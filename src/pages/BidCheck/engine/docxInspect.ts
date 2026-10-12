// ---------------------------------------------------------------------------
// docxInspect —— 只读解包 → 结构化文档树 + 元数据/结构事实（DocContext）。
//
// ⚠️ 本模块只读：仅 unzip 提取 + 正则解析 OOXML 部件，绝不修改、绝不重打包、绝不写回原文件。
//    （与 FormatTool/refreshDocx 共用 fflate 解包能力，但逻辑严格分离：那边改样式，这边只检测。）
//
// 可测性：核心解析纯函数 buildDocContextFromParts(parts, paths, ...) 接受「部件路径→XML 文本」映射，
//   单测无需真实 docx 即可喂手写 OOXML 字符串验证 A/B 类事实提取。
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from "fflate"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import type { CheckChapter, DocContext, DocMeta, PageMargins, Paragraph } from "../bidCheckTypes"

// ---- 通用文本 / 标签工具 ------------------------------------------------

/** 取一段 XML 内所有指定标签的文本内容（如 w:t） */
function collectTagText(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const raw = m[1] ?? ""
    if (raw) out.push(decodeXmlEntities(raw))
  }
  return out
}

/** 去标签 + 实体还原 → 纯文本（用于页眉页脚 / 属性文本提取） */
function stripTags(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, ""))
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_all, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** 从 core.xml / app.xml 取某标签首次出现的文本 */
function firstTagText(xml: string, localName: string): string {
  const re = new RegExp(`<${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</${localName}>`, "i")
  const m = re.exec(xml)
  return m ? decodeXmlEntities(m[1] ?? "").trim() : ""
}

/** 收集去重、非空的正则捕获组 */
function distinctMatches(xml: string, re: RegExp, group: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")
  while ((m = r.exec(xml))) {
    const v = (m[group] ?? "").trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

// ---- 正文 → 段落 / 章节切分（R262 三栏界面：段落携带定位锚点 + 表格/图片边界）----

/** 收集 document.xml 中所有顶层表格 [start,end) 区间（栈式扫描，正确处理嵌套 <w:tbl>） */
function collectTableRanges(documentXml: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  const tokenRe = /<w:tbl\b|<\/w:tbl>/g
  let depth = 0
  let start = 0
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(documentXml))) {
    if (m[0] === "</w:tbl>") {
      depth -= 1
      if (depth === 0) ranges.push({ start, end: m.index + m[0].length })
    } else {
      if (depth === 0) start = m.index
      depth += 1
    }
  }
  return ranges
}

/** 从 document.xml 提取段落序列（标题 / 正文），并识别标题、表格归属、是否含图片 */
export function extractParagraphs(documentXml: string): Paragraph[] {
  const paras: Paragraph[] = []
  const tableRanges = collectTableRanges(documentXml)
  const re = /<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(documentXml))) {
    const chunk = m[0]
    const text = collectTagText(chunk, "w:t").join("")
    const isHeading =
      /<w:pStyle\b[^>]*w:val="[^"]*Heading/i.test(chunk) ||
      /<w:pStyle\b[^>]*w:val="[1-9]"/.test(chunk) ||
      /<w:outlineLvl\b[^>]*w:val="[0-5]"/.test(chunk)
    if (!(text.trim() || isHeading)) continue
    // 表格归属：段落起点落在哪个顶层表格区间内
    let inTable = false
    let tableIndex: number | undefined
    for (let ti = 0; ti < tableRanges.length; ti += 1) {
      const r = tableRanges[ti]
      if (m.index >= r.start && m.index < r.end) {
        inTable = true
        tableIndex = ti
        break
      }
    }
    const hasImage = /<w:drawing\b|<w:pict\b|<w:imagedata\b|<w:object\b/.test(chunk)
    paras.push({ text, heading: isHeading, index: paras.length, inTable, tableIndex, hasImage })
  }
  return paras
}

