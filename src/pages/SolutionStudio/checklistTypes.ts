import { centsToYuan, formatMoney, productCents } from "@/lib/money"
import type { ChecklistSnapshot } from "./solutionTypes"

// ---------------------------------------------------------------------------
// 建设清单：领域类型、评级常量与纯函数（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type RatingGroupKey = "emr" | "hpc" | "ss" | "sm"

export const RATING_GROUPS: {
  key: RatingGroupKey
  label: string
  short: string
  levels: { value: string; label: string }[]
}[] = [
  {
    key: "emr",
    label: "电子病历应用水平分级评价",
    short: "电子病历",
    levels: ["4", "5", "6", "7"].map((v) => ({ value: v, label: `${v} 级` })),
  },
  {
    key: "hpc",
    label: "互联互通标准化成熟度测评",
    short: "互联互通",
    levels: [
      { value: "4B", label: "四级乙等" },
      { value: "4A", label: "四级甲等" },
      { value: "5B", label: "五级乙等" },
      { value: "5A", label: "五级甲等" },
    ],
  },
  {
    key: "ss",
    label: "智慧服务分级评估",
    short: "智慧服务",
    levels: ["1", "2", "3", "4"].map((v) => ({ value: v, label: `${v} 级` })),
  },
  {
    key: "sm",
    label: "智慧管理分级评估",
    short: "智慧管理",
    levels: ["1", "2", "3"].map((v) => ({ value: v, label: `${v} 级` })),
  },
]

/** 评级关联标签：每个评级体系下关联的档位列表（"*" 表示全部档位） */
export type RatingTags = Partial<Record<RatingGroupKey, string[]>>

/** 产品技术参数（轮次 E-3）：参数名 + 参数值 + 竞品对比备注（选填） */
export type TechParam = {
  param_name: string
  param_value: string
  competitor_note?: string
}

/** ONE-LINK 计费档位：一个档位一条（A-E 类 + 门诊量/床位口径 + 该档价格，未落价为 0） */
export type OneLinkPriceTier = {
  /** 档位名，如 A类 */
  tier: string
  /** 表头口径，如 门诊量≥13000 */
  outpatient?: string
  /** 表头口径，如 床位≥2000 */
  bed?: string
  /** 该档价格（元） */
  price?: number
}

export type CheckProduct = {
  id: string
  is_builtin: boolean
  in_company: boolean
  category: string
  product_line: string
  product_name: string
  module_name: string
  module_func: string
  description: string
  charge_mode: string
  unit_price: number
  status: string
  rating_tags: RatingTags
  /** 轮次 E-3：技术参数库，存量记录为 null/缺失，读取一律容错为 [] */
  tech_params?: TechParam[] | null
  /** 产品映射：ONE-LINK《按公司规范》标准列，存量记录为 null/缺失，读取一律容错为 "" / [] */
  product_belong?: string | null
  module_category?: string | null
  standard_name?: string | null
  module_attr?: string | null
  coefficient?: string | null
  recommendation?: string | null
  price_tier?: OneLinkPriceTier[] | null
  created?: string
  updated?: string
}

export type ProductDraft = Omit<CheckProduct, "id" | "created" | "updated">

export type ChecklistLine = {
  line_id: string
  category: string
  product_line: string
  product_name: string
  module_name: string
  module_func: string
  unit: string
  qty: number
  unit_price: number
  source: "company" | "external"
  rating_hits: string[]
  remark: string
  product_id: string
  checked: boolean
}

export type ChecklistRecord = {
  id: string
  rh_user_id: string
  checklist_name: string
  hospital: string
  rating_targets: string[]
  // 既有值 rating / customer_match；dept_check = 标书工作台的「部门检查清单」项目级副本
  // （同一张 checklists 表、另一套 items/rating_targets 结构，本域列表会显式过滤掉，见 checklistLogic.loadMyChecklists）
  source_mode: "rating" | "customer_match" | "dept_check"
  customer_raw: string
  items: ChecklistLine[]
  total_amount: number
  status: string
  created: string
  updated: string
}

export type CheckMapping = {
  id: string
  customer_norm: string
  company_product_name: string
  product_id: string
  hit_count: number
}

