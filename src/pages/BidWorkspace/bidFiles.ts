import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { buildFigureSvg, tokenPalette } from "@/components/bid-workspace/BidFigure"
import { renderMermaidToSvg } from "./mermaidFigure"
import type { Chapter, FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import { DOCX_SIZE_HALFPT } from "./bidFormatConstants"
import { triggerBlobDownload } from "@/lib/download"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import {
  CLAUSE_GRANULARITY_LABEL,
  RESPONSE_LEVEL_LABEL,
  REVIEW_STATUS_LABEL,
  SEVERITY_LABEL,
  VOID_STATUS_LABEL,
  effectiveVoidStatus,
  isBizPart,
  normalizeBidScope,
  normalizeBasisPlaceholders,
  normalizeDeviationTable,
  parseFixedLineSpacing,
  isRealSectionHeading,
  sanitizeChapterText,
  splitContentFont,
  type BidProjectRecord,
  type DeviationRow,
  type FormatAlign,
  type FormatSettings,
  type HeadingFormat,
} from "./bidTypes"

/** R206 切片 1（R-002）：按内容范围三模式决定导出分册收录哪些章——
 *  biz 仅商务章 / tech 仅技术章 / both 全部（商务骨架章保留占位供线下填写） */
function bidExportChapters(project: BidProjectRecord): Chapter[] {
  const scope = normalizeBidScope(project.gen_options)
  return project.bid_chapters.filter((c) => (scope === "biz" ? isBizPart(c) : scope === "tech" ? !isBizPart(c) : true))
}

/** R206 切片 1：分册标题随内容范围切换 */
function bidVolumeTitle(project: BidProjectRecord): string {
  const scope = normalizeBidScope(project.gen_options)
  return scope === "biz" ? "投标文件（商务标）" : scope === "tech" ? "投标文件（技术标）" : "投标文件"
}

// ---------------------------------------------------------------------------
// 本地文件解析（.docx / .pdf → 纯文本，全部在浏览器内完成，不上传原文件）
// ---------------------------------------------------------------------------

// Q28 切片A（天好 Skill 移植）：页码锚点——仅外部投标文件通道注入 〔P<页码>〕 前缀，
// 招标解析等既有通道默认不带（行为零变化）。纯函数独立可测。
export type PageTagOptions = { pageTag?: boolean }
export const PAGE_TAG_RE = /^〔P(\d+|\?)〕\s?/

/** 给一行加页码前缀；已带前缀的行原样返回（幂等） */
export function tagPageLine(line: string, pageNo: number): string {
  if (PAGE_TAG_RE.test(line)) return line
  return "〔P" + pageNo + "〕 " + line
}

/** 剥离行首页码前缀 */
export function stripPageTag(line: string): string {
  return line.replace(PAGE_TAG_RE, "")
}

/** 取行首页码；无页码（docx/文本通道）或非锚点行返回 null */
export function pageOfLine(line: string): number | null {
  const m = line.match(PAGE_TAG_RE)
  if (!m || m[1] === "?") return null
  return parseInt(m[1], 10)
}

/** 显示/导出渲染：〔P12〕 → 「第 12 页」；〔P?〕 → 「见章节」 */
export function renderPageRefs(s: string): string {
  return s
    .replace(/〔P(\d+)〕/g, "第 $1 页")
    .replace(/〔P\?〕/g, "见章节")
}

/** T-DOCX（2026-09-28 解析审计）：docx 文本提取升级——表格感知。
 * extractRawText 会把表格拆成碎单元格流：竖排表头「投标价格分」逐字拆 5 行、
 * 序号/分值/评分标准的对应关系断裂，AI 解析评分表时极易错位配对（实测东华656 安庆二院
 * 招标文件评分表）。改用 convertToHtml 保留 <table> 结构后转「A | B | C」行文本：
 *  - 表格行：单元格以「 | 」分隔（LLM 读表格的标准形态）
 *  - 竖排单元格：单元格内按换行分隔的片段全部 ≤2 字时判定为竖排字，合并（「投 标 价 格 分」→「投标价格分」）
 *  - 普通段落：textContent 独立成行
 * 消费方：招标文件解析 / 范本资料导入 / 知识库 docx 上传，全部受益。 */
export async function extractDocxText(file: File, opts?: PageTagOptions): Promise<string> {
  const mammoth = await import("mammoth")
  const buf = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer: buf })
  const html = result.value ?? ""
  const parsed = new DOMParser().parseFromString(html, "text/html")

  const decode = (s: string) =>
    s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")

  /** 单元格文本：竖排字合并；普通文本空白折叠。td.textContent 保留换行信息供竖排判定 */
  const cellText = (td: Element): string => {
    const raw = decode(td.textContent ?? "")
    const rows = raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (rows.length > 1 && rows.every((r) => [...r].length <= 2)) return rows.join("") // 竖排：逐字换行
    return raw.replace(/\s+/g, " ").trim()
  }

  const walk = (el: Element) => {
    for (const node of Array.from(el.children)) {
      const tag = node.tagName.toLowerCase()
      if (tag === "table") {
        for (const tr of Array.from(node.querySelectorAll("tr"))) {
          const cells = Array.from(tr.children).map((td) => cellText(td)).filter(Boolean)
          // 相邻重复空列去重（rowspan/colspan 空位）；整行全空跳过
          const cleaned = cells.filter((c, i) => c !== "" || (cells[i - 1] ?? "") !== "")
          if (cleaned.some((c) => c)) lines.push(cleaned.join(" | "))
        }
        lines.push("") // 表格后空行，保持分块边界
      } else if (tag === "br") {
        lines.push("")
      } else if (node.children.length > 0 && node.querySelector("table, p")) {
        walk(node) // 容器递归
      } else {
        const text = decode(node.textContent ?? "").replace(/[ \t]+/g, " ").trim()
        if (text) lines.push(text)
      }
    }
  }

  const lines: string[] = []
  walk(parsed.body)
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  // docx 无物理页：锚点占位 〔P?〕，下游按章节定位（不硬造页码）
  return opts?.pageTag && out ? "〔P?〕 " + out : out
}