/**
 * 段落序列 → 章节数组 + 段落→章节映射（T-3）。
 * chapterOf[i] = 段落 i 所属 chapters 下标（长度 = paras.length），供定位换算用，
 * 避免从 chapters[i].content 字符串 indexOf 反查（重复句会定位到错误章节）。
 */
export function parasToChapters(paras: Paragraph[]): { chapters: CheckChapter[]; chapterOf: number[] } {
  const raw: CheckChapter[] = [{ title: "（开头）", content: "" }]
  const chapterOf = new Array<number>(paras.length).fill(0)
  let cur = 0
  for (let i = 0; i < paras.length; i += 1) {
    const p = paras[i]
    if (p.heading) {
      raw.push({ title: p.text.trim() || "（无题）", content: "" })
      cur = raw.length - 1
    } else {
      const c = raw[cur]
      c.content += (c.content ? "\n" : "") + p.text
    }
    chapterOf[i] = cur
  }
  // 剔除空的「（开头）」并把 chapterOf 重映射到过滤后的下标
  const oldToNew = new Map<number, number>()
  const chapters: CheckChapter[] = []
  raw.forEach((c, oi) => {
    if (c.title !== "（开头）" || c.content.trim()) {
      oldToNew.set(oi, chapters.length)
      chapters.push(c)
    }
  })
  for (let i = 0; i < chapterOf.length; i += 1) chapterOf[i] = oldToNew.get(chapterOf[i]) ?? 0
  return { chapters, chapterOf }
}

/**
 * 由章节数组合成段落序列 + chapterOf（项目正文输入：无 docx 包，正文按行拆段）。
 * 每章先出一条标题段，再按换行拆正文段；chapterOf 直接映射回入参 chapters 下标。
 */
export function paragraphsFromChapters(chapters: CheckChapter[]): { paragraphs: Paragraph[]; chapterOf: number[] } {
  const paragraphs: Paragraph[] = []
  const chapterOf: number[] = []
  chapters.forEach((c, ci) => {
    paragraphs.push({ text: c.title, heading: true, index: paragraphs.length, inTable: false, hasImage: false })
    chapterOf.push(ci)
    for (const line of (c.content || "").split(/\r?\n/)) {
      if (!line.trim()) continue
      paragraphs.push({ text: line, heading: false, index: paragraphs.length, inTable: false, hasImage: false })
      chapterOf.push(ci)
    }
  })
  return { paragraphs, chapterOf }
}

// ---- 页面 / 结构事实提取 ------------------------------------------------

const TWIPS_PER_CM = 567

