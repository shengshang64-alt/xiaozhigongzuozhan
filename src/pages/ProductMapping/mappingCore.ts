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
  /** 2026-10-28：中把握候选，界面显示成「建议：xxx（87%）」 */
  suggestion: MatchRow["suggestion"] | null
  /** 2026-10-28 重构：上传原表整行单元格（与项目 sourceColumns 对齐）；非 Excel 来源为空 */
  cells?: string[]
  /** 本地/记忆命中分数（0~1） */
  score?: number
  /** 命中规则（memory/exact/core-exact/abbrev/core-contain/core-sim） */
  rule?: string
  /** 多对多：本行全部命中的公司模块（主干在首位）；未命中为 []。product = products[0] ?? null */
  products?: CheckProduct[]
  /** 2026-10-29：自定义模块名（公司能做但产品清单没有的条目，人工填写），与 products 并存 */
  customNames?: string[]
}

/** 行的完整命中 id 列表（缺省回落单命中口径） */
export function rowProductIds(r: Pick<MatchRow, "product_id" | "product_ids">): string[] {
  if (r.product_ids?.length) return r.product_ids
  return r.product_id ? [r.product_id] : []
}

// ---------------------------------------------------------------------------
// 2026-10-28 重构：行状态口径（界面色块 / 筛选 / 导出共用一个真源）
// 外购、忽略（resolution）优先于匹配方式（kind）；none 且带建议 = 待确认。
// ---------------------------------------------------------------------------
export type MappingRowStatus =
  | "auto" // 本地自动命中（绿）
  | "memory" // 记忆库命中（蓝）
  | "ai" // AI 命中（青）
  | "manual" // 人工指定（紫）
  | "custom" // 自定义模块（公司能做但清单没有，人工填写）
  | "suggest" // 待确认：有候选建议（黄）
  | "none" // 无匹配（红）
  | "external" // 外购（橙）
  | "ignore" // 忽略（灰）

export function rowStatus(
  r: Pick<MappingCompareRow, "kind" | "resolution" | "suggestion" | "product" | "customNames">,
): MappingRowStatus {
  if (r.resolution === "external") return "external"
  if (r.resolution === "ignore") return "ignore"
  // 2026-10-29：自定义模块也算「已命中」——公司确实能做，只是清单里没有
  if (r.customNames && r.customNames.length > 0) return "custom"
  if (r.product) {
    if (r.kind === "mapping") return "memory"
    if (r.kind === "ai") return "ai"
    if (r.kind === "manual") return "manual"
    return "auto"
  }
  return r.suggestion ? "suggest" : "none"
}

export const STATUS_LABEL: Record<MappingRowStatus, string> = {
  auto: "自动",
  memory: "记忆",
  ai: "AI",
  manual: "手动",
  custom: "自定义",
  suggest: "待确认",
  none: "无匹配",
  external: "外购",
  ignore: "忽略",
}

export const RULE_LABEL: Record<string, string> = {
  memory: "记忆库",
  exact: "全名一致",
  "core-exact": "核心词一致",
  abbrev: "缩写命中",
  "core-contain": "核心词包含",
  "core-sim": "核心词相似",
}

// ---------------------------------------------------------------------------
// 2026-10-28 匹配度五档（对齐公司《匹配对照表》交付口径：芜湖眼科样例）：
//   完全匹配 = 可直接进方案报价；基本匹配 = 产品可覆盖但名称/形态不同；
//   部分匹配 = 需多模块组合（一对多）或涉及定制；第三方产品 = 非自研/外购；
//   待确认 = 目录无对应或未经人工确认。
// ---------------------------------------------------------------------------
export type MatchGrade = "full" | "basic" | "partial" | "thirdparty" | "pending"

export const GRADE_LABEL: Record<MatchGrade, string> = {
  full: "完全匹配",
  basic: "基本匹配",
  partial: "部分匹配",
  thirdparty: "第三方产品",
  pending: "待确认",
}

function isThirdpartyProduct(p: CheckProduct): boolean {
  const blob = `${p.product_belong ?? ""}|${p.category ?? ""}|${p.product_name ?? ""}`
  return blob.includes("第三方") || String(p.product_name ?? "").includes("外购")
}

