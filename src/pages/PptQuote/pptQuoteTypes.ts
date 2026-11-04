import type { LlmMessage } from "@/lib/llm"
import { extractJsonCandidate, parseJsonTolerant } from "@/lib/jsonTolerant"
import { makeUid, outlineToText, type Chapter, type FigureSpec, type OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { CheckProduct, ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"
import {
  KIND_LABEL,
  SlideKindSchema,
  SlideRoleSchema,
  SourceRefSchema,
  type SlideKindZ,
  type SlideRoleZ,
  type SourceRefZ,
} from "./deckSchema"
// 2026-11-04 B 项：大纲/单发提示词共用同一份页型配额文案（与确定性校正同源）
import { kindQuotaRuleText } from "./deckOutlineQuota"

// ---------------------------------------------------------------------------
// PPT 与报价页：领域类型、常量、LLM prompt 构造与 JSON 容错解析（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type DeckTypeKey = "general" | "planning" | "topic"
export type DeckStatus = "draft" | "generating" | "done"
export type RefineKind = "rewrite" | "expand" | "condense" | "fill"

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

/** 页面在汇报故事中的角色（2026-10-30 SCQA 叙事骨架） */
export type SlideRole =
  | "context" // 背景情境
  | "problem" // 冲突痛点
  | "question" // 核心问题
  | "answer" // 核心主张
  | "evidence" // 论据支撑
  | "approach" // 实现路径
  | "plan" // 实施计划
  | "value" // 价值收益
  | "close" // 收尾

export const SLIDE_ROLE_LABEL: Record<SlideRole, string> = {
  context: "背景",
  problem: "痛点",
  question: "问题",
  answer: "主张",
  evidence: "论据",
  approach: "路径",
  plan: "计划",
  value: "价值",
  close: "收尾",
}

export type Slide = {
  id: string
  title: string
  bullets: string[]
  notes: string
  /** 版式；缺省/“auto” 由内容自适应（有图无图都能渲染） */
  layout?: SlideLayout
  /** 该页在汇报故事中的角色（SCQA）；用于渲染层的视觉区分与叙事检查 */
  role?: SlideRole
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
  /** 本页引用的素材（2026-10-30：可追溯到具体素材段落） */
  sourceRefs?: SourceRefZ[]
  /** 待补充字段（缺事实时由模型标注，禁止编造） */
  pendingFields?: string[]
  /** 该页既定 kind（来自大纲，渲染与校验用） */
  kind?: SlideKindZ
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
  /** 折扣百分比：90 表示按 9 折计价；缺省/非法/0 一律归一为 100（原价），见 normalizeDiscount（R285）；
   *  小于 5 的数属写法歧义（可能想写「几折」），判定走 discountAmbiguity，录入时先确认（R40/B8） */
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
  // R79 quote-history-2 第一步：结单沉淀样本标记与元数据（存量无此字段，sanitizeQuote 归一）
  won_sample?: boolean
  hospital_level?: string
  beds_total?: number
  modules_summary?: string
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
  fill: "补全此页",
}

/** 汇报时长换算建议页数：约 1.5 分钟一页，6-20 页 */
export function suggestPageCount(durationMin: number): number {
  const d = Number(durationMin) || 10
  return Math.max(6, Math.min(20, Math.round(d / 1.5)))
}

// Money display now has a single app-wide implementation in @/lib/money
// (R113); this re-export keeps every existing import path working.
export { formatMoney } from "@/lib/money"
import { centsToYuan, productCents } from "@/lib/money"
import { cnyToUpper } from "@/lib/currencyCn"

/**
 * R285：折扣百分比的唯一口径。缺省/非法/≤0 一律视为原价（100），超 100 按 100 计。
 * discount 此前全链路常量 100、无录入入口；开放录入后「0」既可能是没填也可能是
 * 误清空，按 0 折计会让整单金额悄悄归零（金额悄悄错），故统一按原价兜底。
 */
export function normalizeDiscount(d: number | undefined | null): number {
  if (d == null || !Number.isFinite(d) || d <= 0) return 100
  return Math.min(100, d)
}

// ---------------------------------------------------------------------------
// R40（backlog B8）：折扣写法歧义。0 < d < 5 的填写值既可能是「按 d% 计价」，也可能是
// 习惯写法「d 折 / 零点几折」，两者相差 10~100 倍且直接乘进金额。normalizeDiscount 的口径
// 一字未动（R285 裁定：≤0 视为原价、>100 封顶，不做静默钳位），本段只补两件只读工具：
//   1) 把判定阈值与两种读法从 @/lib/discountIntent 转出（组件层不许各写一份阈值）；
//   2) 把两种读法换算成真实金额 + 盘点已落库的歧义行，供确认弹窗与交付体检共用。
// ---------------------------------------------------------------------------

import { discountAmbiguity } from "@/lib/discountIntent"

export {
  DISCOUNT_AMBIGUOUS_BELOW,
  discountAmbiguity,
  isAmbiguousDiscount,
  type DiscountAmbiguity,
  type DiscountReading,
} from "@/lib/discountIntent"

/** 某行按指定折扣计价的小计（元）。与 itemSubtotal 同一「精确到分」口径，只用于确认时把钱说清。 */
export function itemSubtotalAtDiscount(it: QuoteItem, pct: number): number {
  return centsToYuan(productCents([Number(it.qty) || 0, Number(it.price) || 0, normalizeDiscount(pct) / 100]))
}

/** 一组行统一按 pct 计价的小计合计（元）；pct=100 即原价合计。整数分累加，同 R34 口径。 */
export function groupSubtotalAtDiscount(items: QuoteItem[], pct: number): number {
  const factor = normalizeDiscount(pct) / 100
  const cents = (items ?? []).reduce(
    (s, it) => s + productCents([Number(it.qty) || 0, Number(it.price) || 0, factor]),
    0,
  )
  return centsToYuan(cents)
}

/** 已落库数据里的歧义折扣行（只盘点、绝不改写）：编辑器横幅与报价交付体检共用同一判据。 */
export type AmbiguousDiscountLine = {
  groupId: string
  groupName: string
  itemId: string
  itemName: string
  raw: number
}

export function scanAmbiguousDiscounts(groups: QuoteGroup[]): AmbiguousDiscountLine[] {
  const out: AmbiguousDiscountLine[] = []
  for (const g of groups ?? []) {
    for (const it of g.items ?? []) {
      const amb = discountAmbiguity(it.discount)
      if (amb) {
        const nm = (it.item_name ?? "").trim()
        out.push({
          groupId: g.id,
          groupName: g.name,
          itemId: it.id,
          itemName: nm || "未命名行",
          raw: amb.raw,
        })
      }
    }
  }
  return out
}

/**
 * 行项小计的整数分。R34 起全链路以「分」为唯一累加单位：
 * 旧写法 `Math.round(qty*price*(disc/100)*100)/100` 在真值恰好半分处（如
 * 15 × 599,729.21 × 90% = 8,096,344.335 元）会被二进制浮点少算 1 分，
 * 与 Excel ROUND / 客户复核差一分——报价单出现两套数字属被质疑级风险。
 * 口径与产品语义不变，只把舍入换成精确十进制定点（见 @/lib/money productCents）。
 */
export function itemSubtotalCents(it: QuoteItem): number {
  return productCents([
    Number(it.qty) || 0,
    Number(it.price) || 0,
    normalizeDiscount(it.discount) / 100,
  ])
}

export function itemSubtotal(it: QuoteItem): number {
  return centsToYuan(itemSubtotalCents(it))
}

export function groupSubtotalCents(g: QuoteGroup): number {
  return (g.items ?? []).reduce((s, it) => s + itemSubtotalCents(it), 0)
}

export function groupSubtotal(g: QuoteGroup): number {
  return centsToYuan(groupSubtotalCents(g))
}

export function quoteTotalCents(groups: QuoteGroup[]): number {
  return (groups ?? []).reduce((s, g) => s + groupSubtotalCents(g), 0)
}

export function quoteTotal(groups: QuoteGroup[]): number {
  return centsToYuan(quoteTotalCents(groups))
}

/**
 * 报价总额中文大写（单源派生）。交付物里的「合计（大写）」必须由 quoteTotal 生成，
 * 手填大写是经典不一致点：改了数量/单价后小写重算、大写仍停在旧值。
 */
export function quoteTotalUpper(groups: QuoteGroup[]): string {
  return cnyToUpper(quoteTotalCents(groups) / 100, { prefixRmb: true })
}

export function bumpVersion(version: string): string {
  const m = /^v(\d+)$/i.exec((version || "").trim())
  if (m) return `v${Number(m[1]) + 1}`
  return "v2"
}

export function emptySlide(title = ""): Slide {
  return { id: makeUid(), title, bullets: [], notes: "", layout: "auto" }
}

/**
 * 占位/空白页判定：有标题位置但正文全空（无要点/图表/KPI/图示/配图/配图关键词），
 * 且不是章节分隔页。批量逐页生成失败时会按大纲留下这种「仅标题占位页」，
 * 供编辑期「补全此页」与「一键补全空白页」定位；口径与 deckLint 的 empty_page 一致。
 */
export function isBlankSlide(s: Slide): boolean {
  if ((s.layout ?? "auto") === "section") return false
  const hasBody = Boolean(
    (s.bullets ?? []).some((b) => (b ?? "").trim()) ||
      (s.chart && (s.chart.categories?.length ?? 0) > 0) ||
      (s.kpi && s.kpi.length > 0) ||
      s.figures?.length ||
      s.image ||
      (s.imageHint ?? "").trim(),
  )
  return !hasBody
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
          const arrowLabel = lr.arrowLabel != null ? String(lr.arrowLabel).trim() || undefined : undefined
          return name ? { name, modules, ...(arrowLabel ? { arrowLabel } : {}) } : null
        })
        .filter(Boolean) as { name: string; modules: string[]; arrowLabel?: string }[]
      const crossCutting = (Array.isArray(r.crossCutting) ? r.crossCutting : [])
        .map((c) => String(c).trim())
        .filter(Boolean)
      if (layers.length) {
        out.push({
          type: "architecture",
          title,
          layers: layers.slice(0, 6),
          ...(crossCutting.length ? { crossCutting: crossCutting.slice(0, 6) } : {}),
          caption,
        })
      }
    } else if (r.type === "table" && Array.isArray(r.columns) && Array.isArray(r.rows)) {
      // 表格图（2026-10-30）：四列对照表 / 指标进度表
      const columns = (r.columns as unknown[]).map((c) => String(c).trim()).filter(Boolean)
      const rows = (r.rows as unknown[])
        .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "").trim()) : null))
        .filter((row): row is string[] => Array.isArray(row) && row.some(Boolean))
      const variant = r.variant === "progress" ? "progress" : r.variant === "compare" ? "compare" : undefined
      if (columns.length >= 2 && rows.length) {
        out.push({
          type: "table",
          title,
          columns: columns.slice(0, 6),
          rows: rows.slice(0, 10),
          ...(variant ? { variant } : {}),
          caption,
        })
      }
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
    won_sample: rec.won_sample === true,
    hospital_level: String(rec.hospital_level ?? ""),
    beds_total: Number(rec.beds_total ?? 0),
    modules_summary: String(rec.modules_summary ?? ""),
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
          // R285：0/非法一律归一为原价，杜绝重载后小计悄悄归零（旧口径 ||0 有此隐患）
          discount: normalizeDiscount(it.discount == null ? undefined : Number(it.discount)),
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
  // ai-stability-01：截候选走 extractJsonCandidate 单一真源，失败抛可读错误而非裸 SyntaxError
  const candidate = extractJsonCandidate(text)
  if (!candidate) throw new Error("AI 返回格式解析失败，请重试")
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

