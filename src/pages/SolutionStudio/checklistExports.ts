import * as XLSX from "xlsx"
import {
  calcTotal,
  fmtMoney,
  targetsLabel,
  type CheckProduct,
  type ChecklistLine,
  type ChecklistRecord,
  type RatingGroupKey,
  type RatingTags,
} from "./checklistTypes"

// ---------------------------------------------------------------------------
// 建设清单 Excel 工具：产品模板下载 / 产品导入导出 / 客户清单解析 / 清单导出
// ---------------------------------------------------------------------------

export const PRODUCT_TEMPLATE_HEADERS = [
  "产品类别",
  "产品线",
  "产品名称",
  "模块名称",
  "模块功能",
  "说明",
  "计费方式",
  "单价",
  "状态",
  "电子病历评级",
  "互联互通评级",
  "智慧服务评级",
  "智慧管理评级",
]

const RATING_COLUMN_KEYS: Record<string, RatingGroupKey> = {
  电子病历评级: "emr",
  互联互通评级: "hpc",
  智慧服务评级: "ss",
  智慧管理评级: "sm",
}

function tagsToCell(tags: RatingTags, key: RatingGroupKey): string {
  return (tags[key] ?? []).join("/")
}

function downloadWorkbook(ws: XLSX.WorkSheet, fileName: string) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, fileName)
}

export function downloadProductTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    PRODUCT_TEMPLATE_HEADERS,
    ["临床诊疗", "HIS", "HIS", "门诊管理", "门诊挂号与收费", "示例行，可删除", "系统授权", 450000, "在售", "4/5/6/7", "4B/4A", "", ""],
  ])
  downloadWorkbook(ws, "我公司产品导入模板.xlsx")
}

export function exportProducts(rows: CheckProduct[]) {
  const aoa: (string | number)[][] = [PRODUCT_TEMPLATE_HEADERS]
  for (const p of rows) {
    aoa.push([
      p.category,
      p.product_line,
      p.product_name,
      p.module_name,
      p.module_func,
      p.description,
      p.charge_mode,
      Number(p.unit_price) || 0,
      p.status,
      tagsToCell(p.rating_tags ?? {}, "emr"),
      tagsToCell(p.rating_tags ?? {}, "hpc"),
      tagsToCell(p.rating_tags ?? {}, "ss"),
      tagsToCell(p.rating_tags ?? {}, "sm"),
    ])
  }
  downloadWorkbook(XLSX.utils.aoa_to_sheet(aoa), "我公司产品清单.xlsx")
}

function splitRatingCell(value: unknown): string[] {
  const text = String(value ?? "").trim()
  if (!text) return []
  return text
    .split(/[/、,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function parseProductFile(file: File): Promise<Partial<CheckProduct>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })
  const out: Partial<CheckProduct>[] = []
  for (const row of rawRows) {
    const productName = String(row["产品名称"] ?? "").trim()
    if (!productName) continue
    const tags: RatingTags = {}
    for (const [col, key] of Object.entries(RATING_COLUMN_KEYS)) {
      const list = splitRatingCell(row[col])
      if (list.length) tags[key] = list
    }
    out.push({
      category: String(row["产品类别"] ?? "").trim(),
      product_line: String(row["产品线"] ?? "").trim(),
      product_name: productName,
      module_name: String(row["模块名称"] ?? "").trim(),
      module_func: String(row["模块功能"] ?? "").trim(),
      description: String(row["说明"] ?? "").trim(),
      charge_mode: String(row["计费方式"] ?? "").trim() || "模块授权",
      unit_price: Number(row["单价"]) || 0,
      status: String(row["状态"] ?? "").trim() || "在售",
      rating_tags: tags,
    })
  }
  return out
}

/** 客户清单 xlsx：取每行第一个非空单元格文本作为条目 */
export async function parseCustomerLinesFile(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const lines: string[] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })
    for (const row of rawRows) {
      if (!Array.isArray(row)) continue
      const first = row.find((cell) => String(cell ?? "").trim() !== "")
      const text = String(first ?? "").trim()
      if (text) lines.push(text)
    }
    if (lines.length) break
  }
  return lines
}

export const TECH_PARAM_SHEET_HEADERS = [
  "产品类别",
  "产品线",
  "产品名",
  "模块名",
  "参数名",
  "参数值",
  "参数说明",
  "竞品备注",
]

/**
 * 参数响应表导出（轮次 E-3）：勾选产品逐参数一行，产品基础信息逐行重复。
 * 未配参数的产品不进入导出，返回 { exported, skipped } 供调用方 toast 提示。
 */
export function exportTechParamsXlsx(rows: CheckProduct[]): { exported: number; skipped: number } {
  const withParams = (rows ?? []).filter((p) => (p.tech_params ?? []).length > 0)
  const skipped = (rows?.length ?? 0) - withParams.length
  if (!withParams.length) return { exported: 0, skipped }
  const aoa: (string | number)[][] = [TECH_PARAM_SHEET_HEADERS]
  for (const p of withParams) {
    for (const t of p.tech_params ?? []) {
      aoa.push([
        p.category || "",
        p.product_line || "",
        p.product_name || "",
        p.module_name || "",
        t.param_name ?? "",
        t.param_value ?? "",
        p.module_func || "",
        t.competitor_note ?? "",
      ])
    }
  }
  downloadWorkbook(XLSX.utils.aoa_to_sheet(aoa), "产品参数响应表.xlsx")
  return { exported: withParams.length, skipped }
}

/** 清单导出：按类别分组 + 分组小计 + 总计 */
export function exportChecklistXlsx(rec: ChecklistRecord) {
  const lines = (rec.items ?? []).filter((l) => l.checked !== false)
  const groups = new Map<string, ChecklistLine[]>()
  for (const line of lines) {
    const key = line.category || "未分类"
    groups.set(key, [...(groups.get(key) ?? []), line])
  }
  const aoa: (string | number)[][] = [
    [rec.checklist_name],
    [`客户医院：${rec.hospital || "未填"}`, `评级目标：${targetsLabel(rec.rating_targets)}`],
    [],
    ["类别", "产品/系统", "模块", "来源", "数量", "单位", "单价", "小计", "评级关联", "备注"],
  ]
  for (const [category, groupLines] of groups) {
    aoa.push([`【${category}】`])
    for (const l of groupLines) {
      aoa.push([
        category,
        l.product_name,
        l.module_name || l.module_func,
        l.source === "external" ? "外购" : "我公司",
        l.qty,
        l.unit,
        l.unit_price,
        l.qty * l.unit_price,
        targetsLabel(l.rating_hits),
        l.remark,
      ])
    }
    const subtotal = groupLines.reduce((s, l) => s + l.qty * l.unit_price, 0)
    aoa.push(["", "", "", "小计", "", "", "", subtotal, "", ""])
  }
  aoa.push([])
  aoa.push(["合计", "", "", "", "", "", "", calcTotal(lines), "", ""])
  aoa.push([fmtMoney(calcTotal(lines))])
  downloadWorkbook(XLSX.utils.aoa_to_sheet(aoa), `${rec.checklist_name}.xlsx`)
}