/** T-PDF（2026-09-28 解析审计）：把 pdfjs 文本项按几何坐标重建行。
 * 旧实现 join("") 把整页文本粘成一行（实测 466 页招标文件均值 895 字符/行，最长 1588），导致：
 *  ① 页码粘进正文与章节名（「15第三章…」）② 表格行列关系全丢 ③ 评分办法定位器
 * extractScoringSectionExcerpt 的「标题行≤60字/行首第X章」规则全部失效 → 评分章节定位
 * 返回空 → 回退全文分段 → 评分表跨段断裂 → AI 误报「评分办法缺失」。
 * 重建规则：同一 y（±2.5pt）的文本项按 x 排序拼一行；y 变化即换行；空串项丢弃。
 * 表格行识别：同一行内相邻文本项列间距 > 15pt（不同表格列）时以「 | 」拼接——与 docx
 * 表格感知提取（convertToHtml）的竖线行格式统一，使解析提示词的「竖线=表格行」规则两通道一致。 */
export function rebuildPdfLines(items: Array<Record<string, unknown>>): string {
  const frags: Array<{ y: number; x: number; w: number; str: string }> = []
  for (const it of items) {
    const str = it && typeof it === "object" && "str" in it ? String((it as { str?: unknown }).str ?? "") : ""
    if (!str.trim()) continue
    const tr = (it as { transform?: number[] }).transform
    const x = Array.isArray(tr) ? Number(tr[4]) || 0 : 0
    const yRaw = Array.isArray(tr) ? Number(tr[5]) || 0 : 0
    const w = Number((it as { width?: number }).width ?? 0) || 0
    frags.push({ y: Math.round(yRaw * 10) / 10, x, w, str })
  }
  if (!frags.length) return ""
  const ys: number[] = []
  for (const f of frags) if (!ys.includes(f.y)) ys.push(f.y)
  ys.sort((a, b) => b - a) // PDF y 轴向上，从大到小 = 从上到下
  const TOL = 2.5
  const GAP = 15 // 列间距阈值：超过视为不同表格列，用竖线分隔
  const lines: string[] = []
  let lastY: number | null = null
  for (const y of ys) {
    if (lastY !== null && Math.abs(y - lastY) <= TOL) continue // 已被同容差行吸收
    const rowFrags = frags
      .filter((f) => Math.abs(f.y - y) <= TOL)
      .sort((a, b) => a.x - b.x)
    let row = ""
    let prevEnd = -Infinity
    let prevStr = ""
    for (const f of rowFrags) {
      // 重叠去重：部分 PDF 生成器对文字做描边+填充双层渲染，同位置同文本出现两次——跳过重复项
      if (row !== "" && f.x < prevEnd - 1 && (f.str === prevStr || prevStr.includes(f.str) || f.str.includes(prevStr))) {
        continue
      }
      const gap = f.x - prevEnd
      const sep = row === "" ? "" : gap > GAP ? " | " : " "
      row = row + sep + f.str
      prevEnd = f.x + f.w
      prevStr = f.str
    }
    row = row.replace(/\s+/g, " ").trim()
    if (row) lines.push(row)
    lastY = y
  }
  return lines.join("\n")
}

export async function extractPdfText(file: File, opts?: PageTagOptions): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) })
  const doc = await loadingTask.promise
  const lines: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // T-PDF：几何重建行（保留段落/表格行/页码边界），不再整页粘成一坨
    const pageText = rebuildPdfLines(content.items as unknown as Array<Record<string, unknown>>)
    if (opts?.pageTag) {
      // Q28 切片A：外部标书审查通道逐行加页码锚点，AI 可回写「〔P12〕」定位
      lines.push(
        pageText
          .split("\n")
          .map((l) => tagPageLine(l, i))
          .join("\n"),
      )
    } else {
      lines.push(pageText)
    }
  }
  await loadingTask.destroy()
  return lines.join("\n").trim()
}

/** 按扩展名分发解析招标文件；失败抛中文错误并引导改用粘贴文本 */
export async function extractTenderFileText(file: File, opts?: PageTagOptions): Promise<string> {
  const lower = file.name.toLowerCase()
  try {
    if (lower.endsWith(".docx")) return await extractDocxText(file, opts)
    if (lower.endsWith(".pdf")) return await extractPdfText(file, opts)
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return (await file.text()).trim()
    throw new Error("暂不支持该格式")
  } catch (e) {
    const detail = e instanceof Error ? e.message : "未知原因"
    throw new Error(`文件解析失败（${detail}）。支持 .docx / .pdf / .txt；扫描版 PDF 无法提取文字，请改用「粘贴文本」方式导入招标文件内容`, { cause: e })
  }
}

// ---------------------------------------------------------------------------
// Word 导出（投标文件 + 解析 / 检查 / 评标报告，全部前端本地生成）
// ---------------------------------------------------------------------------

/** 第十七轮 17C：页面级导出选项（纸张/页边距 twips、页眉文字、页码页脚、目录域更新提示） */
export type DocxExportOptions = {
  page?: {
    size: { width: number; height: number }
    margin: { top: number; bottom: number; left: number; right: number }
  }
  headerText?: string
  footerPageNumber?: boolean
  /** Q28 切片B：true 时页脚只出裸页码数字（暗标「任何一页不得设页眉页脚，只准出现页码」口径） */
  footerPageNumberBare?: boolean
  /**
   * Q28 切片B：true 时把 docx 内置 Title/Heading1-6/Hyperlink 默认样式颜色压成纯黑。
   * docx 9.x 的 Heading1/2/3 默认 run 色为 2E74B5（蓝），而标题段落只覆盖字号/加粗不覆盖颜色，
   * 暗标「所有文字（含图表）均为黑色」的口径会因此判为不符（评标模块可整块 0 分）。
   */
  allTextBlack?: boolean
  updateFields?: boolean
}

export async function downloadDocx(
  fileName: string,
  children: (Paragraph | Table | TableOfContents)[],
  opts?: DocxExportOptions,
): Promise<void> {
  const songRun = (text: string) =>
    new TextRun({ text, size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })
  const headers = opts?.headerText
    ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [songRun(opts.headerText)] })] }) }
    : undefined
  const footers = opts?.footerPageNumber
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              // Q28 切片B：暗标页脚只准出现页码本身（裸连续阿拉伯数字、底端居中）；非暗标保留「第 X 页」字样
              children: opts.footerPageNumberBare
                ? [new TextRun({ children: [PageNumber.CURRENT], size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })]
                : [new TextRun({ children: ["第 ", PageNumber.CURRENT, " 页"], size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })],
            }),
          ],
        }),
      }
    : undefined
  // Q28 切片B：暗标全黑口径——内置标题/超链接样式默认色改黑；非暗标 styles 不下发，零行为变化
  const blackRun = { color: "000000" }
  const blackStyles = opts?.allTextBlack
    ? {
        default: {
          title: { run: blackRun },
          heading1: { run: blackRun },
          heading2: { run: blackRun },
          heading3: { run: blackRun },
          heading4: { run: blackRun },
          heading5: { run: blackRun },
          heading6: { run: blackRun },
          hyperlink: { run: blackRun },
        },
      }
    : undefined
  const doc = new Document({
    ...(blackStyles ? { styles: blackStyles } : {}),
    ...(opts?.updateFields ? { features: { updateFields: true } } : {}),
    sections: [
      {
        ...(opts?.page ? { properties: { page: { size: opts.page.size, margin: opts.page.margin } } } : {}),
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {}),
        children,
      },
    ],
  })
  const blob = await Packer.toBlob(doc)
  triggerBlobDownload(blob, fileName)
}