/**
 * 大纲条目（2026-10-30 重构）。
 *
 * 原实现只有 { title, intent }，导致大纲阶段模型给出的 role/kind 被**静默丢弃**，
 * 逐页生成时没有任何类型约束 → 全部退化成 bullets（这就是"纯文字页过多"的根因）。
 * 现补全为完整契约，逐页生成必须遵守 kind。
 */
export type SlidePlan = {
  /** 稳定 id，逐页生成时复用（便于单页重试与 sourceRefs 追溯） */
  id: string
  title: string
  intent: string
  /** 页面类型：cover/agenda/section/bullets/kpi/chart/table/flow/architecture/image/summary */
  kind: SlideKindZ
  /** 叙事角色（SCQA） */
  role?: SlideRoleZ
  /** 引用的素材块 */
  sourceRefs?: SourceRefZ[]
  /** 预估内容量（字） */
  estimatedContent?: number
  /**
   * 大纲阶段就定下的配图/图示意图（2026-11-04 B 项）。
   *
   * 为什么必须在大纲阶段就有：视觉计划与自动配图都要「先知道这页该画什么」。
   * 等逐页生成完再按标题猜，只能搜到与页面语义无关的图（架构页配到医院大楼）。
   * 逐页生成时作为兜底值传下去；模型自己给了更贴切的 imageHint 时优先用模型的。
   */
  imageHint?: string
}

