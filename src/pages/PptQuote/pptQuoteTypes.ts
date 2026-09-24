import type { LlmMessage } from "@/lib/llm"
import { parseJsonTolerant } from "@/lib/jsonTolerant"
import { makeUid, outlineToText, type Chapter, type FigureSpec, type OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { CheckProduct, ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// PPT 与报价页：领域类型、常量、LLM prompt 构造与 JSON 容错解析（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type DeckTypeKey = "general" | "planning" | "topic"
export type DeckStatus = "draft" | "generating" | "done"
export type RefineKind = "rewrite" | "expand" | "condense"

export type SlideLayout =
  | "auto"
  | "bullets"
  | "section"
  | "image-right"
  | "image-left"
  | "banner"
  | "chart"
  | "kpi"

/** 图表规格：既驱动应用内 ECharts 预览，也在导出时转 PNG 内嵌 .pptx */
export type SlideChart = {
  type: "bar" | "pie" | "line"
  title?: string
  unit?: string
  categories: string[]
  series: { name?: string; data: number[] }[]
}

/** 数字亮点卡（一页 2-4 个大数字 + 说明） */
export type SlideKpi = { value: string; label: string }

export type Slide = {
  id: string
  title: string
  bullets: string[]
  notes: string
  /** 版式；缺省/“auto” 由内容自适应（有图无图都能渲染） */
  layout?: SlideLayout
  /** 图片：dataURL（导出与预览直接内嵌，无跨域） */
  image?: string
  /** 图注 / 图片来源 */
  imageAlt?: string
  /** 配图关键词（中文短语），「一键配图」据此预填检索/挑选 */
  imageHint?: string
  /** 数据图表（存在则该页优先图表版式） */
  chart?: SlideChart | null
  /** 数字亮点卡 */
  kpi?: SlideKpi[]
  /** AI 结构化图示（架构/流程/界面示意）：预览内联 SVG，导出时转 PNG 嵌入；没有真实配图时代替 image 走图文版式 */
  figures?: FigureSpec[]
}

/** 页面切换动画（deck 级，导出时注入 OOXML <p:transition>；应用内放映同步） */
export type DeckTransition = "none" | "fade" | "push" | "wipe" | "split"

export const TRANSITION_LABEL: Record<DeckTransition, string> = {
  none: "无",
  fade: "淡出",
  push: "推入",
  wipe: "擦除",
  split: "分割",
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

/**
 * 报价行项：与 ChecklistLine 对齐的结构（category / product_line / product_name / module_name /
 * module_func / source / product_id / rating_hits / remark），价格与折扣允许后续录入。
 * 老 6 字段（item_name / spec / unit / qty / price / discount）保留以兼容存量数据；
 * 新数据由 quoteItemFromProduct / quoteItemFromChecklistLine 生成，两者同步填充。
 */
export type QuoteItem = {
  id: string
  item_name: string
  spec: string
  unit: string
  qty: number
  price: number
  discount: number
  // —— 与系统清单对齐的扩展字段（可选，老记录缺失） ——
  category?: string
  product_line?: string
  product_name?: string
  module_name?: string
  module_func?: string
  source?: "company" | "external"
  product_id?: string
  rating_hits?: string[]
  remark?: string
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

/**
 * @deprecated 4 大报价科目已废弃：分组语义改为 CheckProduct.category，
 * 由「从产品库追加」/「从建设清单导入」动态生成。仅保留常量给未迁移测试用。
 */
export const DEFAULT_GROUP_NAMES: string[] = []

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
  return { id: makeUid(), title, bullets: [], notes: "", layout: "auto" }
}

/** 新建报价的初始分组：空数组，等待用户从产品库/清单导入或手工加行时再建组 */
export function makeDefaultGroups(): QuoteGroup[] {
  return []
}

/** 行唯一键：按 (category, product_name, module_name) 去重（用于导入合并） */
export function lineKey(it: Pick<QuoteItem, "category" | "product_name" | "item_name" | "module_name">): string {
  return `${it.category ?? ""}::${it.product_name ?? it.item_name ?? ""}::${it.module_name ?? ""}`
}

/** 是否是清单同款结构化行（有 product_id 或 category）：UI 用它决定字段是否锁定 */
export function isCatalogLine(it: QuoteItem): boolean {
  return Boolean(it.product_id) || Boolean(it.category?.trim())
}

/** CheckProduct → 报价行草稿（不含 id） */
export function quoteItemFromProduct(
  p: CheckProduct,
  opts: { zeroPrice?: boolean; qty?: number } = {},
): Omit<QuoteItem, "id"> {
  const zero = opts.zeroPrice ?? true
  const qty = Math.max(1, Math.round(opts.qty ?? 1) || 1)
  return {
    item_name: p.product_name,
    spec: p.module_func || p.description || "",
    unit: "套",
    qty,
    price: zero ? 0 : Number(p.unit_price) || 0,
    discount: 100,
    category: p.category || "未分类",
    product_line: p.product_line || "",
    product_name: p.product_name,
    module_name: p.module_name || "",
    module_func: p.module_func || "",
    source: "company",
    product_id: p.id,
    rating_hits: [],
    remark: "",
  }
}

/** ChecklistLine → 报价行草稿（不含 id） */
export function quoteItemFromChecklistLine(
  l: ChecklistLine,
  opts: { zeroPrice?: boolean } = {},
): Omit<QuoteItem, "id"> {
  const zero = opts.zeroPrice ?? false
  return {
    item_name: l.product_name,
    spec: l.module_func || "",
    unit: l.unit || "套",
    qty: Math.max(1, Number(l.qty) || 1),
    price: zero ? 0 : Number(l.unit_price) || 0,
    discount: 100,
    category: l.category || "未分类",
    product_line: l.product_line || "",
    product_name: l.product_name,
    module_name: l.module_name || "",
    module_func: l.module_func || "",
    source: l.source,
    product_id: l.product_id || "",
    rating_hits: l.rating_hits ?? [],
    remark: l.remark || "",
  }
}

/** 按 category 归并散 Item 列表为 groups（幂等，用于渲染/导出） */
export function groupsFromItems(items: QuoteItem[]): QuoteGroup[] {
  const byCat = new Map<string, QuoteItem[]>()
  for (const it of items) {
    const cat = (it.category ?? "").trim() || "未分类"
    byCat.set(cat, [...(byCat.get(cat) ?? []), it])
  }
  return Array.from(byCat.entries()).map(([name, its]) => ({ id: makeUid(), name, items: its }))
}

/** 合并草稿到现有 groups：按 category 建/找组，按 lineKey 跳过已存在 */
export function mergeItemsIntoGroups(
  groups: QuoteGroup[],
  drafts: Omit<QuoteItem, "id">[],
): { groups: QuoteGroup[]; added: number; skipped: number } {
  const next = groups.map((g) => ({ ...g, items: [...g.items] }))
  const existing = new Set<string>(next.flatMap((g) => g.items.map(lineKey)))
  let added = 0
  let skipped = 0
  for (const draft of drafts) {
    const key = lineKey(draft)
    if (existing.has(key)) {
      skipped += 1
      continue
    }
    existing.add(key)
    const cat = (draft.category ?? "").trim() || "未分类"
    let target = next.find((g) => g.name === cat)
    if (!target) {
      target = { id: makeUid(), name: cat, items: [] }
      next.push(target)
    }
    target.items.push({ ...draft, id: makeUid() })
    added += 1
  }
  return { groups: next, added, skipped }
}

/** 从 ChecklistRecord.items 一次性构造 groups（用于导入预览与单测） */
export function importChecklistLines(
  lines: ChecklistLine[],
  opts: { zeroPrice?: boolean } = {},
): QuoteGroup[] {
  const kept = (lines ?? []).filter((l) => l.checked !== false)
  const items: QuoteItem[] = kept.map((l) => ({
    ...quoteItemFromChecklistLine(l, opts),
    id: makeUid(),
  }))
  return groupsFromItems(items)
}

export function deepCopyGroups(groups: QuoteGroup[]): QuoteGroup[] {
  return (groups ?? []).map((g) => ({
    id: makeUid(),
    name: g.name,
    items: (g.items ?? []).map((it) => ({ ...it, id: makeUid() })),
  }))
}

/**
 * quote-history-01（最小切片）：同一客户的历史报价参考。
 * 匹配口径保守：同 opportunity_id（非空）或同 opportunity_name（非空，兼容存量只记了名字的老单）；
 * 排除自身；按 updated 降序，最多 limit 份。纯检索零 AI，不做任何智能推荐。
 */
export function historyQuotesFor(current: QuoteRecord | null, all: QuoteRecord[], limit = 5): QuoteRecord[] {
  if (!current) return []
  const oppId = (current.opportunity_id ?? "").trim()
  const oppName = (current.opportunity_name ?? "").trim()
  if (!oppId && !oppName) return []
  return (all ?? [])
    .filter((q) => {
      if (!q || q.id === current.id) return false
      const id = (q.opportunity_id ?? "").trim()
      const name = (q.opportunity_name ?? "").trim()
      return (!!oppId && id === oppId) || (!!oppName && name === oppName)
    })
    .sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")))
    .slice(0, limit)
}

/** 记录字段容错：JSON 字段可能是字符串或缺失，统一洗成可用结构 */
const SLIDE_LAYOUTS: string[] = ["auto", "bullets", "section", "image-right", "image-left", "banner", "chart", "kpi"]

function pickLayout(v: unknown): SlideLayout | undefined {
  const s = String(v ?? "").trim()
  return SLIDE_LAYOUTS.includes(s) ? (s as SlideLayout) : undefined
}

/** 图表规格容错归一：type 非法 / 无数据 一律判空，返回 null */
export function normalizeChart(raw: unknown): SlideChart | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const t = String(r.type ?? "").toLowerCase()
  const type = t === "pie" || t === "line" || t === "bar" ? (t as SlideChart["type"]) : null
  if (!type) return null
  const catsRaw = Array.isArray(r.categories) ? r.categories : Array.isArray(r.labels) ? r.labels : Array.isArray(r.x) ? r.x : []
  const categories = catsRaw.map((c) => String(c))
  let series: { name?: string; data: number[] }[] = []
  if (Array.isArray(r.series)) {
    series = (r.series as unknown[])
      .map((s) => {
        const sr = (s && typeof s === "object" ? s : {}) as Record<string, unknown>
        const data = (Array.isArray(sr.data) ? sr.data : []).map((d) => Number(d) || 0)
        return { name: sr.name != null ? String(sr.name) : undefined, data }
      })
      .filter((s) => s.data.length)
  } else if (Array.isArray(r.values)) {
    series = [{ data: (r.values as unknown[]).map((d) => Number(d) || 0) }]
  }
  if (!categories.length || !series.length) return null
  return {
    type,
    title: r.title != null ? String(r.title) : undefined,
    unit: r.unit != null ? String(r.unit) : undefined,
    categories,
    series,
  }
}

/**
 * 图示规格容错归一：与方案/标书侧同一套结构化图型契约（architecture/flow/demo）
 * 结构不合法或字段缺失一律丢弃，最多保留 2 个
 */
export function normalizeSlideFigures(raw: unknown): FigureSpec[] {
  if (!Array.isArray(raw)) return []
  const out: FigureSpec[] = []
  for (const it of raw as unknown[]) {
    if (!it || typeof it !== "object") continue
    const r = it as Record<string, unknown>
    const title = String(r.title ?? "").trim()
    if (!title) continue
    const caption = r.caption != null ? String(r.caption).trim() || undefined : undefined
    if (r.type === "architecture" && Array.isArray(r.layers)) {
      const layers = (r.layers as unknown[])
        .map((l) => {
          const lr = (l && typeof l === "object" ? l : {}) as Record<string, unknown>
          const name = String(lr.name ?? "").trim()
          const modules = (Array.isArray(lr.modules) ? lr.modules : []).map((m) => String(m).trim()).filter(Boolean)
          return name ? { name, modules } : null
        })
        .filter(Boolean) as { name: string; modules: string[] }[]
      if (layers.length) out.push({ type: "architecture", title, layers: layers.slice(0, 6), caption })
    } else if (r.type === "flow" && Array.isArray(r.steps)) {
      const steps = (r.steps as unknown[])
        .map((s) => {
          const sr = (s && typeof s === "object" ? s : {}) as Record<string, unknown>
          const name = String(sr.name ?? "").trim()
          const desc = sr.desc != null ? String(sr.desc).trim() || undefined : undefined
          return name ? { name, desc } : null
        })
        .filter(Boolean) as { name: string; desc?: string }[]
      if (steps.length) {
        const branches = (Array.isArray(r.branches) ? r.branches : []).map((b) => String(b).trim()).filter(Boolean)
        out.push({ type: "flow", title, steps: steps.slice(0, 8), ...(branches.length ? { branches: branches.slice(0, 4) } : {}), caption })
      }
    } else if (r.type === "demo") {
      const sidebar = (Array.isArray(r.sidebar) ? r.sidebar : []).map((s) => String(s).trim()).filter(Boolean)
      const main = (Array.isArray(r.main) ? r.main : [])
        .map((m) => {
          const mr = (m && typeof m === "object" ? m : {}) as Record<string, unknown>
          const block = String(mr.block ?? "").trim()
          const desc = mr.desc != null ? String(mr.desc).trim() || undefined : undefined
          return block ? { block, desc } : null
        })
        .filter(Boolean) as { block: string; desc?: string }[]
      if (sidebar.length || main.length) out.push({ type: "demo", title, sidebar: sidebar.slice(0, 8), main: main.slice(0, 6), caption })
    }
    if (out.length >= 2) break
  }
  return out
}

/** 数字亮点卡容错归一：最多 4 张，缺 value 丢弃 */
function normalizeKpi(raw: unknown): SlideKpi[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = (raw as unknown[])
    .map((it) => {
      const r = (it && typeof it === "object" ? it : {}) as Record<string, unknown>
      const value = String(r.value ?? r.num ?? r.number ?? "").trim()
      const label = String(r.label ?? r.name ?? r.desc ?? "").trim()
      return value ? { value, label } : null
    })
    .filter(Boolean) as SlideKpi[]
  return out.length ? out.slice(0, 4) : undefined
}

function slideVisual(s: Partial<Slide>): Partial<Slide> {
  const rec = s as Record<string, unknown>
  const chart = normalizeChart(rec.chart)
  const kpi = normalizeKpi(rec.kpi)
  const figures = normalizeSlideFigures(rec.figures)
  const extras: Partial<Slide> = {}
  const layout = pickLayout(rec.layout)
  if (layout) extras.layout = layout
  if (typeof rec.image === "string" && rec.image) extras.image = rec.image
  if (rec.imageAlt) extras.imageAlt = String(rec.imageAlt)
  if (rec.imageHint) extras.imageHint = String(rec.imageHint)
  if (chart) extras.chart = chart
  if (kpi) extras.kpi = kpi
  if (figures.length) extras.figures = figures
  return extras
}

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
      ...slideVisual(s),
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
      items: (Array.isArray(g.items) ? g.items : []).map((it) => {
        const ratingHits = Array.isArray(it.rating_hits)
          ? (it.rating_hits as unknown[]).map((x) => String(x)).filter(Boolean)
          : undefined
        const srcRaw = String(it.source ?? "").trim()
        const srcNorm: "company" | "external" | undefined =
          srcRaw === "company" || srcRaw === "external" ? (srcRaw as "company" | "external") : undefined
        return {
          id: it.id || makeUid(),
          item_name: String(it.item_name ?? ""),
          spec: String(it.spec ?? ""),
          unit: String(it.unit ?? "") || "套",
          qty: Number(it.qty) || 0,
          // 价格后录：允许 0（不再兜底为默认参考价），保持数值语义
          price: Number(it.price) || 0,
          discount: it.discount == null ? 100 : Number(it.discount) || 0,
          category: it.category != null ? String(it.category) : undefined,
          product_line: it.product_line != null ? String(it.product_line) : undefined,
          product_name: it.product_name != null ? String(it.product_name) : undefined,
          module_name: it.module_name != null ? String(it.module_name) : undefined,
          module_func: it.module_func != null ? String(it.module_func) : undefined,
          source: srcNorm,
          product_id: it.product_id != null ? String(it.product_id) : undefined,
          rating_hits: ratingHits,
          remark: it.remark != null ? String(it.remark) : undefined,
        }
      }),
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
  // ai-stability-01：宽松解析（含裸控制字符转义），失败抛可读错误而非裸 SyntaxError
  return parseJsonTolerant(candidate)
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
    out.push({ id: makeUid(), title, bullets: bullets.length ? bullets : [title], notes, ...slideVisual(rec) })
  })
  if (!out.length) throw new Error("AI 返回的页面内容为空，请重试")
  return out
}