function titlePara(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: true, size: 40 })],
  })
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 200 },
    children: [new TextRun({ text, bold: true, size: 30 })],
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26 })],
  })
}

/** 第十轮修复 4：三级小标题（（一）（二）… 式），加粗正文字号、无缩进 */
function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 120, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24 })],
  })
}

/** 第十轮修复 4：正文段落规范排版——首行缩进 2 字符（480 twip）、1.5 倍行距、两端对齐 */
function body(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { after: 120, line: 360, lineRule: "auto" },
    children: [new TextRun({ text, size: 24 })],
  })
}

/** AI 位图 URL → PNG（fetch + Blob 解码，供 docx ImageRun）；失败返回 null 走【图】标题文字降级 */
export async function imageUrlToPng(url: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const res = await fetch(url, { credentials: "include" })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith("image/")) return null
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!pngBlob) return null
    return { data: new Uint8Array(await pngBlob.arrayBuffer()), width: bitmap.width, height: bitmap.height }
  } catch {
    return null
  }
}

/** 画布像素原地转灰度（Rec.601 亮度加权，保留 alpha）；异常静默返回原图，不阻断导出 */
function toGrayscale(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  try {
    const frame = ctx.getImageData(0, 0, width, height)
    const d = frame.data
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
      d[i] = y
      d[i + 1] = y
      d[i + 2] = y
    }
    ctx.putImageData(frame, 0, 0)
  } catch {
    /* 画布被跨源污染等异常：保留彩色原图，交由人工核对 */
  }
}

/**
 * Q28 切片B：位图黑白化。暗标招标文件普遍要求「图片（含 PPT 幻灯片）、图表均为黑白色」，
 * 彩色位图直接进 Word 属编制要求不符（暗标评审模块可能整块 0 分）。on=false 原样返回，零行为变化。
 */
async function grayscalePng(
  png: { data: Uint8Array; width: number; height: number },
  on: boolean,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  if (!on) return png
  try {
    const bitmap = await createImageBitmap(new Blob([png.data as BlobPart], { type: "image/png" }))
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return png
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    toGrayscale(ctx, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!blob) return png
    return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
  } catch {
    return png
  }
}

/** 章节配图 SVG → PNG（浏览器内 canvas 转换）；任何一步失败返回 null，由调用方降级为文字段落（方案编制导出同样复用） */
export async function figureToPng(
  spec: FigureSpec,
  opts?: { grayscale?: boolean },
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const grayscale = opts?.grayscale === true
  try {
    // T17：image 型是现成位图，fetch→canvas→PNG（尺寸超宽时等比压到 960 防止 docx 版面溢出）
    if (spec.type === "image") {
      const png = await imageUrlToPng(spec.url)
      if (!png) return null
      const maxW = 960
      if (png.width <= maxW) return grayscalePng(png, grayscale)
      const ratio = maxW / png.width
      const canvas = document.createElement("canvas")
      canvas.width = maxW
      canvas.height = Math.max(1, Math.round(png.height * ratio))
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      const bitmap = await createImageBitmap(new Blob([png.data as BlobPart], { type: "image/png" }))
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!resized) return null
      const scaled = { data: new Uint8Array(await resized.arrayBuffer()), width: canvas.width, height: canvas.height }
      return grayscalePng(scaled, grayscale)
    }
    // T16：mermaid 型走异步渲染（mermaid.render → SVG）再进同一条 SVG→canvas 链路；渲染失败返回 null 走文字降级
    const svg =
      spec.type === "mermaid"
        ? await renderMermaidToSvg(spec.code)
        : buildFigureSvg(spec, tokenPalette())
    if (!svg) return null
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    const root = parsed.documentElement
    if (!root || root.nodeName === "parsererror") return null
    const width = Number(root.getAttribute("width")) || 640
    const height = Number(root.getAttribute("height")) || 320
    const markup = new XMLSerializer().serializeToString(root)
    const blobUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }))
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("配图渲染失败"))
        img.src = blobUrl
      })
      const canvas = document.createElement("canvas")
      canvas.width = width * 2
      canvas.height = height * 2
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      const palette = tokenPalette()
      ctx.fillStyle = palette.card
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // 全黑检测：四角 + 中心抽样 5 点，全部近黑说明 token 色值解析失败，判转换失败走文字降级，杜绝黑块入 Word
      const samplePoints: [number, number][] = [
        [2, 2],
        [canvas.width - 3, 2],
        [2, canvas.height - 3],
        [canvas.width - 3, canvas.height - 3],
        [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
      ]
      const allBlack = samplePoints.every(([x, y]) => {
        const d = ctx.getImageData(x, y, 1, 1).data
        return d[0] < 10 && d[1] < 10 && d[2] < 10
      })
      if (allBlack) return null
      // Q28 切片B：暗标导出图表黑白（SVG 分支渲染后的位图同样过灰度）
      if (grayscale) toGrayscale(ctx, canvas.width, canvas.height)
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!pngBlob) return null
      const buf = await pngBlob.arrayBuffer()
      return { data: new Uint8Array(buf), width, height }
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 第十七轮 17C：格式配置驱动导出（format_settings null = 现状默认导出，一字不改）
// ---------------------------------------------------------------------------

/** 中文字体名 → docx 西文字体名（eastAsia 保留中文名，Word 中文字体直接匹配） */
const DOCX_FONT: Record<string, string> = { 宋体: "SimSun", 黑体: "SimHei", 仿宋: "FangSong", 楷体: "KaiTi" }

// DOCX_SIZE_HALFPT 抽至 ./bidFormatConstants（R269）：构建层与检查层共用同一份字号半点表

const DOCX_ALIGN: Record<FormatAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