/** kind → 中文名（提示用） */
export const KIND_LABEL_CN: Record<SlideKindZ, string> = KIND_LABEL

/**
 * 大纲归一化：**改用 Zod 校验，完整保留全部字段**。
 *
 * 兼容旧数据/旧模型输出：缺 kind 时按标题与位置推断（而非直接丢弃），
 * 但推断结果会在返回值里标注 `inferred: true`，供界面提示用户复核。
 */
export function normalizeSlidePlan(raw: unknown, expect: number): SlidePlan[] {
  const arr = pickArray(raw, ["slides", "outline", "pages"])
  const out: SlidePlan[] = []
  arr.forEach((it, idx) => {
    if (typeof it === "string") {
      const title = it.trim()
      if (title) out.push({ id: `s${idx + 1}`, title, intent: "", kind: inferKindFromTitle(title, idx, expect) })
      return
    }
    if (!it || typeof it !== "object") return
    const rec = it as Record<string, unknown>
    const title = String(rec.title ?? rec.name ?? "").trim()
    if (!title) return
    // 用 Zod 宽松校验单条：非法 kind 不丢弃整条，而是推断后保留（避免"全军覆没"）
    const kindRaw = SlideKindSchema.safeParse(rec.kind)
    const roleRaw = SlideRoleSchema.safeParse(rec.role)
    const refsRaw = Array.isArray(rec.sourceRefs)
      ? rec.sourceRefs
          .map((r) => (r && typeof r === "object" ? SourceRefSchema.safeParse(r) : null))
          .filter((r): r is { success: true; data: SourceRefZ } => Boolean(r?.success))
          .map((r) => r.data)
      : []
    // 2026-11-04 B 项：兼容旧字段 visualHint（chart|kpi|table|architecture|flow|image|text）
    // ——旧版提示词要的是 visualHint，模型可能仍按老口径返回，不能因为字段改名就丢掉页型。
    const legacyVisual = String(rec.visualHint ?? "").trim().toLowerCase()
    const legacyKind =
      legacyVisual === "text" ? SlideKindSchema.safeParse("bullets") : SlideKindSchema.safeParse(legacyVisual)
    const kind = kindRaw.success ? kindRaw.data : legacyKind.success ? legacyKind.data : inferKindFromTitle(title, idx, expect)
    const imageHint = String(rec.imageHint ?? rec.image_hint ?? "").trim().slice(0, 60)
    out.push({
      id: String(rec.id ?? `s${idx + 1}`).slice(0, 40) || `s${idx + 1}`,
      title,
      intent: String(rec.intent ?? rec.summary ?? "").trim().slice(0, 200),
      kind,
      ...(roleRaw.success ? { role: roleRaw.data } : {}),
      ...(refsRaw.length ? { sourceRefs: refsRaw.slice(0, 8) } : {}),
      ...(imageHint ? { imageHint } : {}),
      estimatedContent: Number(rec.estimatedContent) > 0 ? Math.min(2000, Number(rec.estimatedContent)) : 0,
    })
    if (out.length >= expect + 4) return
  })
  if (!out.length) throw new Error("AI 返回的大纲为空，请重试")
  return out.slice(0, expect + 4)
}

/**
 * 从标题与位置推断 kind（仅在模型没给/给错时兜底）。
 * 推断遵循"宁简不错"：**只有明确信号才推断成结构化 kind**，
 * 含糊的一律给 bullets —— 绝不为了视觉丰富而编造图表/架构图。
 */
export function inferKindFromTitle(title: string, idx: number, total: number): SlideKindZ {
  const t = title
  // 结构信号优先于位置判断（否则单页大纲里"实施路径"会被误判成封面）
  if (/目录|议程|agenda/i.test(t)) return "agenda"
  if (/^(第[一二三四五六七八九十]+部分|Part|章节|小结)/i.test(t)) return "section"
  if (/(架构|技术栈|总体设计|分层|系统组成)/.test(t)) return "architecture"
  if (/(流程|步骤|实施路径|阶段划分|实施计划|推进计划)/.test(t)) return "flow"
  if (/(对照|对比表|清单|矩阵|指标表|里程碑表)/.test(t)) return "table"
  if (/(趋势|增长|占比|对比分析|数据表现|年度指标)/.test(t)) return "chart"
  if (/(成效|价值|亮点|规模|数量|实力)/.test(t)) return "kpi"
  if (/(场景|环境|现场|实景)/.test(t)) return "image"
  // 位置信号兜底（结构信号都没有时）
  if (idx === 0) return "cover"
  if (idx === total - 1) return "summary"
  return "bullets"
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

/**
 * 单发生成页数防御（R149）：模型被明确告知「共生成 N 页」，但小目标页数时偶发自行加页
 * （如目标 3 页返回 6 页），旧 normalizeSlides 单发路径完全不限页数、照单全收。
 * 超页时保留首页(开场)与末页(收尾致谢)、仅裁剪中间正文页并维持大纲次序；
 * 不足 target 不补（无法凭空编页）。target 非正数或不超页时原样返回。
 */
export function trimSlidesToTarget<T extends { title: string }>(slides: T[], target: number): T[] {
  if (!Number.isFinite(target) || target <= 0 || slides.length <= target) return slides
  if (target === 1) return [slides[0]]
  const middleCount = Math.max(0, target - 2)
  return [
    slides[0],
    ...slides.slice(1, slides.length - 1).slice(0, middleCount),
    slides[slides.length - 1],
  ]
}

/** 归一化页面角色：非法值一律丢弃（渲染层按 undefined 走中性样式） */
export function normalizeSlideRole(raw: unknown): SlideRole | undefined {
  const v = String(raw ?? "").trim().toLowerCase()
  return v in SLIDE_ROLE_LABEL ? (v as SlideRole) : undefined
}

export function normalizeSlides(raw: unknown, plan: SlidePlan[] | null, maxPages?: number): Slide[] {
  const arr = pickArray(raw, ["slides", "pages"])
  const out: Slide[] = []
  arr.forEach((it, i) => {
    const rec = (it && typeof it === "object" ? it : {}) as Record<string, unknown>
    const title = String(rec.title ?? plan?.[i]?.title ?? "").trim() || `第 ${i + 1} 页`
    const bullets = normalizeBulletList(rec.bullets ?? rec.points ?? rec.items)
    const notes = String(rec.notes ?? rec.note ?? rec.speech ?? "").trim()
    const role = normalizeSlideRole(rec.role)
    out.push({ id: makeUid(), title, bullets: bullets.length ? bullets : [title], notes, ...(role ? { role } : {}), ...slideVisual(rec) })
  })
  if (!out.length) throw new Error("AI 返回的页面内容为空，请重试")
  return maxPages === undefined ? out : trimSlidesToTarget(out, maxPages)
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

/** 目录行判定：短行且以孤立页码收尾（与标书侧 R143 同一判别信号，此处只用于节选时剔除噪声） */
function isTocLikeLine(line: string): boolean {
  const t = line.trim()
  return t.length > 0 && t.length <= 60 && /\s\d{1,4}$/.test(t)
}

/**
 * R149：从招标原文抽取「事实节选」，供 PPT 以标书项目为素材时引用。
 * 招标文本头部（目录之前）是项目名称/采购人/编制时间等事实；
 * 关键的建设目标在第二章正文里——直接按头部切片会被目录页码行挤占预算，
 * 故取「头部事实 + 第二章正文窗口（跳过目录里的同名页码行）」，总长受 maxChars 约束。
 */
export function tenderFactExcerpt(tenderText: string, maxChars = 3600): string {
  const text = (tenderText ?? "").replace(/\r/g, "").trim()
  if (!text) return ""
  const lines = text.split("\n")
  const firstToc = lines.findIndex(isTocLikeLine)
  const headLines = (firstToc > 0 ? lines.slice(0, firstToc) : lines.slice(0, 6)).filter((l) => l.trim())
  let winStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^第二章/.test(lines[i].trim()) && !isTocLikeLine(lines[i])) {
      winStart = i
      break
    }
  }
  const head = headLines.join("\n")
  const window = winStart >= 0 ? lines.slice(winStart).join("\n") : ""
  return `${head}\n${window}`.replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars)
}

