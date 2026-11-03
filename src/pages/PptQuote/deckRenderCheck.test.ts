import { describe, expect, it } from "vitest"
import {
  checkPageGeometry,
  checkPagePixels,
  checkRenderedDeck,
  findBlankRegions,
  measureInk,
  renderReportSummary,
  type Bitmap,
  type RenderedBox,
} from "./deckRenderCheck"

// ---------------------------------------------------------------------------
// 补齐 5 验收测试：PPT 渲染后质量检查
//
// 需求：「导出后将 PPTX 渲染为页面图片，检查实际效果；只检查 JSON 字数不算完成验收。」
//
// 本测试用**构造的渲染结果**验证检测规则（不依赖 LibreOffice），
// 覆盖实测踩过的真实事故类型。
// ---------------------------------------------------------------------------

const CANVAS = { width: 1280, height: 720 }

function box(p: Partial<RenderedBox> & { id: string }): RenderedBox {
  return { kind: "text", x: 100, y: 100, w: 400, h: 60, ...p }
}

/** 构造纯色位图（fill 为亮度值） */
function mkBitmap(width: number, height: number, inkPixels: { x: number; y: number; w: number; h: number }[] = []): Bitmap {
  const data = new Uint8Array(width * height * 4)
  data.fill(255) // 全白
  for (const r of inkPixels) {
    for (let y = r.y; y < r.y + r.h && y < height; y += 1) {
      for (let x = r.x; x < r.x + r.w && x < width; x += 1) {
        const p = (y * width + x) * 4
        data[p] = 30
        data[p + 1] = 30
        data[p + 2] = 30
      }
    }
  }
  return { width, height, data }
}

describe("checkPageGeometry：几何问题", () => {
  it("元素超出画布 → error（导出会被裁切）", () => {
    const issues = checkPageGeometry(1, [box({ id: "t1", x: 1200, w: 400, text: "超出右边" })], CANVAS)
    expect(issues.some((i) => i.code === "out_of_canvas" && i.severity === "error")).toBe(true)
  })

  it("文字重叠 → error（实测真实事故：卡片文字压在序号图标上）", () => {
    const a = box({ id: "a", x: 100, y: 100, w: 300, h: 60, text: "对标电子病历5级" })
    const b = box({ id: "b", x: 120, y: 110, w: 300, h: 60, text: "与互联互通四级甲等" })
    const issues = checkPageGeometry(1, [a, b], CANVAS)
    expect(issues.some((i) => i.code === "text_overlap" && i.severity === "error")).toBe(true)
  })

  it("轻微交叠不报（避免误伤正常排版）", () => {
    const a = box({ id: "a", x: 100, y: 100, w: 300, h: 60 })
    const b = box({ id: "b", x: 390, y: 100, w: 300, h: 60 }) // 只重叠 10px
    const issues = checkPageGeometry(1, [a, b], CANVAS)
    expect(issues.some((i) => i.code === "text_overlap")).toBe(false)
  })

  it("贴近边缘 → warn（可能遮挡 Logo/页脚）", () => {
    const issues = checkPageGeometry(1, [box({ id: "t", x: 2, y: 2, w: 200, h: 40 })], CANVAS)
    expect(issues.some((i) => i.code === "into_safe_margin" && i.severity === "warn")).toBe(true)
  })

  it("字号过小 → warn（投影看不清）", () => {
    const issues = checkPageGeometry(1, [box({ id: "t", fontSizePt: 7 })], CANVAS)
    const hit = issues.find((i) => i.code === "font_too_small")
    expect(hit?.severity).toBe("warn")
    expect(hit?.message).toContain("7pt")
  })

  it("零尺寸元素 → error（渲染异常）", () => {
    const issues = checkPageGeometry(1, [box({ id: "t", w: 0, h: 0 })], CANVAS)
    expect(issues.some((i) => i.code === "zero_size_box")).toBe(true)
  })

  it("正常页面无问题（不误报）", () => {
    const boxes = [
      box({ id: "title", x: 100, y: 60, w: 900, h: 60, text: "标题", fontSizePt: 28 }),
      box({ id: "b1", x: 100, y: 200, w: 400, h: 80, text: "要点一", fontSizePt: 14 }),
      box({ id: "b2", x: 600, y: 200, w: 400, h: 80, text: "要点二", fontSizePt: 14 }),
    ]
    expect(checkPageGeometry(1, boxes, CANVAS)).toHaveLength(0)
  })

  it("问题里带元素 id，便于界面定位高亮", () => {
    const issues = checkPageGeometry(1, [box({ id: "elem-x", x: 1200, w: 400 })], CANVAS)
    expect(issues[0].boxIds).toContain("elem-x")
  })
})

