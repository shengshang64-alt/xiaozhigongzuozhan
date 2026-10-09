import type { CheckProduct, MatchRow } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// 产品映射：纯逻辑核心（无 React / 无网络），供 useProductMapping 与单测共用
// 匹配粒度 = 公司库「模块行」（ONE-LINK 每行一个模块），非产品族名
// ---------------------------------------------------------------------------

/** 一一对照视图/导出用行：客户条目 + 命中的公司模块行（未命中为 null） */
export type MappingCompareRow = {
  row_id: string
  /** 客户条目归一化名 */
  customer: string
  /** 客户条目原文 */
  raw: string
  kind: MatchRow["kind"]
  resolution: MatchRow["resolution"]
  /** 命中的公司库行，未命中为 null */
  product: CheckProduct | null
  /** 备注：一对多其余项 / 命名错位说明 / 留空原因（AI 或人工填写） */
  note: string
}

/** 取公司行展示字段（容错空串） */
export function fieldText(p: CheckProduct | null | undefined, key: keyof CheckProduct): string {
  if (!p) return ""
  const v = p[key]
  if (v === null || v === undefined) return ""
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "是" : ""
  if (typeof v === "string") return v
  return ""
}

/** AI/下拉候选标签：模块名优先，缺则标准名，再缺则产品名 */
export function candidateLabel(p: CheckProduct): string {
  return (
    String(p.module_name ?? "").trim() ||
    String(p.standard_name ?? "").trim() ||
    String(p.product_name ?? "").trim()
  )
}

function norm(s: string): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase()
}

/** 编辑距离相似度阈值（与建设清单口径一致） */
export const SIM_THRESHOLD = 0.6

