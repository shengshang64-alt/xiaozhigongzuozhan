// ---------------------------------------------------------------------------
// semanticReview.ts —— L5-D AI 语义复核（置信度标注）
//
// 在本地检查 runCheck 完成后，用户可选触发「AI 复核」：
// 把 fail/warn 项的 rule + hit text + paragraph 上下文发给 LLM，
// 请求对每条判定「确实是问题」的置信度（0.0~1.0），填入 CheckItem.confidence。
//
// 设计原则：
//  - 只标注不改变 status：AI 仅填 confidence 字段，不翻转 pass/fail；
//  - 批量控制成本：一次最多 10 条；cacheable=true 重复调用不额外计费；
//  - 降级友好：AI 不可用时 toast 提示，不崩流程。
// ---------------------------------------------------------------------------

import type { CheckItem } from "./bidCheckTypes"

// ---- 对外类型 ----

/** AI 复核结果：每条 item code 对应一个置信度分数 + 简短理由 */
export type ReviewResult = {
  code: string
  confidence: number
  reasoning: string
}

/**
 * R273：AI 复核理由挂在会话态字段上（不写库、不改 collection）；
 * toExcel / 标注版 docx 维持既有列，置信度数字复用既有 confidence 列。
 */
export type ReviewAnnotatedItem = CheckItem & { confidenceReasoning?: string }

/** 复核输入摘要（给 AI 看的最小上下文） */
export type ReviewInput = {
  code: string
  title: string
  severity: string
  status: string
  basis: string
  hitText: string
  paragraphText: string
}

// ---- 常量 ----

/** 单次 AI 复核最大条数（控制 token 费用） */
export const REVIEW_BATCH_MAX = 10

/** 从 hit text 取摘要的最大字符数 */
const HIT_EXCERPT_MAX = 160

/** 从 paragraph 取上下文的字符数（前后各取） */
const CONTEXT_MAX = 200

// ---- 核心函数 ----

/**
 * 从检查结果中筛选需要 AI 复核的条目（status = fail 或 warn）。
 * 按 severity 降序排列（critical > high > medium > info），取前 REVIEW_BATCH_MAX 条。
 */
export function pickReviewCandidates(items: CheckItem[]): CheckItem[] {
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 }
  const flagged = items.filter((it) => it.status === "fail" || it.status === "warn")
  flagged.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
  return flagged.slice(0, REVIEW_BATCH_MAX)
}

/**
 * 把 CheckItem 转换为 ReviewInput（喂给 prompt 的最小上下文）。
 */
export function buildReviewInputs(items: CheckItem[]): ReviewInput[] {
  return items.map((it) => {
    const firstHit = it.hits[0]
    const hitText = clip(firstHit?.text ?? "", HIT_EXCERPT_MAX)
    const paraText = clip(firstHit?.paragraphText ?? firstHit?.text ?? "", CONTEXT_MAX)
    return {
      code: it.code,
      title: it.title,
      severity: it.severity,
      status: it.status,
      basis: clip(it.basis, 120),
      hitText,
      paragraphText: paraText,
    }
  })
}

/**
 * 构建发送给 LLM 的 system+user 消息内容（JSON 结构化响应）。
 */
export function buildReviewPrompt(inputs: ReviewInput[]): { system: string; user: string } {
  const system = [
    "你是标书合规检查 AI 复核助手。",
    "用户给你一组本地规则检测出的疑似违规条目，每条包含规则名、检测依据、命中原文、段落上下文。",
    "你的任务：对每一条判断「这是否确实是一个需要投标人整改的问题」，给出置信度（0.0~1.0）和一句话理由。",
    "判定准则：",
    "- 1.0 = 确定是问题（如暗标出现公司名、确实缺必填材料）",
    "- 0.7~0.9 = 很可能是问题，但存在合理解释空间",
    "- 0.3~0.6 = 可能是误报（如引用格式正常但被正则误匹配、表格布局误判）",
    "- 0.0~0.2 = 基本确定是误报",
    '严格返回 JSON 数组，不要包裹在 markdown 代码块中：[{"code":"L1-1","confidence":0.85,"reasoning":"..."}]',
  ].join("\n")

  const userLines = inputs.map((inp) =>
    `- code=${inp.code} | 规则=${inp.title} | 严重度=${inp.severity} | 判定状态=${inp.status}\n` +
    `  依据: ${inp.basis}\n` +
    `  命中原文: ${inp.hitText}\n` +
    `  段落上下文: ${inp.paragraphText}`,
  )
  const user =
    `请对以下 ${inputs.length} 条检测疑似问题逐条给出置信度：\n\n` +
    userLines.join("\n\n") +
    "\n\n请以 JSON 数组返回。"

  return { system, user }
}

/**
 * 容错解析 AI 返回的 JSON（处理 markdown 代码块包裹、多余文字等）。
 */
export function parseReviewResponse(text: string): ReviewResult[] {
  const cleaned = (text ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  // 找 JSON 数组
  const start = cleaned.indexOf("[")
  const end = cleaned.lastIndexOf("]")
  if (start < 0 || end <= start) return []
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as unknown[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x) => ({
        code: String(x.code ?? ""),
        confidence: clampConfidence(Number(x.confidence)),
        reasoning: String(x.reasoning ?? x.reason ?? ""),
      }))
      .filter((r) => r.code)
  } catch {
    return []
  }
}

/**
 * 将 AI 复核结果写回 items 数组的 confidence 字段（+ 会话态理由字段）。
 * 返回新数组（不 mutate），只有 candidates 中的 code 会被标注。
 */
export function applyConfidence(items: CheckItem[], results: ReviewResult[]): CheckItem[] {
  const map = new Map(results.map((r) => [r.code, r]))
  return items.map((it) => {
    const r = map.get(it.code)
    if (!r) return it
    const next: ReviewAnnotatedItem = { ...it, confidence: r.confidence }
    if (r.reasoning) next.confidenceReasoning = r.reasoning
    return next
  })
}

/**
 * 验证并归一化置信度值。
 */
function clampConfidence(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 100) / 100
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + "\u2026"
}