export function buildMaterialText(
  name: string,
  outline: OutlineNode[],
  chapters: Chapter[],
  maxChars = 4200,
  tenderText = "",
): string {
  const parts: string[] = [`【素材来源】${name}`]
  const tender = tenderFactExcerpt(tenderText)
  if (tender) parts.push(`【招标文件节选（项目事实、评级目标与建设范围以此为准）】\n${tender}`)
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

export type DeckContext = {
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
    // 2026-10-08 全站审查：标题/要点纯中文，杜绝「信息化 overview」式中英混排
    "【语言铁律】title、bullets、notes 一律用简体中文，禁止中英混排标题（如「信息化 overview」）；行业通用缩写（HIS、EMR、LIS、PACS、FHIR、DIP、ESB、SOA、KPI、UAT）与必要数字可保留。",
    // —— 借鉴 Anthropic pptx skill + academic-pptx 编辑方法论（作为默认质量基线，对所有用户生效）——
    "【行动标题 Action Title】每页 title 必须是一句有信息量的结论/观点（≤20 字），读者只看标题串起来就能读懂整份汇报的逻辑；" +
      "禁止用名词标签式标题（如「项目背景」「建设方案」「系统架构」），应改写为承载判断的陈述句（如「老系统孤岛数据拖慢全院协作」「一体化平台把门诊准备时间压缩 40%」）。",
    "【图表结论句】凡带 chart 或 kpi 的页，其至少一条要点必须用一句话点明该数据要说明的结论（数字+so what），例如「三期投资逐年递减，运维占比升至 45%」，让图表自证观点而非装饰。",
    "【反 AI 味铁律】禁用空洞排比与套话堆砌（如反复使用『赋能/打造/闭环/抓手/生态/颠覆』却不给具体所指）；每条要点必须落到具体系统、指标、举措或对象；宁少而实，不多而空。",
    // 2026-10-15 评级术语白名单（防 BUG-105 重现：2026 真实场景下"互联互通五乙"等已不是国家正式评级用语，
    // 旧版大纲会"凭印象"输出过时术语，对外汇报被信息科/院长当场挑出）。逐项硬约束：
    "【评级术语白名单·医疗信息化 2026】涉及医院信息化评级时一律按下列最新口径表达，禁用已废止/不存在/拼凑的表述：" +
      "① 电子病历应用水平分级评价：0-8 级（0-4 级从 2021 版起合并数字命名，5-8 级保留），不写「电子病历六级」应写「电子病历 6 级」或「六级及以上」；" +
      "② 医院信息互联互通标准化成熟度测评：当前对外公开的最高等级是五级甲等/五级乙等，**已废止**「五乙」作为对内表述名（行业宣传材料里还在混用旧称）；若本院已通过五级乙等评审，对外正式表述用「互联互通五级乙等（2021 版）」，" +
      "③ 医院智慧服务分级评估：0-5 级（2023 版），不写「智慧服务三级」应写「智慧服务 3 级」；" +
      "④ 医院智慧管理分级评估：0-5 级（2023 版），仅 1-5 级为有效级别，0 级是预评估起步；" +
      "⑤ 互联互通应用成熟度（HL7 FHIR）属接口技术规范不是评级，不要与互联互通成熟度测评混用；" +
      "⑥ 「智慧中医院」不是国家评级（国家叫「电子病历应用水平分级」「医院智慧服务/管理分级」+「互联互通成熟度」四套），不得自创；" +
      "⑦ 中医医院额外参照国家中医药管理局《中医医院信息系统基本功能规范》和《中医馆健康信息平台基本功能规范》，但这两份是建设规范不是评级；" +
      "严格按以上口径写，不确定时写「对标 XX 级目标」并在讲稿备注里说明政策依据（出处限 12 字内）。",
  ].join("\n")
}