/** 纸张尺寸（twips：A4=21×29.7cm，A3=29.7×42cm，16 开=18.5×26cm） */
const PAPER_TWIPS: Record<string, { width: number; height: number }> = {
  A4: { width: 11906, height: 16838 },
  A3: { width: 16838, height: 23811 },
  "16K": { width: 10489, height: 14740 },
}

const CM_TO_TWIPS = 566.93

function cmToTwips(cm: number): number {
  return Math.round(cm * CM_TO_TWIPS)
}

/** 行距值 → docx spacing（固定值N磅 = N×20 twips exact；倍数 = 240×倍数 auto） */
function lineSpacingOf(lineSpacing: string): { line: number; lineRule: "auto" | "exact" } {
  const fixed = parseFixedLineSpacing(lineSpacing)
  if (fixed) return { line: Math.round(fixed * 20), lineRule: "exact" }
  if (lineSpacing === "单倍") return { line: 240, lineRule: "auto" }
  if (lineSpacing === "2倍") return { line: 480, lineRule: "auto" }
  return { line: 360, lineRule: "auto" }
}

/**
 * 格式配置驱动的 docx 构建器（第十七轮 17C 抽出）：字体 run / 各级标题段 / 正文段 /
 * 全角空格分列的纯文本表格行识别与 docx Table 构建；投标文件导出与方案编制导出共用同一套映射。
 */
export type FormatDocxKit = {
  fontRun: (text: string, o: { font: string; size: string; bold?: boolean; italics?: boolean }) => TextRun
  headingAt: (i: number) => HeadingFormat
  headingPara: (
    level: number,
    text: string,
    opts?: { before?: number; after?: number; pageBreakBefore?: boolean },
  ) => Paragraph
  bodyPara: (text: string) => Paragraph
  splitTableRow: (line: string) => string[] | null
  buildFmtTable: (rows: string[][]) => Table
}

export function createFormatDocxKit(fmt: FormatSettings): FormatDocxKit {
  const fontRun: FormatDocxKit["fontRun"] = (text, o) =>
    new TextRun({
      text,
      bold: o.bold ?? false,
      italics: o.italics ?? false,
      size: DOCX_SIZE_HALFPT[o.size] ?? 28,
      font: { ascii: DOCX_FONT[o.font] ?? "SimSun", hAnsi: DOCX_FONT[o.font] ?? "SimSun", eastAsia: o.font },
    })
  const headingAt: FormatDocxKit["headingAt"] = (i) => fmt.heading[Math.min(Math.max(i, 0), 5)]
  const headingPara: FormatDocxKit["headingPara"] = (level, text, opts) => {
    const h = headingAt(level)
    const headingLevel = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(level, 2)]
    return new Paragraph({
      heading: headingLevel,
      alignment: DOCX_ALIGN[h.align],
      ...(opts?.pageBreakBefore ? { pageBreakBefore: true } : {}),
      spacing: { before: opts?.before ?? 240, after: opts?.after ?? 120 },
      children: [fontRun(text, { font: h.font, size: h.size, bold: true })],
    })
  }
  const bodySpacing = lineSpacingOf(fmt.body.lineSpacing)
  // 首行缩进：字符数 × 字号半点值 × 10（1 半点 = 10 twips，2 字符四号 ≈ 560 twips）
  const bodyIndent = Math.round(fmt.body.firstIndent * (DOCX_SIZE_HALFPT[fmt.body.size] ?? 28) * 10)
  const bodyPara: FormatDocxKit["bodyPara"] = (text) =>
    new Paragraph({
      alignment: DOCX_ALIGN[fmt.body.align],
      ...(bodyIndent > 0 ? { indent: { firstLine: bodyIndent } } : {}),
      spacing: { after: 120, ...bodySpacing },
      children: [fontRun(text, { font: fmt.body.font, size: fmt.body.size })],
    })

  // 循环 6 A4：正文里的纯文本表格行（生成约定：每行一条记录、列间用全角空格 U+3000 分隔、首行为表头）
  // 渲染成真正的 docx 表格，边框粗细与单元格字体随格式设置变化
  const tblFont = splitContentFont(fmt.table.contentFont)
  const tblBorderPt = parseFloat(fmt.table.border) || 0.5
  // docx 边框 size 单位 = 1/8 磅："0.5pt" → 4
  const tblBorderSide = {
    style: BorderStyle.SINGLE,
    size: Math.max(1, Math.round(tblBorderPt * 8)),
    color: "000000",
  }
  const splitTableRow: FormatDocxKit["splitTableRow"] = (line) => {
    if (!line.includes("　")) return null
    // 生成约定为「两个全角空格 U+3000」分列；用 \u3000+ 正则折叠连续分隔符，兼容模型偶发单个全角空格
    const cols = line.split(/\u3000+/).map((c) => c.trim())
    while (cols.length && !cols[cols.length - 1]) cols.pop()
    while (cols.length && !cols[0]) cols.shift()
    return cols.length >= 2 ? cols : null
  }
  const buildFmtTable: FormatDocxKit["buildFmtTable"] = (rows) => {
    const colCount = Math.max(...rows.map((r) => r.length))
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: tblBorderSide,
        bottom: tblBorderSide,
        left: tblBorderSide,
        right: tblBorderSide,
        insideHorizontal: tblBorderSide,
        insideVertical: tblBorderSide,
      },
      rows: rows.map((cells, ri) =>
        new TableRow({
          ...(ri === 0 ? { tableHeader: true } : {}),
          children: Array.from({ length: colCount }, (_, ci) =>
            new TableCell({
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  spacing: { after: 0, line: 276, lineRule: "auto" },
                  children: [fontRun(cells[ci] ?? "", { font: tblFont.font, size: tblFont.size, bold: ri === 0 })],
                }),
              ],
            }),
          ),
        }),
      ),
    })
  }
  return { fontRun, headingAt, headingPara, bodyPara, splitTableRow, buildFmtTable }
}

/** 导出投标文件 Word：format_settings 存在时按格式配置驱动；null=现状默认导出一字不改 */
export async function exportBidDocx(project: BidProjectRecord): Promise<void> {
  const fmt = project.format_settings ?? null
  if (!fmt) {
    await exportBidDocxDefaults(project)
    return
  }
  await exportBidDocxFormatted(project, fmt)
}

