import * as XLSX from "xlsx-js-style"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import {
  fieldText,
  GRADE_LABEL,
  matchGrade,
  moduleText,
  productLineText,
  rowStatus,
  STATUS_LABEL,
  type MatchGrade,
  type MappingCompareRow,
} from "./mappingCore"

// ---------------------------------------------------------------------------
// 产品映射导出（2026-10-28 对齐公司《匹配对照表》交付格式 · 芜湖眼科样例）：
//  工作簿三 Sheet：
//   ① 匹配对照表 = 标题行 + 说明行 + 上传原表列 + 映射列组
//      （我司对应产品线「 / 」拼接 · 我司对应模块/标准名称「 + 」拼接 · 匹配度五档带色）
//   ② 统计汇总 = 五档条目数 / 占比 / 处理建议
//   ③ 待确认清单 = 部分匹配 / 第三方 / 待确认条目，供人工裁定
//  另保留：公司标准交付表、骨架回填导出。
//  写样式用 xlsx-js-style（CE xlsx 0.18.5 功能超集，同 quoteExports.ts 先例）。
// ---------------------------------------------------------------------------

/** 映射列组（追加在原表列右侧）。
 *  2026-10-29 改版：对齐用户手工调整的《芜湖眼科医院建设清单》——产品对照固定四列
 *  「产品类别 / 产品名称 / 模块分类 / 模块名称」，其后才是匹配状态等辅助列。 */
export const MAP_RESULT_HEADERS = [
  "产品类别",
  "产品名称",
  "模块分类",
  "模块名称",
  "匹配状态",
  "匹配度",
  "匹配说明 / 差异与风险",
  "备注",
]

/** 无原表信息时（粘贴/招标/方案来源）的首列 */
export const MAPPING_COMPARE_HEADERS = ["客户条目", ...MAP_RESULT_HEADERS]

/** 公司标准交付表表头（ONE-LINK《按公司规范》列顺序） */
export const COMPANY_STANDARD_HEADERS = [
  "产品归属",
  "产品类别",
  "产品名称",
  "模块分类",
  "模块名称",
  "标准名称",
  "模块属性",
  "系数",
  "建议",
  "计费档位",
  "单价",
]

/** 覆盖视角表头（公司目录逐模块 × 本项目命中情况） */
export const COVERAGE_HEADERS = [
  "产品归属",
  "产品类别",
  "产品名称",
  "模块分类",
  "模块名称",
  "标准名称",
  "建议",
  "覆盖状态",
  "命中条目",
  "命中数",
]

/** 待确认清单表头（对齐参考文件「待确认清单」sheet） */
export const PENDING_HEADERS = ["序号", "系统功能名称", "匹配度", "我司对应模块", "需确认的核心问题", "备注/风险"]

/** 统计汇总五档处理建议（对齐参考文件口径） */
export const GRADE_ADVICE: Record<MatchGrade, string> = {
  full: "可直接进入方案与报价，无需人工介入。",
  basic: "产品可覆盖但名称/形态不同，需在方案中做“对应说明”。",
  partial: "需多模块组合或涉及定制，必须人工裁定方案边界与工作量。",
  thirdparty: "非自研产品线，需确认供应商、代理报价与实施责任。",
  pending: "产品目录无对应，需产品/售前确认后再答复客户。",
}

const GRADE_ORDER: MatchGrade[] = ["full", "basic", "partial", "thirdparty", "pending"]

/** 匹配度 → 填充色/字色（与界面色块同色系） */
const GRADE_STYLE: Record<MatchGrade, { bg: string; fg: string }> = {
  full: { bg: "FFC6EFCE", fg: "FF006100" },
  basic: { bg: "FFDDEBF7", fg: "FF1F4E79" },
  partial: { bg: "FFFFF3CD", fg: "FF9C6500" },
  thirdparty: { bg: "FFFFEDD5", fg: "FF9A3412" },
  pending: { bg: "FFFFC7CE", fg: "FF9C0006" },
}

/** 行命中的全部公司模块（products 优先，回落单 product） */
function rowProducts(r: MappingCompareRow): CheckProduct[] {
  if (r.products?.length) return r.products
  return r.product ? [r.product] : []
}

function priceTierText(p: CheckProduct): string {
  const tiers = p.price_tier ?? []
  if (!tiers.length) return ""
  return tiers
    .map((t) => {
      const label = t.tier || ""
      const scope = [t.outpatient, t.bed].filter(Boolean).join("/")
      const price = t.price ? `${t.price}` : ""
      return [label, scope, price].filter(Boolean).join(" ")
    })
    .join("；")
}