// 架构图专用规则（2026-10-29 从 4 篇行业范文提炼，见 docs/architecture-ppt-playbook.md）
// 目的：让模型画出来的分层图「能看出架构决策」，而不是把模块名堆成几行横条。
const ARCH_RULES = [
  "【架构图画法铁律】（画 architecture 图时必须遵守，来自行业范本）：",
  "1. 分层顺序固定：渠道/接入层 → 业务服务层 → 平台能力层 → 数据与中间件层（可按项目裁剪，但必须自下而上逐层支撑）；",
  "2. 层名要短（≤6 字）且职责单一：如「渠道层」「接入层」「业务层」「能力层」「数据层」，不要出现「其他」「支撑」这类空泛层名；",
  "3. 每层 3-6 个模块为宜，模块名用行业真实系统名（HIS/EMR/LIS/PACS/CDSS/集成平台/主索引/数据中台…），禁止编造不存在的产品名；",
  "4. 业务层要体现「业务域」分片思路：按 门诊/住院/医技/药事/管理 等真实业务域组织，而不是把所有系统平铺；",
  "5. 必须体现非功能能力：接入层的网关/鉴权、能力层的监控/日志/配置、数据层的数据治理与安全，这些「业务图不会说但架构必须有」——把安全/运维/监控放进 crossCutting 数组（右侧竖条渲染）；",
  "6. 层间调用关系用 arrowLabel 标注协议/方式（如「HTTPS/REST」「消息队列」「数据同步」），让架构图看得出关键质量属性（并发、一致性、可用性、合规），只画业务功能的图等于没画架构；",
  "7. 层数控制在 4-6 层，超过 7 层说明分层没收敛；",
  "8. 画完自检：同一层内的模块是否同粒度？跨层调用关系是否单向（上层调下层）？有没有出现「孤儿模块」无处挂靠？",
].join("\n")

// ---------------------------------------------------------------------------
// 汇报叙事骨架（2026-10-30，用户反馈「没有汇报思路」的根因修复）
//
// 问题：原来只让模型输出「标题+3-5条要点」，模型就退化成逐页罗列信息，
// 全册读完不知道想说服听众什么。售前汇报的本质是「讲一个有主张的故事」，
// 不是「把资料分页」。
//
// 解法：强制 SCQA（情境-冲突-问题-答案）叙事主线 + 金字塔原理（结论先行），
// 并把每页在故事中的角色（role）显式输出，让页面之间有因果推进而不是并列罗列。
// ---------------------------------------------------------------------------
const NARRATIVE_RULES = [
  "【汇报叙事铁律】（这决定了全册有没有『思路』，比单页好看更重要）",
  "",
  "▎整体骨架：用 SCQA 讲一个有主张的故事",
  "  S 情境：先讲双方都认可的现状（医院规模/评级基础/已有系统），建立共识；",
  "  C 冲突：指出打破现状的变化（政策要求/评级周期/业务压力/技术代差）；",
  "  Q 问题：把冲突收敛成 1-3 个必须回答的问题（如「5级怎么过」「数据孤岛怎么破」）；",
  "  A 答案：给出我们的主张与路径（架构/方案/实施/保障），逐层展开论证。",
  "  → 全册必须能一句话概括主张，且第 1-3 页就要亮出来（结论先行，金字塔原理）。",
  "",
  "▎每页必须标明在故事中的角色 role，取值：",
  "  context=背景情境  problem=冲突痛点  question=核心问题  answer=核心主张",
  "  evidence=论据支撑  approach=实现路径  plan=实施计划  value=价值收益  close=收尾",
  "  role 决定这页该用什么版式（见下），不允许全册清一色 problem/bullets。",
  "",
  "▎页与页之间要有推进关系：",
  "  - 每页标题应能接住上一页的结论（念下来像一段连贯的话，而不是目录条目）；",
  "  - problem 页之后必须紧跟 answer 或 question，不能连续三页都在骂现状；",
  "  - 每 3-4 页要有一个『小结论』页（answer/value），把前面的论据收一下。",
  "",
  "▎禁止的写法：",
  "  ✗ 全册 70% 以上是「标题 + 4条要点」的纯文字页；",
  "  ✗ 要点之间没有逻辑关系，只是把资料拆成短句；",
  "  ✗ 每页都在讲『是什么』，没有『所以呢』（So what）。",
].join("\n")

// ---------------------------------------------------------------------------
// 版式选择指引（2026-10-30 重构：**取消硬配额**）
//
// 用户明确要求：「删除"视觉页必须占 60%"等硬配额，页面形式由内容决定，
// 禁止为了凑图表而编造数据。」
//
// 原规则的问题：它给模型下"必须产出 N 个图表"的死指标，模型没数据时就会编数字 ——
// 这是售前 PPT 最危险的事故源。现改为**决策树**：只告诉模型"什么内容配什么形态"，
// 不规定各类页面的数量。够不够好看由内容质量决定，不靠凑数。
// ---------------------------------------------------------------------------
function layoutGuideRules(): string {
  return [
    "【页面形式怎么选】（按内容决定，**不设数量配额**）",
    "先看这一页要传达什么：",
    "  · 有并列对照（现状/目标、我方/友商、依据/要求）→ table(compare)",
    "  · 有分阶段/分年度指标 → table(progress)",
    "  · 有可比较的真实数值序列（且 ≥3 个、同量纲、有出处）→ chart",
    "  · 有 2-4 个不同量纲的关键成效数字 → kpi",
    "  · 有系统分层/技术组成 → architecture（3-6 层，每层 2-6 模块）",
    "  · 有实施步骤/业务流程 → flow（3-7 步）",
    "  · 有真实场景/设备/环境且能配到图 → image",
    "  · 以上都没有、是论点/论证 → bullets（这是**正常且常见**的选择）",
    "",
    '重要：bullets 不是"低配"。一份好的售前汇报里，论述性内容本来就该用要点表达。',
    '**不要为了"看起来图文并茂"而把没有结构的内容硬套成图表。**',
  ].join("\n")
}

// ---------------------------------------------------------------------------
// 禁止编造规则（2026-10-30 替代原「视觉页必须占 60%」硬配额）
//
// 用户明确要求：页面形式由内容决定，禁止为了凑图表而编造数据。
// 原配额规则的问题：它逼着模型"必须产出 N 个图表"，模型没数据时就会编，
// 这是售前 PPT 最危险的事故源（编出来的数字会被客户当场问穿）。
// ---------------------------------------------------------------------------
const NO_FABRICATION_RULES = [
  '【禁止编造铁律】（比"好看"更重要，违反即整页作废）',
  "1. 没有素材依据的数字、百分比、金额、客户名称、政策名称一律不得写；",
  "2. 需要数据但素材里没有时：不要生成 chart/kpi，改用 bullets，并在 pendingFields 里写【待补充：具体字段】；",
  '3. 不得把"行业常识"包装成"本项目的具体数据"（如无出处不得写"提升 30%"）；',
  "4. 不得编造医院/客户名称、产品型号、资质证书、认证等级；",
  '5. 页面形式由内容决定：内容适合要点就用 bullets，适合结构才用架构图/流程图，没有可靠数据就不用图表。**不要为了"图文并茂"硬塞图表。**',
  "6. 拿不准的一律写【待补充：xxx】并提醒用户补，不要猜。",
].join("\n")