/**
 * AI 草案→ 报价行项：严格从产品目录（CheckProduct）中选取 product_id，
 * 非目录内的项一律过滤。输出价格=0（后录），行项目从目录同名字段带入。
 * 同时兼容旧结构 `{groups:[{items:[{product_id,qty}]}]}`。
 */
export function normalizeDraftItemsFromCatalog(
  raw: unknown,
  catalog: CheckProduct[],
): { items: Omit<QuoteItem, "id">[]; filtered: number } {
  const byId = new Map(catalog.map((p) => [p.id, p]))
  let arr: unknown[] = []
  if (Array.isArray(raw)) arr = raw
  else if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>
    if (Array.isArray(rec.items)) arr = rec.items
    else if (Array.isArray(rec.groups)) {
      arr = (rec.groups as unknown[]).flatMap((g) => {
        if (!g || typeof g !== "object") return []
        const gr = g as Record<string, unknown>
        return Array.isArray(gr.items) ? gr.items : []
      })
    }
  }
  const seen = new Set<string>()
  const items: Omit<QuoteItem, "id">[] = []
  let filtered = 0
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") {
      filtered += 1
      continue
    }
    const r = entry as Record<string, unknown>
    const pid = String(r.product_id ?? "").trim()
    const p = byId.get(pid)
    if (!p) {
      filtered += 1
      continue
    }
    if (seen.has(pid)) continue
    seen.add(pid)
    const qty = Math.max(1, Math.round(Number(r.qty ?? 1) || 1))
    items.push(quoteItemFromProduct(p, { zeroPrice: true, qty }))
  }
  return { items, filtered }
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
    // —— 借鉴 Anthropic pptx skill + academic-pptx 编辑方法论（作为默认质量基线，对所有用户生效）——
    "【行动标题 Action Title】每页 title 必须是一句有信息量的结论/观点（≤20 字），读者只看标题串起来就能读懂整份汇报的逻辑；" +
      "禁止用名词标签式标题（如「项目背景」「建设方案」「系统架构」），应改写为承载判断的陈述句（如「老系统孤岛数据拖慢全院协作」「一体化平台把门诊准备时间压缩 40%」）。",
    "【图表结论句】凡带 chart 或 kpi 的页，其至少一条要点必须用一句话点明该数据要说明的结论（数字+so what），例如「三期投资逐年递减，运维占比升至 45%」，让图表自证观点而非装饰。",
    "【反 AI 味铁律】禁用空洞排比与套话堆砌（如反复使用『赋能/打造/闭环/抓手/生态/颠覆』却不给具体所指）；每条要点必须落到具体系统、指标、举措或对象；宁少而实，不多而空。",
  ].join("\n")
}

