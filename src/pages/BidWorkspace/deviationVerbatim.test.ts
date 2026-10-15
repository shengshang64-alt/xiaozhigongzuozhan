import { describe, expect, it } from "vitest"
import {
  checkDeviationAlignment,
  checkQuoteVerbatim,
  deviationVerbatimReport,
  markNonVerbatimRows,
  normalizeQuoteText,
  splitQuoteSegments,
} from "./deviationVerbatim"
import {
  DEVIATION_CLAUSE_SOURCES,
  deviationResponseText,
  extractRequirementClauses,
  sanitizeDeviationRows,
  type DeviationRow,
  type ParseReport,
  type RequirementClause,
} from "./bidTypes"

/**
 * R52（2026-10-15 用户裁定）：偏离表两条硬要求——
 *   ① 一定要原文响应：响应内容必须是投标文件正文的逐字摘录，不能是概括/改写；
 *   ② 招标要求与响应材料一一对应：每条条款一行、不重复、不漏。
 * 本文件锁的是这两条的**程序判定**，不是提示词措辞（措辞由 promptsSnapshot 锁）。
 */

const BID_TEXT = [
  "第五章 售后服务方案",
  "我方承诺提供三年免费质保，质保期内 7×24 小时响应，接报后 2 小时内到场处理。",
  "系统采用国产化数据库，支持达梦、人大金仓等主流国产数据库的平滑迁移。",
].join("\n")

describe("normalizeQuoteText / splitQuoteSegments", () => {
  it("归一化只留汉字字母数字：空白、全角空格、标点、PDF 竖线一律忽略", () => {
    expect(normalizeQuoteText("三年免费质保，7×24 小时")).toBe("三年免费质保724小时")
    expect(normalizeQuoteText("采 | 购 | 人")).toBe("采购人")
    expect(normalizeQuoteText("   ")).toBe("")
  })

  it("省略标记拆段：两端都要逐字命中，短片段（<4 字）不参与", () => {
    expect(splitQuoteSegments("我方承诺提供三年免费质保……接报后 2 小时内到场处理")).toEqual([
      "我方承诺提供三年免费质保",
      "接报后2小时内到场处理",
    ])
    // 「支持」只有 2 字，到处都是，不参与判定
    expect(splitQuoteSegments("支持")).toEqual([])
  })
})

describe("checkQuoteVerbatim：原文响应核对", () => {
  it("逐字摘录（含标点/空格差异）判为原文", () => {
    const r = checkQuoteVerbatim("我方承诺提供三年免费质保，质保期内7×24小时响应", BID_TEXT)
    expect(r.checked).toBe(true)
    expect(r.verbatim).toBe(true)
    expect(r.missing).toEqual([])
  })

  it("用「……」省略中间也算原文（两端逐字）", () => {
    const r = checkQuoteVerbatim("我方承诺提供三年免费质保……接报后 2 小时内到场处理", BID_TEXT)
    expect(r.verbatim).toBe(true)
  })

  it("改写成同义摘要判为非原文，并点名检索不到的片段", () => {
    const r = checkQuoteVerbatim("已承诺三年免费质保并提供 7×24 小时运维响应", BID_TEXT)
    expect(r.checked).toBe(true)
    expect(r.verbatim).toBe(false)
    expect(r.missing.length).toBeGreaterThan(0)
  })

  it("把招标要求抄成响应内容（正文里没有）判为非原文", () => {
    const r = checkQuoteVerbatim("投标人须提供不少于三年的免费质保服务", BID_TEXT)
    expect(r.verbatim).toBe(false)
  })

  it("响应内容为空 / 全是短片段 / 正文为空时不判非原文（没有可比的东西）", () => {
    expect(checkQuoteVerbatim("", BID_TEXT).checked).toBe(false)
    expect(checkQuoteVerbatim("支持", BID_TEXT).checked).toBe(false)
    expect(checkQuoteVerbatim("我方承诺提供三年免费质保", "").checked).toBe(false)
  })
})

const rowOf = (over: Partial<DeviationRow> = {}): DeviationRow =>
  ({
    clause_id: "c1",
    clause_text: "投标人须提供三年免费质保",
    source: "交货和服务要求",
    response_node: "第五章 售后服务",
    response_level: "full",
    response_summary: "",
    bid_ref: "5.1",
    ...over,
  }) as DeviationRow

describe("markNonVerbatimRows / deviationVerbatimReport", () => {
  it("原文行不打标，非原文行打标", () => {
    const rows = [
      rowOf({ response_text: "我方承诺提供三年免费质保" }),
      rowOf({ clause_id: "c2", response_text: "已按要求提供完善售后服务体系" }),
    ]
    const marked = markNonVerbatimRows(rows, BID_TEXT)
    expect(marked[0].not_verbatim).toBeUndefined()
    expect(marked[1].not_verbatim).toBe(true)
  })

  it("「待人工核对」行不参与原文核对（本来就没有可比对的响应）", () => {
    const rows = [rowOf({ response_text: "已按要求提供完善售后服务体系", needs_review: true })]
    expect(markNonVerbatimRows(rows, BID_TEXT)[0].not_verbatim).toBeUndefined()
  })

  it("正文为空时原样返回，不误标", () => {
    const rows = [rowOf({ response_text: "已按要求提供完善售后服务体系" })]
    expect(markNonVerbatimRows(rows, "   ")[0].not_verbatim).toBeUndefined()
  })

  it("统计：原文 / 非原文 / 缺响应内容三类分开数，待核对行不计入分母", () => {
    const rep = deviationVerbatimReport([
      rowOf({ response_text: "我方承诺提供三年免费质保" }),
      rowOf({ clause_id: "c2", response_text: "已按要求提供完善售后服务体系", not_verbatim: true }),
      rowOf({ clause_id: "c3", response_text: "" }),
      rowOf({ clause_id: "c4", response_text: "本次注入范围内无可见证据，需人工核对未注入部分", needs_review: true }),
    ])
    expect(rep).toEqual({ total: 4, checked: 2, verbatim: 1, not_verbatim: 1, missing_text: 1 })
  })

  it("存量数据（只有 response_summary）走同一读入口，不因缺新字段被判非原文", () => {
    const legacy = rowOf({ response_summary: "我方承诺提供三年免费质保" })
    expect(deviationResponseText(legacy)).toBe("我方承诺提供三年免费质保")
    expect(markNonVerbatimRows([legacy], BID_TEXT)[0].not_verbatim).toBeUndefined()
  })
})