function parseMargins(documentXml: string): PageMargins | null {
  const m = /<w:pgMar\b([^>]*)\/>/.exec(documentXml)
  if (!m) return null
  const attrs = m[1] ?? ""
  const attr = (name: string): number | null => {
    const r = new RegExp(`w:${name}="(\\d+)"`).exec(attrs)
    return r ? Number(r[1]) / TWIPS_PER_CM : null
  }
  const top = attr("top")
  const right = attr("right")
  const bottom = attr("bottom")
  const left = attr("left")
  if (top == null || right == null || bottom == null || left == null) return null
  return { top: round2(top), right: round2(right), bottom: round2(bottom), left: round2(left) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 空 DocMeta（无包时：项目正文 / PDF 文本路径，L5-B 节点项将标 skipped） */
export function emptyMeta(): DocMeta {
  return {
    available: false,
    creator: "",
    lastModifiedBy: "",
    title: "",
    subject: "",
    keywords: "",
    company: "",
    manager: "",
    hasComments: false,
    commentAuthors: [],
    hasHiddenText: false,
    revisionIns: 0,
    revisionDel: 0,
    bookmarkNames: [],
    headerFooterText: "",
    hasProtection: false,
    hasWatermark: false,
    hasCustomXml: false,
    fontsUsed: [],
    sizesUsed: [],
    lineSpacings: [],
    lineSpacingsDetail: [],
    margins: null,
    hasPageNumber: false,
    pageEstimate: 0,
    imageCount: 0,
    pdfMetadata: {},
  }
}

/**
 * 纯函数：从 OOXML 部件文本映射构建 DocContext（只读）。
 * @param sourceName 文件名
 * @param parts      关键部件路径→XML 文本（缺省即视为该部件不存在）
 * @param paths      zip 全部条目路径（用于 customXml / media / 水印判断）
 */
export function buildDocContextFromParts(
  sourceName: string,
  parts: Record<string, string>,
  paths: string[],
): DocContext {
  const documentXml = parts["word/document.xml"] ?? ""
  const paras = extractParagraphs(documentXml)
  const { chapters, chapterOf } = parasToChapters(paras)
  const fullText = chapters.map((c) => `${c.title}\n${c.content}`).join("\n")

  const meta = emptyMeta()
  meta.available = true

  const coreXml = parts["docProps/core.xml"] ?? ""
  meta.creator = firstTagText(coreXml, "dc:creator")
  meta.lastModifiedBy = firstTagText(coreXml, "cp:lastModifiedBy")
  meta.title = firstTagText(coreXml, "dc:title")
  meta.subject = firstTagText(coreXml, "dc:subject")
  meta.keywords = firstTagText(coreXml, "cp:keywords")

  const appXml = parts["docProps/app.xml"] ?? ""
  meta.company = firstTagText(appXml, "Company")
  meta.manager = firstTagText(appXml, "Manager")

  const commentsXml = parts["word/comments.xml"]
  meta.hasComments = !!commentsXml
  meta.commentAuthors = commentsXml ? distinctMatches(commentsXml, /<w:comment\b[^>]*w:author="([^"]*)"/, 1) : []

  meta.hasHiddenText = /<w:vanish\b/.test(documentXml)
  meta.revisionIns = (documentXml.match(/<w:ins\b/g) || []).length
  meta.revisionDel = (documentXml.match(/<w:del\b/g) || []).length
  meta.bookmarkNames = distinctMatches(documentXml, /<w:bookmarkStart\b[^>]*w:name="([^"]*)"/, 1)

  const hfPaths = paths.filter((p) => /^word\/(header|footer)\d*\.xml$/.test(p))
  meta.headerFooterText = hfPaths.map((p) => stripTags(parts[p] ?? "")).join("\n").trim()

  const settingsXml = parts["word/settings.xml"] ?? ""
  meta.hasProtection = /<w:documentProtection\b/.test(settingsXml)
  meta.hasWatermark = /watermark/i.test(documentXml + hfPaths.map((p) => parts[p] ?? "").join(""))

  meta.hasCustomXml = paths.some((p) => p.startsWith("customXml/")) || /<w:dataBinding\b/.test(documentXml)

  meta.fontsUsed = distinctMatches(documentXml, /<w:rFonts\b[^>]*w:eastAsia="([^"]+)"/, 1)
  meta.sizesUsed = distinctMatches(documentXml, /<w:sz\b[^>]*w:val="([^"]+)"/, 1)
  meta.lineSpacings = distinctMatches(
    documentXml,
    /<w:spacing\b[^>]*w:line="(\d+)"[^>]*w:lineRule="([^"]+)"/,
    1,
  )
  // 行距配对详情（R269 L1-14）：捕获每个 w:spacing 的 (w:line, w:lineRule) 并去重；缺 lineRule 依 ECMA-376 默认 auto
  {
    const seen: Set<string> = new Set()
    const els = documentXml.match(/<w:spacing\b[^>]*\/?>/g) ?? []
    for (const el of els) {
      const lineM = /w:line="(\d+)"/.exec(el)
      if (!lineM) continue
      const ruleM = /w:lineRule="([^"]+)"/.exec(el)
      const ln = lineM[1]
      const rule = (ruleM?.[1] ?? "auto").trim()
      const key = `${ln}:${rule}`
      if (!seen.has(key)) {
        seen.add(key)
        meta.lineSpacingsDetail.push({ line: ln, rule })
      }
    }
  }
  meta.margins = parseMargins(documentXml)

  meta.hasPageNumber =
    /<w:fldChar\b/.test(hfPaths.map((p) => parts[p] ?? "").join("")) ||
    /instrText[^>]*>\s*PAGE/i.test(documentXml + hfPaths.map((p) => parts[p] ?? "").join("")) ||
    /<w:pgNumType\b/.test(documentXml)

  meta.imageCount = paths.filter((p) => /^word\/media\//.test(p)).length
  meta.pageEstimate = estimatePages(fullText)

  return {
    sourceName,
    inputKind: "file",
    hasPackage: true,
    chapters,
    paragraphs: paras,
    chapterOf,
    fullText,
    meta,
  }
}

