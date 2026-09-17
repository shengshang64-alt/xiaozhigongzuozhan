import type { LlmMessage } from "@/lib/llm"
import { makeUid, outlineToText, type Chapter, type OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// PPT 与报价页：领域类型、常量、LLM prompt 构造与 JSON 容错解析（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type DeckTypeKey = "general" | "planning" | "topic"
export type DeckStatus = "draft" | "generating" | "done"
export type RefineKind = "rewrite" | "expand" | "condense"

export type Slide = {
  id: string
  title: string
  bullets: string[]
  notes: string
}

export type DeckRecord = {
  id: string
  rh_user_id: string
  deck_name: string
  deck_type: DeckTypeKey
  audience: string
  duration_min: number
  material_ref: string
  slides: Slide[]
  doc_status: DeckStatus
  created: string
  updated: string
}

export type MaterialRef = { type: "solution" | "bid"; id: string; name: string }

export type MaterialOption = { id: string; name: string; desc: string; type: "solution" | "bid" }

export type QuoteItem = {
  id: string
  item_name: string
  spec: string
  unit: string
  qty: number
  price: number
  discount: number
}

export type QuoteGroup = {
  id: string
  name: string
  items: QuoteItem[]
}

export type QuoteRecord = {
  id: string
  rh_user_id: string
  quote_name: string
  ref_type: string
  ref_id: string
  ref_name: string
  // 轮次 F 轨 2：报价 ↔ 商机关联（存量记录无此字段，sanitizeQuote 归一为空串）
  opportunity_id: string
  opportunity_name: string
  groups: QuoteGroup[]
  tax_note: string
  version: string
  created: string
  updated: string
}

export type ProductItem = {
  id: string
  rh_user_id: string
  item_name: string
  spec: string
  unit: string
  ref_price: number
  category: string
  created: string
  updated: string
}

export const DECK_TYPES: { key: DeckTypeKey; label: string; desc: string }[] = [
  { key: "general", label: "通用介绍 PPT", desc: "公司与产品能力介绍，适合初次拜访与产品宣讲" },
  { key: "planning", label: "规划 PPT", desc: "医院信息化规划汇报，面向院领导与信息科" },
  { key: "topic", label: "专题汇报 PPT", desc: "单主题深度汇报，如评级评审、智慧服务" },
]

export function deckTypeLabel(key: string): string {
  return DECK_TYPES.find((t) => t.key === key)?.label ?? "汇报 PPT"
}

export const AUDIENCES = ["院领导", "信息科", "科室主任"]

export const DECK_STATUS_LABEL: Record<DeckStatus, string> = {
  draft: "草稿",
  generating: "生成中",
  done: "已完成",
}

export const DEFAULT_GROUP_NAMES = ["软件许可", "实施服务", "硬件三方", "年保维保"]

export const REFINE_LABEL: Record<RefineKind, string> = {
  rewrite: "重写本页",
  expand: "扩写要点",
  condense: "精简要点",
}

export const DEFAULT_TAX_NOTE = "软件与服务按 6% 增值税计，硬件按 13% 计；报价有效期 30 天，最终以合同为准。"

/** 汇报时长换算建议页数：约 1.5 分钟一页，6-20 页 */
export function suggestPageCount(durationMin: number): number {
  const d = Number(durationMin) || 10
  return Math.max(6, Math.min(20, Math.round(d / 1.5)))
}

export function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function itemSubtotal(it: QuoteItem): number {
  const discount = it.discount == null || !Number.isFinite(it.discount) ? 100 : it.discount
  const raw = (it.qty || 0) * (it.price || 0) * (discount / 100)
  return Math.round(raw * 100) / 100
}

export function groupSubtotal(g: QuoteGroup): number {
  const raw = (g.items ?? []).reduce((s, it) => s + itemSubtotal(it), 0)
  return Math.round(raw * 100) / 100
}

export function quoteTotal(groups: QuoteGroup[]): number {
  const raw = (groups ?? []).reduce((s, g) => s + groupSubtotal(g), 0)
  return Math.round(raw * 100) / 100
}

export function bumpVersion(version: string): string {
  const m = /^v(\d+)$/i.exec((version || "").trim())
  if (m) return `v${Number(m[1]) + 1}`
  return "v2"
}

export function parseMaterialRef(raw: string): MaterialRef | null {
  if (!raw) return null
  try {
    const rec = JSON.parse(raw) as Record<string, unknown>
    const type = rec.type === "bid" ? "bid" : "solution"
    const id = String(rec.id ?? "")
    if (!id) return null
    return { type, id, name: String(rec.name ?? "") }
  } catch {
    return null
  }
}

export function emptySlide(title = ""): Slide {
  return { id: makeUid(), title, bullets: [], notes: "" }
}

export function makeDefaultGroups(): QuoteGroup[] {
  return DEFAULT_GROUP_NAMES.map((name) => ({ id: makeUid(), name, items: [] }))
}

export function deepCopyGroups(groups: QuoteGroup[]): QuoteGroup[] {
  return (groups ?? []).map((g) => ({
    id: makeUid(),
    name: g.name,
    items: (g.items ?? []).map((it) => ({ ...it, id: makeUid() })),
  }))
}

/** 记录字段容错：JSON 字段可能是字符串或缺失，统一洗成可用结构 */
export function sanitizeDeck(rec: DeckRecord): DeckRecord {
  let slides = rec.slides as unknown
  if (typeof slides === "string") {
    try {
      slides = JSON.parse(slides)
    } catch {
      slides = []
    }
  }
  const list = Array.isArray(slides) ? (slides as Partial<Slide>[]) : []
  return {
    ...rec,
    slides: list.map((s) => ({
      id: s.id || makeUid(),
      title: String(s.title ?? ""),
      bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b)) : [],
      notes: String(s.notes ?? ""),
    })),
    duration_min: Number(rec.duration_min) || 10,
  }
}