function styleCell(ws: XLSX.WorkSheet, r: number, c: number, s: Record<string, unknown>) {
  const addr = XLSX.utils.encode_cell({ r, c })
  const cell = ws[addr] ?? (ws[addr] = { t: "s", v: "" })
  cell.s = { ...(cell.s ?? {}), ...s }
}

// ---------------------------------------------------------------------------
// ① 匹配对照表（纯函数 AOA：R1 标题 / R2 说明 / R3 表头 / R4+ 数据）
// ---------------------------------------------------------------------------
export function buildCompareAoa(
  rows: MappingCompareRow[],
  opts: { sourceColumns?: string[]; projectName?: string } = {},
): { aoa: (string | number)[][]; dataStart: number; gradeCol: number } {
  const srcCols = opts.sourceColumns ?? []
  const hasSrc = srcCols.length > 0
  const headers = hasSrc ? [...srcCols, ...MAP_RESULT_HEADERS] : MAPPING_COMPARE_HEADERS
  const project = (opts.projectName ?? "").trim() || "信息化建设清单"
  const aoa: (string | number)[][] = [
    [`${project} —— 产品匹配对照表`],
    ["说明：本表为「机器初筛 + 产品目录比对」的基础稿，匹配度与匹配说明供参考，最终以人工确认为准。"],
    headers,
  ]
  const gradeCol = headers.indexOf("匹配度")
  for (const r of rows) {
    if (r.resolution === "ignore") continue
    const plist = rowProducts(r)
    const srcCells = hasSrc ? srcCols.map((_, i) => r.cells?.[i] ?? "") : [r.customer]
    // 2026-10-29：产品对照四列逐行堆叠（一对多时多值换行对齐），与用户 Excel 的合并单元格式一致
    const joinCol = (fn: (x: CheckProduct) => string) => plist.map(fn).filter(Boolean).join("\n")
    aoa.push([
      ...srcCells,
      joinCol((x) => fieldText(x, "category")) || (r.customNames?.length ? "自定义" : ""),
      joinCol((x) => fieldText(x, "product_name")),
      joinCol((x) => fieldText(x, "module_category")) || (r.customNames?.length ? "自定义" : ""),
      moduleText(plist, r.customNames),
      STATUS_LABEL[rowStatus(r)],
      GRADE_LABEL[matchGrade(r)],
      r.note || "",
      "",
    ])
  }
  return { aoa, dataStart: 3, gradeCol }
}

/** ② 统计汇总（纯函数）：五档条目数 / 占比 / 处理建议（忽略行不计） */
export function buildStatsAoa(rows: MappingCompareRow[]): (string | number)[][] {
  const counted = rows.filter((r) => r.resolution !== "ignore")
  const total = counted.length
  const byGrade = new Map<MatchGrade, number>()
  for (const r of counted) {
    const g = matchGrade(r)
    byGrade.set(g, (byGrade.get(g) ?? 0) + 1)
  }
  const aoa: (string | number)[][] = [
    ["匹配结果统计"],
    [],
    ["匹配度", "条目数", "占比", "处理建议"],
  ]
  for (const g of GRADE_ORDER) {
    const n = byGrade.get(g) ?? 0
    aoa.push([GRADE_LABEL[g], n, total ? `${((n / total) * 100).toFixed(1)}%` : "0.0%", GRADE_ADVICE[g]])
  }
  aoa.push(["合计", total, "100.0%", ""])
  return aoa
}

/** ③ 待确认清单（纯函数）：部分匹配 / 第三方 / 待确认条目（忽略行不计） */
export function buildPendingAoa(rows: MappingCompareRow[]): (string | number)[][] {
  const aoa: (string | number)[][] = [
    ["需人工裁定 / 需产品确认清单"],
    [],
    PENDING_HEADERS,
  ]
  let seq = 0
  for (const r of rows) {
    if (r.resolution === "ignore") continue
    const g = matchGrade(r)
    if (g === "full" || g === "basic") continue
    seq += 1
    const plist = rowProducts(r)
    aoa.push([
      r.cells?.[0] || seq,
      r.raw || r.customer,
      GRADE_LABEL[g],
      moduleText(plist) || (g === "pending" ? "（目录内无对应）" : ""),
      "",
      r.note || "",
    ])
  }
  return aoa
}

/**
 * 匹配对照表导出：三 Sheet 工作簿（匹配对照表 / 统计汇总 / 待确认清单）。
 * 匹配度列按五档着色；标题/说明行合并整行。
 */
