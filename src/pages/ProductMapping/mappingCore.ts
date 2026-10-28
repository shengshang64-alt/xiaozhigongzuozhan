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

// ---------------------------------------------------------------------------
// 2026-10-28（产品对照改造，用户要求「不确定的留空」）：
// 原实现只用编辑距离（SIM_THRESHOLD=0.6）+ 包含即 0.9，对中文**语义无效**。
// 实测证据（真实 ONE-LINK 公司库 549 行 vs 真实招标措辞）：
//   「体检信息管理系统」→ 病理管理系统  0.75  ← 共享「信息管理系统」6 字，语义毫无关系
//   「移动护理信息系统」→ 超声管理系统  0.625 ← 同上
//   「医保结算清单管理系统」→ 医保对账管理系统 0.60
// 而正确答案「电子病历系统（EMR）」→ 电子病历系统对接 只有 0.545，反被判未命中。
// 结论：中文短名之间编辑距离区分不了语义，必须先把「通用后缀」剥掉，比语义核心词。
// ---------------------------------------------------------------------------

/**
 * 通用后缀表（长的优先剥），剥离后剩下的就是语义核心词。
 * 例：「移动护理信息系统」→「移动护理」、「体检信息管理系统」→「体检」。
 * 这些词在几乎任何医院清单里都出现，不携带区分度，留着只会制造假高分。
 */
const GENERIC_SUFFIXES = [
  "信息管理系统",
  "信息管理平台",
  "管理信息系统",
  "信息服务系统",
  "信息平台",
  "管理系统",
  "信息系统",
  "管理平台",
  "服务平台",
  "支持服务",
  "管理软件",
  "子系统",
  "系统",
  "平台",
  "模块",
  "软件",
  "应用",
]

/** 剥离括号注释（如「电子病历系统（EMR）」里的 EMR）与空白，再逐层剥通用后缀 */
export function semanticCore(raw: string): string {
  let t = norm(raw)
  if (!t) return ""
  // 括号里的英文缩写先摘掉，避免 EMR/CIS 这类干扰中文核心词判断
  t = t.replace(/[（(][^）)]*[）)]/g, "")
  let changed = true
  while (changed) {
    changed = false
    for (const suf of GENERIC_SUFFIXES) {
      if (t.length > suf.length && t.endsWith(suf)) {
        t = t.slice(0, -suf.length)
        changed = true
        break
      }
    }
  }
  return t
}

/** 括号内英文缩写（EMR/LIS/PACS/DRG…），用于匹配公司库里带同样缩写的条目 */
function extractAbbrev(raw: string): string {
  const m = String(raw ?? "").match(/[（(]\s*([A-Za-z][A-Za-z0-9-]{1,10})\s*[）)]/)
  if (m) return m[1].toLowerCase()
  // 尾部裸缩写：「检验信息系统LIS」
  const t = String(raw ?? "").match(/([A-Za-z]{2,8})\s*$/)
  return t ? t[1].toLowerCase() : ""
}

/**
 * 匹配把握度分档（取代单一 0.6 阈值）：
 *  - auto：高把握，直接填。只在「全名精确」或「语义核心词完全相等」时给
 *  - suggest：中把握，作为候选让用户点选，不自动落
 *  - none：无法判定，留空由用户自己配
 */
export type MatchConfidence = "auto" | "suggest" | "none"

export type ScoredMatch = {
  product: CheckProduct
  /** 命中的公司字段与原文，便于界面解释「为什么配到这条」 */
  field: "module_name" | "standard_name" | "product_name"
  fieldValue: string
  /** 语义核心词对照（排障与展示用） */
  customerCore: string
  companyCore: string
  score: number
  confidence: MatchConfidence
  rule: "exact" | "core-exact" | "abbrev" | "core-contain" | "core-sim"
}

/** 自动填充门槛：只有 ≥0.95（即 exact / core-exact）才自动落 */
export const AUTO_FILL_MIN = 0.95
/** 候选门槛：0.75 起给候选，低于此留空 */
export const SUGGEST_MIN = 0.75

/**
 * 旧口径阈值常量。保留导出只为不破坏既有 import；
 * 新逻辑的分档用 AUTO_FILL_MIN / SUGGEST_MIN，请勿在新代码里用它做判定。
 */
export const SIM_THRESHOLD = 0.6

/**
 * 给单个客户条目在公司库里打分，返回最高把握的候选（含把握度分档）。
 * 相比旧的 matchLocalProduct：编辑距离只在核心词层面用，且差异过大直接不算。
 */
