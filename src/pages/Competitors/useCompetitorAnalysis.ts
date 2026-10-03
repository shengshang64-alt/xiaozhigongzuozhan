// 竞品 AI 深度分析 Hook：读取当前竞品档案 + 内部 4 类事实源（软著/CRM/KB/情报）
// → 调用模型网关生成分析建议 → 用户确认写回。
//
// 批次 X1（严格内部事实模式）：
// - AI 只能引用被喂进来的事实片段；每条 update 必须附 evidence_refs 指向具体 id。
// - 未出现在事实片段中的信息（市场份额、财务数据、行业排名）不得写入 suggested。
// - confidence 语义重定义：high=3+ 独立事实；medium=1-2 条；low=只有间接/孤证或无 refs。
// - parseAnalysisResponse 对 evidence_refs 缺失或全空的建议自动降级为 low。
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { chatViaGateway, type ModelRef } from "@/lib/modelGateway"
import { costTextForModel } from "@/lib/modelGateway"
import type { LlmMessage } from "@/lib/llm"
import { updateCompetitor, type CompetitorPatch, type CompetitorRow } from "./competitorsCore"
import {
  gatherEvidenceBundle,
  type CopyrightFacts,
  type CustomerShare,
  type EvidenceBundle,
  type IntelEvidence,
  type KbEvidence,
} from "./competitorEvidence"

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** @deprecated 保留兼容旧 UI 引用；新代码请从 competitorEvidence 里导入 IntelEvidence */
export interface IntelBrief {
  id: string
  title: string
  summary: string
  published_at: string
  source_name: string
  url: string
}

export interface FieldSuggestion {
  field: keyof CompetitorPatch
  suggested: string
  reason: string
  confidence: "high" | "medium" | "low"
  /** 依据的具体事实片段 id；空数组意味着 AI 未能提供事实支撑，前端会降级为 low */
  evidence_refs?: string[]
}

export interface AnalysisResult {
  updates: FieldSuggestion[]
  threat_level_change: "up" | "stable" | "down"
  action_items: string[]
  /** 材料清单：本次用了哪几类源、覆盖多少条事实（供 UI 展示信任度） */
  materials?: EvidenceBundle["materialSummary"]
}

// ---------------------------------------------------------------------------
// 分析方法论 System Prompt（严格内部事实模式）
// ---------------------------------------------------------------------------

export const ANALYSIS_SYSTEM_PROMPT = `你是一位资深医疗信息化行业竞品分析师，服务于智业软件（厦门）的售前团队。

# 任务
基于给定的**事实片段集合**分析该竞品的近期变化，给出档案字段的更新建议。

# 硬性约束（违反即视为无效输出）
1. 只能引用 USER 消息中给出的事实片段（【软著事实】【CRM 客户占用】【内部知识库】【关联情报】等段落）
2. 每条建议必须附 evidence_refs 数组指向具体片段 id（如 "cr:2026SR0811498", "cust:<hospitalId>:<system>", "kb:<docId>#<chunkIdx>", "intel:<itemId>"）
3. 任何未在事实片段中出现的信息（市场份额、财务数据、行业排名、未列出的产品/客户名单），不得写入 suggested 字段
4. 若某字段无新事实依据，不出现在 updates 中；不得输出“通常/一般/行业情况…”这类无事实支撑的兜底建议
5. 研判类字段（weaknesses / threat_notes）的建议内容须以「研判：」开头，且必须至少引用 1 条事实
6. confidence 定义：
   - high = 有 3+ 条独立事实片段支撑
   - medium = 有 1-2 条直接事实
   - low = 只有间接/孤证，或 evidence_refs 为空
7. 空事实段直接说"该字段无新事实依据，不生成建议"
8. 涉及招投标金额，仅在【招投标中标】段落出现的具体项目才能引用；无该段则跳过相关字段

# 输出格式（严格 JSON，不输出其他文字）
{
  "updates": [
    {
      "field": "字段名",
      "suggested": "建议更新后的完整内容",
      "reason": "为什么要更新（引用具体证据）",
      "confidence": "high|medium|low",
      "evidence_refs": ["cr:2026SR0811498", "cust:abc123:his", ...]
    }
  ],
  "threat_level_change": "up|stable|down",
  "action_items": ["对我方的具体行动建议，每条应能追溯到至少 1 条事实片段"]
}

可选 field 值：positioning, products, regions, customer_profile, certifications, ai_evolution, xinchuang, strengths, weaknesses, threat_notes, summary
每个字段只出现一次或不出现（不表示无需更新）。若当前档案已足够准确且无新事实，updates 为空数组也是正确答案。`

