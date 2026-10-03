export type CsvCell = string | number | null | undefined

/** 单元格转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍（RFC 4180）。 */
function escapeCell(v: CsvCell): string {
  let s = String(v ?? "")
  // CWE-1236 公式注入防护：以 = + - @ 或制表/回车开头的文本单元格加前导单引号，防在 Excel 被当公式/DDE 执行（数字类型不劫持，保持负数为合法数值）
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * 纯函数：把表头 + 行数组拼成 UTF-8 BOM、CRLF 换行的 CSV 文本（Excel 兼容）。
 * 不落盘、不弹窗，供下载包装（exportToCsv）与需要自定义文件名/下载方式的调用方
 * （如竞品能力矩阵的转置导出）共用同一转义口径，避免各自手抄 join(",") 漏转义致窜列。
 */
export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))]
  return "\uFEFF" + lines.join("\r\n")
}