/** 路径 B 匹配表行 */
export type MatchRow = {
  row_id: string
  raw: string
  norm: string
  product_name: string
  product_id: string
  kind: "mapping" | "local" | "ai" | "manual" | "none"
  resolution: "company" | "external" | "ignore"
  /**
   * 2026-10-28（DS-R08）：中把握候选（0.75~0.95），**不自动落**，供界面显示成
   * 「建议：xxx（87%）」让用户一键采纳。只在 kind==="none" 时可能有值。
   * 理由：产品对照实测发现本地匹配要么高把握（自动填）、要么完全不确定（留空），
   * 中间的「看着像但不肯定」如果丢掉，用户只能从几百条里手翻。
   */
  suggestion?: {
    product_id: string
    product_name: string
    /** 展示标签（模块名 > 标准名 > 产品名），与下拉候选一致 */
    label: string
    /** 0~1，界面按百分比显示 */
    score: number
    /** 为什么建议它（命中字段 + 语义核心词），界面上作为 tooltip */
    reason: string
  }
}

export const PRODUCT_STATUS_OPTIONS = ["在售", "研发中"]

export const MATCH_KIND_LABEL: Record<MatchRow["kind"], string> = {
  mapping: "历史映射",
  local: "本地匹配",
  ai: "AI 匹配",
  manual: "人工指定",
  none: "未命中",
}

export function makeLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** "emr:5" → 「电子病历 5 级」 */
export function targetLabel(code: string): string {
  const [groupKey, level] = code.split(":")
  const group = RATING_GROUPS.find((g) => g.key === groupKey)
  if (!group) return code
  const lv = group.levels.find((l) => l.value === level)
  return `${group.short} ${lv?.label ?? level}`
}

export function targetsLabel(codes: string[]): string {
  return (codes ?? []).map(targetLabel).join("、") || "未指定评级目标"
}

/** 产品评级标签是否命中任一目标，返回命中的目标码列表 */
export function tagsHitTargets(tags: RatingTags | undefined, targets: string[]): string[] {
  const hits: string[] = []
  for (const code of targets ?? []) {
    const [groupKey, level] = code.split(":") as [RatingGroupKey | undefined, string | undefined]
    if (!groupKey || !level) continue
    const list = tags?.[groupKey]
    if (!list?.length) continue
    if (list.includes("*") || list.includes(level)) hits.push(code)
  }
  return hits
}

/** 客户清单条目归一化：去序号、去括号规格后缀、去版本后缀、压缩空白 */
export function normalizeCustomerLine(raw: string): string {
  let t = (raw ?? "").trim()
  t = t.replace(
    /^\s*(?:[\d０-９]{1,3}\s*[.、)．〕：:]|[(（]\s*[\d０-９]{1,3}\s*[)〕]|[①-⑿-ⅷ]|[-—*•·])\s*/,
    "",
  )
  t = t.replace(/[（(][^（）()]*[)）]/g, "")
  t = t.replace(/\s+/g, "")
  t = t.replace(/(V?\d+(?:\.\d+)+|[Vv]\d+|版(?:本)?\d*|规格[:：]?[一-龥A-Za-z0-9-]*)$/i, "")
  return t.trim()
}