// 图文并茂：让模型在文字之外按需给出视觉字段（版式/图表/KPI/配图关键词）
const VISUAL_RULES = [
  "【图文并茂】每页可附加以下可选视觉字段（合适才给，宁缺毋滥）：",
  '- "layout"：版式，取值 bullets(纯要点) / section(章节过渡大字页) / image-right 或 image-left(图文左右分栏) / banner(顶部通栏大图+下方要点) / chart(数据图表页) / kpi(大数字卡)；不填按内容自适应。',
  '- "chart"：当且仅当该页有可量化数据（门诊量、床位数、投资额、占比、分期计划等）时给出，格式 {"type":"bar|pie|line","title":"图标题","unit":"单位","categories":["类目1","类目2"],"series":[{"name":"系列名","data":[10,20]}]}；数字优先取自素材，素材没有把握的不要编造。',
  '- "kpi"：突出关键成效数字时给出，格式 [{"value":"35%","label":"护理效率提升"}]，2-4 个。',
  '- "imageHint"：该页适合配一张真实照片（医院环境/建筑/场景/设备）时，给一个中文配图关键词（如「医院门诊大楼」「智慧病房」「一体化手术部」）。',
  '- "figures"：当该页讲的是系统分层架构、业务流程或系统界面时，输出结构化图示数据（最多 2 个，应用内会自动绘制成矢量图并随导出嵌入）：架构图 {"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}；流程图 {"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；界面示意 {"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}。层/步骤/模块名必须来自素材或行业真实系统名称，每个不超过 12 字；没有合适图型就输出空数组，不要硬凑。',
  "带 chart 或 kpi 的页，把 layout 设为对应类型，并把重复的数字从要点里去掉；视觉字段合适才给，宁缺毋滥、不为凑数硬塞。",
].join("\n")