export function sanitizeQuote(rec: QuoteRecord): QuoteRecord {
  let groups = rec.groups as unknown
  if (typeof groups === "string") {
    try {
      groups = JSON.parse(groups)
    } catch {
      groups = []
    }
  }
  const list = Array.isArray(groups) ? (groups as Partial<QuoteGroup>[]) : []
  return {
    ...rec,
    groups: list.map((g) => ({
      id: g.id || makeUid(),
      name: String(g.name ?? "分组"),
      items: (Array.isArray(g.items) ? g.items : []).map((it) => ({
        id: it.id || makeUid(),
        item_name: String(it.item_name ?? ""),
        spec: String(it.spec ?? ""),
        unit: String(it.unit ?? "") || "套",
        qty: Number(it.qty) || 0,
        price: Number(it.price) || 0,
        discount: it.discount == null ? 100 : Number(it.discount) || 0,
      })),
    })),
    version: rec.version || "v1",
    opportunity_id: rec.opportunity_id ?? "",
    opportunity_name: rec.opportunity_name ?? "",
  }
}

// ---------------------------------------------------------------------------
// JSON 容错解析（沿用 solution-studio 的剥围栏 + 截取首尾括号模式）
// ---------------------------------------------------------------------------

export function parseJsonLoose(text: string): unknown {
  let t = (text || "").trim()
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const objStart = t.indexOf("{")
  const arrStart = t.indexOf("[")
  let candidate = ""
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
    candidate = t.slice(arrStart, t.lastIndexOf("]") + 1)
  } else if (objStart >= 0) {
    candidate = t.slice(objStart, t.lastIndexOf("}") + 1)
  }
  if (!candidate) throw new Error("AI 返回格式解析失败，请重试")
  return JSON.parse(candidate)
}

function pickArray(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>
    for (const k of keys) {
      if (Array.isArray(rec[k])) return rec[k]
    }
  }
  throw new Error("AI 返回格式解析失败，请重试")
}

export type SlidePlan = { title: string; intent: string }

export function normalizeSlidePlan(raw: unknown, expect: number): SlidePlan[] {
  const arr = pickArray(raw, ["slides", "outline", "pages"])
  const out: SlidePlan[] = []
  for (const it of arr) {
    if (typeof it === "string") {
      const title = it.trim()
      if (title) out.push({ title, intent: "" })
      continue
    }
    if (!it || typeof it !== "object") continue
    const rec = it as Record<string, unknown>
    const title = String(rec.title ?? rec.name ?? "").trim()
    if (!title) continue
    out.push({ title, intent: String(rec.intent ?? rec.summary ?? "").trim() })
    if (out.length >= expect + 4) break
  }
  if (!out.length) throw new Error("AI 返回的大纲为空，请重试")
  return out.slice(0, expect + 4)
}

function normalizeBulletList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((b) => (typeof b === "string" ? b : String((b as Record<string, unknown>)?.text ?? "")))
      .map((b) => b.replace(/^[-•*·\d.、)\s]+/, "").trim())
      .filter(Boolean)
  }
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((b) => b.replace(/^[-•*·\d.、)\s]+/, "").trim())
      .filter(Boolean)
  }
  return []
}