/** 编辑距离相似度（0-1），用于客户条目与公司产品名的本地模糊匹配 */
export function lineSimilarity(a: string, b: string): number {
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

// ---------------------------------------------------------------------------
// B9 建设清单金额精确到分（checklist-cent）
//
// 旧写法 `qty * unit_price` 直接走二进制浮点：单价带 3 位以上小数时（Excel 导入、
// AI 生成清单、手工输入都会出现），真值在半分处会被浮点存成 …49999…，Math 显示层
// 四舍五入后比手算少 1 分；更麻烦的是 Excel 导出里「逐行小计」「分类小计」「合计」
// 三条算路各自独立累加，会互相打架（逐行加起来 ≠ 合计），属被质疑/废标级风险。
// 口径统一到报价域 R034 的 money.ts：逐行精确到整数分，再以整数分累加，最后一次性转元。
// ---------------------------------------------------------------------------

/** 单行小计（元）：qty × unit_price，精确到分，与报价域同一口径 */
export function lineSubtotalYuan(l: ChecklistLine): number {
  return centsToYuan(productCents([Number(l.qty) || 0, Number(l.unit_price) || 0]))
}

/** 任意一组行的小计（元）：逐行精确到分后以整数分累加，避免二次浮点漂移 */
export function sumLinesYuan(lines: ChecklistLine[]): number {
  return centsToYuan(
    (lines ?? []).reduce(
      (cents, l) => cents + productCents([Number(l.qty) || 0, Number(l.unit_price) || 0]),
      0,
    ),
  )
}

/** 勾选行合计（元）：剔除未勾选行后按 sumLinesYuan 口径累加 */
export function calcTotal(lines: ChecklistLine[]): number {
  return sumLinesYuan((lines ?? []).filter((l) => l.checked !== false))
}

// Single money convention lives in @/lib/money (R113); the "¥ " prefix and
// the old name stay here so call sites are untouched. Note the intentional
// display shift: integers now render with .00 (previously dropped).
export const fmtMoney = (n: number): string => `¥ ${formatMoney(Number(n) || 0)}`

export function emptyProductDraft(): ProductDraft {
  return {
    is_builtin: false,
    in_company: true,
    category: "",
    product_line: "",
    product_name: "",
    module_name: "",
    module_func: "",
    description: "",
    charge_mode: "模块授权",
    unit_price: 0,
    status: "在售",
    rating_tags: {},
  }
}

export function productToLine(p: CheckProduct, source: "company" | "external", ratingHits: string[]): ChecklistLine {
  return {
    line_id: makeLineId(),
    category: p.category || "未分类",
    product_line: p.product_line,
    product_name: p.product_name,
    module_name: p.module_name,
    module_func: p.module_func,
    unit: "套",
    qty: 1,
    unit_price: Number(p.unit_price) || 0,
    source,
    rating_hits: ratingHits,
    remark: source === "external" ? "公司暂无该产品，评级要求外购" : "",
    product_id: p.id ?? "",
    checked: true,
  }
}

export function snapshotFromChecklist(rec: ChecklistRecord): ChecklistSnapshot {
  const kept = (rec.items ?? []).filter((l) => l.checked !== false)
  const companySystems = Array.from(new Set(kept.filter((l) => l.source === "company").map((l) => l.product_name)))
  const externalSystems = Array.from(new Set(kept.filter((l) => l.source === "external").map((l) => l.product_name)))
  // R150：未经产品匹配的条目（无 product_name）按客户需求原文进快照，否则真实招标来源的清单在方案链路里整段丢失
  const customerRequirements = kept
    .filter((l) => !String(l.product_name ?? "").trim())
    .map((l) => {
      const name = String(l.module_name ?? "").trim()
      const func = String(l.module_func ?? "").trim()
      if (name && func && func !== name) return `${name}（${func}）`
      return name || func
    })
    .filter(Boolean)
  return {
    checklist_id: rec.id,
    checklist_name: rec.checklist_name,
    rating_targets: rec.rating_targets ?? [],
    company_systems: companySystems,
    external_systems: externalSystems,
    customer_requirements: customerRequirements,
  }
}

/** 从清单行集合提取「建设系统」名称列表（去重 + 保留首次插入顺序）
 * 仅已勾选行参与，不区分 company/external；给方案向导的 systems 预填使用。*/
export function systemsFromChecklist(items: ChecklistLine[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const l of items ?? []) {
    if (l.checked === false) continue
    const name = (l.product_name ?? "").trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 容错解析 AI 匹配结果 JSON：[{customer, product}] */
export function parseMatchJson(text: string): { customer: string; product: string | null }[] {
  let t = (text ?? "").trim()
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const arrStart = t.indexOf("[")
  const objStart = t.indexOf("{")
  let candidate = ""
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
    candidate = t.slice(arrStart, t.lastIndexOf("]") + 1)
  } else if (objStart >= 0) {
    candidate = t.slice(objStart, t.lastIndexOf("}") + 1)
  }
  if (!candidate) return []
  try {
    const parsed = JSON.parse(candidate) as unknown
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>).matches)
        ? ((parsed as Record<string, unknown>).matches as unknown[])
        : []
    const out: { customer: string; product: string | null }[] = []
    for (const item of arr) {
      if (!item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      const customer = String(rec.customer ?? rec.customer_norm ?? rec.name ?? "").trim()
      const productRaw = rec.product ?? rec.product_name ?? rec.match ?? null
      const product = productRaw && String(productRaw).trim() && String(productRaw).trim() !== "null" ? String(productRaw).trim() : null
      if (customer) out.push({ customer, product })
    }
    return out
  } catch {
    return []
  }
}