/** 计算行匹配度：resolution 优先 → 命中数 → 第三方归属 → 分数/方式 */
export function matchGrade(
  r: Pick<MappingCompareRow, "resolution" | "kind" | "score" | "product" | "products" | "customNames">,
): MatchGrade {
  if (r.resolution === "external") return "thirdparty"
  const plist = r.products?.length ? r.products : r.product ? [r.product] : []
  const hasCustom = (r.customNames?.length ?? 0) > 0
  // 2026-10-29：纯自定义（公司能做、清单没有）按「部分匹配」计——
  // 不是完全对齐公司标准清单，但也不是待确认（公司确实能交付）。
  if (!plist.length) return hasCustom ? "partial" : "pending"
  if (hasCustom) return "partial"
  if (plist.length > 1) return "partial"
  if (plist.every(isThirdpartyProduct)) return "thirdparty"
  if (r.kind === "manual" || r.kind === "mapping") return "full"
  if ((r.score ?? 0) >= 0.95) return "full"
  return "basic"
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

/** 我司对应产品线：产品类别-产品名称（缺类别仅产品名），去重保序，「 / 」拼接（界面与导出共用） */
export function productLineText(products: CheckProduct[]): string {
  const vals: string[] = []
  for (const p of products) {
    const cat = fieldText(p, "category")
    const name = fieldText(p, "product_name")
    const v = cat && name ? `${cat}-${name}` : name || cat
    if (v && !vals.includes(v)) vals.push(v)
  }
  return vals.join(" / ")
}

/** 我司对应模块/标准名称：模块名（标准名不同则括注），「 + 」拼接（一对多组合口径，界面与导出共用）。
 *  2026-10-29：可选追加自定义模块名（公司能做但清单没有的条目），保证导出的 Excel 也看得到。 */
export function moduleText(products: CheckProduct[], customNames?: string[]): string {
  const vals: string[] = []
  for (const p of products) {
    const mod = fieldText(p, "module_name")
    const std = fieldText(p, "standard_name")
    const v = std && std !== mod ? `${mod}（${std}）` : mod
    if (v && !vals.includes(v)) vals.push(v)
  }
  for (const c of customNames ?? []) {
    const v = String(c ?? "").trim()
    if (v && !vals.includes(v)) vals.push(v)
  }
  return vals.join(" + ")
}

// ---------------------------------------------------------------------------
// 2026-10-29：公司库「同身份重复行」去重
//
// 起因（用户实测反馈）：模块选择器里同一条「胸痛中心」出现两次，勾选口无法区分。
// 根因是两个批次导入的数据叠在一起，字段完整度不同但身份相同：
//   2026-10-08 早期导入：只有 category/product_name/module_name（共 3 个非空字段）
//   2026-10-28 ONE-LINK 完整导入：belong/category/product_name/module_category
//                               /standard_name/recommendation 齐全（7 个）
// 全库 1175 行里这类「完全同 产品名+模块名+标准名」的重复有 37 组、78 行，
// standard_name 为空的历史行另有 626 行 —— 不只某一条，是整个候选池的重影。
//
// 口径：身份 = 模块名 + 标准名 + 产品名（三者都做 trim+小写归一）。
// 同身份保留「信息最完整」的一行：非空业务字段数多者优先，字段数相同取较新 created。
// 不按 id 删数据，只在候选池这一层收敛 —— 既有 check_mappings / checklists
// 引用的仍是原始 id，不会因去重产生悬空引用。
// ---------------------------------------------------------------------------

/** 判断一行信息完整度的字段（业务列，不含 id/时间戳） */
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
  "unit_price",
  "description",
]

/** 一行的非空业务字段数：信息越全越可靠 */
function completenessScore(p: CheckProduct): number {
  let n = 0
  for (const k of COMPLETENESS_FIELDS) {
    const v = p[k]
    if (v === null || v === undefined) continue
    if (typeof v === "string" && v.trim() === "") continue
    if (typeof v === "number" && !v) continue
    n += 1
  }
  return n
}

/** 模块身份键：同键视为同一个可勾选模块（避免重影成两项）。
 *
 *  口径 = 模块名 + 产品名 + 产品类别（module_category），但**任一段为空则不参与比较**：
 *    实测真实库「电子签名 + 院内移动诊疗系统」有 8 行，module_category 分别是
 *    移动医生 / 移动护理 / 门诊移动输液 / 掌上医护 —— 这是 4 个不同产品线下的同名模块，
 *    若把空值与有值分开、或忽略该段，都会把它们误并成 1 个。
 *    而 10-08 早期遗留行的 module_category 是空串，需与 10-28 完整行认成同一身份，
 *    所以空段用「通配」语义：一方为空时按「更具体的那个键」匹配（见 sameIdentity）。
 */