// ---------------------------------------------------------------------------
// 解析 AI 返回 JSON
// ---------------------------------------------------------------------------

/**
 * R145：可被 AI 建议更新并落库的档案字段白名单——与下方 ANALYSIS_SYSTEM_PROMPT 末尾
 * 「可选 field 值：…」同口径（提示词早已声明，本轮把该契约在代码侧落实为确定性校验）。
 * 解析与写回双重拦截：模型（或被污染的事实片段）若返回 name / legal_name / website /
 * software_copyrights / keywords / source / visibility / rh_user_id / id 等非分析目标字段，
 * 会绕过 CompetitorPatch 的 Omit 类型护栏（运行时 `patch[field]=suggested` 不受编译期检查约束），
 * 造成竞品身份覆盖、归属越权、数值/数组列被字符串污染。故这些 field 一律丢弃、不生成建议、不写回。
 */
export const ANALYZABLE_FIELDS: readonly string[] = [
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
]

export function parseAnalysisResponse(text: string): AnalysisResult | null {
  let jsonStr = text.trim()
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim()
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed.updates)) return null
    const updates: FieldSuggestion[] = (parsed.updates as Array<Partial<FieldSuggestion>>)
      .filter(
        (u) =>
          u &&
          typeof u.field === "string" &&
          // R145：仅提示词声明的 11 个分析目标字段可落库；身份/归属/数值/数组/未知字段一律丢弃
          ANALYZABLE_FIELDS.includes(u.field) &&
          typeof u.suggested === "string" &&
          typeof u.reason === "string",
      )
      .map((u) => {
        const rawRefs = Array.isArray(u.evidence_refs) ? u.evidence_refs.filter((x) => typeof x === "string" && x.length > 0) : []
        let conf: "high" | "medium" | "low" = u.confidence === "high" || u.confidence === "medium" || u.confidence === "low" ? u.confidence : "low"
        // 降级：无 evidence_refs → 强制 low；只有 1 条 → 不允许 high；2 条 → 上限 medium
        if (rawRefs.length === 0) conf = "low"
        else if (rawRefs.length === 1 && conf === "high") conf = "medium"
        else if (rawRefs.length === 2 && conf === "high") conf = "medium"
        return {
          field: u.field as FieldSuggestion["field"],
          suggested: String(u.suggested),
          reason: String(u.reason),
          confidence: conf,
          evidence_refs: rawRefs as string[],
        }
      })
    return {
      updates,
      threat_level_change: ["up", "stable", "down"].includes(parsed.threat_level_change) ? parsed.threat_level_change : "stable",
      action_items: Array.isArray(parsed.action_items) ? parsed.action_items.map(String) : [],
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 上下文拼装（把档案 + 事实 bundle 拼成 user message）
// ---------------------------------------------------------------------------

function formatProfileCtx(row: CompetitorRow): string {
  return [
    `【竞品名称】${row.name}（${row.legal_name}）`,
    `【定位】${row.positioning || "空"}`,
    `【产品】${row.products || "空"}`,
    `【区域】${row.regions || "空"}`,
    `【客户画像】${row.customer_profile || "空"}`,
    `【资质】${row.certifications || "空"}`,
    `【AI演进】${row.ai_evolution || "空"}`,
    `【信创】${row.xinchuang || "空"}`,
    `【优势】${row.strengths || "空"}`,
    `【劣势】${row.weaknesses || "空"}`,
    `【威胁与应对】${row.threat_notes || "空"}`,
    `【概览】${row.summary || "空"}`,
    `【关键词】${(row.keywords || []).join(", ")}`,
    `【数据来源】${row.source || "未标注"}`,
  ].join("\n")
}

export function buildUserMessage(row: CompetitorRow, bundle: EvidenceBundle, externalBlock: string): string {
  const ext = externalBlock ? `\n\n${externalBlock}` : ""
  return `请分析以下竞品档案并给出更新建议：\n\n${formatProfileCtx(row)}\n\n===== 事实片段（唯一可引用来源）=====\n\n${bundle.contextString}${ext}\n\n请基于以上事实片段，重点分析：\n1. 是否有新的产品动向 / 客户占用变化 / AI 与信创进展需要补入\n2. 与我方（智业软件）的竞争关系是否需要调整\n3. 现有研判是否需要根据新事实修正\n\n每条 update 必须附 evidence_refs 数组，指向你引用的具体片段 id；无事实依据的字段不要出现在 updates 中。\n只输出 JSON，不输出其他文字。`
}

// ---------------------------------------------------------------------------
// 外部源（X2）：串行 3 路由，总预算 8s，任一失败不阻断
// ---------------------------------------------------------------------------

interface ExternalBidRecord {
  evidenceId: string
  title: string
  url: string
  publishedAt: string
  buyer: string
  amountRaw: string
}

interface ExternalAnnouncement {
  evidenceId: string
  title: string
  url: string
  publishedAt: string
  exchange: string
}

export interface ExternalEvidenceResult {
  bid: ExternalBidRecord[]
  ann: ExternalAnnouncement[]
  copyrightLive: { available: boolean; reason?: string }
  errors: string[]
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const base = getPocketBaseUrl()
  const headers: Record<string, string> = { "Content-Type": "application/json", ...vibexAuthHeaders() }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function buildExternalEvidence(
  company: string,
  legalName: string,
): Promise<ExternalEvidenceResult> {
  const out: ExternalEvidenceResult = { bid: [], ann: [], copyrightLive: { available: false, reason: "未启用" }, errors: [] }
  // 每路 3s 超时；任一失败静默记录到 errors，不阻断
  try {
    const r = await postJson<{ records?: Array<Record<string, string>> }>(
      "/api/competitor-evidence/bid-records",
      { company, legal_name: legalName, window_days: 730 },
      3000,
    )
    out.bid = (r.records || []).slice(0, 15).map((rec, i) => ({
      evidenceId: `bid:${String(rec.id || i)}`,
      title: String(rec.title || ""),
      url: String(rec.url || ""),
      publishedAt: String(rec.published_at || ""),
      buyer: String(rec.buyer || ""),
      amountRaw: String(rec.amount_raw || ""),
    }))
  } catch (e) {
    out.errors.push(`招投标：${e instanceof Error ? e.message : "失败"}`)
  }
  try {
    const r = await postJson<{ announcements?: Array<Record<string, string>> }>("/api/competitor-evidence/listed-announcements", { legal_name: legalName }, 3000)
    out.ann = (r.announcements || []).slice(0, 10).map((a, i) => ({
      evidenceId: `ann:${String(a.id || i)}`,
      title: String(a.title || ""),
      url: String(a.url || ""),
      publishedAt: String(a.published_at || ""),
      exchange: String(a.exchange || ""),
    }))
  } catch (e) {
    out.errors.push(`上市公司公告：${e instanceof Error ? e.message : "失败"}`)
  }
  try {
    const r = await postJson<{ available?: boolean; reason?: string }>("/api/competitor-evidence/copyright-live", { owner: legalName }, 2000)
    out.copyrightLive = { available: !!r.available, reason: String(r.reason || "") }
  } catch {
    out.copyrightLive = { available: false, reason: "外部接口不稳定，回退本地 13,505 条 Excel 基线" }
  }
  return out
}

export function formatExternalBlock(ext: ExternalEvidenceResult): string {
  const parts: string[] = []
  if (ext.bid.length > 0) {
    const rows = ext.bid
      .map(
        (b) =>
          `- [${b.evidenceId}] [${b.publishedAt.slice(0, 10)}] ${b.title} · 采购方：${b.buyer || "未标注"} · 金额：${b.amountRaw || "未披露"}`,
      )
      .join("\n")
    parts.push(`【招投标中标·最近 ${ext.bid.length} 条（ccgp 检索）】\n${rows}`)
  } else {
    parts.push(`【招投标中标】未检索到近期公告（或外部源不可达）。`)
  }
  if (ext.ann.length > 0) {
    const rows = ext.ann.map((a) => `- [${a.evidenceId}] [${a.publishedAt.slice(0, 10)}] (${a.exchange}) ${a.title}`).join("\n")
    parts.push(`【上市公司公告·${ext.ann.length} 条】\n${rows}`)
  }
  return parts.join("\n\n")
}

// ---------------------------------------------------------------------------
// 主 Hook
// ---------------------------------------------------------------------------

export interface UseCompetitorAnalysisOptions {
  modelRef: ModelRef | null
  onSuccess?: () => void
  /** 是否调用 X2 外部源（默认 true；关闭时纯 X1 内部事实模式） */
  enableExternal?: boolean
}

export function useCompetitorAnalysis(opts: UseCompetitorAnalysisOptions) {
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState("")
  const [relatedIntel, setRelatedIntel] = useState<IntelEvidence[]>([])
  const [intelLoading, setIntelLoading] = useState(false)
  const [applied, setApplied] = useState(false)
  const [evidenceBundle, setEvidenceBundle] = useState<EvidenceBundle | null>(null)

  // 关联情报独立加载（供 UI 面板在分析前后展示，与 runAnalysis 分离）
  const loadRelatedIntel = useCallback(async (row: CompetitorRow) => {
    setIntelLoading(true)
    try {
      const items = await gatherEvidenceBundle({ name: row.name, legal_name: row.legal_name, keywords: row.keywords || [], products: row.products })
      setRelatedIntel(items.intel)
    } finally {
      setIntelLoading(false)
    }
  }, [])

  const runAnalysis = useCallback(
    async (row: CompetitorRow) => {
      if (!opts.modelRef) {
        setError("请先配置可用的 AI 模型")
        return
      }
      setAnalyzing(true)
      setResult(null)
      setError("")
      setApplied(false)
      setEvidenceBundle(null)

      // X1：并行拉 4 类内部事实
      const bundle = await gatherEvidenceBundle({
        name: row.name,
        legal_name: row.legal_name,
        keywords: row.keywords || [],
        products: row.products,
      })
      setEvidenceBundle(bundle)
      setRelatedIntel(bundle.intel)

      // X2：可选外部源（招投标 / 上市公告 / 版权局实时）；失败降级为空
      let extBlock = ""
      const materials: AnalysisResult["materials"] = [...bundle.materialSummary]
      if (opts.enableExternal !== false) {
        const ext = await buildExternalEvidence(row.name, row.legal_name)
        extBlock = formatExternalBlock(ext)
        materials.push({ kind: "bid", label: "招投标中标（ccgp 实时）", count: ext.bid.length, note: ext.errors[0] })
        materials.push({ kind: "ann", label: "上市公司公告", count: ext.ann.length, note: ext.errors[1] })
        materials.push({
          kind: "crx",
          label: "版权局实时软著",
          count: 0,
          note: ext.copyrightLive.available ? "外部接口可用" : ext.copyrightLive.reason || "不可用",
        })
      }

      const userMsg = buildUserMessage(row, bundle, extBlock)
      const messages: LlmMessage[] = [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ]

      try {
        const res = await chatViaGateway({
          modelRef: opts.modelRef,
          messages,
          page: "competitors",
          max_tokens: 4096,
          temperature: 0.3,
        })
        if (res.needsLogin) {
          setError("AI 服务需要登录，请先登录后重试")
          setAnalyzing(false)
          return
        }
        if (!res.ok || res.status !== "success") {
          setError(res.error || "AI 分析失败，请稍后重试")
          setAnalyzing(false)
          return
        }
        const parsed = parseAnalysisResponse(res.text || "")
        if (!parsed) {
          setError("AI 返回格式无法解析，请重试")
          setAnalyzing(false)
          return
        }
        parsed.materials = materials
        setResult(parsed)
      } catch (e) {
        setError(e instanceof Error ? e.message : "分析异常")
      } finally {
        setAnalyzing(false)
      }
    },
    [opts.modelRef, opts.enableExternal],
  )

  const applyUpdates = useCallback(
    async (rowId: string, accepted: FieldSuggestion[]) => {
      if (accepted.length === 0) return
      // 二次确认：无事实依据 & 非 low 的建议（防降级未生效），提示"该条无事实依据，确认采纳？"
      const noEvidence = accepted.filter((u) => (u.evidence_refs?.length ?? 0) === 0 && u.confidence !== "low")
      if (noEvidence.length > 0) {
        const ok = window.confirm(`有 ${noEvidence.length} 条建议未附事实依据，确认采纳？`)
        if (!ok) return
      }
      const patch: CompetitorPatch = {}
      for (const u of accepted) {
        // R145：写回侧纵深防御——即使 accepted 从别处流入，也只允许白名单字段落库；
        // 运行时索引写入绕过 CompetitorPatch 类型层 Omit，须在此再兜一道（与解析侧同一白名单）。
        if (ANALYZABLE_FIELDS.includes(String(u.field))) {
          (patch as Record<string, unknown>)[u.field] = u.suggested
        }
      }
      try {
        await updateCompetitor(rowId, patch)
        setApplied(true)
        toast.success(`已采纳 ${accepted.length} 项更新`)
        opts.onSuccess?.()
      } catch {
        toast.error("写回失败，请稍后重试")
      }
    },
    [opts],
  )

  const reset = useCallback(() => {
    setResult(null)
    setError("")
    setApplied(false)
    setEvidenceBundle(null)
  }, [])

  return {
    analyzing,
    result,
    error,
    relatedIntel,
    intelLoading,
    applied,
    evidenceBundle,
    runAnalysis,
    loadRelatedIntel,
    applyUpdates,
    reset,
    costHint: opts.modelRef ? costTextForModel(opts.modelRef) : "",
  }
}

// 保留旧类型导出给 UI 引用（不阻断），运行时兼容
export type { CopyrightFacts, CustomerShare, KbEvidence, IntelEvidence, EvidenceBundle }