export function buildDeckSingleMessages(ctx: DeckContext, pageCount: number): LlmMessage[] {
  const system = [
    deckSystem(ctx),
    `输出铁律：只输出一个 JSON 对象，不要 markdown 围栏以外的任何解释。格式：`,
    `{"slides":[{"title":"页标题(≤16字)","bullets":["要点1","要点2","要点3"],"notes":"该页讲稿备注(80-150字)","layout":"bullets","chart":null,"imageHint":"..."}]}`,
    `共生成 ${pageCount} 页（含开场页与收尾致谢页），每页要点 3-5 条、每条 ≤32 字；讲稿备注面向「${ctx.audience || "院领导"}」的口吻。`,
    VISUAL_RULES,
    "整份配额（本次一次性生成全部页，请全局统筹达标）：全篇至少 2 页用 chart 或 kpi、至少 2 页给出 imageHint、至少 1-2 页在讲架构/流程/界面时给出 figures 图示（开场/目录/致谢页除外），做到图文并茂。",
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
    `{"slides":[{"title":"页标题(与给定标题一致)","bullets":["要点1","要点2"],"notes":"讲稿备注(80-150字)","layout":"bullets","chart":null,"imageHint":"..."}]}`,
    `本批共 ${batch.length} 页，按给定顺序输出，每页要点 3-5 条、每条 ≤32 字。`,
    VISUAL_RULES,
    "分批生成说明：本批只需为内容确实适合配图表/大数字/配图/结构化图示的页面添加 chart/kpi/imageHint/figures，合适才加；整份 PPT 的图文配额由页面大纲阶段统一预分配、生成后代码校验兜底，不要在本批为凑数硬塞。",
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

export function buildQuoteDraftMessages(refName: string, materialText: string, catalog: CheckProduct[]): LlmMessage[] {
  const MAX_CATALOG = 200
  const list = (catalog ?? []).slice(0, MAX_CATALOG)
  const catalogLines = list
    .map((p) => {
      const mod = p.module_name ? ` - ${p.module_name}` : ""
      const func = (p.module_func || "").replace(/\s+/g, " ").slice(0, 60)
      const price = Number(p.unit_price) || 0
      return `[${p.id}] ${p.category || "未分类"} | ${p.product_name}${mod} | ${func} | 套 | ${price}`
    })
    .join("\n")
  const system = [
    "你是医疗信息化行业资深售前商务经理，正在根据建设内容为医院项目拟定报价清单初稿。",
    "【硬约束】只能引用 USER 消息中「产品目录」列出的 product_id；不允许编造未在目录中的产品、系统、模块、单位或价格。",
    "【输出格式】只输出一个 JSON 对象：{\"items\":[{\"product_id\":\"...\",\"qty\":1}]}；qty 为正整数，同一 product_id 仅出现一次。",
    "【价格与备注】价格、折扣、备注一律留空，由人工后录。不允许你输出 price / unit_price / discount / remark 字段。",
    "【分组不手写】分组由系统根据 product_id 对应的产品类别自动归类，你不需输出 group / category。",
    "【覆盖度】从素材中识别主要建设内容，尽量在目录中找到匹配项；目录里没有对应产品时直接跳过，不要生造。总条数 8-40 条之间。",
    "【目录为空】若产品目录为空，输出 {\"items\":[]}，不要自行补充。",
  ].join("\n")
  const user = [
    `【关联项目】${refName}`,
    materialText.trim() ? `【参考素材】\n${materialText}` : "",
    `【产品目录】共 ${list.length} 条，格式：[product_id] 类别 | 产品名 - 模块名 | 模块功能 | 单位 | 参考价`,
    catalogLines || "（产品库为空，请返回 {\"items\":[]}）",
  ]
    .filter(Boolean)
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