export function productIdentity(p: CheckProduct): string {
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase()
  return [norm(p.module_name), norm(p.product_name), norm(p.module_category)].join("§")
}

/** 身份段拆分（空段记为空串） */
function identityParts(p: CheckProduct): string[] {
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase()
  return [norm(p.module_name), norm(p.product_name), norm(p.module_category)]
}

/**
 * 两行是否同一模块身份：
 *  - 前两段（模块名 / 产品名）必须完全一致；
 *  - 第三段（产品类别）若一方为空则视为匹配（历史遗留行缺该字段），双方都有值时必须相等。
 * 这样 10-08 残缺行能与 10-28 完整行合并，同时不会把 4 个不同产品线上的「电子签名」并成 1 个。
 */
export function sameIdentity(a: CheckProduct, b: CheckProduct): boolean {
  const pa = identityParts(a)
  const pb = identityParts(b)
  if (pa[0] !== pb[0] || pa[1] !== pb[1]) return false
  if (!pa[2] || !pb[2]) return true
  return pa[2] === pb[2]
}

/**
 * 收敛候选池的重复行：同身份只留信息最全的一行。
 * 保序：按首次出现的位置输出（界面/导出顺序稳定，不因去重跳位）。
 * 若同身份内存在 keepIds 里的 id，优先保留它 —— 保证「当前已选中的那条」
 * 不会因为去重而从候选中消失（否则用户已勾的项会变成找不到的幽灵）。
 *
 * 实现说明：因为 sameIdentity 允许「产品类别为空则通配」，等价关系不是严格等价
 * （a≡b、b≡c 不必然 a≡c），不能用 Map 单键分组。这里按「模块名+产品名」粗分组，
 * 组内再做 sameIdentity 的贪心归并——组规模通常 ≤ 8，代价可忽略。
 */
export function dedupeProducts(products: CheckProduct[], keepIds?: Iterable<string>): CheckProduct[] {
  const keep = new Set(keepIds ?? [])
  const coarseKey = (p: CheckProduct) => {
    const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase()
    return `${norm(p.module_name)}§${norm(p.product_name)}`
  }

  // 粗分组（保序）
  const groupOrder: string[] = []
  const groups = new Map<string, CheckProduct[]>()
  for (const p of products) {
    const k = coarseKey(p)
    if (!groups.has(k)) {
      groups.set(k, [])
      groupOrder.push(k)
    }
    groups.get(k)!.push(p)
  }

  const pickBetter = (cur: CheckProduct, cand: CheckProduct): CheckProduct => {
    const curKept = keep.has(cur.id)
    const candKept = keep.has(cand.id)
    if (candKept && !curKept) return cand
    if (curKept && !candKept) return cur
    const candScore = completenessScore(cand)
    const curScore = completenessScore(cur)
    if (candScore > curScore) return cand
    if (candScore < curScore) return cur
    // 完整度相同：类别更具体的优先，其次较新的
    const candCat = String(cand.module_category ?? "").trim()
    const curCat = String(cur.module_category ?? "").trim()
    if (candCat && !curCat) return cand
    if (curCat && !candCat) return cur
    const candTime = String(cand.updated ?? cand.created ?? "")
    const curTime = String(cur.updated ?? cur.created ?? "")
    return candTime > curTime ? cand : cur
  }

  const out: CheckProduct[] = []
  for (const k of groupOrder) {
    const bucket = groups.get(k)!
    // 组内贪心：每遇到一行，找是否已有 sameIdentity 的代表行
    const reps: CheckProduct[] = []
    for (const p of bucket) {
      const idx = reps.findIndex((r) => sameIdentity(r, p))
      if (idx < 0) reps.push(p)
      else reps[idx] = pickBetter(reps[idx], p)
    }
    out.push(...reps)
  }
  return out
}

/**
 * 把「已映射 id」映射到去重后的等价 id：去重若把某个 id 收掉了，
 * 同一个模块身份仍应能正确定位到保留下来的那一行（否则对照表会显示"未匹配"）。
 */