const clause = (id: string, text: string, no = ""): RequirementClause => ({
  id,
  text,
  source: "交货和服务要求",
  no,
})

describe("checkDeviationAlignment：招标要求 ↔ 响应材料一一对应", () => {
  it("行数=条款数且不重复时对齐", () => {
    const a = checkDeviationAlignment([rowOf(), rowOf({ clause_id: "c2" })], [clause("c1", "甲"), clause("c2", "乙")])
    expect(a).toEqual({ clause_count: 2, row_count: 2, missing: [], duplicated: [] })
  })

  it("缺行与重复行都被点名", () => {
    const a = checkDeviationAlignment(
      [rowOf(), rowOf()],
      [clause("c1", "甲"), clause("c2", "乙")],
    )
    expect(a.missing).toEqual(["c2"])
    expect(a.duplicated).toEqual(["c1"])
  })
})

describe("sanitizeDeviationRows：原文响应与一一对应的规整口径", () => {
  const clauses = [clause("c1", "投标人须提供三年免费质保", "5.1"), clause("c2", "须支持国产数据库", "5.2")]

  it("response_text 进原文列并带上条款原编号", () => {
    const rows = sanitizeDeviationRows(
      { rows: [{ clause_id: "c1", response_level: "完全响应", response_text: "我方承诺提供三年免费质保", bid_ref: "5.1", evidence_ref: "第5章 售后服务/块1" }] },
      clauses,
    )
    expect(rows[0].response_text).toBe("我方承诺提供三年免费质保")
    expect(rows[0].clause_no).toBe("5.1")
    expect(rows[0].evidence_ref).toBe("第5章 售后服务/块1")
    expect(deviationResponseText(rows[0])).toBe("我方承诺提供三年免费质保")
  })

  it("同一条款多行只留第一行（重复行会破坏一一对应）", () => {
    const rows = sanitizeDeviationRows(
      {
        rows: [
          { clause_id: "c1", response_level: "完全响应", response_text: "我方承诺提供三年免费质保" },
          { clause_id: "c1", response_level: "偏离", response_text: "质保一年" },
          { clause_id: "c2", response_level: "完全响应", response_text: "支持国产数据库" },
        ],
      },
      clauses,
    )
    expect(rows.map((r) => r.clause_id)).toEqual(["c1", "c2"])
    expect(rows[0].response_level).toBe("full")
  })

  it("AI 漏答的条款补「部分响应·待人工核对」行，保证行数=条款数", () => {
    const rows = sanitizeDeviationRows({ rows: [{ clause_id: "c1", response_level: "完全响应", response_text: "我方承诺提供三年免费质保" }] }, clauses)
    expect(rows.length).toBe(2)
    expect(rows[1].clause_id).toBe("c2")
    expect(rows[1].response_level).toBe("partial")
    expect(rows[1].needs_review).toBe(true)
  })

  it("只给 response_summary 的存量契约仍可用（原文列回退读摘要）", () => {
    const rows = sanitizeDeviationRows({ rows: [{ clause_id: "c1", response_level: "完全响应", response_summary: "已承诺三年质保" }] }, clauses)
    expect(rows[0].response_text).toBeUndefined()
    expect(deviationResponseText(rows[0])).toBe("已承诺三年质保")
  })
})

describe("条款来源口径：偏离表只取技术文件要求", () => {
  const report = {
    scope: "full",
    sections: [
      { key: "delivery_req", title: "交货和服务要求", content: "5.1 系统须支持国产化数据库，兼容主流国产操作系统\n5.2 提供三年免费质保与 7×24 小时运维响应" },
      { key: "tech_score", title: "技术评分要求", content: "技术方案（20 分）：优（15-20 分），需提供完整技术架构说明" },
      { key: "response_req", title: "响应文件要求", content: "投标文件须胶装成册，正本一份副本四份，签字并加盖公章" },
    ],
  } as ParseReport

  it("默认口径（其他功能）仍取三类来源", () => {
    const all = extractRequirementClauses(report, { granularity: "system" })
    expect(all.length).toBe(4)
  })

  it("偏离表口径只取交货和服务要求，并保留招标文件原编号", () => {
    const only = extractRequirementClauses(report, { granularity: "system", sources: DEVIATION_CLAUSE_SOURCES })
    expect(only.length).toBe(2)
    expect(only.map((c) => c.no)).toEqual(["5.1", "5.2"])
    expect(only.every((c) => c.source === "交货和服务要求")).toBe(true)
  })

  it("裸数字行（「3 年质保」）不当作条款编号，避免把数量当编号", () => {
    const rep = {
      scope: "full",
      sections: [{ key: "delivery_req", title: "交货和服务要求", content: "3 年质保服务由原厂提供并包含现场支持" }],
    } as ParseReport
    const cs = extractRequirementClauses(rep, { granularity: "system", sources: DEVIATION_CLAUSE_SOURCES })
    expect(cs[0].no).toBe("")
  })
})