// 页标题规则（2026-10-30，借鉴 Gamma）：标题必须是完整结论句/观点句，不是名词短语。
// 名词短语标题（如「建设方案」「系统架构」）听众看完不知道你想说什么；
// 结论句标题（如「一体化平台是评级达标的最短路径」）3 秒读懂观点，汇报可直接念。
const TITLE_RULE = [
  "【页标题铁律】",
  "1. 每页标题必须是「观点/结论句」——看完能知道这页想说什么，如「数据孤岛是互联互通失败的头号原因」；",
  "2. 禁止纯名词短语标题，如「建设方案」「系统架构」「项目背景」——这类标题信息量≈0；",
  "3. 章节过渡页(section 版式)可用短语，但内容页（bullets/chart/kpi/图文页）必须结论句；",
  "4. 拿不准时自检：把标题念给同事听，对方能复述出这页的核心观点吗？不能就重写。",
].join("\n")

// 图文并茂：视觉字段说明（2026-10-30 从"可选"改为"按配额必给"——模型对"建议"几乎不执行）
const VISUAL_RULES = [
  "【视觉字段用法】以下字段按上一节的版式配额**必须给出**（不是可选）：",
  '- "layout"：版式，取值 bullets(纯要点) / section(章节过渡大字页) / image-right 或 image-left(图文左右分栏) / banner(顶部通栏大图+下方要点) / chart(数据图表页) / kpi(大数字卡)；不填按内容自适应。',
  '- "chart"：当且仅当该页有可量化数据（门诊量、床位数、投资额、占比、分期计划等）时给出，格式 {"type":"bar|pie|line","title":"图标题","unit":"单位","categories":["类目1","类目2"],"series":[{"name":"系列名","data":[10,20]}]}；数字优先取自素材，素材没有把握的不要编造。',
  '- "kpi"：突出关键成效数字时给出，格式 [{"value":"35%","label":"护理效率提升"}]，2-4 个。',
  '- "imageHint"：该页适合配一张真实照片（医院环境/建筑/场景/设备）时，给一个中文配图关键词（如「医院门诊大楼」「智慧病房」「一体化手术部」）。',
  '- "figures"：当该页讲的是系统分层架构、业务流程、对照关系或系统界面时，输出结构化图示数据（最多 2 个，应用内会自动绘制成矢量图并随导出嵌入）：架构图 {"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"],"arrowLabel":"层间调用协议（可选）"}],"crossCutting":["信息安全","运维管理"]}——crossCutting 是横切关注点（安全/运维/监控/标准规范），强烈建议给出；流程图 {"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；表格 {"type":"table","title":"图名","columns":["列1","列2","列3","列4"],"rows":[["值","值","值","值"]],"variant":"compare|progress"}——「依据/要求/动作/边界」这类四列对照用 variant=compare，年度目标/指标达成用 variant=progress（数值如 95% 会自动画进度条）；界面示意 {"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}。层/步骤/模块名必须来自素材或行业真实系统名称，每个不超过 12 字；没有合适图型就输出空数组，不要硬凑。',
  ARCH_RULES,
  "带 chart 或 kpi 的页，把 layout 设为对应类型，并把重复的数字从要点里去掉；视觉字段合适才给，宁缺毋滥、不为凑数硬塞。",
].join("\n")

export function buildDeckSingleMessages(ctx: DeckContext, pageCount: number): LlmMessage[] {
  const system = [
    deckSystem(ctx),
    `输出铁律：只输出一个 JSON 对象，不要 markdown 围栏以外的任何解释。格式：`,
    `{"slides":[{"title":"页标题(≤16字)","role":"context|problem|question|answer|evidence|approach|plan|value|close","kind":"cover|agenda|section|bullets|kpi|chart|table|flow|architecture|image|summary","bullets":["要点1","要点2"],"notes":"该页讲稿备注(80-150字)","layout":"bullets|chart|kpi|table|image-right|banner","chart":null,"kpi":null,"imageHint":"..."}]}`,
    NARRATIVE_RULES,
    TITLE_RULE,
    layoutGuideRules(),
    // 2026-11-04 B 项：≤10 页走单发（不进大纲），配额只能写进提示词；
    // 与大纲路径共用同一份文案，避免两条路径口径分叉。
    kindQuotaRuleText(pageCount),
    VISUAL_RULES,
    `共生成 ${pageCount} 页（含开场页与收尾致谢页）；纯文字页要点 3-4 条、每条 ≤26 字（越短越像汇报、越不像文档）；讲稿备注面向「${ctx.audience || "院领导"}」的口吻，讲稿可详细但**页面上要少字**。`,
    "最后自检（不达标就重写这几页）：① 全册念下来是不是一个有主张的故事？② 纯文字页是否超过配额？③ 有没有连续三页以上都在罗列现状？④ 每页标题是不是结论句？⑤ 架构/流程/KPI 页是否达到配额？",
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
    `{"slides":[{"id":"s1","title":"页标题(≤16字)","role":"context|problem|question|answer|evidence|approach|plan|value|close","intent":"该页要讲什么(一句话，结构化页要写清骨架)","kind":"cover|agenda|section|bullets|kpi|chart|table|flow|architecture|image|summary","imageHint":"这页要画什么/给谁看（不需要配图的页留空串）"}]}`,
    NARRATIVE_RULES,
    TITLE_RULE,
    layoutGuideRules(),
    // 2026-11-04 B 项：大纲阶段就下硬配额（与 enforceOutlineKindQuota 同源文案），
    // 否则模型仍会整册输出 bullets，到逐页生成再改就要重写内容。
    kindQuotaRuleText(pageCount),
    `共 ${pageCount} 页（含开场页与收尾致谢页），页与页之间逻辑递进、不重复。`,
    "大纲阶段就要把 SCQA 骨架排好：哪些页是问题、哪些页是答案、哪些页是论据，并给每页标 kind 与 imageHint。",
    "自检（不达标就重排这几页）：① 架构页 ≥ 配额？② 流程/分期页 ≥ 配额？③ KPI/对照页 ≥ 配额？④ 纯 bullets 页是否超 30%？",
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: deckContextLines(ctx) },
  ]
}