export function remapIdsToDeduped(
  ids: string[],
  original: CheckProduct[],
  deduped: CheckProduct[],
): string[] {
  const byId = new Map(original.map((p) => [p.id, p]))
  const out: string[] = []
  for (const id of ids) {
    const src = byId.get(id)
    if (!src) continue
    const target = deduped.find((d) => sameIdentity(d, src))
    const id2 = target?.id ?? id
    if (!out.includes(id2)) out.push(id2)
  }
  return out
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

/** 组装一一对照初始行：记忆库 → 本地打分（自动落/候选）→ 留空（none）；cellsList 与 norms 按下标对齐 */
export function buildInitialRows(opts: {
  norms: string[]
  products: CheckProduct[]
  mappings: { customer_norm: string; company_product_name: string; product_id: string; custom_name?: string }[]
  makeRowId: () => string
  labelOf: (p: CheckProduct) => string
  /** 2026-10-28 重构：每行对应的上传原表单元格（可选，按下标对齐） */
  cellsList?: (string[] | undefined)[]
  /** 每行对应的客户条目原文（可选；缺省用 norm 充当） */
  raws?: string[]
}): MatchRow[] {
  const { norms, products, mappings, makeRowId, labelOf, cellsList, raws } = opts
  const idToProduct = new Map(products.map((p) => [p.id, p]))
  const labelToProduct = new Map<string, CheckProduct>()
  for (const p of products) {
    const key = norm(labelOf(p))
    if (key && !labelToProduct.has(key)) labelToProduct.set(key, p)
  }
  return norms.map((normCustomer, idx) => {
    const cells = cellsList?.[idx]
    const rawText = raws?.[idx] || normCustomer
    // 记忆库命中：同一外部名可能沉淀了多对（一对多），全部恢复，首条为主干
    const memoryHits = mappings.filter((m) => norm(m.customer_norm) === normCustomer)
    if (memoryHits.length) {
      const resolved: CheckProduct[] = []
      // 2026-10-29：记忆里可能同时有公司库 pair 和自定义名，两者都要恢复
      const customNames: string[] = []
      for (const m of memoryHits) {
        const custom = String(m.custom_name ?? "").trim()
        if (custom) {
          if (!customNames.includes(custom)) customNames.push(custom)
          continue
        }
        const byId = m.product_id ? idToProduct.get(m.product_id) : undefined
        const hit = byId ?? labelToProduct.get(norm(m.company_product_name))
        if (hit && !resolved.some((x) => x.id === hit.id)) resolved.push(hit)
      }
      const primary = resolved[0]
      if (primary || customNames.length) {
        return {
          row_id: makeRowId(),
          raw: rawText,
          norm: normCustomer,
          product_name: primary?.product_name ?? customNames[0] ?? memoryHits[0].company_product_name,
          product_id: primary?.id ?? "",
          ...(resolved.length ? { product_ids: resolved.map((x) => x.id) } : {}),
          ...(customNames.length ? { custom_names: customNames } : {}),
          kind: "mapping" as const,
          resolution: "company" as const,
          score: 1,
          rule: "memory",
          ...(cells ? { cells } : {}),
        }
      }
      // 记忆指向的公司条目已不在库：保留旧口径（展示记忆里的名字，id 空）
      return {
        row_id: makeRowId(),
        raw: rawText,
        norm: normCustomer,
        product_name: memoryHits[0].company_product_name,
        product_id: "",
        kind: "mapping" as const,
        resolution: "company" as const,
        score: 1,
        rule: "memory",
        ...(cells ? { cells } : {}),
      }
    }
    const local = scoreProductMatch(normCustomer, products)
    if (local && local.confidence === "auto") {
      return {
        row_id: makeRowId(),
        raw: rawText,
        norm: normCustomer,
        product_name: local.product.product_name,
        product_id: local.product.id,
        product_ids: [local.product.id],
        kind: "local" as const,
        resolution: "company" as const,
        score: local.score,
        rule: local.rule,
        ...(cells ? { cells } : {}),
      }
    }
    // 2026-10-28：中把握（suggest）**不再自动落**，但也不丢——作为 suggestion 带在行上，
    // 由界面显示成「建议：xxx（87%）」供用户一键采纳。这样既不会把「体检」硬配成「病理」，
    // 也不至于让用户从几百行里手翻。真·无法判定的仍然留空（无 suggestion）。
    return {
      row_id: makeRowId(),
      raw: rawText,
      norm: normCustomer,
      product_name: "",
      product_id: "",
      kind: "none" as const,
      resolution: "company" as const,
      ...(cells ? { cells } : {}),
      ...(local && local.confidence === "suggest"
        ? {
            suggestion: {
              product_id: local.product.id,
              product_name: local.product.product_name,
              label: candidateLabel(local.product),
              score: local.score,
              reason: `${local.rule}：客户核心「${local.customerCore}」↔ 公司核心「${local.companyCore}」（${local.field}）`,
            },
          }
        : {}),
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
      product_ids: [product.id],
      resolution: "company" as const,
    }
  })
}

/** AI 后仍未命中的，用映射库模糊回填（≥0.8；同一外部名的多对记忆全部恢复） */
export function backfillFromMappings(
  rows: MatchRow[],
  mappings: { customer_norm: string; company_product_name: string; product_id: string; custom_name?: string }[],
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
    const hits = mappings.filter((m) => {
      const mn = norm(m.customer_norm)
      if (!mn) return false
      return (
        mn === r.norm ||
        (r.norm.length >= 4 && (r.norm.includes(mn) || mn.includes(r.norm))) ||
        similarity(r.norm, mn) >= 0.8
      )
    })
    if (!hits.length) return r
    // 2026-10-29：记忆里可能同时存公司库 pair 和自定义名，两者都要恢复
    const resolved: CheckProduct[] = []
    const customNames: string[] = []
    for (const h of hits) {
      const custom = String(h.custom_name ?? "").trim()
      if (custom) {
        if (!customNames.includes(custom)) customNames.push(custom)
        continue
      }
      const p = idToProduct.get(h.product_id) ?? labelToProduct.get(norm(h.company_product_name))
      if (p && !resolved.some((x) => x.id === p.id)) resolved.push(p)
    }
    const primary = resolved[0]
    // 只命中自定义名：状态算「自定义」，不算公司库命中
    if (!resolved.length && !customNames.length) return r
    return {
      ...r,
      kind: "mapping" as const,
      product_name: primary?.product_name ?? customNames[0] ?? hits[0].company_product_name,
      product_id: primary?.id ?? "",
      ...(resolved.length ? { product_ids: resolved.map((x) => x.id) } : {}),
      ...(customNames.length ? { custom_names: customNames } : {}),
      resolution: "company" as const,
      rule: "memory",
      score: 0.8,
    }
  })
}

