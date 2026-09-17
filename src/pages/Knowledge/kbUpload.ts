// 知识库上传解析：.md/.markdown/.txt 直接入库，.docx/.pdf 本地转文本，
// .zip 客户端解压（fflate）取其中 md/txt 批量入库并保留相对路径为目录。
// 全部在浏览器内完成，不上传原文件。

import { extractDocxText, extractPdfText } from "@/pages/BidWorkspace/bidFiles"

export interface KbUploadItem {
  title: string
  content: string
  doc_format: string
  folder_path: string
  source_file_name: string
}

const TEXT_EXT_RE = /\.(md|markdown|txt)$/i
const JOIN_SEP = "/"

function joinFolder(base: string, sub: string): string {
  const parts = [base.trim(), sub.trim()].filter(Boolean).map((p) => p.replace(/^\/+|\/+$/g, ""))
  return parts.filter(Boolean).join(JOIN_SEP)
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.(md|markdown|txt|docx|pdf)$/i, "").trim() || fileName
}

function dirOfPath(entryPath: string): string {
  const idx = entryPath.lastIndexOf("/")
  return idx > 0 ? entryPath.slice(0, idx) : ""
}

function isJunkEntry(entryPath: string): boolean {
  return entryPath.split("/").some((seg) => seg.startsWith(".") || seg === "__MACOSX")
}

async function readTextFile(file: File): Promise<string> {
  return (await file.text()).trim()
}

/** 解析单个文件为一个或多个入库条目；不支持的格式抛中文错误 */
export async function parseUploadFile(file: File, baseFolder: string): Promise<KbUploadItem[]> {
  const fileName = file.name
  const lower = fileName.toLowerCase()
  if (isJunkEntry(fileName)) throw new Error("系统隐藏文件，已跳过")

  if (TEXT_EXT_RE.test(lower)) {
    const content = await readTextFile(file)
    if (!content) throw new Error("文件内容为空")
    return [
      {
        title: titleFromFileName(fileName),
        content,
        doc_format: lower.endsWith(".txt") ? "txt" : "md",
        folder_path: baseFolder,
        source_file_name: fileName,
      },
    ]
  }

  if (lower.endsWith(".docx")) {
    const content = await extractDocxText(file)
    if (!content) throw new Error("docx 中没有解析出文本")
    return [
      {
        title: titleFromFileName(fileName),
        content,
        doc_format: "docx",
        folder_path: baseFolder,
        source_file_name: fileName,
      },
    ]
  }

  if (lower.endsWith(".pdf")) {
    const content = await extractPdfText(file)
    if (!content) throw new Error("pdf 中没有解析出文本（可能是扫描件）")
    return [
      {
        title: titleFromFileName(fileName),
        content,
        doc_format: "pdf",
        folder_path: baseFolder,
        source_file_name: fileName,
      },
    ]
  }

  if (lower.endsWith(".zip")) {
    const { unzipSync, strFromU8 } = await import("fflate")
    const buf = new Uint8Array(await file.arrayBuffer())
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(buf)
    } catch {
      throw new Error("zip 解压失败（可能加密或已损坏）")
    }
    const items: KbUploadItem[] = []
    for (const [entryPath, data] of Object.entries(entries)) {
      if (entryPath.endsWith("/") || isJunkEntry(entryPath)) continue
      if (!TEXT_EXT_RE.test(entryPath)) continue
      const content = strFromU8(data).trim()
      if (!content) continue
      const baseName = entryPath.slice(entryPath.lastIndexOf("/") + 1)
      items.push({
        title: titleFromFileName(baseName),
        content,
        doc_format: entryPath.toLowerCase().endsWith(".txt") ? "txt" : "md",
        folder_path: joinFolder(baseFolder, dirOfPath(entryPath)),
        source_file_name: fileName,
      })
    }
    if (items.length === 0) throw new Error("zip 内没有 .md/.markdown/.txt 文档")
    return items
  }

  throw new Error("暂不支持该格式（支持 md/markdown/txt/docx/pdf/zip）")
}

export function isSupportedUpload(fileName: string): boolean {
  return /\.(md|markdown|txt|docx|pdf|zip)$/i.test(fileName)
}
