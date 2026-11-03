import type { CheckProduct, OneLinkPriceTier, RatingGroupKey, RatingTags } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// ONE-LINK 标准清单导入：解析《智慧医院报价（按公司规范）》表 → 公司库行
// 列序：产品归属 | 产品类别 | 产品名称 | 模块分类 | 模块名称 | 标准名称
//       | 计费档位（G 起 5 列，三行表头：门诊量口径 / 床位口径 / A-E 类）
//       | 模块属性 | 系数 | 建议 | 评级勾选列 … | 著作权名称 | 测试报告名称 | 模块说明
// ---------------------------------------------------------------------------

/** 目标工作表：以「按公司规范」为准，「按国家标准」不参与映射 */
export const ONE_LINK_SHEET_KEYWORDS = ["按公司规范", "公司规范"]

/** 表头三行内允许出现的口径前缀，其余（如「智慧管理」简写表头）不当前缀 */
const TIER_OUTPATIENT_PREFIXES = ["门诊量", "门量", "门诊人数"]
const TIER_BED_PREFIXES = ["床位", "床"]

/** 评级勾选列 → 评级体系：前缀最长匹配优先（「五级四甲」属智慧管理，不能落到「五乙」上） */
const TAG_COLUMN_PREFIXES: { prefix: string; key: RatingGroupKey }[] = [
  { prefix: "病历", key: "emr" },
  { prefix: "电子病历", key: "emr" },
  { prefix: "互联互通", key: "hpc" },
  { prefix: "智慧服务", key: "ss" },
  { prefix: "智慧管理", key: "sm" },
  // 智慧管理在标准表里简写为「五级四乙 / 五级四甲 / 六级四甲 / 六级五乙」
  { prefix: "五级四", key: "sm" },
  { prefix: "六级四", key: "sm" },
  { prefix: "六级五", key: "sm" },
  { prefix: "五乙", key: "hpc" },
  { prefix: "五甲", key: "hpc" },
  { prefix: "四乙", key: "hpc" },
  { prefix: "四甲", key: "hpc" },
]

/** 导入解析出的单行（字段口径与 CheckProduct 对齐，额外带标准表原文列） */
export type OneLinkRow = {
  /** Excel 实际行号（1 起），供预览定位 */
  excel_row: number
  product_belong: string
  category: string
  product_line: string
  product_name: string
  module_category: string
  module_name: string
  standard_name: string
  module_attr: string
  coefficient: string
  recommendation: string
  price_tier: OneLinkPriceTier[]
  rating_tags: RatingTags
  remark: string
}

export type OneLinkParseSummary = {
  sheet: string
  /** 命中的数据行数（= rows.length） */
  rowCount: number
  /** 去重后的产品名称数 */
  productCount: number
  /** 合并单元格向下填充过的列名 */
  filledColumns: string[]
  /** 跳过的空行数（模块名称与标准名称均为空） */
  skippedEmpty: number
}

export type OneLinkParseResult = {
  rows: OneLinkRow[]
  summary: OneLinkParseSummary
}

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

/** 标准表把「无关联」写成 0 / ∅ / ／，一律视为未勾选 */
function isMarkCell(value: unknown): boolean {
  const t = text(value)
  if (!t) return false
  if (t.startsWith("0")) return false
  return !["∅", "×", "x", "X", "－", "-", "—", "/"].includes(t)
}

function longestPrefixMatch(header: string, candidates: string[]): number {
  const h = (header ?? "").replace(/\s+/g, "")
  if (!h) return -1
  let bestIdx = -1
  let bestLen = 0
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i] ?? ""
    if (c && h.startsWith(c) && c.length > bestLen) {
      bestIdx = i
      bestLen = c.length
    }
  }
  return bestIdx
}

function findColumn(header: string[], needle: string): number {
  return header.findIndex((h) => h.includes(needle))
}

