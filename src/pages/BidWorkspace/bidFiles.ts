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
import type { Chapter, FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import {
  CLAUSE_GRANULARITY_LABEL,
  RESPONSE_LEVEL_LABEL,
  REVIEW_STATUS_LABEL,
  SEVERITY_LABEL,
  STAGE_LABEL,
  VOID_STATUS_LABEL,
  effectiveVoidStatus,
  isBizPart,
  normalizeDeviationTable,
  parseFixedLineSpacing,
  sanitizeChapterText,
  splitContentFont,
  type BidProjectRecord,
  type DeviationRow,
  type FormatAlign,
  type FormatSettings,
  type HeadingFormat,
} from "./bidTypes"

// ---------------------------------------------------------------------------
// 本地文件解析（.docx / .pdf → 纯文本，全部在浏览器内完成，不上传原文件）
// ---------------------------------------------------------------------------

export async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth")
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return (result.value ?? "").trim()
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) })
  const doc = await loadingTask.promise
  const lines: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join("")
    lines.push(pageText)
  }
  await loadingTask.destroy()
  return lines.join("\n").trim()
}

/** 按扩展名分发解析招标文件；失败抛中文错误并引导改用粘贴文本 */
export async function extractTenderFileText(file: File): Promise<string> {
  const lower = file.name.toLowerCase()
  try {
    if (lower.endsWith(".docx")) return await extractDocxText(file)
    if (lower.endsWith(".pdf")) return await extractPdfText(file)
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return (await file.text()).trim()
    throw new Error("暂不支持该格式")
  } catch (e) {
    const detail = e instanceof Error ? e.message : "未知原因"
    throw new Error(`文件解析失败（${detail}）。支持 .docx / .pdf / .txt；扫描版 PDF 无法提取文字，请改用「粘贴文本」方式导入招标文件内容`)
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
              children: [new TextRun({ children: ["第 ", PageNumber.CURRENT, " 页"], size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })],
            }),
          ],
        }),
      }
    : undefined
  const doc = new Document({
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
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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

/** 章节配图 SVG → PNG（浏览器内 canvas 转换）；任何一步失败返回 null，由调用方降级为文字段落 */
async function figureToPng(spec: FigureSpec): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const svg = buildFigureSvg(spec, tokenPalette())
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

/** 中文字号 → 半点值（docx size 单位=半点：四号=14pt=28） */
const DOCX_SIZE_HALFPT: Record<string, number> = {
  初号: 84,
  小初: 72,
  一号: 52,
  小一: 48,
  二号: 44,
  小二: 36,
  三号: 32,
  小三: 30,
  四号: 28,
  小四: 24,
  五号: 21,
  小五: 18,
}

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
  children.push(titlePara(`${project.project_name} 投标文件（技术标）`))
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
  for (const [idx, ch] of project.bid_chapters.entries()) {
    const chapter: Chapter = ch
    children.push(h1(`第${idx + 1}章 ${chapter.title}`))
    // 标书第十三轮改造 4：商务骨架章导出「章标题 + 小节标题 + 每节占位行」，供线下填写后合并
    if (isBizPart(chapter)) {
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
    // 第十轮修复 1/4：导出前整体净化正文（存量脏数据——围栏/JSON 块/markdown 残留——导出也干净）
    const cleanContent = sanitizeChapterText(chapter.content || "")
    for (const rawLine of cleanContent.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      const isSubHeading =
        chapter.sections.some((s) => line.startsWith(s)) || /^\d+[.、]\s*\S/.test(line) || /^\d+\.\d+/.test(line)
      // 修复 4：（一）（二）… 式小标题用 h3，既有 h2 判定保留并优先
      const isH3 = /^（[一二三四五六七八九十]+）/.test(line)
      if (!isSubHeading && !isH3 && firstBodyAt === -1) firstBodyAt = paras.length
      paras.push(isSubHeading ? h2(line) : isH3 ? h3(line) : body(line))
    }
    const figs = chapter.figures ?? []
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
 * 目录/页码/页眉页脚开关；sealed=true 加暗标声明占位页且全文不输出页码。
 * 章节配图逻辑与默认导出一致（SVG→PNG 插入正文首段后，失败降级「【图】标题」）。
 */
async function exportBidDocxFormatted(project: BidProjectRecord, fmt: FormatSettings): Promise<void> {
  const fontRun = (text: string, o: { font: string; size: string; bold?: boolean; italics?: boolean }) =>
    new TextRun({
      text,
      bold: o.bold ?? false,
      italics: o.italics ?? false,
      size: DOCX_SIZE_HALFPT[o.size] ?? 28,
      font: { ascii: DOCX_FONT[o.font] ?? "SimSun", hAnsi: DOCX_FONT[o.font] ?? "SimSun", eastAsia: o.font },
    })
  const headingAt = (i: number): HeadingFormat => fmt.heading[Math.min(Math.max(i, 0), 5)]
  const headingPara = (
    level: number,
    text: string,
    opts?: { before?: number; after?: number; pageBreakBefore?: boolean },
  ) => {
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
  const bodyPara = (text: string) =>
    new Paragraph({
      alignment: DOCX_ALIGN[fmt.body.align],
      ...(bodyIndent > 0 ? { indent: { firstLine: bodyIndent } } : {}),
      spacing: { after: 120, ...bodySpacing },
      children: [fontRun(text, { font: fmt.body.font, size: fmt.body.size })],
    })

  // 循环 6 A4：消费 fmt.table——正文里的纯文本表格行（生成约定：每行一条记录、列间用全角空格
  // U+3000 分隔、首行为表头）渲染成真正的 docx 表格，边框粗细与单元格字体随格式设置变化
  const tblFont = splitContentFont(fmt.table.contentFont)
  const tblBorderPt = parseFloat(fmt.table.border) || 0.5
  // docx 边框 size 单位 = 1/8 磅："0.5pt" → 4
  const tblBorderSide = {
    style: BorderStyle.SINGLE,
    size: Math.max(1, Math.round(tblBorderPt * 8)),
    color: "000000",
  }
  const splitTableRow = (line: string): string[] | null => {
    if (!line.includes("　")) return null
    // 生成约定为「两个全角空格」分列；用 /　+/ 折叠连续分隔符，兼容模型偶发单个全角空格
    const cols = line.split(/　+/).map((c) => c.trim())
    while (cols.length && !cols[cols.length - 1]) cols.pop()
    while (cols.length && !cols[0]) cols.shift()
    return cols.length >= 2 ? cols : null
  }
  const buildFmtTable = (rows: string[][]): Table => {
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

  const children: (Paragraph | Table | TableOfContents)[] = []
  // 暗标：声明占位页置顶（正文前独立一页），页码在 downloadDocx 选项里整体关闭
  if (fmt.sealed) {
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
    children.push(bodyPara("暗标部分不得出现投标人名称、印章或任何身份标识；本导出已按暗标要求不输出页码。"))
    children.push(new Paragraph({ pageBreakBefore: true }))
  }
  const h0 = headingAt(0)
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [fontRun(`${project.project_name} 投标文件（技术标）`, { font: h0.font, size: h0.size, bold: true })],
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
    children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" }))
    breakBeforeNext = true
  }
  // 标题编号样式：数字层级 "1 / 1.1"；章—节式 "第1章 / 1.1"（现状默认）；无编号
  const chapterPrefix = (idx: number) =>
    fmt.titleNumbering === "none" ? "" : fmt.titleNumbering === "chapter" ? `第${idx + 1}章 ` : `${idx + 1} `
  const sectionPrefix = (idx: number, j: number) =>
    fmt.titleNumbering === "none" ? "" : `${idx + 1}.${j + 1} `
  for (const [idx, ch] of project.bid_chapters.entries()) {
    const chapter: Chapter = ch
    children.push(headingPara(0, `${chapterPrefix(idx)}${chapter.title}`, { before: 320, after: 200, pageBreakBefore: breakBeforeNext }))
    breakBeforeNext = false
    if (isBizPart(chapter)) {
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
    const cleanContent = sanitizeChapterText(chapter.content || "")
    const contentLines = cleanContent
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    let li = 0
    while (li < contentLines.length) {
      const line = contentLines[li]
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
      const isSubHeading =
        chapter.sections.some((s) => line.startsWith(s)) || /^\d+[.、]\s*\S/.test(line) || /^\d+\.\d+/.test(line)
      const isH3 = /^（[一二三四五六七八九十]+）/.test(line)
      if (!isSubHeading && !isH3 && firstBodyAt === -1) firstBodyAt = paras.length
      paras.push(isSubHeading ? headingPara(1, line) : isH3 ? headingPara(2, line) : bodyPara(line))
      li++
    }
    const figs = chapter.figures ?? []
    if (figs.length) {
      const figParas: Paragraph[] = []
      for (const spec of figs) {
        const png = await figureToPng(spec)
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
    headerText: fmt.headerFooter ? `${project.project_name} 投标文件` : "",
    footerPageNumber: fmt.pageNumber && !fmt.sealed,
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
        if (item.response_location) children.push(body(`响应位置：${item.response_location}`))
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

export function stageOf(project: BidProjectRecord): string {
  return STAGE_LABEL[project.stage] ?? "待解析"
}
