import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import { RATING_GROUPS, type RatingGroupKey } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// 评级筛选（2026-10-29）
//
// 需求（用户原话）：
//   「公司的清单导出要求按照我这个格式导出，因为很多清单是没有体现具体的内容，
//     要求一，如果有评级需求，就按照评级的内容先进行筛选，然后再把客户提到的要求，
//     增加进去，明确好，三方、公司、自定义产品。」
//   「涉及到评级的必选项，一定要体现，没有可不选」
//
// 口径：
//   1) 评级档位（如电子病历 5 级、互联互通 4A）由用户选，对应产品行上的 rating_tags
//      （该产品支持哪些评级档位）命中才算「该评级要求这个模块」；
//   2) 该评级下「建议=必选」的模块强制带出（不可丢），「建议=可选/空]的可另行过滤；
//   3) 再把客户清单里实际点到、但评级清单没覆盖的条目追加进来（来源标"客户清单"）；
//   4) 每行标注归属类型：公司 / 三方 / 自定义。
// ---------------------------------------------------------------------------

/** 单行在「评级筛选结果」里的来源 */
export type CoverageSource = "rating-required" | "rating-optional" | "customer"

/** 归属类型：公司自研 / 三方产品 / 自定义（公司能做但清单无对应模块） */
export type DeliveryKind = "公司" | "三方" | "自定义"

export type RatingSelection = Partial<Record<RatingGroupKey, string[]>>

export type RatingCoverageRow = {
  productBelong: string
  category: string
  productName: string
  moduleCategory: string
  moduleName: string
  /** 评级标签的可读文本，如「电子病历4级、互联互通4A」 */
  ratingText: string
  /** 公司清单里的「建议」列 */
  recommendation: string
  /** 归属类型 */
  kind: DeliveryKind
  /** 命中来源 */
  source: CoverageSource
  /** 客户清单里对应的条目（原文，去重保序） */
  customerItems: string[]
  /** 是否评级必选（建议=必选 且被选中评级命中） */
  required: boolean
  /** 是否有客户清单命中 */
  coveredByCustomer: boolean
}

/** 评级档位的中文标签，如 emr/5 -> 「电子病历 5 级」 */
export function ratingLevelLabel(group: RatingGroupKey, value: string): string {
  const g = RATING_GROUPS.find((x) => x.key === group)
  if (!g) return `${group} ${value}`
  const lv = g.levels.find((l) => l.value === value)
  return lv ? `${g.short} ${lv.label}` : `${g.short} ${value}`
}

/** 一组评级选择 → 可读文本，如「电子病历 5 级；互联互通 四级甲等」 */
export function ratingSelectionText(sel: RatingSelection): string {
  const parts: string[] = []
  for (const g of RATING_GROUPS) {
    const picked = sel[g.key]
    if (!picked?.length) continue
    const labels = picked.map((v) => ratingLevelLabel(g.key, v))
    parts.push(labels.join("、"))
  }
  return parts.join("；")
}

/**
 * 评级档位值归一化（2026-10-29）
 *
 * 起因：公司库里的 rating_tags 存的是导入时的**列头原文**，与 RATING_GROUPS 的标准码不一致：
 *   emr 实际存 "病历五级"，标准码是 "5"
 *   hpc 实际存 "互联互通四甲"，标准码是 "4A"
 *   sm  实际存 "五级四甲"，标准码是 "3"
 * 直接比对导致「选中电子病历 5 级」一个模块都命中不了（实测评级必选 0 项）。
 * 这里把两种写法都折叠成同一个规范键，命中判断与展示都用它。
 */
const LEVEL_ALIASES: Record<RatingGroupKey, Record<string, string>> = {
  emr: {
    "病历四级": "4", 四: "4", "4": "4",
    "病历五级": "5", 五: "5", "5": "5",
    "病历六级": "6", 六: "6", "6": "6",
    "病历七级": "7", 七: "7", "7": "7",
  },
  hpc: {
    "互联互通四级乙等": "4B", "四级乙等": "4B", 四乙: "4B", "4B": "4B",
    "互联互通四级甲等": "4A", "四级甲等": "4A", 四甲: "4A", "4A": "4A",
    "互联互通五级乙等": "5B", "五级乙等": "5B", 五乙: "5B", "5B": "5B",
    "互联互通五级甲等": "5A", "五级甲等": "5A", 五甲: "5A", "5A": "5A",
  },
  ss: {
    "智慧服务一级": "1", "一级": "1", "1": "1",
    "智慧服务二级": "2", "二级": "2", "2": "2",
    "智慧服务三级": "3", "三级": "3", "3": "3",
    "智慧服务四级": "4", "四级": "4", "4": "4",
  },
  sm: {
    // 智慧管理标准表的简写是「五级四甲=3 级」这类组合，取其中的等级位
    "五级四乙": "3", "五级四甲": "3", 四级乙等: "2", 四级甲等: "2",
    "六级四甲": "3", "六级五乙": "3",
    "智慧管理一级": "1", "智慧管理二级": "2", "智慧管理三级": "3",
    "1": "1", "2": "2", "3": "3",
  },
}

