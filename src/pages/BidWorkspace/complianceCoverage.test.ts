import { describe, expect, it } from "vitest"
import {
  auditComplianceCoverage,
  buildCompliancePendingText,
  clauseMatchKeys,
  COMPLIANCE_COVERAGE_LABEL,
  COMPLIANCE_COVERAGE_ORDER,
} from "./complianceCoverage"
import type { ComplianceRow } from "./complianceMatrix"
import type { Chapter } from "../SolutionStudio/solutionTypes"

const ch = (over: Partial<Chapter>): Chapter =>
  ({ node_id: "n", title: "章", sections: [], content: "", gen_status: "pending", ...over }) as Chapter

const star = (id: string, text: string): ComplianceRow => ({ id, kind: "star", text, mandatory: true })
const other = (id: string, kind: ComplianceRow["kind"], text: string): ComplianceRow => ({
  id,
  kind,
  text,
  mandatory: kind !== "comp",
})

describe("auditComplianceCoverage · 只核 ★ 条款", () => {
  it("非 star 行不参与判定，byRow 只含 star 行", () => {
    const rows = [
      star("s1", "门急诊挂号系统响应时间≤3秒"),
      other("v1", "void", "投标文件未密封的作废标处理"),
      other("q1", "qual", "具备医疗器械经营许可证"),
    ]
    const r = auditComplianceCoverage(rows, [ch({ node_id: "a", title: "技术方案", content: "响应时间控制在 3 秒以内。" })])
    expect(r.total).toBe(1)
    expect(Object.keys(r.byRow)).toEqual(["s1"])
    expect(r.byRow["v1"]).toBeUndefined()
  })

  it("无 star 行时零耗降级（total=0，counts 全 0）", () => {
    const r = auditComplianceCoverage([other("v1", "void", "未密封作废标")], [ch({ content: "正文" })])
    expect(r.total).toBe(0)
    expect(r.responded).toBe(0)
    expect(r.pending).toBe(0)
    expect(r.counts.full).toBe(0)
  })
})

describe("auditComplianceCoverage · 四态判定", () => {
  const rows = [star("s1", "数据处理能力 日均门诊15000人次")]

  it("正文全部要点命中 → full", () => {
    const r = auditComplianceCoverage(rows, [
      ch({ node_id: "a", title: "性能", content: "系统支持日均门诊 15000 人次的数据处理能力。" }),
    ])
    expect(r.byRow["s1"].level).toBe("full")
    expect(r.responded).toBe(1)
    expect(r.pending).toBe(0)
    expect(r.byRow["s1"].missingKeys).toEqual([])
    expect(r.byRow["s1"].bodyChapters[0].title).toBe("性能")
  })

  it("正文命中部分要点 → partial，未命中要点进 missingKeys", () => {
    const r = auditComplianceCoverage(rows, [ch({ node_id: "a", content: "具备数据处理能力。" })])
    expect(r.byRow["s1"].level).toBe("partial")
    expect(r.byRow["s1"].missingKeys.length).toBeGreaterThan(0)
    expect(r.counts.partial).toBe(1)
  })

  it("仅章节标题命中、正文未命中 → outline", () => {
    const r = auditComplianceCoverage(rows, [
      ch({ node_id: "a", title: "日均门诊15000人次数据处理", content: "本章介绍系统总体架构。" }),
    ])
    expect(r.byRow["s1"].level).toBe("outline")
    expect(r.byRow["s1"].bodyChapters).toEqual([])
    expect(r.byRow["s1"].outlineChapters.length).toBeGreaterThan(0)
  })

  it("正文与大纲都没出现 → missing", () => {
    const r = auditComplianceCoverage(rows, [ch({ node_id: "a", title: "网络设计", content: "介绍组网拓扑。" })])
    expect(r.byRow["s1"].level).toBe("missing")
  })

  it("跨章合并：要点分散在多章正文里也能命中", () => {
    const r = auditComplianceCoverage(rows, [
      ch({ node_id: "a", content: "日均门诊 15000 人次" }),
      ch({ node_id: "b", content: "完善的数据处理能力" }),
    ])
    expect(r.byRow["s1"].level).toBe("full")
    expect(r.byRow["s1"].bodyChapters.length).toBe(2)
  })

  it("正文未生成（generatedChapters=0）时不算命中，但记录章数供展示层改口", () => {
    const r = auditComplianceCoverage(rows, [ch({ node_id: "a", title: "日均门诊15000人次数据处理", content: "   " })])
    expect(r.generatedChapters).toBe(0)
    expect(r.chapterCount).toBe(1)
    expect(r.byRow["s1"].level).toBe("outline")
  })
})

describe("clauseMatchKeys · 复用 R155 分段器", () => {
  it("去泛词、拆标点/连词，长度不足则整条兜底", () => {
    expect(clauseMatchKeys("门急诊挂号系统响应时间≤3秒").length).toBeGreaterThan(0)
    expect(clauseMatchKeys("系统")).toEqual(["系统"])
  })
})

describe("泛化要点（模板词）降权", () => {
  const rows = [
    star("s1", "国密改造（服务类，详见第七章技术参数要求）"),
    star("s2", "信创升级（服务类，详见第七章技术参数要求）"),
    star("s3", "运维服务（服务类，详见第七章技术参数要求）"),
    star("s4", "集成实施（服务类，详见第七章技术参数要求）"),
    star("s5", "培训服务（服务类，详见第七章技术参数要求）"),
    star("s6", "检验设备采购（全自动生化分析仪）"),
  ]

  it("正文只写模板词时不把大批条款升为 partial", () => {
    const chapters = [ch({ node_id: "a", title: "实施范围", content: "本项目按服务类范围实施，详见第七章技术参数要求。" })]
    const r = auditComplianceCoverage(rows, chapters)
    expect(r.boilerplateKeys).toContain("服务类")
    expect(r.counts.partial).toBe(0)
    expect(r.byRow["s1"].level).toBe("missing")
  })

  it("条款数不足门槛（<6）时不做模板词降权", () => {
    const few = rows.slice(0, 3)
    const r = auditComplianceCoverage(few, [ch({ content: "服务类" })])
    expect(r.boilerplateKeys).toEqual([])
  })
})

describe("buildCompliancePendingText · 待核对清单", () => {
  it("全部命中时返回空串", () => {
    const rows = [star("s1", "响应时间")]
    const r = auditComplianceCoverage(rows, [ch({ content: "优化响应时间" })])
    if (r.byRow["s1"].level === "full") {
      expect(buildCompliancePendingText(r, rows)).toBe("")
    }
  })

  it("未全命中时按严重度分组并列出未见要点", () => {
    const rows = [star("s1", "日均门诊15000人次数据处理")]
    const r = auditComplianceCoverage(rows, [ch({ content: "具备数据处理能力" })])
    const text = buildCompliancePendingText(r, rows)
    if (r.pending > 0) {
      expect(text).toContain("★ 技术条款正文待核对清单")
      expect(text).toContain("正文未见要点")
    }
  })
})

describe("标签与排序口径", () => {
  it("四态标签齐全，排序以 missing 在前 full 在后", () => {
    expect(Object.keys(COMPLIANCE_COVERAGE_LABEL).sort()).toEqual(["full", "missing", "outline", "partial"])
    expect(COMPLIANCE_COVERAGE_ORDER[0]).toBe("missing")
    expect(COMPLIANCE_COVERAGE_ORDER[COMPLIANCE_COVERAGE_ORDER.length - 1]).toBe("full")
  })
})