/** 解析 ONE-LINK《智慧医院报价（按公司规范）》工作表 */
export async function parseOneLinkWorkbook(source: File | ArrayBuffer): Promise<OneLinkParseResult> {
  const XLSX = await import("xlsx")
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  const wb = XLSX.read(buf)
  const sheetName =
    wb.SheetNames.find((n) => ONE_LINK_SHEET_KEYWORDS.some((k) => String(n).includes(k))) ?? ""
  if (!sheetName) {
    throw new Error("未找到按公司规范的工作表，请确认是《智慧医院信息化建设- ONE-LINK》标准清单文件")
  }
  const ws = wb.Sheets[sheetName]
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true })
  const cellAt = (r: number, c: number): string => {
    const row = grid[r]
    if (!Array.isArray(row)) return ""
    return text(row[c])
  }

  // 表头定位：含「模块名称」的行即表头首行，其后连续非空行为表头副行（门诊量/床位/档位）
  let headerRow = -1
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    if (findColumn((grid[i] ?? []).map(text), "模块名称") >= 0) {
      headerRow = i
      break
    }
  }
  if (headerRow < 0) throw new Error("标准清单表头缺少「模块名称」列，无法解析")
  const header = (grid[headerRow] ?? []).map(text)

  const colBelong = Math.max(findColumn(header, "产品归属"), 0)
  const colCategory = Math.max(findColumn(header, "产品类别"), 0)
  const colProductName = findColumn(header, "产品名称")
  const colModuleCategory = findColumn(header, "模块分类")
  const colModuleName = findColumn(header, "模块名称")
  const colStandard = findColumn(header, "标准名称")
  if (colProductName < 0 || colModuleCategory < 0 || colModuleName < 0) {
    throw new Error("标准清单缺少产品名称/模块分类/模块名称列，无法解析")
  }
  const colModuleAttr = findColumn(header, "模块属性")
  const colCoefficient = findColumn(header, "系数")
  const colRecommend = findColumn(header, "建议")
  const colCopyright = findColumn(header, "著作权")
  const colTestReport = findColumn(header, "测试报告")
  const colModuleDesc = findColumn(header, "模块说明")

  // 计费档位：表头首行与副行都可能是档位口径，逐列取最长前缀命中
  // 副表头行：所有身份列（归属/类别/产品名称/模块分类/模块名称/标准名称）均为空的行
  const identityCols = [colBelong, colCategory, colProductName, colModuleCategory, colModuleName, colStandard]
  const isIdentityBlank = (r: number): boolean => identityCols.every((c) => cellAt(r, c) === "")
  const tierLabelRows: number[] = []
  for (let i = headerRow + 1; i < grid.length && tierLabelRows.length < 3; i++) {
    if (!isIdentityBlank(i)) break
    tierLabelRows.push(i)
  }
  const readTierLabel = (c: number, candidates: string[]): string => {
    for (const r of tierLabelRows) {
      const t = cellAt(r, c)
      if (t && candidates.some((p) => t.replace(/\s+/g, "").startsWith(p))) return t
    }
    return ""
  }
  const tiers: { col: number; outpatient: string; bed: string; tier: string }[] = []
  for (let c = 0; c < header.length; c++) {
    const outpatient =
      cellAt(headerRow, c) || readTierLabel(c, TIER_OUTPATIENT_PREFIXES)
    if (!outpatient || !TIER_OUTPATIENT_PREFIXES.some((p) => outpatient.replace(/\s+/g, "").startsWith(p))) {
      continue
    }
    const bed = readTierLabel(c, TIER_BED_PREFIXES)
    let tier = ""
    for (const r of [headerRow, ...tierLabelRows]) {
      const t = cellAt(r, c)
      if (t && /[类等级]$/.test(t) && !t.startsWith("门诊")) tier = t
    }
    tiers.push({ col: c, outpatient, bed, tier })
  }

  const dataStart = tierLabelRows.length ? tierLabelRows[tierLabelRows.length - 1] + 1 : headerRow + 1

  // 合并单元格：xlsx 读出后仅首格有值，归属/类别/产品名称/模块分类向下填充；
  // 标准名称同列合并时一并填充（模块名称为空的行按跳过处理）
  const fillCols = [colBelong, colCategory, colProductName, colModuleCategory, colModuleName, colStandard]
  const carried: string[] = ["", "", "", "", "", ""]
  const tagColumns: { col: number; key: RatingGroupKey; label: string }[] = []
  for (let c = 0; c < header.length; c++) {
    if (c <= colRecommend) continue
    const hit = longestPrefixMatch(header[c], TAG_COLUMN_PREFIXES.map((t) => t.prefix))
    if (hit < 0) continue
    tagColumns.push({ col: c, key: TAG_COLUMN_PREFIXES[hit].key, label: header[c].replace(/\s+/g, "") })
  }

  const rows: OneLinkRow[] = []
  let skippedEmpty = 0
  for (let r = dataStart; r < grid.length; r++) {
    const rawModuleName = cellAt(r, colModuleName)
    const rawStandard = cellAt(r, colStandard)
    if (rawModuleName === "" && rawStandard === "") {
      const anyCell = (grid[r] ?? []).some((c) => text(c) !== "")
      if (anyCell) skippedEmpty += 1
      continue
    }
    const filled: string[] = []
    for (let k = 0; k < fillCols.length; k++) {
      const cell = cellAt(r, fillCols[k])
      if (cell) carried[k] = cell
      filled.push(carried[k])
    }
    const [belong, category, productName, moduleCategory, moduleName, standardName] = filled

    const priceTier: OneLinkPriceTier[] = []
    for (const t of tiers) {
      const price = Number(text((grid[r] ?? [])[t.col]) || 0)
      priceTier.push({
        tier: t.tier || `档位${priceTier.length + 1}`,
        outpatient: t.outpatient,
        bed: t.bed || undefined,
        price: Number.isFinite(price) ? price : 0,
      })
    }

    const ratingTags: RatingTags = {}
    for (const tc of tagColumns) {
      const cell = text((grid[r] ?? [])[tc.col])
      if (!isMarkCell(cell)) continue
      const list = ratingTags[tc.key] ?? []
      if (!list.includes(tc.label)) ratingTags[tc.key] = [...list, tc.label]
    }

    rows.push({
      excel_row: r + 1,
      product_belong: belong,
      category,
      product_line: productName,
      product_name: productName,
      module_category: moduleCategory,
      // 少数行只填了标准名称（模块名称空）：以标准名称作为模块名，保证映射候选标签不为空
      module_name: moduleName || standardName,
      standard_name: standardName,
      module_attr: colModuleAttr >= 0 ? cellAt(r, colModuleAttr) : "",
      coefficient: colCoefficient >= 0 ? cellAt(r, colCoefficient) : "",
      recommendation: colRecommend >= 0 ? cellAt(r, colRecommend) : "",
      price_tier: priceTier,
      rating_tags: ratingTags,
      remark: [
        colCopyright >= 0 ? cellAt(r, colCopyright) : "",
        colTestReport >= 0 ? cellAt(r, colTestReport) : "",
        colModuleDesc >= 0 ? cellAt(r, colModuleDesc) : "",
      ]
        .filter((s) => s && s !== "0")
        .join("；"),
    })
  }

  if (!rows.length) throw new Error("标准清单没有可解析的数据行")
  return {
    rows,
    summary: {
      sheet: sheetName,
      rowCount: rows.length,
      productCount: new Set(rows.map((x) => x.product_name)).size,
      filledColumns: ["产品归属", "产品类别", "产品名称", "模块分类", "模块名称", "标准名称"],
      skippedEmpty,
    },
  }
}

/** 解析行 → 公司库写入载荷（is_builtin:false + in_company:true，口径同产品库 Excel 导入） */
export function oneLinkRowsToProductPayloads(rows: OneLinkRow[]): Partial<CheckProduct>[] {
  return rows.map((r) => ({
    is_builtin: false,
    in_company: true,
    category: r.category,
    product_line: r.product_line,
    product_name: r.product_name,
    module_name: r.module_name,
    module_func: r.standard_name,
    description: r.remark,
    charge_mode: "模块授权",
    unit_price: 0,
    status: "在售",
    rating_tags: r.rating_tags,
    product_belong: r.product_belong,
    module_category: r.module_category,
    standard_name: r.standard_name,
    module_attr: r.module_attr,
    coefficient: r.coefficient,
    recommendation: r.recommendation,
    price_tier: r.price_tier,
  }))
}
