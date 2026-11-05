/** @vitest-environment jsdom */
/**
 * R1（整仓重构 · 标书内核拆分）**拆分回归网**：记录层与正文取数层的对外契约。
 *
 * 为什么需要这个文件——R1 的验收句是「行为对外不变」，而拆分的风险恰好不在
 * 「新模块写错」，而在**接线悄悄变了**：
 *   · 导出 API 从 `useBidWorkspace` 取不到（页面 import 断了，tsc 才发现）；
 *   · 内部调用点改读另一份实现（同一个数字两处算法，正是本仓反复踩过的坑）；
 *   · 双模式正文（external/internal）在搬家时丢掉一条分支。
 *
 * 所以这里钉三件事：
 *   ① 新模块与 hook 的 re-export 是**同一个函数对象**（不是两份拷贝）；
 *   ② 库列归一的宽容语义（缺列 / 空串 / 脏值）逐条不变；
 *   ③ 正文双模式与条款归章的口径不变。
 *
 * 纯 node 环境即可跑（不挂 jsdom）：本文件只测纯函数，不渲染组件。
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import * as record from "./bidRecord"
import * as body from "./bidBodyText"
import * as hook from "./useBidWorkspace"
import type { BidProjectRecord, RequirementClause, OutlineCoverageItem } from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

describe("① 导出 API 兼容：hook 的 re-export 必须与新模块是同一实现", () => {
  it("记录层 6 个符号经 useBidWorkspace 取到的就是 bidRecord 的那一份", () => {
    expect(hook.asArrayField).toBe(record.asArrayField)
    expect(hook.readOutlineDraft).toBe(record.readOutlineDraft)
    expect(hook.writeOutlineDraft).toBe(record.writeOutlineDraft)
    expect(hook.clearOutlineDraft).toBe(record.clearOutlineDraft)
    // normalizeRecord / sortOppsByHospital 是内部实现，经 re-export 后应同样同一引用
    expect(hook.normalizeRecord).toBe(record.normalizeRecord)
    expect(hook.sortOppsByHospital).toBe(record.sortOppsByHospital)
  })

  it("正文取数层 6 个符号经 useBidWorkspace 取到的就是 bidBodyText 的那一份", () => {
    expect(hook.chaptersToTextStub).toBe(body.chaptersToTextStub)
    expect(hook.isExternalBid).toBe(body.isExternalBid)
    expect(hook.resolveBidText).toBe(body.resolveBidText)
    expect(hook.bidChaptersFor).toBe(body.bidChaptersFor)
    expect(hook.auditLeafExcerpt).toBe(body.auditLeafExcerpt)
    expect(hook.mapClausesToChapters).toBe(body.mapClausesToChapters)
  })
})

describe("② 库列归一：宽容缺列 / 空串 / 脏值（归档页白屏事故的守卫）", () => {
  const minimal = { id: "p1" } as unknown as BidProjectRecord

  it("最小记录（只有 id）能归一，不乱抛", () => {
    const rec = record.normalizeRecord(minimal)
    expect(rec.id).toBe("p1")
    expect(rec.bid_outline).toEqual([])
    expect(rec.bid_chapters).toEqual([])
    expect(rec.tender_files).toEqual([])
    expect(rec.tender_text).toBe("")
    expect(rec.hospital).toBe("")
    expect(rec.bid_open_date).toBe("")
    expect(rec.stage).toBe("pending_parse")
  })

  it("JSON 列存成空字符串时归一为 []（?? 挡不住 ''，这就是事故值）", () => {
    const rec = record.normalizeRecord({
      id: "p2",
      bid_chapters: "",
      bid_outline: "  ",
      response_map: "",
    } as unknown as BidProjectRecord)
    expect(rec.bid_chapters).toEqual([])
    expect(rec.bid_outline).toEqual([])
    expect(rec.response_map).toBeNull()
  })

  it("已是数组时原样保留内容（不复制、不重排）", () => {
    const chapters = [{ node_id: "c1", title: "第一章", sections: [], content: "x", gen_status: "done" }]
    const rec = record.normalizeRecord({ id: "p3", bid_chapters: chapters } as unknown as BidProjectRecord)
    expect(rec.bid_chapters).toEqual(chapters)
    expect(rec.bid_chapters[0].node_id).toBe("c1")
  })

  it("数值列越界/非法一律回落默认（页面不显示 NaN）", () => {
    const rec = record.normalizeRecord({
      id: "p4",
      target_pages: "abc",
      outline_level: 9,
      section_words: 10,
      bid_amount: -5,
      bid_result: "不存在的值",
    } as unknown as BidProjectRecord)
    expect(rec.target_pages).toBeNull()
    expect(rec.outline_level).toBe(0)
    expect(rec.section_words).toBeNull()
    expect(rec.bid_amount).toBeNull()
    expect(rec.bid_result).toBe("")
  })

  it("合法值不被误伤（页面该显示的仍然显示）", () => {
    const rec = record.normalizeRecord({
      id: "p5",
      target_pages: 120,
      outline_level: 2,
      section_words: 800,
      bid_amount: 1_250_000,
      bid_result: "won",
      figures_enabled: false,
    } as unknown as BidProjectRecord)
    expect(rec.target_pages).toBe(120)
    expect(rec.outline_level).toBe(2)
    expect(rec.section_words).toBe(800)
    expect(rec.bid_amount).toBe(1_250_000)
    expect(rec.bid_result).toBe("won")
    expect(rec.figures_enabled).toBe(false)
  })
})

describe("② 大纲草稿留档：按项目隔离，存储异常静默降级", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("写入后可读回同一份大纲", () => {
    const nodes = [{ id: "n1", title: "总则", children: [] }]
    record.writeOutlineDraft("proj-a", nodes)
    expect(record.readOutlineDraft("proj-a")).toEqual(nodes)
  })

  it("项目之间互不串味（按 id 分键）", () => {
    record.writeOutlineDraft("proj-a", [{ id: "a", title: "A", children: [] }])
    record.writeOutlineDraft("proj-b", [{ id: "b", title: "B", children: [] }])
    expect(record.readOutlineDraft("proj-a")?.[0].id).toBe("a")
    expect(record.readOutlineDraft("proj-b")?.[0].id).toBe("b")
  })

  it("清掉之后读不到（确认大纲 / 重置项目后不应复活旧草稿）", () => {
    record.writeOutlineDraft("proj-a", [{ id: "n1", title: "总则", children: [] }])
    record.clearOutlineDraft("proj-a")
    expect(record.readOutlineDraft("proj-a")).toBeNull()
  })

  it("空 id / 空数组一律视为无草稿", () => {
    expect(record.readOutlineDraft(null)).toBeNull()
    expect(record.readOutlineDraft(undefined)).toBeNull()
    expect(record.readOutlineDraft("")).toBeNull()
    record.writeOutlineDraft("proj-c", [])
    expect(record.readOutlineDraft("proj-c")).toBeNull()
  })

  it("localStorage 抛异常时不连累编辑（隐私模式 / 超配额）", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    expect(() => record.writeOutlineDraft("proj-d", [{ id: "n", title: "t", children: [] }])).not.toThrow()
    spy.mockRestore()
  })
})

describe("③ 正文双模式：external 用上传全文，internal 用编制章节", () => {
  const internalChapters = [
    { node_id: "c1", title: "技术方案", sections: [], content: "内部正文一", gen_status: "done" as const },
  ]

  it("internal：正文取编制章节，章节结构原样透传", () => {
    const cur = { bid_source_mode: "internal", bid_chapters: internalChapters } as unknown as BidProjectRecord
    expect(body.resolveBidText(cur)).toContain("内部正文一")
    expect(body.bidChaptersFor(cur)).toEqual(internalChapters)
  })

  it("external：正文取外部全文，章节合成单章 stub", () => {
    const cur = {
      bid_source_mode: "external",
      bid_external_text: "外部投标全文",
      bid_chapters: internalChapters,
    } as unknown as BidProjectRecord
    expect(body.resolveBidText(cur)).toContain("外部投标全文")
    const chs = body.bidChaptersFor(cur)
    expect(chs).toHaveLength(1)
    expect(chs[0].content).toBe("外部投标全文")
  })

  it("external 但全文为空：章节给空数组（不能凭空造一章空正文）", () => {
    const cur = { bid_source_mode: "external", bid_external_text: "   ", bid_chapters: internalChapters } as unknown as BidProjectRecord
    expect(body.bidChaptersFor(cur)).toEqual([])
  })

  it("老数据缺 bid_source_mode：按 internal 容错（行为与现状一致）", () => {
    const cur = { bid_chapters: internalChapters } as unknown as BidProjectRecord
    expect(body.isExternalBid(cur)).toBe(false)
    expect(body.bidChaptersFor(cur)).toEqual(internalChapters)
  })
})

describe("③ 条款归章：只归技术章、每章上限 15 条", () => {
  const chapters = [
    { title: "技术方案", sections: ["系统架构"] },
    { title: "商务响应", sections: [], part: "biz" },
  ]

  it("coverage 命中的条款归到技术章，商务章不承接", () => {
    const clauses: RequirementClause[] = [{ id: "R1", text: "须提供系统架构说明" } as RequirementClause]
    const coverage: OutlineCoverageItem[] = [{ clause_id: "R1", node_title: "系统架构" } as OutlineCoverageItem]
    const per = body.mapClausesToChapters(clauses, coverage, chapters)
    expect(per[0].map((c) => c.id)).toEqual(["R1"])
    expect(per[1]).toEqual([])
  })

  it("无 coverage 时按相似度兜底，且仍不进商务章", () => {
    const clauses: RequirementClause[] = [{ id: "R2", text: "系统架构应采用微服务" } as RequirementClause]
    const per = body.mapClausesToChapters(clauses, [], chapters)
    expect(per[1]).toEqual([])
    expect(per.flat().map((c) => c.id)).toContain("R2")
  })

  it("空条款 / 空章节不抛错，返回与章节等长的空槽位", () => {
    expect(body.mapClausesToChapters([], [], chapters)).toEqual([[], []])
    const per = body.mapClausesToChapters([], [], [])
    expect(per).toEqual([])
  })

  it("每章最多 15 条（防止 prompt 无上限膨胀）", () => {
    const clauses = Array.from({ length: 30 }, (_, i) => ({ id: `R${i}`, text: `技术方案 要求 ${i}` }) as RequirementClause)
    const coverage = clauses.map((c) => ({ clause_id: c.id, node_title: "系统架构" }) as OutlineCoverageItem)
    const per = body.mapClausesToChapters(clauses, coverage, chapters)
    expect(per[0].length).toBeLessThanOrEqual(15)
  })
})

describe("③ 审计节摘录：优先确定性切片，缺失时回退标题行定位", () => {
  const chapter = {
    node_id: "c1",
    title: "技术方案",
    sections: ["系统架构", "实施计划"],
    section_stats: [
      { title: "系统架构", chars: 20 },
      { title: "实施计划", chars: 20 },
    ],
    content: "1.1 系统架构\n采用微服务架构。\n1.2 实施计划\n分三期推进。",
    gen_status: "done" as const,
  } as unknown as Chapter

  it("能取到目标节的正文，且不含别的小节", () => {
    const got = body.auditLeafExcerpt(chapter, "系统架构")
    expect(got).toContain("微服务")
    expect(got).not.toContain("分三期")
  })

  it("章节缺失 / 无正文时返回空串，不抛错", () => {
    expect(body.auditLeafExcerpt(undefined, "任意")).toBe("")
    expect(body.auditLeafExcerpt({ content: "" } as unknown as Chapter, "任意")).toBe("")
  })

  it("节标题为空时给出章节开头（按 max 截断）", () => {
    const got = body.auditLeafExcerpt(chapter, "", 10)
    expect(got.length).toBeLessThanOrEqual(10)
  })
})