export function scoreProductMatch(normCustomer: string, products: CheckProduct[]): ScoredMatch | null {
  if (!normCustomer) return null
  const custCore = semanticCore(normCustomer)
  const custAbbrev = extractAbbrev(normCustomer)
  let best: ScoredMatch | null = null

  for (const p of products) {
    // 2026-10-28：**不拿 product_name 当匹配字段**。它是产品线聚合名（如「急诊移动护理」），
    // 一条产品线底下挂着很多模块（病人管理/输液管理/文书管理…）。用产品线名去匹配客户条目，
    // 一旦命中，展示出来的却是「该产品线的某个模块」，等于张冠李戴——
    // 实测「移动护理信息系统」就是这样被配成「病人管理」的。
    // 产品线名只在没有模块名/标准名时才兜底使用。
    const cands: [ScoredMatch["field"], string][] = [
      ["module_name", String(p.module_name ?? "")],
      ["standard_name", String(p.standard_name ?? "")],
    ]
    if (!norm(String(p.module_name ?? "")) && !norm(String(p.standard_name ?? ""))) {
      cands.push(["product_name", String(p.product_name ?? "")])
    }
    for (const [field, rawVal] of cands) {
      const cn = norm(rawVal)
      if (!cn) continue
      const candCore = semanticCore(rawVal)
      const push = (score: number, rule: ScoredMatch["rule"]) => {
        const confidence: MatchConfidence =
          score >= AUTO_FILL_MIN ? "auto" : score >= SUGGEST_MIN ? "suggest" : "none"
        if (confidence === "none") return
        if (!best || score > best.score) {
          best = {
            product: p,
            field,
            fieldValue: rawVal,
            customerCore: custCore,
            companyCore: candCore,
            score,
            confidence,
            rule,
          }
        }
      }
      // ① 全名完全一致 → 最高把握
      if (cn === normCustomer) {
        push(1, "exact")
        continue
      }
      // ② 英文缩写命中（LIS/PACS/DRG 这类，公司库里也是缩写形态）
      if (custAbbrev && custAbbrev.length >= 2 && cn.includes(custAbbrev)) {
        push(0.96, "abbrev")
        continue
      }
      // ③ 语义核心词完全相等 → 高把握（「体检」=「体检」）
      if (custCore && candCore && custCore === candCore) {
        push(0.97, "core-exact")
        continue
      }
      // ④ 核心词互相包含 → 按方向定档。
      //    2026-10-28 实测校准（真实公司库 + 真实招标措辞）：
      //      · 客户「挂号收费」⊂ 公司「门急诊挂号收费」→ 同一模块在不同清单里的粒度差，属高把握；
      //      · 客户「移动护理」⊂ 公司「急诊移动护理」→ 同上，高把握；
      //      · 客户「移动护理」⊃ 公司「病人管理」→ 客户名更泛，公司名更窄，语义不确定，只给候选。
      //    旧的「包含即 0.9」不分方向，正是把「体检→病理」这类错配放进来的原因之一。
      if (
        custCore.length >= 2 &&
        candCore.length >= 2 &&
        (custCore.includes(candCore) || candCore.includes(custCore))
      ) {
        const ratio = Math.min(custCore.length, candCore.length) / Math.max(custCore.length, candCore.length)
        if (candCore.includes(custCore)) {
          // 客户核心词完整落在公司核心词里：公司在同一模块上加了限定词（门急诊/急诊…）
          // 但比值过低说明只是恰好共享一小段（如「病人管理」⊂「移动护理病人管理」），不能当高把握。
          const tight = ratio >= 0.5
          push(tight ? 0.95 + 0.04 * ratio : 0.82, "core-contain")
        } else {
          // 反过来：客户名更宽泛，只作候选，不自动落
          push(0.8 + 0.15 * ratio, "core-contain")
        }
        continue
      }
      // ⑤ 核心词编辑距离：仅当两者长度接近（差 ≤2）且相似度 ≥0.75 才算低分候选。
      //    这一层比旧实现严格得多——旧实现直接拿全名算，中文短名靠共享后缀就能过 0.6。
      if (custCore.length >= 2 && candCore.length >= 2 && Math.abs(custCore.length - candCore.length) <= 2) {
        const cs = similarity(custCore, candCore)
        if (cs >= 0.75) push(cs * 0.9, "core-sim")
      }
    }
  }
  return best
}

/** 精确/包含命中模块名（保留旧签名供既有调用方与单测使用，内部改走新打分） */
export function matchLocalProduct(
  normCustomer: string,
  products: CheckProduct[],
  threshold = SIM_THRESHOLD,
): CheckProduct | null {
  const hit = scoreProductMatch(normCustomer, products)
  if (!hit) return null
  return hit.score >= threshold ? hit.product : null
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
    const local = scoreProductMatch(normCustomer, products)
    if (local && local.confidence === "auto") {
      return {
        row_id: makeRowId(),
        raw: normCustomer,
        norm: normCustomer,
        product_name: local.product.product_name,
        product_id: local.product.id,
        kind: "local" as const,
        resolution: "company" as const,
      }
    }
    // 2026-10-28：中把握（suggest）**不再自动落**，但也不丢——带着候选进 AI 阶段，
    // 由界面作为「建议」给用户点选。这样既不会把「体检」硬配成「病理」，
    // 也不至于让用户从 549 行里手翻。真·无法判定的仍然留空。
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