/** MatchRow[] → 一一对照视图/导出行（透传原表单元格 cells、命中分数/规则、多对命中 products） */
export function toCompareRows(
  rows: MatchRow[],
  products: CheckProduct[],
  notes: Record<string, string> = {},
  /** 可选：去重前的原始候选池。传入后，映射 id 若在去重中被收掉，
   *  按其模块身份回退到去重后的同身份行（避免历史映射显示成「未匹配」）。 */
  originalPool?: CheckProduct[],
): MappingCompareRow[] {
  const idToProduct = new Map(products.map((p) => [p.id, p]))
  const originalById = new Map((originalPool ?? []).map((p) => [p.id, p]))
  const resolve = (id: string): CheckProduct | undefined => {
    const direct = idToProduct.get(id)
    if (direct) return direct
    const src = originalById.get(id)
    if (!src) return undefined
    return products.find((p) => sameIdentity(p, src))
  }
  return rows.map((r) => {
    const resolved = rowProductIds(r)
      .map((id) => resolve(id))
      .filter((p): p is CheckProduct => Boolean(p))
    return {
      row_id: r.row_id,
      customer: r.norm,
      raw: r.raw,
      kind: r.kind,
      resolution: r.resolution,
      product: resolved[0] ?? null,
      products: resolved,
      ...(r.custom_names && r.custom_names.length ? { customNames: r.custom_names } : {}),
      note: notes[r.row_id] ?? "",
      // 已落定（有 product_id）的行不再显示建议，避免用户以为还有个待选项
      suggestion: r.product_id ? null : (r.suggestion ?? null),
      ...(r.cells ? { cells: r.cells } : {}),
      ...(r.score !== undefined ? { score: r.score } : {}),
      ...(r.rule ? { rule: r.rule } : {}),
    }
  })
}

/**
 * 已确认映射（公司命中）→ 映射库沉淀候选（一对多：每个命中模块一对）。
 * products 传入时按 id 取展示标签；未传时主干回落 row.product_name（旧口径兼容）。
 */
export function manualMappingWrites(
  rows: MatchRow[],
  products?: CheckProduct[],
): { norm: string; productName: string; productId: string }[] {
  const out: { norm: string; productName: string; productId: string }[] = []
  for (const r of rows) {
    if (r.kind === "manual" && r.resolution === "company") {
      for (const pid of rowProductIds(r)) {
        const p = products?.find((x) => x.id === pid)
        const productName = p ? candidateLabel(p) : pid === r.product_id ? r.product_name : ""
        if (!productName) continue
        out.push({ norm: r.norm, productName, productId: pid })
      }
    }
  }
  return out
}