// ---------------------------------------------------------------------------
// 各 kind 的输出示例（2026-10-30 修复问题 2）
//
// 原实现把 `"layout":"bullets"` 写死在示例里 —— 等于告诉模型"所有页都输出要点"，
// 这是"纯文字页过多"的直接原因。现改为**按该页既定 kind 给出对应示例**。
// ---------------------------------------------------------------------------
const KIND_EXAMPLE: Record<SlideKindZ, string> = {
  cover: `{"id":"s1","title":"页标题","kind":"cover","bullets":["副标题或汇报对象"],"notes":"讲稿"}`,
  agenda: `{"id":"s2","title":"目录","kind":"agenda","bullets":["一、现状与挑战","二、总体方案","三、实施路径"],"notes":"讲稿"}`,
  section: `{"id":"s3","title":"第一部分 现状分析","kind":"section","bullets":[],"notes":"讲稿"}`,
  bullets: `{"id":"s4","title":"结论式标题","kind":"bullets","bullets":["要点1","要点2","要点3"],"notes":"详细讲稿"}`,
  kpi: `{"id":"s5","title":"结论式标题","kind":"kpi","bullets":[],"kpi":[{"value":"5级","label":"电子病历目标"},{"value":"12个月","label":"建设周期"}],"notes":"讲稿"}`,
  chart: `{"id":"s6","title":"结论式标题","kind":"chart","bullets":[],"chart":{"type":"bar","title":"图标题","unit":"%","categories":["2024","2025"],"series":[{"name":"指标","data":[78,96]}],"dataSource":"来自客户提供的历史数据"},"notes":"讲稿"}`,
  table: `{"id":"s7","title":"结论式标题","kind":"table","bullets":[],"table":{"columns":["维度","现状","目标"],"rows":[["电子病历","4级","5级"],["互联互通","未测评","四级甲等"]],"variant":"compare"},"notes":"讲稿"}`,
  flow: `{"id":"s8","title":"结论式标题","kind":"flow","bullets":[],"flow":{"steps":[{"name":"调研","desc":"2周"},{"name":"建设","desc":"6个月"},{"name":"验收","desc":"1个月"}]},"notes":"讲稿"}`,
  architecture: `{"id":"s9","title":"结论式标题","kind":"architecture","bullets":[],"architecture":{"layers":[{"name":"业务层","modules":["HIS","EMR"],"arrowLabel":"服务调用"},{"name":"平台层","modules":["集成平台","主索引"]},{"name":"数据层","modules":["业务库","数据仓"]}],"crossCutting":["信息安全","运维监控"]},"notes":"讲稿"}`,
  image: `{"id":"s10","title":"结论式标题","kind":"image","bullets":["要点1","要点2"],"imageHint":"医院门诊大厅","notes":"讲稿"}`,
  summary: `{"id":"s11","title":"总结与展望","kind":"summary","bullets":["核心结论1","核心结论2"],"notes":"讲稿"}`,
}