export function normalizeSlides(raw: unknown, plan: SlidePlan[] | null): Slide[] {
  const arr = pickArray(raw, ["slides", "pages"])
  const out: Slide[] = []
  arr.forEach((it, i) => {
    const rec = (it && typeof it === "object" ? it : {}) as Record<string, unknown>
    const title = String(rec.title ?? plan?.[i]?.title ?? "").trim() || `第 ${i + 1} 页`
    const bullets = normalizeBulletList(rec.bullets ?? rec.points ?? rec.items)
    const notes = String(rec.notes ?? rec.note ?? rec.speech ?? "").trim()
    out.push({ id: makeUid(), title, bullets: bullets.length ? bullets : [title], notes })
  })
  if (!out.length) throw new Error("AI 返回的页面内容为空，请重试")
  return out
}

export type DraftGroup = { name: string; items: Omit<QuoteItem, "id">[] }

export function normalizeQuoteGroups(raw: unknown): DraftGroup[] {
  const arr = pickArray(raw, ["groups", "items"])
  const out: DraftGroup[] = []
  for (const g of arr) {
    if (!g || typeof g !== "object") continue
    const rec = g as Record<string, unknown>
    const name = String(rec.name ?? rec.group ?? "").trim() || "实施服务"
    const itemsRaw = Array.isArray(rec.items) ? rec.items : []
    const items: Omit<QuoteItem, "id">[] = []
    for (const it of itemsRaw) {
      if (!it || typeof it !== "object") continue
      const r = it as Record<string, unknown>
      const itemName = String(r.item_name ?? r.name ?? "").trim()
      if (!itemName) continue
      const discountRaw = Number(r.discount ?? 100)
      items.push({
        item_name: itemName,
        spec: String(r.spec ?? r.spec_note ?? r.remark ?? "").trim(),
        unit: String(r.unit ?? "").trim() || "套",
        qty: Math.max(1, Math.round(Number(r.qty ?? r.quantity ?? 1) || 1)),
        price: Math.max(0, Math.round(Number(r.ref_price ?? r.price ?? 0) || 0)),
        discount: Number.isFinite(discountRaw) && discountRaw > 0 && discountRaw <= 100 ? discountRaw : 100,
      })
    }
    if (items.length) out.push({ name, items })
  }
  if (!out.length) throw new Error("AI 未返回可用的报价行项，请重试")
  return out
}

// ---------------------------------------------------------------------------
// 素材引入（方案 / 标书项目 → 生成材料文本）
// ---------------------------------------------------------------------------

export function buildMaterialText(name: string, outline: OutlineNode[], chapters: Chapter[], maxChars = 4200): string {
  const parts: string[] = [`【素材来源】${name}`]
  const outlineText = outlineToText(outline ?? [])
  if (outlineText) parts.push(`【大纲】\n${outlineText}`)
  const chapterLines: string[] = []
  for (const ch of chapters ?? []) {
    if (!ch?.title) continue
    const body = (ch.content ?? "").replace(/\s+/g, " ").trim()
    chapterLines.push(body ? `${ch.title}：${body.slice(0, 220)}` : ch.title)
    if (chapterLines.join("\n").length > maxChars) break
  }
  if (chapterLines.length) parts.push(`【内容摘要】\n${chapterLines.join("\n")}`)
  const text = parts.join("\n\n")
  return text.slice(0, maxChars + 600)
}

// ---------------------------------------------------------------------------
// LLM prompt 构造
// ---------------------------------------------------------------------------

const DECK_PERSONA: Record<DeckTypeKey, string> = {
  general:
    "通用介绍 PPT：向医院客户介绍医疗信息化公司与产品能力，覆盖公司实力、产品矩阵、典型案例、实施方法论与服务体系",
  planning:
    "医院信息化规划汇报 PPT：面向医院管理层与信息科的信息化建设规划汇报，覆盖现状与痛点、政策与评级要求、总体蓝图、分期建设路径、投资估算与保障措施",
  topic:
    "专题汇报 PPT：单一主题深度汇报（如等级评审、智慧服务、电子病历评级、互联互通测评），突出问题分析、建设思路、落地路径与成效指标",
}

type DeckContext = {
  deckType: DeckTypeKey
  topic: string
  audience: string
  keyPoints: string
  materialText: string
}

function deckContextLines(ctx: DeckContext): string {
  const lines = [
    `【汇报主题】${ctx.topic}`,
    `【汇报对象】${ctx.audience || "院领导"}`,
    `【核心要点】${ctx.keyPoints.trim() || "（未提供，按主题自行组织）"}`,
  ]
  if (ctx.materialText.trim()) lines.push(`【参考素材（来自已有方案/标书，优先复用其中的事实与数据）】\n${ctx.materialText}`)
  return lines.join("\n")
}

