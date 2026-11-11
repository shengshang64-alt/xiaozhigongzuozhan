import { describe, expect, it } from "vitest"
import {
  buildExportComposeModel,
  buildExportFiles,
  buildVolumeRows,
  formatSummary,
} from "./exportComposeModel"
import { DEFAULT_FORMAT_SETTINGS, type BidProjectRecord } from "./bidTypes"
import type { Chapter } from "../SolutionStudio/solutionTypes"

// UX-v2 ⑦ 组卷导出：三块数据都必须来自项目档案真值。
// 这组测试锁三件事：
//   ① 组卷顺序 = 导出真正写入的章序（章 → 卷，无正文的章也在，只是页数按 1 页算）；
//   ② 前置件按真开关出（toc 关了就标「可选」并说明已关闭，不假装有目录）；
//   ③ 导出清单不预填体积，未就绪项如实说缺什么。

const chapter = (over: Partial<Chapter>): Chapter => ({
  node_id: over.node_id ?? "n1",
  title: over.title ?? "技术方案",
  sections: [],
  content: over.content ?? "",
  gen_status: "done",
  part: over.part,
  ...over,
})

const fmt = (over: Partial<typeof DEFAULT_FORMAT_SETTINGS> = {}) => ({ ...DEFAULT_FORMAT_SETTINGS, ...over })

const project = (over: Partial<BidProjectRecord> = {}): BidProjectRecord =>
  ({
    id: "p1",
    project_name: "测试项目",
    tender_no: "ZB-1",
    hospital: "某医院",
    bid_open_date: "",
    stage: "composing",
    tender_text: "",
    tender_files: [],
    parse_report: null,
    parse_config: null,
    bid_outline: [],
    bid_chapters: [],
    response_map: null,
    dup_report: null,
    void_check: null,
    ai_review: null,
    manual_review: null,
    ...over,
  }) as BidProjectRecord

describe("buildVolumeRows · 组卷顺序 = 导出真正写入的章序", () => {
  it("前置件：封面必选；目录随 toc 开关；对照表只在有匹配行时出现", () => {
    const base = { chapters: [], format: fmt() }
    const withToc = buildVolumeRows({ ...base, hasCatalogIndex: false })
    expect(withToc.map((v) => v.id)).toEqual(["front-cover", "front-toc"])
    expect(withToc.every((v) => v.required)).toBe(true)

    const noToc = buildVolumeRows({ ...base, format: fmt({ toc: false }), hasCatalogIndex: false })
    const tocRow = noToc.find((v) => v.id === "front-toc")
    expect(tocRow?.required).toBe(false)
    expect(tocRow?.note).toContain("已关闭目录")

    const withCatalog = buildVolumeRows({ ...base, hasCatalogIndex: true })
    expect(withCatalog.some((v) => v.id === "front-catalog")).toBe(true)
  })

  it("每章一行，页数按字数折算；空章仍占 1 页并说明「只有章标题」", () => {
    const rows = buildVolumeRows({
      chapters: [
        chapter({ node_id: "a", title: "技术方案", content: "正文".repeat(1900) }), // 3800 字 / 950 ≈ 4 页
        chapter({ node_id: "b", title: "培训方案", content: "" }),
      ],
      format: fmt(),
      hasCatalogIndex: false,
    })
    const tech = rows.find((r) => r.id === "ch-a")
    expect(tech?.pages).toBe(4)
    expect(tech?.kind).toBe("tech")

    const empty = rows.find((r) => r.id === "ch-b")
    expect(empty?.pages).toBe(1)
    expect(empty?.note).toContain("还没有正文")
  })

  it("商务章标 biz 且说明「线下填写」；前置件页数给 null（不编页数）", () => {
    const rows = buildVolumeRows({
      chapters: [chapter({ node_id: "biz1", title: "投标函", part: "biz", content: "" })],
      format: fmt(),
      hasCatalogIndex: false,
    })
    expect(rows.find((r) => r.id === "ch-biz1")?.kind).toBe("biz")
    expect(rows.find((r) => r.id === "ch-biz1")?.note).toContain("线下填写")
    expect(rows.find((r) => r.id === "front-cover")?.pages).toBeNull()
  })
})

describe("buildExportFiles · 导出清单不预填体积", () => {
  it("全空项目：七项全部未就绪，且每项都说明缺什么", () => {
    const files = buildExportFiles({
      project: project(),
      chapters: [],
      bodyPages: 0,
      techParamTotal: 0,
      techParamCovered: 0,
      deviationRows: 0,
    })
    expect(files).toHaveLength(7)
    expect(files.every((f) => !f.ready)).toBe(true)
    expect(files.every((f) => f.desc.length > 4)).toBe(true)
  })

  it("有正文 / 有偏离表 / 有报告时对应项就绪", () => {
    const files = buildExportFiles({
      project: project({
        dup_report: { items: [] } as never,
        ai_review: { items: [{}, {}] } as never,
        parse_report: { scope: "key", sections: [{ key: "void_items", title: "v", content: "x" }] } as never,
      }),
      chapters: [chapter({ content: "正文" })],
      bodyPages: 1,
      techParamTotal: 10,
      techParamCovered: 0,
      deviationRows: 3,
    })
    const byKey = Object.fromEntries(files.map((f) => [f.key, f]))
    expect(byKey.bid.ready).toBe(true)
    expect(byKey.techparam.ready).toBe(true)
    expect(byKey.deviation.ready).toBe(true)
    expect(byKey.parse.ready).toBe(true)
    expect(byKey.check.ready).toBe(true)
    expect(byKey.eval.ready).toBe(true)
    expect(byKey.eval.desc).toContain("2")
    // 采购清单：既没上传表格也没有解析分区 → 未就绪
    expect(byKey.purchase.ready).toBe(false)
  })

  it("desc 里不出现编造的文件体积（KB / MB）", () => {
    const files = buildExportFiles({
      project: project(),
      chapters: [chapter({ content: "正文" })],
      bodyPages: 3,
      techParamTotal: 5,
      techParamCovered: 5,
      deviationRows: 5,
    })
    for (const f of files) {
      expect(/\d+(\.\d+)?\s*(KB|MB|GB)/.test(f.desc)).toBe(false)
    }
  })
})

describe("buildExportComposeModel · 汇总口径", () => {
  it("chapterCount / bodyPages 只算正文，不含前置件", () => {
    const m = buildExportComposeModel({
      project: project(),
      chapters: [
        chapter({ node_id: "a", content: "正".repeat(950) }), // 1 页
        chapter({ node_id: "b", content: "正".repeat(1900) }), // 2 页
      ],
      format: fmt(),
      hasCatalogIndex: false,
      techParamTotal: 0,
      techParamCovered: 0,
      deviationRows: 0,
    })
    expect(m.chapterCount).toBe(2)
    expect(m.bodyPages).toBe(3)
    // 卷数含前置件
    expect(m.volumes.length).toBe(4)
  })
})

describe("formatSummary · 版式一句话", () => {
  it("把纸型/字体/行距/目录/页码说清", () => {
    const s = formatSummary(fmt())
    expect(s).toContain("A4")
    expect(s).toContain("含目录")
    expect(s).toContain("有页码")
    expect(formatSummary(fmt({ toc: false, pageNumber: false }))).toContain("无页码")
  })
})
