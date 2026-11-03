import { describe, expect, it } from "vitest"
import { analysisReportToText } from "./analysisReport"
import type { AnalysisResult } from "./useCompetitorAnalysis"

const result = {
  updates: [{ field: "市场份额", confidence: "high", reason: "中标数量从 12 涨到 20", evidence_refs: ["ev1"] }],
  threat_level_change: "up",
  action_items: ["在标书中强调我方数据迁移能力"],
  materials: [{ kind: "cr", label: "版权软著", count: 8 }],
} as unknown as AnalysisResult

describe("analysisReportToText · 竞品分析报告可带走文本（R59）", () => {
  it("拼出含威胁变化/更新建议/行动建议/材料清单的完整文本", () => {
    const out = analysisReportToText("卫宁健康", result)
    expect(out).toContain("「卫宁健康」竞品档案 AI 深度分析")
    expect(out).toContain("威胁等级变化：↑ 上升")
    expect(out).toContain("- 市场份额（置信度 high）：中标数量从 12 涨到 20")
    expect(out).toContain("- 在标书中强调我方数据迁移能力")
    expect(out).toContain("- 版权软著：8 条")
  })

  it("空结果不产生空小节", () => {
    const out = analysisReportToText("东软", {
      updates: [],
      threat_level_change: "stable",
      action_items: [],
    } as unknown as AnalysisResult)
    expect(out).toContain("威胁等级变化：→ 持平")
    expect(out).not.toContain("可更新字段")
    expect(out).not.toContain("行动建议")
  })
})
