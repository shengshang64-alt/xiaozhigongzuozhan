// 情报清单导出（循环 7 C3）：把当前已加载的情报条目导出为 xlsx。
// 独立于 PptQuote 域的 quoteExports.ts，本文件只服务情报中心，避免跨域耦合。

import * as XLSX from "xlsx"

/** 导出所需的最小行结构（IntelItemRow 结构化兼容，调用方直接传列表） */
export interface IntelExportRow {
  title: string
  source_name: string
  published_at: string
  created: string
  tags: string[]
  summary: string
  url: string
}

function fmtExportTime(iso: string): string {
  const raw = (iso ?? "").trim()
  if (!raw) return ""
  return raw.replace("T", " ").slice(0, 16)
}

function safeExportFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
}

/** 导出情报清单 xlsx，返回实际导出条数 */
export function exportIntelItemsXlsx(rows: IntelExportRow[]): number {
  const aoa: (string | number)[][] = [
    ["标题", "来源", "时间", "标签", "摘要", "链接"],
    ...rows.map((r) => [
      r.title ?? "",
      r.source_name ?? "",
      fmtExportTime(r.published_at || r.created),
      Array.isArray(r.tags) ? r.tags.join("、") : "",
      r.summary ?? "",
      r.url ?? "",
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = [{ wch: 44 }, { wch: 16 }, { wch: 17 }, { wch: 24 }, { wch: 60 }, { wch: 48 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "情报清单")
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  XLSX.writeFile(wb, `${safeExportFileName(`情报清单-${dateStr}`)}.xlsx`)
  return rows.length
}
