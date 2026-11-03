import { toast } from "sonner"
import { buildCsv } from "@/lib/csv"
import { triggerBlobDownload } from "@/lib/download"

/**
 * 轻量 CSV 导出工具：将表头 + 行数组拼成 UTF-8 BOM CSV 并触发浏览器下载。
 * 转义/BOM/CRLF 口径统一走 @/lib/csv 的 buildCsv，与竞品矩阵等自定义下载导出同源。
 */
export function exportToCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" })
  triggerBlobDownload(blob, filename)
  toast.success(`已导出 ${rows.length} 条记录`)
}
