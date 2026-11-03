// D3/R89 consistencyGuard：prompt 快照 + 结果清洗 + 预算闸
import { describe, expect, it } from "vitest"

import {
  buildConsistencyGuardMessages,
  checkBudgetGate,
  sanitizeConsistencyIssues,
  type GuardChapterInput,
} from "./consistencyGuard"

const input: GuardChapterInput = {
  chapterTitle: "第三章 项目实施方案",
  chapterBody: "本项目总投资预算为2500万元，建设周期18个月，服务床位1200张。",
  globalFacts: "项目总投资：4000万元；建设周期：12个月；服务床位：2000张",
  tenderFragment: "预算金额：人民币肆仟万元整（¥40,000,000）",
  kbContext: "三级甲等综合医院信息化建设项目方案参考",
}

describe("buildConsistencyGuardMessages", () => {
  it("返回 2 条 system+user 消息", () => {
    const msgs = buildConsistencyGuardMessages(input)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe("system")
    expect(msgs[1].role).toBe("user")
  })

  it("system 含三类规则关键词", () => {
    const { content } = buildConsistencyGuardMessages(input)[0]
    expect(content).toContain("量化依据")
    expect(content).toContain("量级自洽")
    expect(content).toContain("政策时效")
  })

  it("user 含章节标题与事实表", () => {
    const { content } = buildConsistencyGuardMessages(input)[1]
    expect(content).toContain("第三章 项目实施方案")
    expect(content).toContain("总投资：4000万元")
  })

  it("空辅助字段不崩溃", () => {
    const empty: GuardChapterInput = { ...input, globalFacts: "", tenderFragment: "", kbContext: "" }
    const msgs = buildConsistencyGuardMessages(empty)
    expect(msgs[1].content).not.toContain("全局事实表")
  })
})

describe("sanitizeConsistencyIssues", () => {
  it("正常条目全保留", () => {
    const raw = [
      { rule: "quant_basis", severity: "critical", issue: "金额不一致", location: "第三章", evidence: "2500万", suggestion: "对齐招标" },
      { rule: "magnitude_coherence", severity: "major", issue: "周期矛盾", location: "第三章", evidence: "18月", suggestion: "修正" },
      { rule: "policy_currency", severity: "minor", issue: "政策过期", location: "第一章", evidence: "2021-2025", suggestion: "更新" },
    ]
    const out = sanitizeConsistencyIssues(raw)
    expect(out).toHaveLength(3)
    expect(out[0].rule).toBe("quant_basis")
    expect(out[2].severity).toBe("minor")
  })

  it("非法 rule/severity 归默认值", () => {
    const raw = [{ rule: "unknown", severity: "extreme", issue: "X", location: "", evidence: "", suggestion: "" }]
    const out = sanitizeConsistencyIssues(raw)
    expect(out[0].rule).toBe("quant_basis")
    expect(out[0].severity).toBe("minor")
  })

  it("空/非数组返回空", () => {
    expect(sanitizeConsistencyIssues(null)).toEqual([])
    expect(sanitizeConsistencyIssues("text")).toEqual([])
    expect(sanitizeConsistencyIssues([])).toEqual([])
  })

  it("去重：同 rule+前40字一致=合并", () => {
    const dup = [
      { rule: "quant_basis", severity: "major", issue: "金额A金额B金额C金额D金额E", location: "", evidence: "", suggestion: "" },
      { rule: "quant_basis", severity: "minor", issue: "金额A金额B金额C金额D金额E", location: "", evidence: "", suggestion: "" },
    ]
    expect(sanitizeConsistencyIssues(dup)).toHaveLength(1)
  })
})

describe("checkBudgetGate", () => {
  it("限额内放行", () => {
    expect(checkBudgetGate(10, 0.5).allowed).toBe(true)
  })
  it("次数超限拦截", () => {
    const r = checkBudgetGate(150, 3)
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain("上限")
  })
  it("费用超限拦截", () => {
    expect(checkBudgetGate(10, 5.1).allowed).toBe(false)
  })
})
// normalizeSubmissionCheck 数据容错回归：consistency_issues 保留/null 语义/坏条目清洗
import { normalizeSubmissionCheck } from "../bidTypes"

describe("normalizeSubmissionCheck consistency_issues", () => {
  it("数组字段逐条清洗后保留", () => {
    const raw = {
      items: [],
      checked_at: "2026-09-30T10:00:00Z",
      fact_conflicts: [],
      consistency_issues: [
        { rule: "policy_currency", severity: "major", issue: "规划已过期", location: "第一章", evidence: "2021-2025", suggestion: "更新口径" },
        { rule: "bogus", severity: "extreme", issue: "X" },
      ],
    }
    const out = normalizeSubmissionCheck(raw)
    expect(out?.consistency_issues).toHaveLength(2)
    expect(out?.consistency_issues?.[0].rule).toBe("policy_currency")
    expect(out?.consistency_issues?.[1].rule).toBe("quant_basis")
    expect(out?.consistency_issues?.[1].severity).toBe("minor")
  })

  it("缺字段=null（未跑语义），老数据不崩", () => {
    const old = { items: [], checked_at: "2026-09-30T10:00:00Z", fact_conflicts: [] }
    expect(normalizeSubmissionCheck(old)?.consistency_issues ?? null).toBe(null)
  })
})
// 快照锁字（与 promptsSnapshot 同规范）：任何顺手改提示词都会在这里现形，改字必须走 B 类流程 PROMPT_VERSION+1
describe("consistencyGuard prompt 快照", () => {
  it("system+user 全文锁定", () => {
    expect(buildConsistencyGuardMessages(input)).toMatchSnapshot()
  })
})
