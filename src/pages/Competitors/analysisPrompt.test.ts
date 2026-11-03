import { describe, expect, it } from "vitest"
import { ANALYSIS_SYSTEM_PROMPT } from "./useCompetitorAnalysis"

// ---------------------------------------------------------------------------
// 批次 X1 · System Prompt 关键禁令回归
//
// 旧版 Prompt 里出现「优先引用 IDC 报告、上市公司年报等权威来源」，直接邀请模型
// 从记忆里编数据 → 用户反馈"很多是不对的"根源。本测试锁定三个"必须不出现"的短语
// 与一个"必须出现"的硬约束，防止未来回退。
// ---------------------------------------------------------------------------

describe("ANALYSIS_SYSTEM_PROMPT · 严格内部事实模式", () => {
  it("旧版邀请幻觉的短语必须不出现", () => {
    // 「IDC」—— 邀请从记忆里编市场份额
    expect(ANALYSIS_SYSTEM_PROMPT).not.toMatch(/IDC\s*报告/)
    // 「权威来源」—— 邀请未列出的外部数据源
    expect(ANALYSIS_SYSTEM_PROMPT).not.toContain("权威来源")
    // 「行业惯例」—— 邀请无证据的通用性结论
    expect(ANALYSIS_SYSTEM_PROMPT).not.toContain("行业惯例")
  })

  it("必须包含的核心约束存在", () => {
    // 只能引用 USER 消息给出的事实片段
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("只能引用")
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("事实片段")
    // 每条建议必须附 evidence_refs
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("evidence_refs")
    // confidence 语义：high = 3+ 独立事实
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/3\+?\s*条/)
    // 空事实段直接说"不生成建议"
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/不生成建议|不出现在 updates/)
  })

  it("示例 evidence id 前缀覆盖 4 类源（供模型模仿）", () => {
    // cr / cust / kb / intel 四种前缀都必须在示例里出现
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("cr:")
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("cust:")
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("kb:")
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("intel:")
  })

  it("可选 field 白名单未丢失（回归 AI 输出结构约束）", () => {
    for (const f of [
      "positioning",
      "products",
      "regions",
      "customer_profile",
      "certifications",
      "ai_evolution",
      "xinchuang",
      "strengths",
      "weaknesses",
      "threat_notes",
      "summary",
    ]) {
      expect(ANALYSIS_SYSTEM_PROMPT).toContain(f)
    }
  })
})
