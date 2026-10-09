// 知识库分类与 AI 上下文策略（轮次 D-1）：
// 七档分类 + 默认策略表（合同商务/资质证书默认脱敏摘要且不进 AI 原文），
// kbCore 检索、useKnowledge 问答、assistantCore 小智注入三处共用，避免口径漂移。

import type { KbDocRow } from "@/lib/kbCore"
import { redactPii } from "@/lib/piiRedact"

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
    if (summary) return `（脱敏摘要，原文不进 AI 上下文）${redactPii(summary)}`
    const keywords = (doc.keywords ?? []).map((k) => String(k)).join("、")
    return `（脱敏摘要，原文不进 AI 上下文）${redactPii(doc.title)}${keywords ? `；关键词：${redactPii(keywords)}` : ""}`
  }
  // original 档但被显式标记敏感（is_sensitive）：原文仍进 AI，但先二次掩码 PII（AGENTS.md #7）
  return policy.is_sensitive ? redactPii(hit.snippet) : hit.snippet
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

// ---------------------------------------------------------------------------
// 内容感知分类（本地导入批量用，不依赖大模型）：
// 文件名 + 正文开头片段一起打分，命中关键词最多的类别胜出；全 0 回退文件名猜测。
// 关键词表按医疗售前材料实际语料调校，命中优先级：政策法规 > 资质证书 > 合同商务 > 项目案例 > 产品资料 > 技术方案。
// ---------------------------------------------------------------------------

const CONTENT_CATEGORY_RULES: { category: KbCategory; words: string[] }[] = [
  {
    category: "政策法规",
    words: ["标准与规范", "建设标准", "分级评价", "分级评估", "测评方案", "管理规范", "管理办法", "指导意见", "试点方案", "国家标准", "卫生行业标准", "卫健委", "国家卫生健康委", "政策法规", "考核指标", "评审标准"],
  },
  {
    category: "资质证书",
    words: ["营业执照", "资质证书", "CMMI", "ISO9001", "ISO14001", "ISO20000", "软件著作权", "软件产品登记", "信用等级", "等级保护测评", "授权书", "资格证明", "许可证"],
  },
  {
    category: "合同商务",
    words: ["报价表", "分项报价", "报价一览", "供应商", "合同条款", "采购需求", "商务偏离", "商务条款", "付款", "税率", "开标", "控制价", "最高限价", "协议"],
  },
  {
    category: "项目案例",
    words: ["投标文件", "响应文件", "谈判响应", "投标函", "技术响应", "业绩", "案例介绍", "验收报告", "实施总结", "客户汇报", "交流汇报", "首次交流", "现场汇报", "应答"],
  },
  {
    category: "产品资料",
    words: ["产品介绍", "产品彩页", "产品手册", "功能清单", "白皮书", "公司简介", "整体解决方案", "展会", "宣传", "产品优势", "核心产品", "能力介绍"],
  },
  {
    category: "技术方案",
    words: ["建设方案", "规划方案", "建设规划", "总体架构", "技术方案", "初步设计", "详细设计", "需求分析", "建设内容", "技术路线", "可行性", "现状与需求", "系统集成", "数据治理", "设计方案", "解决方案", "升级方案"],
  },
]

/** 结合文件名与正文片段做七类判定；返回带命中的类别与得分最高的词，便于调试 */
export function classifyKbDoc(
  fileName: string,
  content: string,
): { category: KbCategory; score: number } {
  // 出版书/电子书守卫：文件名带 ISBN13（97 开头 13 位）或 ISBN 字样，属外部出版物而非公司材料，
  // 归「其他」且不进敏感档（否则正文含「软件著作权」等词会被误判资质证书并脱敏）。
  if (/97[0-9]{11}|\bISBN\b/i.test(fileName ?? "")) return { category: "其他", score: 0 }
  const hay = `${fileName ?? ""}\n${(content ?? "").replace(/\s+/g, "").slice(0, 4000)}`
  const nameHay = fileName ?? ""
  let best: { category: KbCategory; score: number } = { category: "其他", score: 0 }
  for (const rule of CONTENT_CATEGORY_RULES) {
    let score = 0
    for (const w of rule.words) {
      // 文件名命中权重更高（×3），正文命中 ×1
      const inName = nameHay.includes(w) ? 3 : 0
      const inBody = hay.split(w).length - 1
      score += inName + inBody
    }
    if (score > best.score) best = { category: rule.category, score }
  }
  if (best.score > 0) return best
  return { category: guessCategoryFromFileName(fileName), score: 0 }
}
