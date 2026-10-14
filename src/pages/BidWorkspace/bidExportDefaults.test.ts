// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import { exportBidDocx } from "./bidFiles"
import type { BidProjectRecord } from "./bidTypes"

/**
 * R46 回归：**默认导出（format_settings=null）必须写入字体信息**。
 * 不写字体时 docx 里没有任何 <w:rFonts>，Word 会落到主题默认字体，
 * 既导致「导出的标书字体不是仿宋/黑体」，也让格式识别 / 暗标检查读不到字体。
 */
function project(patch?: Partial<BidProjectRecord>): BidProjectRecord {
  return {
    id: "t1",
    project_name: "默认导出口径实测",
    hospital: "某某医院",
    tender_no: "2026-T-001",
    gen_options: { include_biz: true, include_tech: true },
    bid_chapters: [
      { id: "c1", title: "项目理解与需求响应", part: "tech", sections: ["1.1 现状诊断"], content: "第一段正文。\n1.1 现状诊断\n第二段正文。" } as never,
      { id: "c2", title: "商务响应", part: "biz", sections: ["2.1 报价一览"], content: "" } as never,
    ],
    format_settings: null,
    ...patch,
  } as unknown as BidProjectRecord
}

/** 捕获 downloadDocx 产出的 blob（jsdom 无真实下载） */
async function exportAndReadDocXml(proj: BidProjectRecord): Promise<string> {
  let captured: Blob | null = null
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL
  URL.createObjectURL = ((b: Blob) => { captured = b; return "blob:test" }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  try {
    await exportBidDocx(proj)
  } finally {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    clickSpy.mockRestore()
  }
  expect(captured).not.toBeNull()
  const zip = unzipSync(new Uint8Array(await (captured as unknown as Blob).arrayBuffer()))
  return zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : ""
}

describe("exportBidDocx · 默认导出字体（R46）", () => {
  it("format_settings=null 时正文/标题都写出 <w:rFonts>（仿宋 / 黑体）", async () => {
    const doc = await exportAndReadDocXml(project())
    expect(doc).toContain('w:eastAsia="仿宋"')
    expect(doc).toContain('w:eastAsia="黑体"')
    expect(doc).toContain('w:ascii="FangSong"')
    expect(doc).toContain('w:ascii="SimHei"')
  })

  it("不存在「只有字号、没有字体」的裸运行", async () => {
    const doc = await exportAndReadDocXml(project())
    expect((doc.match(/<w:rPr><w:sz /g) ?? []).length).toBe(0)
    const rPrCount = (doc.match(/<w:rPr>/g) ?? []).length
    const rFontsCount = (doc.match(/<w:rFonts/g) ?? []).length
    expect(rFontsCount).toBeGreaterThanOrEqual(rPrCount)
  })

  it("已配置格式的导出路径同样写出字体（回归护栏）", async () => {
    const proj = project({
      format_settings: {
        paper: "A4",
        margins: { top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 },
        heading: [0, 1, 2, 3, 4, 5].map(() => ({ font: "黑体", size: "三号", align: "left" })) as never,
        body: { font: "仿宋", size: "四号", firstIndent: 2, align: "justify", lineSpacing: "1.5倍" },
        table: { border: "0.5pt", contentFont: "宋体五号" },
        toc: false,
        pageNumber: false,
        headerFooter: false,
        titleNumbering: "1.1.1",
        sealed: false,
        sealedPages: null,
        sealedDeclarationPage: false,
      } as never,
    })
    const doc = await exportAndReadDocXml(proj)
    expect(doc).toContain('w:eastAsia="仿宋"')
    expect(doc).toContain('w:eastAsia="黑体"')
  })
})