/** 单页生成消息（2026-10-30：默认 1 页/批，从"批"降到"页"以隔离失败） */
export function buildSlideContentMessages(ctx: DeckContext, plan: SlidePlan, allTitles: string[]): LlmMessage[] {
  const example = KIND_EXAMPLE[plan.kind] ?? KIND_EXAMPLE.bullets
  // 页码：优先按 title 找回索引；找不到（标题被改过）时兜底为 1，避免出现"第 0 页"
  const foundIdx = allTitles.indexOf(plan.title)
  const pageNo = foundIdx >= 0 ? foundIdx + 1 : 1
  const isDataKind = plan.kind === "chart" || plan.kind === "kpi"
  const contentRules = [
    "内容要求：",
    "1. 标题必须是结论句（≤20 字），不能是名词短语；",
    "2. bullets 默认 2-4 条、每条 ≤32 字（kind 为 cover/section/kpi/chart/table/flow/architecture 时可留空）；",
    "3. 详细内容写进 notes（80-200 字），页面要少字；",
    "4. 不得输出坐标、字号、颜色、HTML 或任何排版指令；",
    "5. 缺事实/数据时，在 pendingFields 里列出「待补充：具体字段」，不要编造；",
  ]
  if (isDataKind) {
    contentRules.push(
      `6. 本页要求数据。素材里没有可靠数字时，不要生成 ${plan.kind}，改为 kind="bullets" 并在 pendingFields 写明待补充项，notes 里说明需要客户提供什么。`,
    )
  }
  if (plan.sourceRefs?.length) {
    contentRules.push(`7. 本页引用素材：${plan.sourceRefs.map((r) => r.materialName || r.chunkId).join("、")}；内容须来自这些素材。`)
  }
  const system = [
    deckSystem(ctx),
    `整体大纲（共 ${allTitles.length} 页）：\n${allTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    "",
    `【本页任务】只生成第 ${pageNo} 页「${plan.title}」，不要输出其它页。`,
    `- 页面类型 kind 已由大纲确定为「${KIND_LABEL[plan.kind]}」，必须原样使用 kind="${plan.kind}"，不得改回 bullets。`,
    plan.role ? `- 该页叙事角色：${plan.role}` : "",
    plan.intent ? `- 该页要讲什么：${plan.intent}` : "",
    // 2026-11-04 B 项：大纲已定下这页要画什么，逐页生成照此给图表/图示意图，
    // 别再让模型在"这页该不该配图"上重新猜一遍（猜出来的图常与页面语义无关）。
    plan.imageHint ? `- 该页视觉意图（大纲已定）：${plan.imageHint}` : "",
    plan.estimatedContent ? `- 预估正文约 ${plan.estimatedContent} 字` : "",
    "",
    "输出铁律：只输出一个 JSON 对象，格式：",
    `{"slides":[${example}]}`,
    "",
    contentRules.join("\n"),
    NO_FABRICATION_RULES,
  ]
    .filter(Boolean)
    .join("\n")
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `${deckContextLines(ctx)}${plan.sourceRefs?.length ? `\n\n【本页可用素材片段】\n${plan.sourceRefs.map((r) => `- ${r.excerpt}`).join("\n")}` : ""}\n\n【本页标题（已定）】${plan.title}`,
    },
  ]
}

export function buildDeckBatchMessages(ctx: DeckContext, batch: SlidePlan[], allTitles: string[]): LlmMessage[] {
  // 2026-10-30 修复（问题 2）：不再用 bullets 作统一示例，改为按各页既定 kind 给示例
  const batchLines = batch
    .map((p, i) => {
      const role = p.role ? `，角色 ${p.role}` : ""
      const intent = p.intent ? `，意图：${p.intent}` : ""
      return `${i + 1}. [kind=${p.kind}${role}] ${p.title}${intent}`
    })
    .join("\n")
  const examples = Array.from(new Set(batch.map((p) => p.kind)))
    .map((k) => `- kind="${k}" 的示例：${KIND_EXAMPLE[k] ?? KIND_EXAMPLE.bullets}`)
    .join("\n")
  const system = [
    deckSystem(ctx),
    `整体 PPT 的页面大纲已确定：\n${allTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    "",
    "现在请为下面这一批页面生成详细内容。**每页的 kind 已由大纲确定，必须原样保留，不得改回 bullets。**",
    "",
    "各 kind 的输出示例（只列本批出现的类型）：",
    examples,
    "",
    '输出铁律：只输出一个 JSON 对象，格式 {"slides":[...]}，顺序与本批一致，每页必须带 id/title/kind。',
    `本批共 ${batch.length} 页；bullets 默认 2-4 条、每条 ≤32 字；详细内容写 notes。`,
    layoutGuideRules(),
    NO_FABRICATION_RULES,
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
        : kind === "condense"
          ? "精简：压缩到 3 条以内核心要点，每条 ≤26 字，不丢关键信息"
          : "补全：本页目前只有标题、还没有正文要点，请紧扣该页标题在全篇中的定位，撰写 3-5 条要点（每条 ≤32 字），并配一段 80-150 字的讲稿备注；内容须贴合全篇主题、不与其它页重复，数字与承诺无出处时留【待填写】，不要编造"
  const system = [
    `你是医疗信息化行业资深售前顾问，正在精修「${deck.deck_name}」（${deckTypeLabel(deck.deck_type)}，汇报对象：${deck.audience || "院领导"}）中的第 ${slide.title} 页。`,
    `请对该页执行「${action}」。讲稿备注同步调整，与要点保持一致。`,
    '输出铁律：只输出一个 JSON 对象，格式：{"title":"页标题","bullets":["要点"],"notes":"讲稿备注"}，title 除非明显有问题否则保持不变。',
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

// ---------------------------------------------------------------------------
// 文字润色（2026-10-30，借鉴 ChatPPT / iSlide 的「AI 润色选中文字」）
//
// 与 refineSlide 的区别：
//   refineSlide = 整页重写（标题+要点+讲稿一起改），适合"这页整体不行"；
//   polishText  = 只打磨一段文字（单条要点/讲稿/标题），适合"其它都好就这句别扭"。
//   后者改动面小、可逆、不需要重新审整页，是日常编辑里更高频的操作。
// ---------------------------------------------------------------------------
export type PolishKind = "tighten" | "expand" | "professional" | "plain"

export const POLISH_LABEL: Record<PolishKind, string> = {
  tighten: "精简",
  expand: "扩写",
  professional: "专业化",
  plain: "说人话",
}

const POLISH_ACTION: Record<PolishKind, string> = {
  tighten: "精简：删掉冗余修饰与重复表述，保留全部事实信息，字数压到原文的 60% 左右",
  expand: "扩写：补上支撑这个观点的具体做法/数据/场景，字数约为原文 1.6 倍，不编造无出处的数字",
  professional: "专业化：换成医疗信息化售前汇报的书面表达，用词精准、去掉口语和感叹，长度与原文相当",
  plain: "说人话：把术语堆叠拆成人能听懂的说法，保留专业性但降低理解成本，长度与原文相当",
}

/**
 * 单段文字润色消息。
 *
 * @param text    待润色的文字（要点/讲稿/标题）
 * @param kind    润色方向
 * @param context 该页标题与要点，帮助模型不跑题（可选）
 */
export function buildPolishMessages(text: string, kind: PolishKind, context?: { title?: string; bullets?: string[] }): LlmMessage[] {
  const system = [
    "你是医疗信息化行业资深售前顾问，擅长把方案文字打磨到汇报级表达。",
    `本次任务：对用户给出的「${POLISH_LABEL[kind]}」——${POLISH_ACTION[kind]}。`,
    context?.title ? `所属页面标题：${context.title}` : "",
    context?.bullets?.length ? `该页其它要点（仅供理解上下文，不要重复或改写它们）：\n${context.bullets.map((b) => `- ${b}`).join("\n")}` : "",
    '输出铁律：只输出一个 JSON 对象 {"text":"润色后的文字"}；只润色用户给的那段文字，不要输出解释、不要加引号、不要换行分点。',
    "硬约束：不得凭空新增医院名称、具体金额、具体百分比等无出处的事实；原文没有的数据不要编。",
  ]
    .filter(Boolean)
    .join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ]
}

/** 从润色结果里取文本：优先 JSON 的 text 字段，退化到原文修剪 */
export function parsePolishResult(raw: string, fallback: string): string {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return fallback
  // 去掉可能的 markdown 围栏
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
  try {
    const obj = JSON.parse(unfenced) as { text?: unknown }
    const t = String(obj?.text ?? "").trim()
    if (t) return t
  } catch {
    /* 非 JSON：按下面的兜底处理 */
  }
  return unfenced || fallback
}

export function buildQuoteDraftMessages(refName: string, materialText: string, catalog: CheckProduct[]): LlmMessage[] {  const MAX_CATALOG = 200
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
    '【输出格式】只输出一个 JSON 对象：{"items":[{"product_id":"...","qty":1}]}；qty 为正整数，同一 product_id 仅出现一次。',
    "【价格与备注】价格、折扣、备注一律留空，由人工后录。不允许你输出 price / unit_price / discount / remark 字段。",
    "【分组不手写】分组由系统根据 product_id 对应的产品类别自动归类，你不需输出 group / category。",
    "【覆盖度】从素材中识别主要建设内容，尽量在目录中找到匹配项；目录里没有对应产品时直接跳过，不要生造。总条数 8-40 条之间。",
    '【目录为空】若产品目录为空，输出 {"items":[]}，不要自行补充。',
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
