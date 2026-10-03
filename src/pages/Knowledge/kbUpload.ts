// 知识库上传解析：.md/.markdown/.txt 直接入库，.docx/.pdf 本地转文本，
// .zip 客户端解压（fflate）取其中 md/txt 批量入库并保留相对路径为目录。
// 全部在浏览器内完成，不上传原文件。


export interface KbUploadItem {
  title: string
  content: string
  doc_format: string
  folder_path: string
  source_file_name: string
}

const TEXT_EXT_RE = /\.(md|markdown|txt)$/i
const JOIN_SEP = "/"

/** XML 实体解码（先剥标签再解码，避免正文里的 &lt; 被误当标签删） */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** pptx：fflate 选择性 inflate 只取各 slide 的 <a:t> 文本（不解压 ppt/media 图片，防巨型 deck OOM） */
async function extractPptxText(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate")
  const buf = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    // filter 让 fflate 只解压幻灯片 XML，跳过图片/媒体，200MB 级 deck 也不会整包解压 OOM
    entries = unzipSync(buf, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) })
  } catch {
    throw new Error("pptx 解压失败（可能加密或已损坏）")
  }
  const keys = Object.keys(entries)
    .sort((a, b) => (parseInt(a.match(/(\d+)/)?.[1] ?? "0") - parseInt(b.match(/(\d+)/)?.[1] ?? "0")))
  const out: string[] = []
  for (const k of keys) {
    const xml = strFromU8(entries[k])
    // a:t 后只允许空白+属性或紧邻 >，避免把 <a:tx>/<a:tbl>/<a:txBody> 等兄弟标签误当开标签
    const runs = xml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) ?? []
    const txt = runs
      .map((s) => decodeXmlEntities(s.replace(/^<a:t(?:\s[^>]*)?>/, "").replace(/<\/a:t>$/, "")))
      .join(" ")
      .trim()
    if (txt) out.push(txt)
  }
  return out.join("\n")
}

/** xls/xlsx：SheetJS 逐表转 CSV */
async function extractXlsxText(file: File): Promise<string> {
  const XLSX = await import("xlsx")
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
  const out: string[] = []
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    if (csv.trim()) out.push(`【工作表 ${name}】\n${csv}`)
  }
  return out.join("\n")
}

function joinFolder(base: string, sub: string): string {
  const parts = [base.trim(), sub.trim()].filter(Boolean).map((p) => p.replace(/^\/+|\/+$/g, ""))
  return parts.filter(Boolean).join(JOIN_SEP)
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.(md|markdown|txt|docx|pdf|pptx|xls|xlsx)$/i, "").trim() || fileName
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
    const content = await (await import("@/pages/BidWorkspace/bidFiles")).extractDocxText(file)
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
    const content = await (await import("@/pages/BidWorkspace/bidFiles")).extractPdfText(file)
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

  if (lower.endsWith(".pptx")) {
    const content = await extractPptxText(file)
    if (!content) throw new Error("pptx 中没有解析出文本（可能是纯图片演示）")
    return [
      {
        title: titleFromFileName(fileName),
        content,
        doc_format: "pptx",
        folder_path: baseFolder,
        source_file_name: fileName,
      },
    ]
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const content = await extractXlsxText(file)
    if (!content) throw new Error("表格中没有解析出内容")
    return [
      {
        title: titleFromFileName(fileName),
        content,
        doc_format: lower.endsWith(".xls") ? "xls" : "xlsx",
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
  return /\.(md|markdown|txt|docx|pdf|pptx|xls|xlsx|zip)$/i.test(fileName)
}