/** 粗估页数：正文字数 / 每页字数（A4 满版约 1000 字/页），仅用于页数提示，不宣称精确 */
export function estimatePages(text: string): number {
  const chars = (text || "").replace(/\s+/g, "").length
  if (!chars) return 0
  return Math.max(1, Math.ceil(chars / 1000))
}

// ---- 文件入口（浏览器 File → DocContext）--------------------------------

/** 上传 docx：fflate 解包（只读）→ 关键部件文本 → DocContext */
export async function inspectDocxFile(file: File): Promise<DocContext> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const paths = Object.keys(zip)
  const wanted = [
    "word/document.xml",
    "word/settings.xml",
    "word/comments.xml",
    "docProps/core.xml",
    "docProps/app.xml",
  ]
  const parts: Record<string, string> = {}
  for (const p of wanted) if (zip[p]) parts[p] = strFromU8(zip[p])
  for (const p of paths) {
    if (/^word\/(header|footer)\d*\.xml$/.test(p) && zip[p]) parts[p] = strFromU8(zip[p])
  }
  return buildDocContextFromParts(file.name, parts, paths)
}

/** 上传 pdf：抽正文文本 + getMetadata 元数据（无 OOXML 节点，meta.available=false 但填 pdfMetadata） */
export async function inspectPdfFile(file: File): Promise<DocContext> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise

  let text = ""
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    text += tc.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ") + "\n"
  }

  const meta = emptyMeta()
  try {
    const md = (await doc.getMetadata()) as unknown as { info?: Record<string, unknown> }
    const info = md?.info ?? {}
    const pick = (k: string): string => (typeof info[k] === "string" ? (info[k] as string) : "")
    meta.creator = pick("Author")
    meta.lastModifiedBy = pick("ModDate")
    meta.title = pick("Title")
    meta.subject = pick("Subject")
    meta.company = pick("Creator")
    for (const k of Object.keys(info)) {
      const v = info[k]
      if (typeof v === "string" && v.trim()) meta.pdfMetadata[k] = v.trim()
    }
  } catch {
    /* PDF 元数据读取失败不影响正文检查 */
  }
  meta.pageEstimate = doc.numPages
  meta.available = false // 非 OOXML 包，节点级痕迹无法直接取；文本类仍全跑

  // PDF 无段落边界：按行合成段落，全部归入唯一「全文」章（chapterOf 全 0）
  const pdfChapters: CheckChapter[] = [{ title: "全文", content: text }]
  const { paragraphs, chapterOf } = paragraphsFromChapters(pdfChapters)

  return {
    sourceName: file.name,
    inputKind: "file",
    hasPackage: false,
    chapters: pdfChapters,
    paragraphs,
    chapterOf,
    fullText: text,
    meta,
  }
}

/** 按扩展名分派；其它类型抛用户可读文案 */
export async function inspectFile(file: File): Promise<DocContext> {
  const lower = (file.name || "").toLowerCase()
  if (lower.endsWith(".docx")) return inspectDocxFile(file)
  if (lower.endsWith(".pdf")) return inspectPdfFile(file)
  throw new Error("暂仅支持 .docx 与 .pdf 文件，请上传其一")
}
