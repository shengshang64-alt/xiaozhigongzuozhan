import type { CheckMapping, CheckProduct, OneLinkPriceTier } from "@/pages/SolutionStudio/checklistTypes"
import { sameIdentity } from "./mappingCore"

// ---------------------------------------------------------------------------
// 公司库 upsert + 去重（第一期）
//
// 身份沿用 mappingCore.sameIdentity：模块名 + 产品名必须一致；模块分类任一方为空
// 则通配（以便 10-08 残缺行与完整导入行合并），双方都有值时必须相等。
// 这比「产品名+模块名+标准名」更能合并标准名为空的历史行，同时不会把不同产品线
// 下的同名模块（如电子签名）误并成一条。
//
// 新表价格为空或 0 时不覆盖已有 unit_price / price_tier。
// 只处理 in_company 行；行业种子（in_company=false）不删除、不合并。
// ---------------------------------------------------------------------------

function text(v: unknown): string {
  return String(v ?? "").trim()
}

function hasRatingTags(p: { rating_tags?: CheckProduct["rating_tags"] }): boolean {
  const tags = p.rating_tags ?? {}
  return Object.values(tags).some((v) => Array.isArray(v) && v.length > 0)
}

const COMPLETENESS_FIELDS: (keyof CheckProduct)[] = [
  "product_belong",
  "category",
  "product_line",
  "product_name",
  "module_name",
  "module_func",
  "standard_name",
  "module_category",
  "module_attr",
  "recommendation",
  "charge_mode",
  "description",
]

/** 保留行打分：优先有归属/类别/评级标签的完整导入行，再比非空字段数，再比更新时间 */
export function libraryKeepScore(p: CheckProduct): number {
  let score = 0
  if (text(p.product_belong)) score += 100
  if (text(p.category)) score += 100
  if (hasRatingTags(p)) score += 100
  if (text(p.standard_name)) score += 40
  if (text(p.module_category)) score += 40
  if (text(p.recommendation)) score += 20
  for (const k of COMPLETENESS_FIELDS) {
    const v = p[k]
    if (v === null || v === undefined) continue
    if (typeof v === "string" && v.trim() === "") continue
    if (typeof v === "number" && !v) continue
    score += 1
  }
  const ts = Date.parse(String(p.updated || p.created || ""))
  if (Number.isFinite(ts)) score += ts / 1e15
  return score
}

export function pickPreferredProduct(a: CheckProduct, b: CheckProduct): CheckProduct {
  const sb = libraryKeepScore(b)
  const sa = libraryKeepScore(a)
  if (sb !== sa) return sb > sa ? b : a
  // 同分时取更早创建、再比 id，避免因数组顺序导致「先更新后删除」
  const ta = Date.parse(String(a.created || "")) || 0
  const tb = Date.parse(String(b.created || "")) || 0
  if (ta !== tb) return ta && tb ? (ta <= tb ? a : b) : a
  return String(a.id) <= String(b.id) ? a : b
}

export function companyRowsOf(products: CheckProduct[]): CheckProduct[] {
  return products.filter((p) => p.in_company)
}

/** 在公司库行里找与 incoming 同一身份的行（可能多条） */
export function findIdentityMatches(existing: CheckProduct[], incoming: Partial<CheckProduct>): CheckProduct[] {
  const probe = incoming as CheckProduct
  return existing.filter((p) => p.in_company && sameIdentity(p, probe))
}

export function priceTierHasPrice(tiers: OneLinkPriceTier[] | null | undefined): boolean {
  return (tiers ?? []).some((t) => Number(t?.price) > 0)
}

export function incomingPriceIsBlank(incoming: Partial<CheckProduct>): boolean {
  const unit = Number(incoming.unit_price) || 0
  return unit <= 0 && !priceTierHasPrice(incoming.price_tier)
}

const NON_PRICE_KEYS = [
  "category",
  "product_line",
  "product_name",
  "module_name",
  "module_func",
  "description",
  "charge_mode",
  "status",
  "rating_tags",
  "product_belong",
  "module_category",
  "standard_name",
  "module_attr",
  "coefficient",
  "recommendation",
] as const

/** 用新表行更新已有行：空价格不覆盖；其它业务字段写入 */
export function mergeIncomingProduct(existing: CheckProduct, incoming: Partial<CheckProduct>): Partial<CheckProduct> {
  const patch: Partial<CheckProduct> = {}
  for (const k of NON_PRICE_KEYS) {
    if (incoming[k] !== undefined) (patch as Record<string, unknown>)[k] = incoming[k]
  }
  if (!incomingPriceIsBlank(incoming)) {
    if (Number(incoming.unit_price) > 0) patch.unit_price = Number(incoming.unit_price)
    if (priceTierHasPrice(incoming.price_tier)) patch.price_tier = incoming.price_tier
  }
  patch.in_company = true
  patch.is_builtin = false
  return patch
}