/** 现状默认导出（存量项目 format_settings=null 走此路径） */
async function exportBidDocxDefaults(project: BidProjectRecord): Promise<void> {
  const children: Paragraph[] = []
  children.push(titlePara(`${project.project_name} ${bidVolumeTitle(project)}`))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: [project.hospital, project.tender_no].filter((x) => x).join(" · "),
          size: 24,
        }),
      ],
    }),
  )
  for (const [idx, ch] of bidExportChapters(project).entries()) {
    const chapter: Chapter = ch
    children.push(h1(`第${idx + 1}章 ${chapter.title}`))
    // 标书第十三轮改造 4：商务骨架章导出「章标题 + 小节标题 + 每节占位行」，供线下填写后合并
    if (isBizPart(chapter) && !(chapter.content ?? "").trim()) {
      const bizSections = chapter.sections ?? []
      if (!bizSections.length) {
        children.push(body("（商务文书，请线下填写）"))
      }
      bizSections.forEach((s, j) => {
        children.push(h2(`${idx + 1}.${j + 1} ${s}`))
        children.push(body(`（商务文书，请线下填写：${s}）`))
      })
      continue
    }
    const paras: Paragraph[] = []
    let firstBodyAt = -1
    // 2026-10-07 图位锚点：正文行「【图：标题】」= 该图的插入位置（按标题精确匹配，每图一次）；
    // 未匹配到图的锚点行直接丢弃（不把标记文字带进 Word）；剩余未锚定图回落到旧聚合位置
    const figsAll = chapter.figures ?? []
    const usedFigTitles = new Set<string>()
    // 第十轮修复 1/4：导出前整体净化正文（存量脏数据——围栏/JSON 块/markdown 残留——导出也干净）
    // 交付物治理：依据表「编号」列的无编号占位（【待填写】）规整为「／」，不动库内原文
    const cleanContent = normalizeBasisPlaceholders(sanitizeChapterText(chapter.content || ""))
    for (const rawLine of cleanContent.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      const anchorMatch = /^【图[:：](.+?)】$/.exec(line)
      if (anchorMatch) {
        const spec = figsAll.find((f) => f.title === anchorMatch[1].trim() && !usedFigTitles.has(f.title))
        if (spec) {
          usedFigTitles.add(spec.title)
          const rendered = await figureToPng(spec)
          const figCaption = (spec.caption ?? "").trim()
          if (rendered) {
            const drawW = 460
            const drawH = Math.max(40, Math.round((drawW * rendered.height) / rendered.width))
            paras.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 160, after: 60 },
                children: [new ImageRun({ type: "png", data: rendered.data, transformation: { width: drawW, height: drawH } })],
              }),
            )
          } else {
            paras.push(body(`【图】${spec.title}`))
          }
          paras.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: figCaption ? 40 : 160 },
              children: [new TextRun({ text: spec.title, italics: true, size: 20 })],
            }),
          )
          if (figCaption) {
            paras.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
                children: [new TextRun({ text: figCaption, size: 18 })],
              }),
            )
          }
        }
        continue
      }
      // 问题3：正文句以小节名/数字开头不再误升标题——改走整行精确匹配真小节标题
      const isSubHeading = isRealSectionHeading(line, chapter.sections, idx + 1)
      // （一）（二）… 式小标题用 h3：整行短（≤30 字）且不以句末标点结尾才算
      const isH3 = /^（[一二三四五六七八九十]+）/.test(line) && line.length <= 30 && !/[。！？；，、]$/.test(line)
      if (!isSubHeading && !isH3 && firstBodyAt === -1) firstBodyAt = paras.length
      paras.push(isSubHeading ? h2(line) : isH3 ? h3(line) : body(line))
    }
    const figs = figsAll.filter((f) => !usedFigTitles.has(f.title))
    if (figs.length) {
      const figParas: Paragraph[] = []
      for (const spec of figs) {
        const png = await figureToPng(spec)
        // 循环 2 批 2-1：编排图注（caption）非空时图后追加图注行（纯文本不斜体、小字号）
        const figCaption = (spec.caption ?? "").trim()
        if (png) {
          const drawW = 460
          const drawH = Math.max(40, Math.round((drawW * png.height) / png.width))
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 60 },
              children: [new ImageRun({ type: "png", data: png.data, transformation: { width: drawW, height: drawH } })],
            }),
          )
        } else {
          figParas.push(body(`【图】${spec.title}`))
        }
        figParas.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: figCaption ? 40 : 160 },
            children: [new TextRun({ text: spec.title, italics: true, size: 20 })],
          }),
        )
        if (figCaption) {
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [new TextRun({ text: figCaption, size: 18 })],
            }),
          )
        }
      }
      const insertAt = firstBodyAt === -1 ? paras.length : firstBodyAt + 1
      paras.splice(insertAt, 0, ...figParas)
    }
    children.push(...paras)
  }
  await downloadDocx(`${project.project_name}-投标文件.docx`, children)
}

/**
 * 第十七轮 17C：格式配置驱动导出——字体/字号映射、行距、页边距、首行缩进、标题编号样式、
 * 目录/页码/页眉页脚开关。
 * Q28 切片B：sealed=true 按暗标编制口径出件——页码为页面底端居中裸连续阿拉伯数字（不再关闭页码）、
 * 强制不输出页眉、配图与图片黑白化；「暗标声明」占位页改由 sealedDeclarationPage 单独控制（默认不出）。
 * 章节配图逻辑与默认导出一致（SVG→PNG 插入正文首段后，失败降级「【图】标题」）。
 */
