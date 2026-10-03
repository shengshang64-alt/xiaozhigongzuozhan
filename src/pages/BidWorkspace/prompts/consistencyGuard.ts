// ---------------------------------------------------------------------------
// D3/R89 AI 内容护栏 consistencyGuard（规则 ②量化依据 / ③量级自洽 / ④政策时效）
// 只报不拦：结果并入交卷体检 format_issues，零 schema 变更。
// ---------------------------------------------------------------------------

import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/** consistencyGuard 结果条目（兼容 FormatIssue 结构 + 额外规则维度字段） */
export type ConsistencyIssue = {
  issue: string
  severity: "critical" | "major" | "minor"
  location: string
  suggestion: string
  /** 所属规则：quant_basis / magnitude_coherence / policy_currency */
  rule: "quant_basis" | "magnitude_coherence" | "policy_currency"
  /** 支撑判定的原文摘录（≤60字） */
  evidence: string
}

/** 规则/严重度中文标签（体检面板渲染用） */
export const CONSISTENCY_RULE_LABEL: Record<ConsistencyIssue["rule"], string> = {
  quant_basis: "量化依据",
  magnitude_coherence: "量级自洽",
  policy_currency: "政策时效",
}
export const CONSISTENCY_SEVERITY_LABEL: Record<ConsistencyIssue["severity"], string> = {
  critical: "严重",
  major: "警告",
  minor: "提示",
}

/** 逐章护栏入参（由调用方裁剪 token 后传入） */
export type GuardChapterInput = {
  chapterTitle: string
  chapterBody: string        // 前 6000 字裁剪后
  globalFacts: string        // 事实表（≤2000 字）
  tenderFragment: string     // 招标原文相关片段（≤2000 字）
  kbContext: string          // KB 检索同赛道文档（≤2000 字）
}

/** 构造逐章护栏检测 messages */
export function buildConsistencyGuardMessages(input: GuardChapterInput): LlmMessage[] {
  const system = [
    "你是医疗信息化标书质量审核专家，逐条检查投标正文中的内容护栏合规性。",
    "检查范围（只查这三类）：",
    "② 量化依据：正文中的关键数字（工期/人数/金额/响应时间/设备数量等）是否有招标原文或全局事实依据，禁止无中生有；",
    "③ 量级自洽：数字量级是否合理自洽（预算与报价匹配、并发与床位数匹配、人员规模与项目规模匹配等）；",
    "④ 政策时效：引用的政策/标准/评级/行动方案是否现行有效（已过期、已废止、或被新版替代均视为问题）。",
    "判定口径：",
    "- 找不到对应依据但数字看起来合理=minor；数字明显矛盾=critical；量级偏差在合理范围外=major；引用政策已废止=major；",
    "- 只报问题条目，合规内容不报；没有问题就输出空数组，禁止为凑数编造问题；",
    "- 每条 issue 必须附 evidence（正文中对应原文摘录，≤60字）与出处（全局事实/招标片段中对应条目的关键句）；",
    "- 处置由用户判断，不自动改写任何正文内容。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"rule":"quant_basis","severity":"critical","issue":"","location":"","evidence":"","suggestion":""}]',
  ].join("\n")
  const user = [
    input.globalFacts ? `【全局事实表】\n${input.globalFacts}` : "",
    input.tenderFragment ? `【招标原文片段】\n${input.tenderFragment}` : "",
    input.kbContext ? `【知识库参考（同赛道文档片段）】\n${input.kbContext}` : "",
    `【待检章节：${input.chapterTitle}】\n${input.chapterBody}`,
    "请按规则②③④逐条检查，输出 JSON 数组（无问题则输出 []）。",
  ].filter(Boolean).join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 解析 LLM 护栏输出 → ConsistencyIssue[]（容错+去重+severity 归一） */
export function sanitizeConsistencyIssues(raw: unknown): ConsistencyIssue[] {
  const arr = Array.isArray(raw) ? raw : []
  const VALID_RULES = new Set(["quant_basis", "magnitude_coherence", "policy_currency"])
  const VALID_SEV = new Set(["critical", "major", "minor"])
  const out: ConsistencyIssue[] = []
  const seen = new Set<string>()
  for (const it of arr) {
    if (!it || typeof it !== "object") continue
    const r = it as Record<string, unknown>
    const issue = String(r.issue ?? r.problem ?? "").trim()
    if (!issue) continue
    const rule = String(r.rule ?? "").trim()
    const severity = String(r.severity ?? "minor").trim()
    const dedup = rule + "|" + issue.slice(0, 40)
    if (seen.has(dedup)) continue
    seen.add(dedup)
    out.push({
      rule: (VALID_RULES.has(rule) ? rule : "quant_basis") as ConsistencyIssue["rule"],
      severity: (VALID_SEV.has(severity) ? severity : "minor") as ConsistencyIssue["severity"],
      issue: issue.slice(0, 200),
      location: String(r.location ?? "").trim().slice(0, 100),
      evidence: String(r.evidence ?? "").trim().slice(0, 120),
      suggestion: String(r.suggestion ?? "").trim().slice(0, 150),
    })
  }
  return out
}

/** 预算闸：无人在场自主模式，每日 AI 调用限额判断 */
export const DAILY_AI_BUDGET_LIMIT = 150  // 次/天
export const DAILY_AI_COST_LIMIT = 5.0    // 元/天

export type BudgetGateResult = {
  allowed: boolean
  reason?: string
}

/** 简易预算闸（调用前检查当日已用量是否达上限） */
export function checkBudgetGate(
  todayCallCount: number,
  todayCostYuan: number,
): BudgetGateResult {
  if (todayCallCount >= DAILY_AI_BUDGET_LIMIT) {
    return { allowed: false, reason: `当日 AI 调用已达上限(${DAILY_AI_BUDGET_LIMIT}次)，跳过护栏检查` }
  }
  if (todayCostYuan >= DAILY_AI_COST_LIMIT) {
    return { allowed: false, reason: `当日 AI 费用已达上限(${DAILY_AI_COST_LIMIT}元)，跳过护栏检查` }
  }
  return { allowed: true }
}
// ------------------- 日用量记录（localStorage 轻量计数，预算闸数据源） -------------------

const DAY_KEY_PREFIX = "bid_ai_daily_"

function todayKey(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${DAY_KEY_PREFIX}${d.getFullYear()}-${mm}-${dd}`
}

/** 读当日已用量（次数；费用本机无精确口径恒报 0，由次数限额兜底） */
export function readTodayAiUsage(): { count: number; costYuan: number } {
  try {
    const raw = localStorage.getItem(todayKey())
    if (!raw) return { count: 0, costYuan: 0 }
    const rec = JSON.parse(raw) as { count?: number; cost?: number }
    return { count: Number(rec.count) || 0, costYuan: Number(rec.cost) || 0 }
  } catch {
    return { count: 0, costYuan: 0 }
  }
}

/** 记一次 AI 调用（护栏路每章调用后调用；localStorage 不可用时静默） */
export function recordAiCall(costYuan = 0): void {
  try {
    const cur = readTodayAiUsage()
    localStorage.setItem(todayKey(), JSON.stringify({ count: cur.count + 1, cost: cur.costYuan + costYuan }))
  } catch {
    /* 静默：用量记录失败不阻断业务 */
  }
}