function deckSystem(ctx: DeckContext): string {
  return [
    `你是医疗信息化行业资深售前顾问，正在制作一份「${DECK_PERSONA[ctx.deckType] ?? DECK_PERSONA.general}」。`,
    "内容要求：贴合医院真实业务场景，专业、克制、可落地；要点用短句，避免空话套话；讲稿备注是汇报人口语化讲解词。",
  ].join("\n")
}

export function buildDeckSingleMessages(ctx: DeckContext, pageCount: number): LlmMessage[] {
  const system = [
    deckSystem(ctx),
    `输出铁律：只输出一个 JSON 对象，不要 markdown 围栏以外的任何解释。格式：`,
    `{"slides":[{"title":"页标题(≤16字)","bullets":["要点1","要点2","要点3"],"notes":"该页讲稿备注(80-150字)"}]}`,
    `共生成 ${pageCount} 页（含开场页与收尾致谢页），每页要点 3-5 条、每条 ≤32 字；讲稿备注面向「${ctx.audience || "院领导"}」的口吻。`,
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: deckContextLines(ctx) },
  ]
}

export function buildDeckOutlineMessages(ctx: DeckContext, pageCount: number): LlmMessage[] {
  const system = [
    deckSystem(ctx),
    "输出铁律：只输出一个 JSON 对象。格式：",
    `{"slides":[{"title":"页标题(≤16字)","intent":"该页要讲什么(一句话)"}]}`,
    `共 ${pageCount} 页（含开场页与收尾致谢页），页与页之间逻辑递进、不重复。`,
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: deckContextLines(ctx) },
  ]
}

export function buildDeckBatchMessages(ctx: DeckContext, batch: SlidePlan[], allTitles: string[]): LlmMessage[] {
  const batchLines = batch.map((p, i) => `${i + 1}. ${p.title}${p.intent ? `（${p.intent}）` : ""}`).join("\n")
  const system = [
    deckSystem(ctx),
    `整体 PPT 的页面大纲已确定：\n${allTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    "现在请为下面这一批页面生成详细内容。输出铁律：只输出一个 JSON 对象，格式：",
    `{"slides":[{"title":"页标题(与给定标题一致)","bullets":["要点1","要点2"],"notes":"讲稿备注(80-150字)"}]}`,
    `本批共 ${batch.length} 页，按给定顺序输出，每页要点 3-5 条、每条 ≤32 字。`,
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: `${deckContextLines(ctx)}\n\n【本批页面】\n${batchLines}` },
  ]
}

export function buildSlideRefineMessages(kind: RefineKind, deck: DeckRecord, slide: Slide): LlmMessage[] {
  const action =
    kind === "rewrite"
      ? "重写：保持本页信息定位，换更专业、更有说服力的表达，重组要点顺序"
      : kind === "expand"
        ? "扩写：补充医疗行业细节、量化指标与落地举措，要点条数可增加 1-3 条"
        : "精简：压缩到 3 条以内核心要点，每条 ≤26 字，不丢关键信息"
  const system = [
    `你是医疗信息化行业资深售前顾问，正在精修「${deck.deck_name}」（${deckTypeLabel(deck.deck_type)}，汇报对象：${deck.audience || "院领导"}）中的第 ${slide.title} 页。`,
    `请对该页执行「${action}」。讲稿备注同步调整，与要点保持一致。`,
    "输出铁律：只输出一个 JSON 对象，格式：{\"title\":\"页标题\",\"bullets\":[\"要点\"],\"notes\":\"讲稿备注\"}，title 除非明显有问题否则保持不变。",
  ].join("\n")
  const user = [
    `【页标题】${slide.title}`,
    `【当前要点】\n${(slide.bullets ?? []).map((b) => `- ${b}`).join("\n") || "（空）"}`,
    `【当前讲稿】${slide.notes || "（空）"}`,
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export function buildQuoteDraftMessages(refName: string, materialText: string): LlmMessage[] {
  const system = [
    "你是医疗信息化行业资深售前商务经理，正在根据建设内容为医院项目拟定报价清单初稿。",
    "行项要求：名称具体到可报价粒度（如「电子病历系统四级升级」「接口开发与联调」），规格说明写清范围与关键参数，单位为 套/项/人月/台/年，数量合理，参考单价给出市场常见价位（元，整数）。",
    "分组只能使用：软件许可、实施服务、硬件三方、年保维保；总行项 15-35 条，覆盖素材中的主要建设内容。",
    "输出铁律：只输出一个 JSON 对象，格式：",
    `{"groups":[{"name":"软件许可","items":[{"item_name":"名称","spec":"规格说明","unit":"套","qty":1,"ref_price":100000}]}]}`,
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: `【关联项目】${refName}\n\n${materialText}` },
  ]
}