async function exportBidDocxFormatted(project: BidProjectRecord, fmt: FormatSettings): Promise<void> {
  // 字体/标题/正文/表格构建统一走 createFormatDocxKit（与方案编制导出共用同一套映射）
  const { fontRun, headingAt, headingPara, bodyPara, splitTableRow, buildFmtTable } = createFormatDocxKit(fmt)

  const children: (Paragraph | Table | TableOfContents)[] = []
  // Q28 切片B：声明占位页仅在显式勾选时置顶（多数暗标招标文件不要求，多余页反成不符项）
  if (fmt.sealed && fmt.sealedDeclarationPage) {
    const sealHead = headingAt(0)
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400, after: 320 },
        children: [fontRun("暗 标 声 明", { font: sealHead.font, size: sealHead.size, bold: true })],
      }),
    )
    children.push(bodyPara("（暗标声明页占位：请按招标文件要求在此粘贴暗标声明与密封标注。）"))
    children.push(bodyPara("暗标部分不得出现投标人名称、印章或任何身份标识；页码按招标文件要求编制于页面底端居中。"))
    children.push(new Paragraph({ pageBreakBefore: true }))
  }
  const h0 = headingAt(0)
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [fontRun(`${project.project_name} ${bidVolumeTitle(project)}`, { font: h0.font, size: h0.size, bold: true })],
    }),
  )
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        fontRun([project.hospital, project.tender_no].filter((x) => x).join(" · "), {
          font: fmt.body.font,
          size: fmt.body.size,
        }),
      ],
    }),
  )
  // 目录开关：TOC 域（Word 打开时提示更新域），目录后正文另起一页
  let breakBeforeNext = false
  if (fmt.toc) {
    const tocHead = headingAt(1)
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 160 },
        children: [fontRun("目  录", { font: tocHead.font, size: tocHead.size, bold: true })],
      }),
    )
    // Q28 切片B：暗标目录不做超链接——Word 更新域后会给超链接目录项套 Hyperlink 字符样式（蓝色下划线）
    children.push(new TableOfContents("目录", { hyperlink: !fmt.sealed, headingStyleRange: "1-3" }))
    breakBeforeNext = true
  }
  // 标题编号样式：数字层级 "1 / 1.1"；章—节式 "第1章 / 1.1"（现状默认）；无编号
  const chapterPrefix = (idx: number) =>
    fmt.titleNumbering === "none" ? "" : fmt.titleNumbering === "chapter" ? `第${idx + 1}章 ` : `${idx + 1} `
  const sectionPrefix = (idx: number, j: number) =>
    fmt.titleNumbering === "none" ? "" : `${idx + 1}.${j + 1} `
  for (const [idx, ch] of bidExportChapters(project).entries()) {
    const chapter: Chapter = ch
    children.push(headingPara(0, `${chapterPrefix(idx)}${chapter.title}`, { before: 320, after: 200, pageBreakBefore: breakBeforeNext }))
    breakBeforeNext = false
    if (isBizPart(chapter) && !(chapter.content ?? "").trim()) {
      const bizSections = chapter.sections ?? []
      if (!bizSections.length) children.push(bodyPara("（商务文书，请线下填写）"))
      bizSections.forEach((s, j) => {
        children.push(headingPara(1, `${sectionPrefix(idx, j)}${s}`))
        children.push(bodyPara(`（商务文书，请线下填写：${s}）`))
      })
      continue
    }
    const paras: (Paragraph | Table)[] = []
    let firstBodyAt = -1
    // 2026-10-07 图位锚点（与默认导出同语义）：「【图：标题】」行 = 该图插入位置，每图一次；
    // 未匹配的锚点行丢弃；剩余未锚定图回落到旧聚合位置（首段后）
    const figsAll = chapter.figures ?? []
    const usedFigTitles = new Set<string>()
    const renderAnchoredFig = async (spec: FigureSpec): Promise<(Paragraph | Table)[]> => {
      const out: (Paragraph | Table)[] = []
      const rendered = await figureToPng(spec, { grayscale: fmt.sealed })
      const figCaption = (spec.caption ?? "").trim()
      if (rendered) {
        const drawW = 460
        const drawH = Math.max(40, Math.round((drawW * rendered.height) / rendered.width))
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 60 },
            children: [new ImageRun({ type: "png", data: rendered.data, transformation: { width: drawW, height: drawH } })],
          }),
        )
      } else {
        out.push(bodyPara(`【图】${spec.title}`))
      }
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: figCaption ? 40 : 160 },
          children: [fontRun(spec.title, { font: fmt.body.font, size: "小五", italics: true })],
        }),
      )
      if (figCaption) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [fontRun(figCaption, { font: fmt.body.font, size: "小五" })],
          }),
        )
      }
      return out
    }
    // 交付物治理：依据表「编号」列的无编号占位（【待填写】）规整为「／」，不动库内原文
    const cleanContent = normalizeBasisPlaceholders(sanitizeChapterText(chapter.content || ""))
    const contentLines = cleanContent
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    let li = 0
    while (li < contentLines.length) {
      const line = contentLines[li]
      const anchorMatch = /^【图[:：](.+?)】$/.exec(line)
      if (anchorMatch) {
        const spec = figsAll.find((f) => f.title === anchorMatch[1].trim() && !usedFigTitles.has(f.title))
        if (spec) {
          usedFigTitles.add(spec.title)
          if (firstBodyAt === -1) firstBodyAt = paras.length
          paras.push(...(await renderAnchoredFig(spec)))
        }
        li++
        continue
      }
      // 循环 6 A4：连续 ≥2 行可拆分（全角空格分列）视为表格块，转 docx Table；孤立单行仍按正文段落
      const headCols = splitTableRow(line)
      if (headCols) {
        const block: string[][] = [headCols]
        let lj = li + 1
        while (lj < contentLines.length) {
          const nextCols = splitTableRow(contentLines[lj])
          if (!nextCols) break
          block.push(nextCols)
          lj++
        }
        if (block.length >= 2) {
          if (firstBodyAt === -1) firstBodyAt = paras.length
          paras.push(buildFmtTable(block))
          li = lj
          continue
        }
      }
      const isSubHeading = isRealSectionHeading(line, chapter.sections, idx + 1)
      const isH3 = /^（[一二三四五六七八九十]+）/.test(line) && line.length <= 30 && !/[。！？；，、]$/.test(line)
      if (!isSubHeading && !isH3 && firstBodyAt === -1) firstBodyAt = paras.length
      paras.push(isSubHeading ? headingPara(1, line) : isH3 ? headingPara(2, line) : bodyPara(line))
      li++
    }
    const figs = figsAll.filter((f) => !usedFigTitles.has(f.title))
    if (figs.length) {
      const figParas: Paragraph[] = []
      for (const spec of figs) {
        const png = await figureToPng(spec, { grayscale: fmt.sealed })
        // 循环 2 批 2-1：编排图注（caption）非空时图后追加图注行（正文字体、不斜体、小五号）
        const figCaption = (spec.caption ?? "").trim()
        if (png) {
          const drawW = 460
          const drawH = Math.max(40, Math.round((drawW * png.height) / png.width))
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 60 },
              children: [new ImageRun({ type: "png", data: png.data, transformation: { width: drawW, height: drawH } })],
            }),
          )
        } else {
          figParas.push(bodyPara(`【图】${spec.title}`))
        }
        figParas.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: figCaption ? 40 : 160 },
            children: [fontRun(spec.title, { font: fmt.body.font, size: "小五", italics: true })],
          }),
        )
        if (figCaption) {
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [fontRun(figCaption, { font: fmt.body.font, size: "小五" })],
            }),
          )
        }
      }
      const insertAt = firstBodyAt === -1 ? paras.length : firstBodyAt + 1
      paras.splice(insertAt, 0, ...figParas)
    }
    children.push(...paras)
  }
  await downloadDocx(`${project.project_name}-投标文件.docx`, children, {
    page: {
      size: PAPER_TWIPS[fmt.paper] ?? PAPER_TWIPS.A4,
      margin: {
        top: cmToTwips(fmt.margins.top),
        bottom: cmToTwips(fmt.margins.bottom),
        left: cmToTwips(fmt.margins.left),
        right: cmToTwips(fmt.margins.right),
      },
    },
    // Q28 切片B：暗标任何一页不得设页眉，强制不输出页眉文字
    headerText: fmt.headerFooter && !fmt.sealed ? `${project.project_name} 投标文件` : "",
    // Q28 切片B：暗标同样必须编页码（底端居中·连续阿拉伯数字），只把样式换成裸数字
    footerPageNumber: fmt.pageNumber,
    footerPageNumberBare: fmt.sealed,
    // Q28 切片B：暗标全黑（内置标题/超链接样式默认色改黑）
    allTextBlack: fmt.sealed,
    updateFields: fmt.toc,
  })
}

