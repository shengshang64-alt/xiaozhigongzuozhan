import * as XLSX from "xlsx"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import { fieldText, type MappingCompareRow } from "./mappingCore"

// ---------------------------------------------------------------------------
// 产品映射导出：公司格式（ONE-LINK《按公司规范》列）
// 与 checklistExports.ts 同源（xlsx），调用方按需 import("./productMappingExports") 懒加载
// ---------------------------------------------------------------------------

/** 一一对照表表头 */
export const MAPPING_COMPARE_HEADERS = [
  "客户条目",
  "匹配方式",
  "处理结果",
  "产品归属",
  "产品类别",
  "产品名称",
  "模块分类",
  "模块名称",
  "标准名称",
  "模块属性",
  "系数",
  "建议",
  "备注",
]

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

const MATCH_KIND_ZH: Record<MappingCompareRow["kind"], string> = {
  mapping: "映射库",
  local: "本地匹配",
  ai: "AI 匹配",
  manual: "人工指定",
  none: "未命中",
}

const RESOLUTION_ZH: Record<MappingCompareRow["resolution"], string> = {
  company: "我公司",
  external: "外购",
  ignore: "忽略",
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

function downloadWorkbook(ws: XLSX.WorkSheet, fileName: string, sheetName: string) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName)
}

/** 一一对照表导出：客户条目 | 匹配方式 | 处理结果 | 公司标准列 */
export function exportMappingCompareXlsx(rows: MappingCompareRow[], fileName = "产品映射-一一对照.xlsx"): number {
  const aoa: (string | number)[][] = [MAPPING_COMPARE_HEADERS]
  for (const r of rows) {
    if (r.resolution === "ignore") continue
    const p = r.product
    aoa.push([
      r.customer,
      MATCH_KIND_ZH[r.kind],
      RESOLUTION_ZH[r.resolution],
      p ? fieldText(p, "product_belong") : "",
      p ? fieldText(p, "category") : "",
      p ? fieldText(p, "product_name") : "",
      p ? fieldText(p, "module_category") : "",
      p ? fieldText(p, "module_name") : "",
      p ? fieldText(p, "standard_name") : "",
      p ? fieldText(p, "module_attr") : "",
      p ? fieldText(p, "coefficient") : "",
      p ? fieldText(p, "recommendation") : "",
      r.note || "",
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = MAPPING_COMPARE_HEADERS.map((h) => ({ wch: Math.max(10, h.length * 2) }))
  downloadWorkbook(ws, fileName, "一一对照")
  return rows.filter((r) => r.resolution !== "ignore").length
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
  downloadWorkbook(ws, fileName, "按公司规范")
  return products.length
}

/** 归一化文本用于骨架行与对照条目的包含式匹配（去空白与常见标点） */
function nz(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[（）()、,，.。：:*#\-—_]/g, "")
}

const FILL_NEW_COLS = ["产品名称", "模块分类", "模块名称", "备注"]

/**
 * 骨架回填式导出（参照公司 tm.py write 的“原列不动、只写目标列、时间戳不覆盖”）：
 * 上传公司对照表骨架（首个 sheet），按客户条目文本定位行，只在右侧新增
 * 产品名称/模块分类/模块名称/备注 四列回填命中结果，原有单元格值一字不动。
 * 备注取对照行的 note（一对多其余项 / 命名错位说明）。
 * 注：浏览器端 xlsx(SheetJS) 写回不保留富样式（字体/边框），若需样式照抄请用离线 openpyxl 版。
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

  // 待回填行：只取命中我公司产物的条目（未命中/外购留空，与 tm.py 一致）
  const targets = rows.filter((r) => r.resolution === "company" && r.product)
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
    if (!hit?.product) continue
    used.add(hit.row_id)
    row[width] = fieldText(hit.product, "product_name")
    row[width + 1] = fieldText(hit.product, "module_category")
    row[width + 2] = fieldText(hit.product, "module_name")
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