/** 把档位值（标准码或导入原文）折叠成规范码；无法识别时原样返回（去空白小写） */
export function normalizeLevel(group: RatingGroupKey, value: string): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const alias = LEVEL_ALIASES[group]
  if (alias[raw]) return alias[raw]
  // 兜底：去掉「电子病历/互联互通/智慧服务/智慧管理」前缀再试一次
  const stripped = raw.replace(/^(电子病历|互联互通|智慧服务|智慧管理)/, "")
  if (stripped && alias[stripped]) return alias[stripped]
  return raw.replace(/\s+/g, "").toLowerCase()
}

/** 该产品是否命中任一被选中的评级档位 */
export function productMatchesRating(p: CheckProduct, sel: RatingSelection): boolean {
  const tags = p.rating_tags ?? {}
  for (const g of RATING_GROUPS) {
    const want = sel[g.key]
    if (!want?.length) continue
    const have = tags[g.key] ?? []
    // "*" = 该产品声明支持该评级体系全部档位
    if (have.includes("*")) return true
    const wantNorm = new Set(want.map((v) => normalizeLevel(g.key, v)))
    if (have.some((v) => wantNorm.has(normalizeLevel(g.key, v)))) return true
  }
  return false
}

/** 产品归属类型判定：三方产品 / 公司自研 */
export function deliveryKindOf(p: CheckProduct): DeliveryKind {
  const blob = `${p.product_belong ?? ""}|${p.category ?? ""}|${p.product_name ?? ""}`
  if (blob.includes("三方") || blob.includes("第三方") || String(p.product_name ?? "").includes("外购")) return "三方"
  return "公司"
}

/** 产品行的评级文本（用于导出展示），如「电子病历 5 级/6 级；互联互通 四级甲等」 */
export function productRatingText(p: CheckProduct): string {
  const tags = p.rating_tags ?? {}
  const parts: string[] = []
  for (const g of RATING_GROUPS) {
    const vals = tags[g.key]
    if (!vals?.length) continue
    if (vals.includes("*")) {
      parts.push(`${g.short}全部`)
      continue
    }
    // 归一化到规范码再转成可读标签（公司库存的是导入原文，直接展示会出现「电子病历病历五级」这种重复）
    const labels = Array.from(new Set(vals.map((v) => normalizeLevel(g.key, v))))
      .map((code) => {
        const lv = g.levels.find((l) => l.value === code)
        return lv ? lv.label : code
      })
    parts.push(`${g.short} ${labels.join("/")}`)
  }
  return parts.join("；")
}

/**
 * 星级覆盖清单构建：评级优先 → 追加客户清单条目 → 标注归属。
 *
 * @param products 公司库全部行（已去重）
 * @param rows     本次对照结果（含客户清单条目与其命中的模块）
 * @param sel      用户选中的评级档位；为空表示「不做评级筛选」
 * @param opts.includeOptional 是否带上「建议=可选」的评级模块（默认 true）
 */
