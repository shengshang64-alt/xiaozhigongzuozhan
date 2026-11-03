/**
 * 评级覆盖清单导出（2026-10-29）
 *
 * 对应用户需求：
 *   1) 导出的公司清单一律按「评级先筛 → 客户要求补充 → 明确归属」的顺序组织；
 *   2) 评级必选项强制体现（建议=必选）；
 *   3) 每行标明归属：公司 / 三方 / 自定义。
 *
 * 版式对齐用户手工 Excel：
 *   Sheet1「评级覆盖清单」= 产品归属|产品类别|产品名称|模块分类|模块名称|评级|建议|归属|来源|客户清单条目
 *   Sheet2「评级统计」= 各维度条数
 *   Sheet3「待确认」= 评级可选但客户未提及的条目（供人工判断要不要砍）
 */
import * as XLSX from "xlsx-js-style"
import type { RatingCoverageRow, RatingSelection } from "./ratingCoverage"
import { coverageStats, ratingSelectionText } from "./ratingCoverage"

export const RATING_COVERAGE_HEADERS = [
  "产品归属",
  "产品类别",
  "产品名称",
  "模块分类",
  "模块名称",
  "评级要求",
  "建议",
  "归属",
  "来源",
  "客户清单条目",
]

const SOURCE_LABEL: Record<RatingCoverageRow["source"], string> = {
  "rating-required": "评级必选",
  customer: "客户清单",
  "rating-optional": "评级可选",
}

/** 归属色（公司=绿 / 三方=橙 / 自定义=紫），与界面徽标同色系 */
const KIND_FILL: Record<RatingCoverageRow["kind"], string> = {
  公司: "FFECFDF5",
  三方: "FFFFF7ED",
  自定义: "FFF5F3FF",
}

export function buildRatingCoverageAoa(
  rows: RatingCoverageRow[],
  sel: RatingSelection,
): (string | number)[][] {
  const selText = ratingSelectionText(sel) || "未指定评级（仅按客户清单+全量公司目录）"
  const aoa: (string | number)[][] = [
    ["评级覆盖清单"],
    [`评级要求：${selText} · 共 ${rows.length} 项`],
    RATING_COVERAGE_HEADERS,
  ]
  for (const r of rows) {
    aoa.push([
      r.productBelong,
      r.category,
      r.productName,
      r.moduleCategory,
      r.moduleName,
      r.ratingText,
      r.recommendation || (r.required ? "必选" : ""),
      r.kind,
      SOURCE_LABEL[r.source],
      r.customerItems.join("、"),
    ])
  }
  return aoa
}

export function exportRatingCoverageXlsx(
  rows: RatingCoverageRow[],
  sel: RatingSelection,
  fileName = "产品映射-评级覆盖清单.xlsx",
): number {
  const aoa = buildRatingCoverageAoa(rows, sel)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const colCount = RATING_COVERAGE_HEADERS.length
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
  ]
  const kindCol = RATING_COVERAGE_HEADERS.indexOf("归属")
  const srcCol = RATING_COVERAGE_HEADERS.indexOf("来源")
  const recCol = RATING_COVERAGE_HEADERS.indexOf("建议")
  // 表头加粗
  for (let c = 0; c < colCount; c += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c })]
    if (!cell) continue
    cell.s = { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFF3F4F6" } } }
  }
  // 数据行着色：归属淡色 + 评级必选加粗
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const excelRow = 3 + i
    const kCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: kindCol })]
    if (kCell) kCell.s = { fill: { patternType: "solid", fgColor: { rgb: KIND_FILL[r.kind] } }, alignment: { horizontal: "center" } }
    const req = r.required || r.source === "rating-required"
    if (req) {
      const rCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: recCol })]
      if (rCell) rCell.s = { font: { bold: true, color: { rgb: "FFB91C1C" } }, alignment: { horizontal: "center" } }
      const sCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: srcCol })]
      if (sCell) sCell.s = { font: { bold: true }, alignment: { horizontal: "center" } }
    }
  }
  ws["!cols"] = [
    { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 26 },
    { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 42 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "评级覆盖清单")

  // 统计页
  const st = coverageStats(rows)
  const selText = ratingSelectionText(sel) || "未指定评级"
  const statsAoa: (string | number)[][] = [
    ["评级覆盖统计"],
    [`评级要求：${selText}`],
    ["维度", "条数"],
    ["合计", st.total],
    ["评级必选（不可缺）", st.required],
    ["归属：公司", st.company],
    ["归属：三方", st.thirdparty],
    ["归属：自定义", st.custom],
    ["客户清单已覆盖", st.coveredByCustomer],
    ["评级可选/客户未提及", st.total - st.coveredByCustomer - st.required],
  ]
  const wsStats = XLSX.utils.aoa_to_sheet(statsAoa)
  wsStats["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }]
  wsStats["!cols"] = [{ wch: 26 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsStats, "评级统计")

  // 待确认页：评级可选、且客户清单没提到 —— 这些是「可以砍」的候选
  const pending = rows.filter((r) => !r.coveredByCustomer && !r.required)
  const pendingAoa: (string | number)[][] = [
    ["评级可选、客户清单未提及（可评估是否砍掉）"],
    [],
    ["产品类别", "产品名称", "模块分类", "模块名称", "评级要求", "归属"],
    ...pending.map((r) => [r.category, r.productName, r.moduleCategory, r.moduleName, r.ratingText, r.kind] as (string | number)[]),
  ]
  const wsPending = XLSX.utils.aoa_to_sheet(pendingAoa)
  wsPending["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }]
  wsPending["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 26 }, { wch: 24 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, wsPending, "待确认")

  XLSX.writeFile(wb, fileName)
  return rows.length
}