export type UpsertPlanItem = {
  action: "create" | "update"
  incoming: Partial<CheckProduct>
  existing?: CheckProduct
  pricePreserved: boolean
  patch?: Partial<CheckProduct>
}

export type UpsertPlan = {
  items: UpsertPlanItem[]
  create: number
  update: number
  pricePreserved: number
}

export function planLibraryUpsert(existing: CheckProduct[], incoming: Partial<CheckProduct>[]): UpsertPlan {
  const company = companyRowsOf(existing)
  const items: UpsertPlanItem[] = []
  // 同一轮 incoming 若撞上同一已有行，后续条并入该更新（或待创建行），避免再插一条重复
  const claimed = new Set<string>()
  const pendingCreates: Partial<CheckProduct>[] = []
  for (const row of incoming) {
    const allMatches = findIdentityMatches(company, row)
    const matches = allMatches.filter((p) => !claimed.has(p.id))
    if (!matches.length && allMatches.length) {
      continue
    }
    if (!matches.length) {
      const dupCreate = pendingCreates.some((p) => sameIdentity(p as CheckProduct, row as CheckProduct))
      if (dupCreate) continue
      pendingCreates.push(row)
      items.push({ action: "create", incoming: row, pricePreserved: false })
      continue
    }
    const keep = matches.reduce(pickPreferredProduct)
    claimed.add(keep.id)
    const pricePreserved = incomingPriceIsBlank(row)
    items.push({
      action: "update",
      incoming: row,
      existing: keep,
      pricePreserved,
      patch: mergeIncomingProduct(keep, row),
    })
  }
  return {
    items,
    create: items.filter((x) => x.action === "create").length,
    update: items.filter((x) => x.action === "update").length,
    pricePreserved: items.filter((x) => x.pricePreserved).length,
  }
}

export type DedupeGroup = {
  keep: CheckProduct
  retire: CheckProduct[]
}

export type DedupePlan = {
  groups: DedupeGroup[]
  retireIds: string[]
  mappingRetargets: { mappingId: string; from: string; to: string }[]
}

function identNorm(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").toLowerCase()
}

/**
 * 去重聚类：同「模块名+产品名」下，非空模块分类各自成组；
 * 分类为空的历史行仅在该模块只有一种非空分类时并入该组，
 * 否则单独成组，避免「空分类」把电子签名等不同产品线桥接成一条。
 */
export function dedupeClusters(products: CheckProduct[]): CheckProduct[][] {
  const company = companyRowsOf(products)
  const coarse = new Map<string, CheckProduct[]>()
  const order: string[] = []
  for (const p of company) {
    const k = `${identNorm(p.module_name)}§${identNorm(p.product_name)}`
    if (!coarse.has(k)) {
      coarse.set(k, [])
      order.push(k)
    }
    coarse.get(k)!.push(p)
  }
  const clusters: CheckProduct[][] = []
  for (const k of order) {
    const rows = coarse.get(k)!
    const strict = new Map<string, CheckProduct[]>()
    const residual: CheckProduct[] = []
    for (const p of rows) {
      const cat = identNorm(p.module_category)
      if (cat) {
        const list = strict.get(cat) ?? []
        list.push(p)
        strict.set(cat, list)
      } else {
        residual.push(p)
      }
    }
    for (const list of strict.values()) clusters.push(list)
    if (!residual.length) continue
    if (strict.size === 1) {
      const only = [...strict.values()][0]
      only.push(...residual)
    } else {
      // 0 种或多种非空分类：空分类行只在彼此之间合并，不跨分类
      clusters.push(residual)
    }
  }
  return clusters
}

/**
 * 同身份只留字段更完整的一行；被合并行上的映射记忆改写到保留行。
 * 不处理 in_company=false 的行业种子。
 */
export function planLibraryDedupe(products: CheckProduct[], mappings: CheckMapping[]): DedupePlan {
  const groups: DedupeGroup[] = []
  for (const cluster of dedupeClusters(products)) {
    if (cluster.length <= 1) continue
    const keep = cluster.reduce(pickPreferredProduct)
    const retire = cluster.filter((x) => x.id !== keep.id)
    groups.push({ keep, retire })
  }
  const retargetTo = new Map<string, string>()
  for (const g of groups) {
    for (const r of g.retire) retargetTo.set(r.id, g.keep.id)
  }
  const mappingRetargets: DedupePlan["mappingRetargets"] = []
  for (const m of mappings) {
    const from = String(m.product_id || "").trim()
    const to = from ? retargetTo.get(from) : undefined
    if (from && to && to !== from) mappingRetargets.push({ mappingId: m.id, from, to })
  }
  return {
    groups,
    retireIds: groups.flatMap((g) => g.retire.map((r) => r.id)),
    mappingRetargets,
  }
}