export type ReportKind = "parse" | "dup_void" | "eval"

/**
 * 循环 6 A4：报告 / 偏离表导出的页面级选项——纸张、页边距、页码从 format_settings 读取；
 * format_settings=null（存量默认）返回 undefined，导出行为与改前完全一致。
 * 正文标题/段落仍用各报告既有固定样式（最小改动，只补页面设置）。
 */
function pageOptsOf(project: BidProjectRecord, pageNumber: boolean): DocxExportOptions | undefined {
  return pageOptsFromFormatSettings(project.format_settings ?? null, { pageNumber })
}

/**
 * 循环 9 C2：纯函数——由 FormatSettings 生成页面级导出选项（方案工作台 localStorage 方案复用）；
 * fmt 空 → undefined（导出走现状默认）。sealedAware：密封口径由调用方在 pageNumber 入参体现，此函数不感知。
 */
export function pageOptsFromFormatSettings(
  fmt: FormatSettings | null | undefined,
  opts?: { pageNumber?: boolean },
): DocxExportOptions | undefined {
  if (!fmt) return undefined
  return {
    page: {
      size: PAPER_TWIPS[fmt.paper] ?? PAPER_TWIPS.A4,
      margin: {
        top: cmToTwips(fmt.margins.top),
        bottom: cmToTwips(fmt.margins.bottom),
        left: cmToTwips(fmt.margins.left),
        right: cmToTwips(fmt.margins.right),
      },
    },
    ...(opts?.pageNumber ? { footerPageNumber: true } : {}),
  }
}

/** 导出解析报告 / 检查报告 / 评标报告 Word */
/** Q28 切片A：页码锚点渲染开关——external（外部标书审查）模式下 〔P12〕 显示为「第 12 页」 */
function shouldRenderPages(project: { bid_source_mode?: unknown }): boolean {
  return String((project as { bid_source_mode?: string }).bid_source_mode ?? "") === "external"
}

export async function exportReportDocx(kind: ReportKind, project: BidProjectRecord): Promise<void> {
  const fmt = project.format_settings ?? null
  const pageOpts = pageOptsOf(project, !!fmt?.pageNumber)
  const children: Paragraph[] = []
  if (kind === "parse") {
    const rep = project.parse_report
    children.push(titlePara(`${project.project_name} 招标文件解析报告`))
    if (!rep || !rep.sections.length) {
      children.push(body("尚未生成解析报告。"))
    } else {
      rep.sections.forEach((s, i) => {
        children.push(h1(`${i + 1}. ${s.title}${s.human_edited ? "（已人工修订）" : ""}`))
        const lines = s.content
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
        if (!lines.length) children.push(body("（本分区暂无内容）"))
        else lines.forEach((line) => children.push(body(line)))
      })
    }
    await downloadDocx(`${project.project_name}-解析报告.docx`, children, pageOpts)
    return
  }
  if (kind === "dup_void") {
    children.push(titlePara(`${project.project_name} 查重与废标检查报告`))
    children.push(h1("一、标书查重"))
    const dup = project.dup_report
    if (!dup) children.push(body("尚未执行查重。"))
    else {
      children.push(body(`对比范围：本人历史投标项目 ${dup.scanned_projects} 个；可疑段落 ${dup.suspect_count} 处。`))
      dup.pairs.forEach((pair, i) => {
        children.push(h2(`${i + 1}. ${pair.target_chapter} ↔「${pair.source_project}」${pair.source_chapter}（相似度 ${Math.round(pair.similarity * 100)}%${pair.ai_verdict ? `，AI 复判：${pair.ai_verdict}` : ""}）`))
        children.push(body(`本标书段落：${pair.target_text}`))
        children.push(body(`历史段落：${pair.source_text}`))
        if (pair.ai_note) children.push(body(`复判意见：${pair.ai_note}`))
      })
    }
    children.push(h1("二、废标项自查"))
    const vc = project.void_check
    if (!vc) children.push(body("尚未执行废标项检查。"))
    else {
      vc.items.forEach((item, i) => {
        const status = effectiveVoidStatus(item)
        children.push(h2(`${i + 1}. ${item.clause}`))
        children.push(
          body(
            `判定：${VOID_STATUS_LABEL[status]}（严重度：${SEVERITY_LABEL[item.severity]}；核销：${REVIEW_STATUS_LABEL[item.review_status]}${item.review_status === "skipped" && item.skip_reason ? `，原因：${item.skip_reason}` : ""}）${item.manual_checked ? "（已人工复核）" : ""}`,
          ),
        )
        if (item.source_location) children.push(body(`招标位置：${item.source_location}`))
        if (item.response) children.push(body(`投标文件响应：${item.response}`))
        if (item.response_location)
          children.push(
            body(
              `响应位置：${shouldRenderPages(project) ? renderPageRefs(item.response_location) : item.response_location}`,
            ),
          )
        if (item.evidence) children.push(body(`证据摘录：${item.evidence}`))
        if (item.suggestion) children.push(body(`整改建议：${item.suggestion}`))
        if (item.reason) children.push(body(`说明：${item.reason}`))
      })
    }
    await downloadDocx(`${project.project_name}-检查报告.docx`, children, pageOpts)
    return
  }
  children.push(titlePara(`${project.project_name} 模拟评标报告`))
  const ai = project.ai_review
  const manual = project.manual_review
  children.push(h1("一、AI 模拟评标"))
  if (!ai) children.push(body("尚未执行模拟评标。"))
  else {
    children.push(body(`AI 预估总分：${ai.total_score} 分`))
    ai.items.forEach((item, i) => {
      children.push(h2(`${i + 1}. ${item.scoring_item}（${item.ai_score} / ${item.max_score} 分）`))
      if (item.reason) children.push(body(`扣分理由：${item.reason}`))
      if (item.suggestion) children.push(body(`改进建议：${item.suggestion}`))
    })
    if (ai.summary) {
      children.push(h2("总体评价"))
      children.push(body(ai.summary))
    }
  }
  children.push(h1("二、人工打分"))
  if (!manual || !manual.items.length) children.push(body("尚未进行人工打分。"))
  else {
    children.push(body(`人工总分：${manual.total_score} 分`))
    manual.items.forEach((item, i) => {
      children.push(body(`${i + 1}. ${item.scoring_item}：${item.manual_score} / ${item.max_score} 分${item.comment ? `（${item.comment}）` : ""}`))
    })
  }
  await downloadDocx(`${project.project_name}-评标报告.docx`, children, pageOpts)
}