export function exportMappingCompareXlsx(
  rows: MappingCompareRow[],
  opts: { sourceColumns?: string[]; projectName?: string; fileName?: string } = {},
): number {
  const { aoa, dataStart, gradeCol } = buildCompareAoa(rows, opts)
  const colCount = aoa[2].length
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // 标题 / 说明行整行合并
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
  ]
  styleCell(ws, 0, 0, { font: { bold: true, sz: 14 }, alignment: { horizontal: "left" } })
  styleCell(ws, 1, 0, { font: { color: { rgb: "FF6B7280" }, sz: 10 } })
  // 表头加粗
  for (let c = 0; c < colCount; c += 1) {
    styleCell(ws, 2, c, { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFF3F4F6" } } })
  }
  // 匹配度五档着色
  const dataRows = rows.filter((r) => r.resolution !== "ignore")
  dataRows.forEach((r, i) => {
    const g = matchGrade(r)
    styleCell(ws, dataStart + i, gradeCol, {
      fill: { patternType: "solid", fgColor: { rgb: GRADE_STYLE[g].bg } },
      font: { color: { rgb: GRADE_STYLE[g].fg }, bold: true },
      alignment: { horizontal: "center" },
    })
  })
  // 列宽：原表列按内容，映射列组固定
  const srcLen = colCount - MAP_RESULT_HEADERS.length
  const mapWidths = [24, 36, 10, 40, 24, 12, 20]
  ws["!cols"] = Array.from({ length: colCount }, (_, i) =>
    i < srcLen ? { wch: 16 } : { wch: mapWidths[i - srcLen] ?? 14 },
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "匹配对照表")

  const wsStats = XLSX.utils.aoa_to_sheet(buildStatsAoa(rows))
  wsStats["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]
  styleCell(wsStats, 0, 0, { font: { bold: true, sz: 13 } })
  for (let c = 0; c < 4; c += 1) {
    styleCell(wsStats, 2, c, { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFF3F4F6" } } })
  }
  wsStats["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 62 }]
  XLSX.utils.book_append_sheet(wb, wsStats, "统计汇总")

  const wsPending = XLSX.utils.aoa_to_sheet(buildPendingAoa(rows))
  wsPending["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: PENDING_HEADERS.length - 1 } }]
  styleCell(wsPending, 0, 0, { font: { bold: true, sz: 13 } })
  for (let c = 0; c < PENDING_HEADERS.length; c += 1) {
    styleCell(wsPending, 2, c, { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFF3F4F6" } } })
  }
  wsPending["!cols"] = [{ wch: 8 }, { wch: 26 }, { wch: 12 }, { wch: 36 }, { wch: 38 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, wsPending, "待确认清单")

  XLSX.writeFile(wb, opts.fileName ?? "产品映射-匹配对照表.xlsx")
  return dataRows.length
}

/**
 * 覆盖视角 AOA（纯函数，可单测）：公司库逐模块一行，
 * 命中条目 = 本项目对照到该模块的客户条目（原文，去重保序）。
 * 多对多：一条客户条目命中多个模块时，每个模块都计入（多对一/一对多均正确聚合）。
 */
export function buildCoverageAoa(
  products: CheckProduct[],
  rows: MappingCompareRow[],
): (string | number)[][] {
  const hitByProduct = new Map<string, string[]>()
  for (const r of rows) {
    if (r.resolution !== "company") continue
    const label = r.raw || r.customer
    if (!label) continue
    for (const p of rowProducts(r)) {
      const list = hitByProduct.get(p.id) ?? []
      if (!list.includes(label)) list.push(label)
      hitByProduct.set(p.id, list)
    }
  }
  const aoa: (string | number)[][] = [COVERAGE_HEADERS]
  for (const p of products) {
    const hits = hitByProduct.get(p.id) ?? []
    aoa.push([
      fieldText(p, "product_belong"),
      fieldText(p, "category"),
      fieldText(p, "product_name"),
      fieldText(p, "module_category"),
      fieldText(p, "module_name"),
      fieldText(p, "standard_name"),
      fieldText(p, "recommendation"),
      hits.length ? `已覆盖 ${hits.length} 条` : "未覆盖",
      hits.join("、"),
      hits.length,
    ])
  }
  return aoa
}

/** 公司目录覆盖视角导出：未覆盖模块高亮（检查方案完整性/报价遗漏） */
export function exportCoverageXlsx(
  products: CheckProduct[],
  rows: MappingCompareRow[],
  fileName = "产品映射-目录覆盖视角.xlsx",
): number {
  const aoa = buildCoverageAoa(products, rows)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const statusCol = COVERAGE_HEADERS.indexOf("覆盖状态")
  for (let i = 1; i < aoa.length; i += 1) {
    const covered = String(aoa[i][statusCol] ?? "").startsWith("已覆盖")
    styleCell(ws, i, statusCol, {
      fill: { patternType: "solid", fgColor: { rgb: covered ? GRADE_STYLE.full.bg : GRADE_STYLE.pending.bg } },
      font: { color: { rgb: covered ? GRADE_STYLE.full.fg : GRADE_STYLE.pending.fg }, bold: !covered },
      alignment: { horizontal: "center" },
    })
  }
  ws["!cols"] = COVERAGE_HEADERS.map((h, i) => ({ wch: i === COVERAGE_HEADERS.indexOf("命中条目") ? 50 : Math.max(10, String(h).length * 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "目录覆盖视角")
  XLSX.writeFile(wb, fileName)
  return aoa.length - 1
}

/**
 * 公司格式导出：命中我公司的条目按 ONE-LINK《按公司规范》列顺序落表，供直接交付。
 * 传 CheckProduct[]（已命中的公司行，可含重复），逐行输出一行。
 */
export function exportCompanyStandardXlsx(
  products: CheckProduct[],
  fileName = "产品映射-公司标准清单.xlsx",
): number {
  const aoa: (string | number)[][] = [COMPANY_STANDARD_HEADERS]
  for (const p of products) {
    aoa.push([
      fieldText(p, "product_belong"),
      fieldText(p, "category"),
      fieldText(p, "product_name"),
      fieldText(p, "module_category"),
      fieldText(p, "module_name"),
      fieldText(p, "standard_name"),
      fieldText(p, "module_attr"),
      fieldText(p, "coefficient"),
      fieldText(p, "recommendation"),
      priceTierText(p),
      fieldText(p, "unit_price"),
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = COMPANY_STANDARD_HEADERS.map((h) => ({ wch: Math.max(10, h.length * 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "按公司规范")
  XLSX.writeFile(wb, fileName)
  return products.length
}

/** 归一化文本用于骨架行与对照条目的包含式匹配（去空白与常见标点） */
function nz(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[（）()、,，.。：:*#\-—_]/g, "")
}

const FILL_NEW_COLS = ["我司对应产品线", "我司对应模块/标准名称", "匹配度", "匹配说明"]

/**
 * 骨架回填式导出（参照公司 tm.py write 的“原列不动、只写目标列、时间戳不覆盖”）：
 * 上传公司对照表骨架（首个 sheet），按客户条目文本定位行，只在右侧新增
 * 我司对应产品线/我司对应模块·标准名称/匹配度/匹配说明 四列回填命中结果，原有单元格值一字不动。
 * 注：浏览器端 SheetJS 写回不保留富样式（字体/边框），若需样式照抄请用离线 openpyxl 版。
 */
export async function exportFillSkeletonXlsx(file: File, rows: MappingCompareRow[], fileName?: string): Promise<number> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error("empty sheet")
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" }) as unknown[][]
  if (!aoa.length) throw new Error("empty sheet")

  let width = 0
  for (const row of aoa) width = Math.max(width, row.length)
  // 表头行追加四列标题（不修改已有表头单元）
  const header = aoa[0]
  for (let i = 0; i < FILL_NEW_COLS.length; i += 1) header[width + i] = FILL_NEW_COLS[i]

  // 待回填行：只取命中我公司产物的条目（未命中/外购留空，与 tm.py 一致；一对多按「 / 」「 + 」拼接）
  const targets = rows.filter((r) => r.resolution === "company" && rowProducts(r).length)
  const used = new Set<string>()
  let filled = 0
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i]
    const rowText = nz(row.join(""))
    if (!rowText) continue
    const hit = targets.find((r) => {
      if (used.has(r.row_id)) return false
      const cn = nz(r.customer)
      if (!cn) return false
      return rowText.includes(cn) || (cn.length >= 4 && cn.includes(rowText) && rowText.length >= 4)
    })
    if (!hit) continue
    const prods = rowProducts(hit)
    if (!prods.length) continue
    used.add(hit.row_id)
    row[width] = productLineText(prods)
    row[width + 1] = moduleText(prods)
    row[width + 2] = GRADE_LABEL[matchGrade(hit)]
    row[width + 3] = hit.note || ""
    filled += 1
  }

  const ws2 = XLSX.utils.aoa_to_sheet(aoa)
  const wb2 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb2, ws2, sheetName || "对照")
  const base = file.name.replace(/\.[^.]+$/, "") || "对照表"
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  XLSX.writeFile(wb2, fileName || `${base}_已匹配_${ts}.xlsx`)
  return filled
}