describe("measureInk：有墨率统计", () => {
  it("全白 → 有墨率 0", () => {
    const bm = mkBitmap(100, 100)
    expect(measureInk(bm).inkRatio).toBe(0)
    expect(measureInk(bm).blankRatio).toBe(1)
  })

  it("全黑 → 有墨率 1", () => {
    const bm = mkBitmap(100, 100, [{ x: 0, y: 0, w: 100, h: 100 }])
    expect(measureInk(bm).inkRatio).toBeCloseTo(1, 5)
  })

  it("部分有墨 → 比例正确", () => {
    const bm = mkBitmap(100, 100, [{ x: 0, y: 0, w: 50, h: 100 }])
    expect(measureInk(bm).inkRatio).toBeCloseTo(0.5, 2)
  })
})

describe("checkPagePixels：空白页检测（实测真实事故）", () => {
  it("几乎全白 → blank_page_render error（导出一份有空页的 PPT 是废品）", () => {
    const bm = mkBitmap(400, 300)
    const issues = checkPagePixels(3, bm)
    const hit = issues.find((i) => i.code === "blank_page_render")
    expect(hit).toBeTruthy()
    expect(hit!.severity).toBe("error")
    expect(hit!.page).toBe(3)
  })

  it("内容充足 → 不报空白页", () => {
    const bm = mkBitmap(400, 300, [{ x: 20, y: 20, w: 360, h: 260 }])
    expect(checkPagePixels(1, bm).some((i) => i.code === "blank_page_render")).toBe(false)
  })

  it("大片留白 → large_blank_area warn（观感像资料汇编）", () => {
    // 只在左上角 1/16 区域有内容
    const bm = mkBitmap(400, 300, [{ x: 0, y: 0, w: 100, h: 75 }])
    const issues = checkPagePixels(2, bm)
    expect(issues.some((i) => i.code === "large_blank_area")).toBe(true)
  })
})

describe("findBlankRegions：留白区域定位", () => {
  it("全白图 → 所有格子都空白", () => {
    const bm = mkBitmap(80, 80)
    const regions = findBlankRegions(bm, { gridRows: 2, gridCols: 2 })
    expect(regions).toHaveLength(4)
  })

  it("有内容的格子不报", () => {
    const bm = mkBitmap(80, 80, [{ x: 0, y: 0, w: 40, h: 40 }])
    const regions = findBlankRegions(bm, { gridRows: 2, gridCols: 2 })
    expect(regions).toHaveLength(3) // 只有左上角有内容
  })
})

describe("checkRenderedDeck：整册编排", () => {
  it("全部正常 → pass=true", () => {
    const pages = [
      { page: 1, canvas: CANVAS, boxes: [box({ id: "a", fontSizePt: 20 })], bitmap: mkBitmap(200, 120, [{ x: 10, y: 10, w: 180, h: 100 }]) },
    ]
    const r = checkRenderedDeck(pages)
    expect(r.pass).toBe(true)
    expect(r.errorCount).toBe(0)
  })

  it("有 error → pass=false（据此阻断导出）", () => {
    const pages = [{ page: 2, canvas: CANVAS, bitmap: mkBitmap(200, 120) }] // 空白页
    const r = checkRenderedDeck(pages)
    expect(r.pass).toBe(false)
    expect(r.errorCount).toBe(1)
  })

  it("问题按页码排序，便于逐页修", () => {
    const pages = [
      { page: 5, canvas: CANVAS, bitmap: mkBitmap(100, 100) },
      { page: 2, canvas: CANVAS, bitmap: mkBitmap(100, 100) },
    ]
    const r = checkRenderedDeck(pages)
    const pagesOrdered = r.issues.map((i) => i.page)
    expect(pagesOrdered).toEqual([...pagesOrdered].sort((a, b) => a - b))
  })

  it("同时有 boxes 和 bitmap → 两类检查都跑", () => {
    const pages = [
      {
        page: 1,
        canvas: CANVAS,
        boxes: [box({ id: "t", x: 1200, w: 400 })],
        bitmap: mkBitmap(200, 120, [{ x: 10, y: 10, w: 180, h: 100 }]),
      },
    ]
    const r = checkRenderedDeck(pages)
    expect(r.issues.some((i) => i.code === "out_of_canvas")).toBe(true)
  })
})

describe("renderReportSummary：给人看的一句话", () => {
  it("无问题时报页数", () => {
    const s = renderReportSummary({ pageCount: 12, issues: [], errorCount: 0, warnCount: 0, pass: true })
    expect(s).toContain("12 页")
    expect(s).toContain("未发现版面问题")
  })

  it("有严重问题时列出页码", () => {
    const s = renderReportSummary({
      pageCount: 10,
      issues: [{ page: 3, code: "blank_page_render", severity: "error", message: "x" }],
      errorCount: 1,
      warnCount: 0,
      pass: false,
    })
    expect(s).toContain("1 处严重问题")
    expect(s).toContain("第 3 页")
  })
})