/** T18+：文本审计报告导出（错别字 + 逻辑谬误清单成档，交卷前留痕用） */
export async function exportTextAuditDocx(project: BidProjectRecord): Promise<void> {
  const fmt = project.format_settings ?? null
  const pageOpts = pageOptsOf(project, !!fmt?.pageNumber)
  const report = project.text_audit ?? null
  const children: Paragraph[] = []
  children.push(titlePara(`${project.project_name} 文本审计报告`))
  if (!report || (!report.typos.length && !report.logic.length)) {
    children.push(body("尚未执行文本审计，或本次审计未发现问题。"))
  } else {
    children.push(
      body(
        `检查对象：${report.source === "external" ? "外部投标文件全文" : "已成稿章节正文"}；检查时间：${report.checked_at ? formatDateTimeDisplay(report.checked_at) : "—"}；发现错别字 ${report.typos.length} 处、逻辑问题 ${report.logic.length} 处。错别字均经原文位置校验（逐字命中才收录）。`,
      ),
    )
    children.push(h1("一、错别字清单"))
    if (!report.typos.length) children.push(body("未发现高确信错别字。"))
    else
      report.typos.forEach((t, i) => {
        children.push(h2(`${i + 1}. 「${t.wrongText}」→「${t.correctText}」（${t.docTitle} · 第 ${t.line} 行附近）`))
        children.push(body(`原文摘录：…${t.excerpt}…`))
        children.push(body(`判定理由：${t.reason}`))
      })
    children.push(h1("二、逻辑谬误 / 前后不一致清单"))
    if (!report.logic.length) children.push(body("未发现逻辑谬误或前后不一致。"))
    else
      report.logic.forEach((l, i) => {
        children.push(h2(`${i + 1}. ${l.title}（${l.docTitle} · ${l.locationHint}）`))
        children.push(body(`原文摘录：${l.originalText}`))
        children.push(body(`问题说明：${l.fallacyReason}`))
        children.push(body(`修改建议：${l.suggestion}`))
      })
  }
  await downloadDocx(`${project.project_name}-文本审计报告.docx`, children, pageOpts)
}

function deviationCell(text: string, opts?: { bold?: boolean; width?: number }): TableCell {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "—", size: 20, bold: opts?.bold ?? false })],
      }),
    ],
  })
}

/** 改造 4：独立导出技术偏离表 Word（按来源章节分组的表格：条款序号|招标要求|响应程度|响应内容摘要|响应位置） */
export async function exportDeviationDocx(project: BidProjectRecord): Promise<void> {
  // 循环 6 A4：偏离表属投标文件组成部分——暗标时与正文同口径不输出页码
  const devFmt = project.format_settings ?? null
  const pageOpts = pageOptsOf(project, !!devFmt && devFmt.pageNumber && !devFmt.sealed)
  const table = normalizeDeviationTable(project.response_map)
  const children: (Paragraph | Table)[] = []
  children.push(titlePara(`${project.project_name} 技术偏离表`))
  if (!table || !table.rows.length) {
    children.push(body("尚未生成技术偏离表，请先在「投标文件编制」环节生成。"))
    await downloadDocx(`${project.project_name}-技术偏离表.docx`, children, pageOpts)
    return
  }
  const full = table.rows.filter((r) => r.response_level === "full").length
  const partial = table.rows.filter((r) => r.response_level === "partial").length
  const deviation = table.rows.filter((r) => r.response_level === "deviation").length
  children.push(
    body(
      `拆分维度：${CLAUSE_GRANULARITY_LABEL[table.split_dim]}；总条款 ${table.rows.length} 条，完全响应 ${full} 条、部分响应 ${partial} 条、偏离 ${deviation} 条。`,
    ),
  )
  // 按来源章节分组导出
  const groups: { source: string; rows: DeviationRow[] }[] = []
  for (const r of table.rows) {
    const g = groups.find((x) => x.source === r.source)
    if (g) g.rows.push(r)
    else groups.push({ source: r.source || "招标技术要求", rows: [r] })
  }
  groups.forEach((g, gi) => {
    children.push(h2(`${gi + 1}. ${g.source}（${g.rows.length} 条）`))
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              deviationCell("条款序号", { bold: true, width: 9 }),
              deviationCell("招标要求", { bold: true, width: 35 }),
              deviationCell("响应程度", { bold: true, width: 11 }),
              deviationCell("响应内容摘要", { bold: true, width: 29 }),
              deviationCell("响应位置", { bold: true, width: 16 }),
            ],
          }),
          ...g.rows.map((r, ri) =>
            new TableRow({
              children: [
                deviationCell(r.clause_id || String(ri + 1), { width: 9 }),
                deviationCell(r.clause_text, { width: 35 }),
                deviationCell(r.response_level ? RESPONSE_LEVEL_LABEL[r.response_level] : "待人工判定", { width: 11 }),
                deviationCell(r.response_summary, { width: 29 }),
                deviationCell([r.bid_ref, r.response_node].filter(Boolean).join(" "), { width: 16 }),
              ],
            }),
          ),
        ],
      }),
    )
  })
  await downloadDocx(`${project.project_name}-技术偏离表.docx`, children, pageOpts)
}

