import { extractDocxTables } from "@/lib/docxTableExtract"

// ---------------------------------------------------------------------------
// 建设要求文件 → 正文 + 表格。复用标书工作台已有的 Word/PDF 解析，不新引依赖。
// 本模块只负责读文件；条目拆分见 requirementExtract.ts（纯函数、可离线单测）。
// ---------------------------------------------------------------------------

export type RequirementFileRaw = {
  fileName: string
  ext: "docx" | "pdf" | "txt" | "md"
  text: string
  tables: string[][][]
}

export function isRequirementDocFile(name: string): boolean {
  return /\.(docx|pdf|txt|md)$/i.test(name)
}

export async function readRequirementFile(file: File): Promise<RequirementFileRaw> {
  const fileName = file.name || "未命名材料"
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const text = (await file.text()).trim()
    if (!text) throw new Error("文件内容为空")
    return { fileName, ext: lower.endsWith(".md") ? "md" : "txt", text, tables: [] }
  }
  const bidFiles = await import("@/pages/BidWorkspace/bidFiles")
  if (lower.endsWith(".docx")) {
    const text = (await bidFiles.extractTenderFileText(file)).trim()
    const tables = extractDocxTables(new Uint8Array(await file.arrayBuffer())).map((t) => t.rows)
    if (!text && !tables.length) throw new Error("Word 中没有解析出文本或表格")
    return { fileName, ext: "docx", text, tables }
  }
  if (lower.endsWith(".pdf")) {
    const text = (await bidFiles.extractTenderFileText(file)).trim()
    if (!text) throw new Error("PDF 中没有解析出文本（可能是扫描件），请改用 Word 或粘贴文本")
    return { fileName, ext: "pdf", text, tables: [] }
  }
  throw new Error("暂不支持该格式。请上传 .docx / .pdf / .txt，Excel 请走「上传 Excel」向导")
}