/** 本地模糊匹配：命中客户条目最接近的公司模块行 */
export function matchLocalProduct(
  normCustomer: string,
  products: CheckProduct[],
  threshold = SIM_THRESHOLD,
): CheckProduct | null {
  if (!normCustomer) return null
  let best: CheckProduct | null = null
  let bestScore = 0
  for (const p of products) {
    const candidates = [p.module_name, p.standard_name, p.product_name]
    for (const c of candidates) {
      const cn = norm(String(c ?? ""))
      if (!cn) continue
      if (cn === normCustomer) return p
      const containment =
        normCustomer.length >= 3 && (normCustomer.includes(cn) || cn.includes(normCustomer))
      if (containment) {
        const score = 0.9
        if (score > bestScore) {
          bestScore = score
          best = p
        }
        continue
      }
      const score = similarity(normCustomer, cn)
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
  }
  return bestScore >= threshold ? best : null
}

/** 编辑距离相似度（0-1），本地实现避免依赖工程外函数行为差异 */
export function similarity(a: string, b: string): number {
  const s = (a ?? "").toLowerCase()
  const t = (b ?? "").toLowerCase()
  if (!s.length || !t.length) return 0
  if (s === t) return 1
  const m = s.length
  const n = t.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

/** 组装一一对照初始行：精确映射 → 本地模糊 → 留空（none） */
export function buildInitialRows(opts: {
  norms: string[]
  products: CheckProduct[]
  mappings: { customer_norm: string; company_product_name: string; product_id: string }[]
  makeRowId: () => string
  labelOf: (p: CheckProduct) => string
}): MatchRow[] {
  const { norms, products, mappings, makeRowId, labelOf } = opts
  const idToProduct = new Map(products.map((p) => [p.id, p]))
  const labelToProduct = new Map<string, CheckProduct>()
  for (const p of products) {
    const key = norm(labelOf(p))
    if (key && !labelToProduct.has(key)) labelToProduct.set(key, p)
  }
  return norms.map((normCustomer) => {
    const exact = mappings.find((m) => norm(m.customer_norm) === normCustomer)
    if (exact) {
      const byId = exact.product_id ? idToProduct.get(exact.product_id) : undefined
      const byLabel = byId ?? labelToProduct.get(norm(exact.company_product_name))
      if (byId || byLabel) {
        const hit = byId ?? byLabel!
        return {
          row_id: makeRowId(),
          raw: normCustomer,
          norm: normCustomer,
          product_name: hit.product_name,
          product_id: hit.id,
          kind: "mapping" as const,
          resolution: "company" as const,
        }
      }
      return {
        row_id: makeRowId(),
        raw: normCustomer,
        norm: normCustomer,
        product_name: exact.company_product_name,
        product_id: "",
        kind: "mapping" as const,
        resolution: "company" as const,
      }
    }
    const local = matchLocalProduct(normCustomer, products)
    if (local) {
      return {
        row_id: makeRowId(),
        raw: normCustomer,
        norm: normCustomer,
        product_name: local.product_name,
        product_id: local.id,
        kind: "local" as const,
        resolution: "company" as const,
      }
    }
    return {
      row_id: makeRowId(),
      raw: normCustomer,
      norm: normCustomer,
      product_name: "",
      product_id: "",
      kind: "none" as const,
      resolution: "company" as const,
    }
  })
}

/**
 * 解析 AI 返回的 [{customer, product, note}]：容忍代码围栏与前后杂字；
 * product 为 null / 空 / "null" 视为未命中；note 缺省空串。
 * 独立于 checklistTypes.parseMatchJson，因其需要额外的 note 字段。
 */
export function parseMappingJson(text: string): { customer: string; product: string | null; note: string }[] {
  const s = String(text ?? "").trim()
  if (!s) return []
  const start = s.indexOf("[")
  const end = s.lastIndexOf("]")
  const body = start >= 0 && end > start ? s.slice(start, end + 1) : s
  let arr: unknown
  try {
    arr = JSON.parse(body)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: { customer: string; product: string | null; note: string }[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const customer = String(o.customer ?? o.name ?? "").trim()
    if (!customer) continue
    const p = o.product
    const product = p === null || p === undefined || String(p).trim() === "" || String(p).trim().toLowerCase() === "null" ? null : String(p).trim()
    const note = String(o.note ?? o.remark ?? "").trim()
    out.push({ customer, product, note })
  }
  return out
}

/** 从 AI pairs 收集按 row_id 索引的备注（仅 AI 命中行且带 note） */
export function collectRowNotes(
  rows: MatchRow[],
  pairs: { customer: string; product: string | null; note?: string }[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.kind !== "ai") continue
    const pair = pairs.find((x) => norm(x.customer) === r.norm)
    if (pair?.note) out[r.row_id] = pair.note
  }
  return out
}

/** 应用 AI 返回的 [{customer, product, note}] 到未命中行（product 命中候选标签才落） */
export function applyAiPairs(
  rows: MatchRow[],
  pairs: { customer: string; product: string | null; note?: string }[],
  products: CheckProduct[],
  labelOf: (p: CheckProduct) => string,
): MatchRow[] {
  const labelToProduct = new Map<string, CheckProduct>()
  for (const p of products) {
    const key = norm(labelOf(p))
    if (key && !labelToProduct.has(key)) labelToProduct.set(key, p)
  }
  return rows.map((r) => {
    if (r.kind !== "none") return r
    const pair = pairs.find((x) => norm(x.customer) === r.norm)
    if (!pair?.product) return r
    const product = labelToProduct.get(norm(pair.product))
    if (!product) return r
    return {
      ...r,
      kind: "ai" as const,
      product_name: product.product_name,
      product_id: product.id,
      resolution: "company" as const,
    }
  })
}

/** AI 后仍未命中的，用映射库模糊回填（≥0.8） */
export function backfillFromMappings(
  rows: MatchRow[],
  mappings: { customer_norm: string; company_product_name: string; product_id: string }[],
  products: CheckProduct[],
): MatchRow[] {
  const idToProduct = new Map(products.map((p) => [p.id, p]))
  const labelToProduct = new Map<string, CheckProduct>()
  for (const p of products) {
    const k = norm(p.module_name || p.standard_name || p.product_name)
    if (k && !labelToProduct.has(k)) labelToProduct.set(k, p)
  }
  return rows.map((r) => {
    if (r.kind !== "none") return r
    const hit = mappings.find((m) => {
      const mn = norm(m.customer_norm)
      if (!mn) return false
      return (
        mn === r.norm ||
        (r.norm.length >= 4 && (r.norm.includes(mn) || mn.includes(r.norm))) ||
        similarity(r.norm, mn) >= 0.8
      )
    })
    if (!hit) return r
    const product = idToProduct.get(hit.product_id) ?? labelToProduct.get(norm(hit.company_product_name))
    return {
      ...r,
      kind: "mapping" as const,
      product_name: product?.product_name ?? hit.company_product_name,
      product_id: product?.id ?? "",
      resolution: "company" as const,
    }
  })
}

/** MatchRow[] → 一一对照视图/导出行 */
export function toCompareRows(
  rows: MatchRow[],
  products: CheckProduct[],
  notes: Record<string, string> = {},
): MappingCompareRow[] {
  const idToProduct = new Map(products.map((p) => [p.id, p]))
  return rows.map((r) => ({
    row_id: r.row_id,
    customer: r.norm,
    raw: r.raw,
    kind: r.kind,
    resolution: r.resolution,
    product: r.product_id ? (idToProduct.get(r.product_id) ?? null) : null,
    note: notes[r.row_id] ?? "",
  }))
}

/** 已确认映射（公司命中）→ 映射库沉淀候选 */
export function manualMappingWrites(
  rows: MatchRow[],
): { norm: string; productName: string; productId: string }[] {
  const out: { norm: string; productName: string; productId: string }[] = []
  for (const r of rows) {
    if (r.kind === "manual" && r.product_id && r.resolution === "company") {
      out.push({ norm: r.norm, productName: r.product_name, productId: r.product_id })
    }
  }
  return out
}