export function buildRatingCoverageRows(
  products: CheckProduct[],
  rows: {
    raw: string
    /** MatchRow 用 norm、对照视图用 customer，两者取其一即可 */
    customer?: string
    norm?: string
    resolution: string
    product?: CheckProduct | null
    products?: CheckProduct[]
    customNames?: string[]
  }[],
  sel: RatingSelection,
  opts: { includeOptional?: boolean } = {},
): RatingCoverageRow[] {
  const includeOptional = opts.includeOptional ?? true
  const hasRating = RATING_GROUPS.some((g) => (sel[g.key]?.length ?? 0) > 0)

  // 客户清单命中：product.id -> 客户条目原文列表
  const hitByProduct = new Map<string, string[]>()
  const customRows: RatingCoverageRow[] = []
  for (const r of rows) {
    if (r.resolution === "ignore" || r.resolution === "external") continue
    const label = (r.raw || r.customer || r.norm || "").trim()
    const list = r.products?.length ? r.products : r.product ? [r.product] : []
    for (const p of list) {
      if (!label) continue
      const arr = hitByProduct.get(p.id) ?? []
      if (!arr.includes(label)) arr.push(label)
      hitByProduct.set(p.id, arr)
    }
    // 自定义模块（公司能做但清单没有）单独成行
    for (const cn of r.customNames ?? []) {
      customRows.push({
        productBelong: "",
        category: "自定义",
        productName: r.customer || r.norm || "",
        moduleCategory: "自定义",
        moduleName: cn,
        ratingText: "",
        recommendation: "",
        kind: "自定义",
        source: "customer",
        customerItems: label ? [label] : [r.customer || r.norm || ""],
        required: false,
        coveredByCustomer: true,
      })
    }
  }

  const out: RatingCoverageRow[] = []
  const pushed = new Set<string>()

  // ① 评级优先：被选中评级命中、且建议不是「可选」被过滤掉的模块
  if (hasRating) {
    for (const p of products) {
      if (!productMatchesRating(p, sel)) continue
      const rec = String(p.recommendation ?? "").trim()
      const isRequired = rec === "必选"
      if (!isRequired && !includeOptional) continue
      const items = hitByProduct.get(p.id) ?? []
      out.push({
        productBelong: String(p.product_belong ?? "").trim(),
        category: String(p.category ?? "").trim(),
        productName: String(p.product_name ?? "").trim(),
        moduleCategory: String(p.module_category ?? "").trim(),
        moduleName: String(p.module_name ?? "").trim(),
        ratingText: productRatingText(p),
        recommendation: rec,
        kind: deliveryKindOf(p),
        source: isRequired ? "rating-required" : "rating-optional",
        customerItems: items,
        required: isRequired,
        coveredByCustomer: items.length > 0,
      })
      pushed.add(p.id)
    }
  }

  // ② 追加客户清单里提到、但评级清单没覆盖的条目
  for (const p of products) {
    if (pushed.has(p.id)) continue
    const items = hitByProduct.get(p.id) ?? []
    if (!items.length) continue
    const rec = String(p.recommendation ?? "").trim()
    out.push({
      productBelong: String(p.product_belong ?? "").trim(),
      category: String(p.category ?? "").trim(),
      productName: String(p.product_name ?? "").trim(),
      moduleCategory: String(p.module_category ?? "").trim(),
      moduleName: String(p.module_name ?? "").trim(),
      ratingText: productRatingText(p),
      recommendation: rec,
      kind: deliveryKindOf(p),
      source: "customer",
      customerItems: items,
      // 客户明确要求 → 也算必须体现（否则交付漏项）
      required: rec === "必选",
      coveredByCustomer: true,
    })
  }

  // ③ 自定义模块
  out.push(...customRows)

  // 排序：评级必选 → 客户清单 → 评级可选 → 自定义；组内按 类别/产品/模块
  const rank: Record<CoverageSource, number> = { "rating-required": 0, customer: 1, "rating-optional": 2 }
  return out.sort((a, b) => {
    const ka = a.kind === "自定义" ? 3 : rank[a.source]
    const kb = b.kind === "自定义" ? 3 : rank[b.source]
    if (ka !== kb) return ka - kb
    const key = (x: RatingCoverageRow) => `${x.category}§${x.productName}§${x.moduleCategory}§${x.moduleName}`
    return key(a).localeCompare(key(b), "zh-CN")
  })
}

/** 统计：各类归属 / 来源的条数（导出统计页与界面提示共用） */
export function coverageStats(rows: RatingCoverageRow[]): {
  total: number
  required: number
  company: number
  thirdparty: number
  custom: number
  coveredByCustomer: number
} {
  let required = 0
  let company = 0
  let thirdparty = 0
  let custom = 0
  let coveredByCustomer = 0
  for (const r of rows) {
    if (r.required) required += 1
    if (r.kind === "公司") company += 1
    else if (r.kind === "三方") thirdparty += 1
    else custom += 1
    if (r.coveredByCustomer) coveredByCustomer += 1
  }
  return { total: rows.length, required, company, thirdparty, custom, coveredByCustomer }
}
