// Author: loop-R127
// formatSpec 的 docx 识别部分（DOMParser）在 node 环境不可测，但桥接层
// specToFormatSettings / SIZE_PT 是纯查表逻辑且被格式刷新与对比两侧共用，
// 此前 0 直接单测。钉住：字号 0.5pt 圆整、字体枚举降级与 notes 口径、
// 标题缺失逐级回填、正文字号/行距的近似 note 触发边界。
// 注：recognize 侧圆整口径（Math.round(pt*2)/2）在调用点，本测试以传入
// 已圆整值 + 边界值钉住 nearestSize 的「严格最近」选择器行为。
import { describe, expect, it } from "vitest"

import type { FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import { SIZE_PT, specToFormatSettings, type FormatSpec, type HeadingSpec } from "./formatSpec"

const KEYS = ["初号", "小初", "一号", "小一", "二号", "小二", "三号", "小三", "四号", "小四", "五号", "小五"]

function mkHeading(over: Partial<HeadingSpec> = {}): HeadingSpec {
  return {
    level: 1,
    styleId: "1",
    styleName: "heading 1",
    fontEastAsia: "黑体",
    fontAscii: "",
    sizePt: 16,
    bold: true,
    align: "left",
    lineSpacing: "",
    firstLineChars: 0,
    colorRgb: "",
    ...over,
  }
}

function mkSpec(over: Partial<FormatSpec> = {}): FormatSpec {
  return {
    sourceFileName: "格式方案.docx",
    page: {
      paperW: 11906,
      paperH: 16838,
      margin: { top: 2.54, right: 3.18, bottom: 2.54, left: 3.18 },
      paperGuess: "A4",
    },
    body: {
      styleId: "Normal",
      styleName: "Normal",
      fontEastAsia: "仿宋",
      fontAscii: "",
      sizePt: 14,
      bold: false,
      align: "justify",
      lineSpacing: "1.5倍",
      firstLineChars: 2,
      colorRgb: "",
    },
    headings: [],
    paragraphStyleCount: 1,
    styleSample: [],
    ...over,
  }
}

describe("SIZE_PT 字号表", () => {
  it("12 档中文字号齐全且对应标准磅值", () => {
    expect(Object.keys(SIZE_PT).sort()).toEqual([...KEYS].sort())
    expect(SIZE_PT["三号"]).toBe(16)
    expect(SIZE_PT["四号"]).toBe(14)
    expect(SIZE_PT["小四"]).toBe(12)
    expect(SIZE_PT["五号"]).toBe(10.5)
    expect(SIZE_PT["小五"]).toBe(9)
    expect(SIZE_PT["初号"]).toBe(42)
  })
})

describe("specToFormatSettings · 标题映射", () => {
  it("识别到什么映射什么：字体名/就近字号/对齐", () => {
    const { settings, notes } = specToFormatSettings(
      mkSpec({ headings: [mkHeading({ fontEastAsia: "宋体", sizePt: 22, align: "center" })] }),
    )
    expect(settings.heading[0]).toEqual({ font: "宋体", size: "二号", align: "center" })
    expect(notes).toEqual([])
  })

  it("字体枚举降级：黑体变体就近黑体；英文 songti/serif 归宋体，均不产 note", () => {
    const { settings, notes } = specToFormatSettings(
      mkSpec({ headings: [mkHeading({ fontEastAsia: "黑体-简" }), mkHeading({ level: 2, fontEastAsia: "songti" })] }),
    )
    expect(settings.heading[0].font).toBe("黑体")
    expect(settings.heading[1].font).toBe("宋体")
    expect(notes).toEqual([])
  })

  it("含「黑」字的枚举外字体（微软雅黑）→ 关键词命中黑体、不产 note（设计使然）", () => {
    const { settings, notes } = specToFormatSettings(
      mkSpec({ headings: [mkHeading({ fontEastAsia: "微软雅黑" })] }),
    )
    expect(settings.heading[0].font).toBe("黑体")
    expect(notes).toEqual([])
  })

  it("完全枚举外字体（Arial）→ 兜底黑体 + note 点名原名并说明刷新保留", () => {
    const { settings, notes } = specToFormatSettings(
      mkSpec({ headings: [mkHeading({ fontEastAsia: "Arial" })] }),
    )
    expect(settings.heading[0].font).toBe("黑体")
    expect(notes.some((n) => n.includes("Arial") && n.includes("宋体"))).toBe(true)
  })

  it("完全未识别标题 → 六级全部默认黑体三号左对齐", () => {
    const { settings, notes } = specToFormatSettings(mkSpec({ headings: [] }))
    expect(settings.heading).toHaveLength(6)
    expect(settings.heading.every((h) => h.font === "黑体" && h.size === "三号" && h.align === "left")).toBe(true)
    expect(notes).toEqual([])
  })

  it("缺失级别按已有最低级回填（识别一级 22pt 宋体 → 全 6 级同源）", () => {
    const { settings } = specToFormatSettings(mkSpec({ headings: [mkHeading({ sizePt: 22, fontEastAsia: "宋体" })] }))
    expect(settings.heading).toHaveLength(6)
    expect(settings.heading.every((h) => h.font === "宋体" && h.size === "二号")).toBe(true)
  })

  it("字号严格最近：13pt 归小四（差 1）而非四号（差 1）时以先枚举者为准", () => {
    // diff 相等时保留先遍历到的档位：FORMAT_SIZE_OPTIONS 中四号在小四之前
    const { settings } = specToFormatSettings(mkSpec({ headings: [mkHeading({ sizePt: 13 })] }))
    expect(settings.heading[0].size).toBe("四号")
    // 13.1pt 则明确更近四号，12.9pt 更近小四
    const a = specToFormatSettings(mkSpec({ headings: [mkHeading({ sizePt: 13.1 })] }))
    expect(a.settings.heading[0].size).toBe("四号")
    const b = specToFormatSettings(mkSpec({ headings: [mkHeading({ sizePt: 12.9 })] }))
    expect(b.settings.heading[0].size).toBe("小四")
  })

  it("字号 0（未设置）→ 兜底四号", () => {
    const { settings } = specToFormatSettings(mkSpec({ headings: [mkHeading({ sizePt: 0 })] }))
    expect(settings.heading[0].size).toBe("四号")
  })
})

describe("specToFormatSettings · 正文与页面", () => {
  it("标准原稿全字段直传：字体字号缩进行距与页面边距纸张", () => {
    const { settings, notes } = specToFormatSettings(mkSpec())
    expect(settings.body).toEqual({ font: "仿宋", size: "四号", firstIndent: 2, align: "justify", lineSpacing: "1.5倍" })
    expect(settings.paper).toBe("A4")
    expect(settings.margins).toEqual({ top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 })
    expect(notes).toEqual([])
  })

  it("lineSpacing 合法归一值（含固定值N磅）不误报 note", () => {
    for (const ls of ["单倍", "1.5倍", "2倍", "固定值28磅"]) {
      const { notes } = specToFormatSettings(mkSpec({ body: { ...mkSpec().body, lineSpacing: ls } }))
      expect(notes).toEqual([])
    }
  })

  it("lineSpacing 超出档位（1.2倍）→ note 提示会就近处理", () => {
    const { notes } = specToFormatSettings(mkSpec({ body: { ...mkSpec().body, lineSpacing: "1.2倍" } }))
    expect(notes.some((n) => n.includes("1.2倍") && n.includes("档位"))).toBe(true)
  })

  it("正文字号偏差 >0.6pt（13pt）→ note 记录就近映射", () => {
    const { settings, notes } = specToFormatSettings(mkSpec({ body: { ...mkSpec().body, sizePt: 13 } }))
    expect(settings.body.size).toBe("四号")
    expect(notes.some((n) => n.includes("13pt") && n.includes("四号"))).toBe(true)
  })

  it("正文字号在容差内（14.3pt）→ 不产字号 note", () => {
    const { notes } = specToFormatSettings(mkSpec({ body: { ...mkSpec().body, sizePt: 14.3 } }))
    expect(notes.filter((n) => n.includes("正文字号"))).toEqual([])
  })

  it("纸张与页边距随识别值走（A3 大纸）", () => {
    const { settings } = specToFormatSettings(
      mkSpec({ page: { paperW: 16838, paperH: 23811, margin: { top: 2, bottom: 2, left: 2.5, right: 2.5 }, paperGuess: "A3" } }),
    )
    expect(settings.paper).toBe("A3")
    expect(settings.margins.left).toBe(2.5)
  })

  it("非归一行距字符串（3倍）→ 直传但产 note", () => {
    const { settings, notes } = specToFormatSettings(mkSpec({ body: { ...mkSpec().body, lineSpacing: "3倍" } }))
    expect(settings.body.lineSpacing).toBe("3倍")
    expect(notes.length).toBeGreaterThan(0)
  })

  it("返回值形状：settings 为完整 FormatSettings、notes 为字符串数组", () => {
    const r = specToFormatSettings(mkSpec())
    const s: FormatSettings = r.settings
    expect(s.toc).toBe(true)
    expect(s.sealed).toBe(false)
    expect(Array.isArray(r.notes)).toBe(true)
    expect(r.notes.every((n) => typeof n === "string")).toBe(true)
  })
})
