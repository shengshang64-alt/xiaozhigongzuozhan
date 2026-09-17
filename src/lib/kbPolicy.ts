// 知识库分类与 AI 上下文策略（轮次 D-1）：
// 七档分类 + 默认策略表（合同商务/资质证书默认脱敏摘要且不进 AI 原文），
// kbCore 检索、useKnowledge 问答、assistantCore 小智注入三处共用，避免口径漂移。

import type { KbDocRow } from "@/lib/kbCore"

// ---------------------------------------------------------------------------
// 分类七档与默认策略表
// ---------------------------------------------------------------------------

export const KB_CATEGORIES = [
  "产品资料",
  "技术方案",
  "项目案例",
  "政策法规",
  "合同商务",
  "资质证书",
  "其他",
] as const

export type KbCategory = (typeof KB_CATEGORIES)[number]

export type AiContextMode = "original" | "sanitized_summary" | "blocked"

export interface KbCategoryPolicy {
  ai_context_mode: AiContextMode
  retrieval_weight: number
  is_sensitive: boolean
}

export const KB_CATEGORY_POLICY: Record<string, KbCategoryPolicy> = {
  合同商务: { ai_context_mode: "sanitized_summary", retrieval_weight: 0.5, is_sensitive: true },
  资质证书: { ai_context_mode: "sanitized_summary", retrieval_weight: 0.5, is_sensitive: true },
  产品资料: { ai_context_mode: "original", retrieval_weight: 1.2, is_sensitive: false },
  技术方案: { ai_context_mode: "original", retrieval_weight: 1.2, is_sensitive: false },
  项目案例: { ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false },
  政策法规: { ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false },
  其他: { ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false },
}

export const AI_CONTEXT_MODE_LABELS: Record<AiContextMode, string> = {
  original: "原文",
  sanitized_summary: "脱敏摘要",
  blocked: "禁止进 AI",
}

/** doc 自带分类（非法/空一律归「其他」） */
export function categoryOf(doc: Pick<KbDocRow, "doc_category"> | null | undefined): string {
  const raw = doc?.doc_category ?? ""
  return (KB_CATEGORIES as readonly string[]).includes(raw) ? raw : "其他"
}

function isExplicitMode(value: unknown): value is AiContextMode {
  return value === "original" || value === "sanitized_summary" || value === "blocked"
}

/** 文档显式设置过策略（ai_context_mode 非空）则整体以显式值为准，否则取分类默认 */
export function effectivePolicy(doc: KbDocRow): KbCategoryPolicy {
  const base = KB_CATEGORY_POLICY[categoryOf(doc)] ?? KB_CATEGORY_POLICY["其他"]
  if (isExplicitMode(doc.ai_context_mode)) {
    return {
      ai_context_mode: doc.ai_context_mode,
      retrieval_weight:
        typeof doc.retrieval_weight === "number" && doc.retrieval_weight > 0
          ? doc.retrieval_weight
          : base.retrieval_weight,
      is_sensitive: doc.is_sensitive === true,
    }
  }
  return base
}

/** 进 AI 上下文与引用摘录使用的片段：sanitized_summary 文档只给摘要，绝不出现原文 */
export function contextSnippetOf(doc: KbDocRow, hit: { snippet: string }): string {
  const policy = effectivePolicy(doc)
  if (policy.ai_context_mode === "sanitized_summary") {
    const summary = (doc.summary ?? "").trim()
    if (summary) return `（脱敏摘要，原文不进 AI 上下文）${summary}`
    const keywords = (doc.keywords ?? []).map((k) => String(k)).join("、")
    return `（脱敏摘要，原文不进 AI 上下文）${doc.title}${keywords ? `；关键词：${keywords}` : ""}`
  }
  return hit.snippet
}

// ---------------------------------------------------------------------------
// 上传按文件名智能预选分类（轮次 D-1）
// ---------------------------------------------------------------------------

const FILENAME_CATEGORY_RULES: { re: RegExp; category: KbCategory }[] = [
  { re: /合同|商务|报价单/, category: "合同商务" },
  { re: /资质|证书|许可/, category: "资质证书" },
  { re: /案例|业绩/, category: "项目案例" },
  { re: /政策|法规|标准|规范/, category: "政策法规" },
  { re: /方案|技术/, category: "技术方案" },
  { re: /产品|彩页|手册/, category: "产品资料" },
]

export function guessCategoryFromFileName(fileName: string): KbCategory {
  const name = fileName ?? ""
  for (const rule of FILENAME_CATEGORY_RULES) {
    if (rule.re.test(name)) return rule.category
  }
  return "其他"
}
