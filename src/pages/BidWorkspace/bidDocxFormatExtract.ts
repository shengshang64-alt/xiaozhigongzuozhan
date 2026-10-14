// ---------------------------------------------------------------------------
// R-042 底稿 docx 格式提取器（纯浏览器，零上传，零 AI）
//
// 背景：商务同事给的标书模板 docx 里已经排好版（字体/字号/边距/行距/标题层级样式），
// 用户上传底稿做「底稿增量合并」时，希望这些格式能自动同步到本项目的 format_settings，
// 导出成稿时与模板一致。
//
// 实现：docx 本质是 zip，用 fflate 解包 → DOMParser 读 word/styles.xml + word/document.xml，
// 提取 docDefaults（默认字体/字号/行距）+ Heading1-6 样式 + sectPr（页面尺寸/边距）；
// R47（B20）另识别页眉页脚 / 页码域 / 目录域 / 封面 / 内容要求 / 表格样式 / 标题编号。
// 输出 FormatSettings 的 partial 结构，由调用方（DraftMergePanel）弹预览让你逐项勾选。
//
// 边界：
//  - 只提取能可靠映射到 FormatSettings 的字段；无法映射的（如自定义字符间距）忽略
//  - 单位换算：docx 半点 (half-point) → pt；缇 (twip) → cm；1/20 pt → 磅
//  - 缺 styles.xml 或 document.xml 时返回空 partial（不抛错，让 UI 显示"未提取到格式"）
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from "fflate"
import {
  DEFAULT_FORMAT_SETTINGS,
  FORMAT_ALIGN_OPTIONS,
  FORMAT_FONT_OPTIONS,
  FORMAT_SIZE_OPTIONS,
  type FormatAlign,
  type FormatFont,
  type FormatFontSize,
  type FormatPaper,
  type FormatSettings,
  type HeadingFormat,
  type TitleNumbering,
} from "./bidTypes"

/** 提取结果（FormatSettings 的 partial + 每项来源标签供 UI 展示） */
export interface ExtractedFormat {
  /** R-042：只产出本项目支持的纸张（A4/A3/16K，见 PAPER_OPTIONS）；识别不出则不产出该字段 */
  paper?: FormatPaper
  margins?: FormatSettings["margins"]
  bodyFont?: string
  bodySize?: string
  bodyLineSpacing?: string
  bodyFirstIndent?: number
  heading1?: { font?: string; size?: string; align?: string }
  heading2?: { font?: string; size?: string; align?: string }
  heading3?: { font?: string; size?: string; align?: string }
  heading4?: { font?: string; size?: string; align?: string }
  heading5?: { font?: string; size?: string; align?: string }
  heading6?: { font?: string; size?: string; align?: string }
  /** 表格样式（R47 B20）：边框粗细（如 "0.5pt"）+ 内容字体（「宋体五号」式组合串） */
  table?: { border?: string; contentFont?: string }
  /** 页眉 / 页脚文本（拼接同一节内所有 header/footer part 的可见文字；空=无） */
  header?: string
  footer?: string
  /** 页眉或页脚里检出 PAGE 域（=模板自带页码） */
  pageNumber?: boolean
  /** 正文检出 TOC 域（=模板自带目录） */
  toc?: boolean
  /** 标题编号规则：chapter=第N章式 / 1.1.1=数字层级 / none=无自动编号 */
  titleNumbering?: TitleNumbering
  /** 首页要素命中「投标文件 + 招标编号/项目名称/投标人」=模板带封面页 */
  cover?: boolean
  /** 模板里写明的「内容要求 / 格式要求」原文行（R47 B20；最多 40 条） */
  requirements?: string[]
  /** 提取过程中命中的原始值（供 UI tooltip 展示证据） */
  evidence: Record<string, string>
}

// ---------------- 纸张识别 ----------------
/**
 * 页面尺寸（twips）→ 本项目支持的纸张。数值与导出侧同口径（bidFiles.PAPER_TWIPS：
 * A4 11906×16838 / A3 16838×23811 / 16K 10489×14740），容差 200 twips（≈0.35cm）
 * 兼容各 Word 版本导出时的取整差异。表外纸张（Letter/Legal…）返回 null。
 *
 * 为什么不 import bidFiles 里的表：bidFiles 静态拉入 docx（数百 kB），而
 * onDemandHeavyLibs.test.ts 钉住「BidWorkspace 路由壳静态不可达 docx」——本文件经
 * FormatSyncDialog 静态可达。两张表的一致性由 bidDocxFormatExtract.test.ts 的 parity 用例钉住。
 */
const PAPER_TWIPS_LOCAL: { paper: FormatPaper; w: number; h: number }[] = [
  { paper: "A4", w: 11906, h: 16838 },
  { paper: "A3", w: 16838, h: 23811 },
  { paper: "16K", w: 10489, h: 14740 },
]

export function detectPaper(w: number, h: number): FormatPaper | null {
  for (const p of PAPER_TWIPS_LOCAL) {
    if (Math.abs(w - p.w) < 200 && Math.abs(h - p.h) < 200) return p.paper
  }
  return null
}

// ---------------- 单位换算 ----------------
/** 半点 → 中文字号（近似映射：14pt=四号 / 16pt=三号 / 12pt=小四 / 15pt=小三） */
function halfPtToChineseSize(halfPt: number): string {
  const pt = halfPt / 2
  const map: [number, string][] = [
    [8, "八号"], [9, "小五"], [10.5, "五号"], [12, "小四"], [14, "四号"],
    [15, "小三"], [16, "三号"], [18, "小二"], [22, "二号"], [24, "小一"],
    [26, "一号"], [36, "小初"], [42, "初号"],
  ]
  // 就近取
  let best = map[0]
  for (const m of map) if (Math.abs(pt - m[0]) < Math.abs(pt - best[0])) best = m
  return best[1]
}

/** 缇 (twip) → cm（1 twip = 1/1440 英寸 = 2.54/1440 cm） */
function twipToCm(twip: number): number {
  return Math.round((twip * 2.54) / 1440 * 100) / 100
}

/** w:spacing line 值 → 展示串（240 = 单倍；360 = 1.5 倍；exact 走"固定 X 磅"） */
function lineToDisplay(line: number, rule: string | null): string {
  if (rule === "exact" || rule === "atLeast") {
    const pt = Math.round((line / 20) * 10) / 10
    return `固定${pt}磅`
  }
  const mult = line / 240
  if (Math.abs(mult - 1) < 0.05) return "单倍"
  if (Math.abs(mult - 1.5) < 0.05) return "1.5倍"
  if (Math.abs(mult - 2) < 0.05) return "2倍"
  return `${Math.round(mult * 10) / 10}倍`
}

// ---------------- XML 查询小工具 ----------------
function q(el: Element | null | undefined, sel: string): Element | null {
  if (!el) return null
  // docx XML 用 w: 前缀，DOMParser 里 querySelector 需转义或用 localName
  // 简化：直接遍历匹配 localName + 属性
  const [tag, attrSpec] = sel.split("[")
  const wantAttr = attrSpec ? attrSpec.replace("]", "").split("=")[0] : null
  const wantVal = attrSpec ? attrSpec.replace("]", "").split("=")[1]?.replace(/^"|"$/g, "") : null
  const walk = (node: Element): Element | null => {
    for (const child of Array.from(node.children)) {
      if (child.localName === tag) {
        if (!wantAttr) return child
        if (child.getAttributeNS("*", wantAttr) === wantVal || child.getAttribute(wantAttr) === wantVal) return child
      }
      const r = walk(child)
      if (r) return r
    }
    return null
  }
  return walk(el as Element)
}

function qa(root: Document | Element, localName: string): Element[] {
  const out: Element[] = []
  const walk = (node: Element) => {
    for (const c of Array.from(node.children)) {
      if (c.localName === localName) out.push(c)
      walk(c)
    }
  }
  walk((root as Document).documentElement ?? (root as Element))
  return out
}

function attr(el: Element | null, name: string): string | null {
  if (!el) return null
  return el.getAttributeNS("*", name) ?? el.getAttribute(`w:${name}`) ?? el.getAttribute(name)
}

// ---------------- R47（B20）模板四类信息识别（标题层级 / 页眉页脚 / 要求 / 表格 / 编号） ----------------

/**
 * 段落样式 → 标题层级（1-6）；识别不到返回 0。
 * 三路识别（同一级标题在不同 Word 版本 / 语言下写法各异）：
 *   ① styleId 与样式名：Heading1 / heading 1 / 标题 1 / 标题1 / title 1（CN Word 的 styleId 常为 "1"）
 *   ② pPr/outlineLvl 大纲级别（0-5 → 1-6 级）
 * 这是「格式更新」此前只认 Heading1-3 的根因：第 4-6 级标题被整段丢弃。
 */
export function headingLevelOfStyle(id: string, styleName: string, pPr: Element | null): number {
  const strict = /^(?:heading|标题|title)\s*([1-6])$/i
  for (const cand of [id, styleName]) {
    const m = strict.exec((cand ?? "").trim())
    if (m) return Number(m[1])
  }
  for (const cand of [id, styleName]) {
    const t = (cand ?? "").trim()
    if (!/^(?:heading|标题|title)/i.test(t)) continue
    const m = /([1-6])\s*$/.exec(t)
    if (m) return Number(m[1])
  }
  const lvl = attr(q(pPr, "outlineLvl"), "val")
  if (lvl !== null && lvl !== "") {
    const n = Number(lvl)
    if (Number.isFinite(n) && n >= 0 && n <= 5) return Math.floor(n) + 1
  }
  return 0
}

/** 元素序列化（TOC / PAGE 域判定要在原始 XML 上做正则，文本节点里看不到域指令） */
function serializeXml(el: Element): string {
  try {
    return new XMLSerializer().serializeToString(el)
  } catch {
    return el.outerHTML ?? ""
  }
}

/** 原始 XML 里是否含指定域的指令（instrText 或 fldSimple@instr） */
function hasField(rawXml: string, field: string): boolean {
  if (!rawXml) return false
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\// ---------------- 主提取函数 ----------------")
  if (new RegExp("w:instrText[^>]*>\\s*" + esc + "\\b").test(rawXml)) return true
  return new RegExp("w:instr\\s*=\\s*\"\\s*" + esc + "\\b").test(rawXml)
}

/**
 * 段落文字采集：rawXml=原始 XML（供域判定）+ paragraphs=非空段落文本 + headingTexts=标题段落文本。
 * headingIds=样式表里识别到的标题 styleId 集合（正文里 pStyle="1" 式引用也能认出是标题段）。
 */
function collectParagraphTexts(
  root: Element,
  headingIds?: Set<string>,
): { rawXml: string; paragraphs: string[]; headingTexts: string[] } {
  const rawXml = serializeXml(root)
  const paragraphs: string[] = []
  const headingTexts: string[] = []
  for (const p of qa(root, "p")) {
    const text = qa(p, "t").map((t) => t.textContent ?? "").join("").replace(/\s+/g, " ").trim()
    if (!text) continue
    paragraphs.push(text)
    const pPr = q(p, "pPr")
    const styleRef = attr(q(pPr, "pStyle"), "val") ?? ""
    if (styleRef && (headingIds?.has(styleRef) || headingLevelOfStyle(styleRef, styleRef, pPr))) {
      headingTexts.push(text)
    }
  }
  return { rawXml, paragraphs, headingTexts }
}

/**
 * 页眉 / 页脚：同一节可能有多份 part（首页、奇数页、偶数页），拼成一行文本。
 * pageNumber=任一 part 里检出 PAGE 域（=模板自带页码；模板没有就是没有，不替用户臆造）。
 */
function readHeaderFooter(
  zip: Record<string, Uint8Array>,
  parser: DOMParser,
): { header: string; footer: string; pageNumber: boolean } {
  const read = (prefix: string) => {
    const texts: string[] = []
    let pageNumber = false
    for (const name of Object.keys(zip)) {
      if (!name.startsWith(prefix) || !name.endsWith(".xml")) continue
      const raw = strFromU8(zip[name])
      if (hasField(raw, "PAGE")) pageNumber = true
      const doc = parser.parseFromString(raw, "application/xml")
      for (const p of collectParagraphTexts(doc.documentElement).paragraphs) texts.push(p)
    }
    return { text: texts.join(" ").replace(/\s+/g, " ").trim().slice(0, 200), pageNumber }
  }
  const h = read("word/header")
  const f = read("word/footer")
  return { header: h.text, footer: f.text, pageNumber: h.pageNumber || f.pageNumber }
}

/** 封面识别：首屏 15 段同时出现「投标文件/响应文件」与「编号/项目名称/投标人」= 模板带封面页 */
function detectCover(paragraphs: string[], headingTexts: string[]): boolean {
  const head = paragraphs.map((p) => p.trim()).filter(Boolean).slice(0, 15).join(" ")
  if (!head) return false
  const title = /投标文件|响应文件|投标书|响应书/
  const meta = /招标编号|项目编号|采购编号|项目名称|投标人|供应商名称|投标单位|投标日期/
  if (title.test(head) && meta.test(head)) return true
  // 标题段落本身就是「投标文件」，首屏其余段写编号/项目名（信息分处不同段落）
  return headingTexts.slice(0, 3).some((t) => title.test(t)) && meta.test(head)
}

/** 模板里写明的「内容要求 / 格式要求 / 禁则」原文行（本地抽取，零 AI；去重、限长、最多 40 条） */
export function extractRequirementLines(paragraphs: string[]): string[] {
  const re = /须包含|应包含|必须包含|须列明|应列明|必须列明|须写明|应写明|须提供|应提供|须按照|应按照|不得出现|不得包含|不得使用|禁止|评分|评审|编制要求|格式要求|内容要求|章节目录|须满足|应满足/
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paragraphs) {
    const line = raw.replace(/\s+/g, " ").trim()
    if (line.length < 4 || line.length > 200) continue
    if (/\.{3,}/.test(line)) continue // 目录点线引导行
    if (!re.test(line)) continue
    const key = line.slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= 40) break
  }
  return out
}

/** 表格样式：边框粗细（w:sz 八分之一磅 → "0.5pt"）+ 内容字体（「宋体五号」式组合串） */
function detectTableStyle(
  doc: Document,
  parser: DOMParser,
  zip: Record<string, Uint8Array>,
): { border?: string; contentFont?: string } | null {
  const documentXml = zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : null
  if (!documentXml) return null
  const ddoc = parser.parseFromString(documentXml, "application/xml")
  const tbl = q(ddoc.documentElement, "tbl")
  if (!tbl) return null
  const out: { border?: string; contentFont?: string } = {}
  const tblPr = q(tbl, "tblPr")
  let borders = tblPr ? q(tblPr, "tblBorders") : null
  const tblStyleId = tblPr ? attr(q(tblPr, "tblStyle"), "val") : null
  if (!borders && tblStyleId) {
    // 直接格式没写边框时，回退到样式表里该表格样式（"TableGrid" 之类）的定义
    for (const st of qa(doc.documentElement, "style")) {
      if ((attr(st, "styleId") ?? "") !== tblStyleId) continue
      borders = q(st, "tblBorders")
      break
    }
  }
  const sz = attr(borders ? q(borders, "top") : null, "sz")
  if (sz) {
    const n = Number(sz)
    if (Number.isFinite(n) && n > 0) out.border = `${Math.round((n / 8) * 100) / 100}pt`
  }
  for (const r of qa(tbl, "r")) {
    const rPr = q(r, "rPr")
    const ea = attr(rPr ? q(rPr, "rFonts") : null, "eastAsia")
    if (!ea) continue
    const szR = attr(rPr ? q(rPr, "sz") : null, "val")
    const sizePart = szR && Number.isFinite(Number(szR)) ? halfPtToChineseSize(Number(szR)) : ""
    const font = FORMAT_FONT_OPTIONS.find((f) => ea.startsWith(f)) ?? ea
    out.contentFont = `${font}${sizePart}`.slice(0, 12)
    break
  }
  return Object.keys(out).length ? out : null
}

/**
 * 标题编号规则：numbering.xml 的 lvlText / numFmt + 样式表里标题样式是否挂 numPr。
 * 找不到依据返回 null（不写该字段，导出维持既有默认），避免替用户猜。
 */
function detectTitleNumbering(
  doc: Document,
  parser: DOMParser,
  zip: Record<string, Uint8Array>,
): { value: TitleNumbering; evidence: string } | null {
  let headingNumPr = false
  for (const st of qa(doc.documentElement, "style")) {
    const id = attr(st, "styleId") ?? ""
    const name = attr(q(st, "name"), "val") ?? ""
    if (!headingLevelOfStyle(id, name, null)) continue
    if (q(st, "numPr")) {
      headingNumPr = true
      break
    }
  }
  const numberingXml = zip["word/numbering.xml"] ? strFromU8(zip["word/numbering.xml"]) : null
  if (!numberingXml) {
    return headingNumPr
      ? { value: "chapter", evidence: "标题样式挂 numPr 但缺 numbering.xml，按导出默认「章—节式」落地" }
      : null
  }
  const ndoc = parser.parseFromString(numberingXml, "application/xml")
  const lvlTexts = qa(ndoc.documentElement, "lvlText").map((e) => attr(e, "val") ?? "")
  const fmts = qa(ndoc.documentElement, "numFmt").map((e) => attr(e, "val") ?? "")
  const chapterLvl = lvlTexts.some((t) => /第\s*%1\s*[章节篇]/.test(t))
  const dotted = lvlTexts.some((t) => /%1\.%2/.test(t))
  const chinese = fmts.includes("chineseCounting") || fmts.includes("chineseCountingThousand")
  const ev = `numbering.xml lvlText=${lvlTexts.slice(0, 3).join(" / ") || "-"} numFmt=${fmts.slice(0, 3).join(",") || "-"}`
  if (chapterLvl || (chinese && !dotted)) return { value: "chapter", evidence: `${ev} → 章—节式` }
  if (dotted) return { value: "1.1.1", evidence: `${ev} → 数字层级 1.1.1` }
  if (headingNumPr) return { value: "chapter", evidence: `${ev}（标题挂 numPr，格式未识别，按导出默认落地）` }
  return null
}

// ---------------- 主提取函数 ----------------
/**
 * 从 docx File 提取格式（不抛错；解不开或无 styles 时返回 evidence 空的 partial）。
 */
export async function extractDocxFormat(file: File): Promise<ExtractedFormat> {
  const result: ExtractedFormat = { evidence: {} }
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const zip = unzipSync(buf)
    const stylesXml = zip["word/styles.xml"] ? strFromU8(zip["word/styles.xml"]) : null
    const documentXml = zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : null
    const parser = new DOMParser()
    // R47（B20）：样式表里识别到的标题 styleId（正文段落 pStyle 命中即视为标题段）
    const headingStyleIds = new Set<string>()

    // ---- 从 styles.xml 读 docDefaults（默认字体/字号/行距）----
    if (stylesXml) {
      const doc = parser.parseFromString(stylesXml, "application/xml")
      const docDefaults = q(doc.documentElement, "docDefaults")
      const rPrDefault = q(docDefaults, "rPrDefault")
      const rPr = q(rPrDefault, "rPr")
      if (rPr) {
        const rFonts = q(rPr, "rFonts")
        const eastAsia = attr(rFonts, "eastAsia")
        const ascii = attr(rFonts, "ascii")
        if (eastAsia || ascii) {
          result.bodyFont = eastAsia || ascii || ""
          result.evidence.bodyFont = `docDefaults/rPr/rFonts eastAsia="${eastAsia ?? ""}" ascii="${ascii ?? ""}"`
        }
        const sz = q(rPr, "sz")
        const szVal = attr(sz, "val")
        if (szVal) {
          const n = Number(szVal)
          if (Number.isFinite(n)) {
            result.bodySize = halfPtToChineseSize(n)
            result.evidence.bodySize = `docDefaults/rPr/sz val=${szVal}（${n / 2}pt）`
          }
        }
        const spacing = q(rPr, "spacing")
        const line = attr(spacing, "line")
        const rule = attr(spacing, "lineRule")
        if (line) {
          result.bodyLineSpacing = lineToDisplay(Number(line), rule)
          result.evidence.bodyLineSpacing = `docDefaults/rPr/spacing line=${line} rule=${rule ?? "auto"}`
        }
      }

      // ---- R47（B20）：标题 1-6 级样式（此前只认 Heading1-3，商务模板的第 4-6 级标题
      //      被整段丢弃，导出时那几级标题退回缺省黑体三号；现按 styleId / 中文样式名 /
      //      outlineLvl 三路识别，识别到哪级写哪级） ----
      const styles = qa(doc.documentElement, "style")
      for (const st of styles) {
        const styleType = attr(st, "type")
        if (styleType && styleType !== "paragraph") continue
        const id = attr(st, "styleId") ?? ""
        const nameRaw = attr(q(st, "name"), "val") ?? ""
        const lvl = headingLevelOfStyle(id, nameRaw, q(st, "pPr"))
        if (!lvl) continue
        headingStyleIds.add(id)
        const key = `heading${lvl}` as "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6"
        if (result[key]) continue // 同级多份样式（如「标题 1」与「Heading1」并存）取先命中的一份
        const rPr2 = q(st, "rPr")
        const jc = attr(q(st, "pPr") ? q(q(st, "pPr")!, "jc") : null, "val")
        const fonts = rPr2 ? q(rPr2, "rFonts") : null
        const ea = attr(fonts, "eastAsia")
        const sz2 = rPr2 ? attr(q(rPr2, "sz"), "val") : null
        const obj: { font?: string; size?: string; align?: string } = {}
        if (ea) obj.font = ea
        if (sz2) obj.size = halfPtToChineseSize(Number(sz2))
        if (jc) obj.align = jc === "both" ? "justify" : jc
        if (Object.keys(obj).length) {
          result[key] = obj
          result.evidence[key] = `style#${id}(${nameRaw || "-"}): font=${ea ?? "?"} sz=${sz2 ?? "?"}pt=${sz2 ? Number(sz2) / 2 : "?"} align=${jc ?? "?"}`
        }
      }
    }

    // ---- 从 document.xml 读 sectPr（页面尺寸/边距）----
    if (documentXml) {
      const doc = parser.parseFromString(documentXml, "application/xml")
      const sectPr = q(doc.documentElement, "sectPr")
      const pgSz = q(sectPr, "pgSz")
      const pgMar = q(sectPr, "pgMar")
      if (pgSz) {
        const w = Number(attr(pgSz, "w") ?? 0)
        const h = Number(attr(pgSz, "h") ?? 0)
        const paper = detectPaper(w, h)
        if (paper) result.paper = paper
        result.evidence.paper = `pgSz w=${w} h=${h} twips${paper ? "" : "（表外纸张，不同步）"}`
      }
      if (pgMar) {
        const top = Number(attr(pgMar, "top") ?? 0)
        const bottom = Number(attr(pgMar, "bottom") ?? 0)
        const left = Number(attr(pgMar, "left") ?? 0)
        const right = Number(attr(pgMar, "right") ?? 0)
        if (top && bottom && left && right) {
          result.margins = { top: twipToCm(top), bottom: twipToCm(bottom), left: twipToCm(left), right: twipToCm(right) }
          result.evidence.margins = `pgMar top=${top} bottom=${bottom} left=${left} right=${right} twips`
        }
      }
      // 首行缩进：从 styles.xml 的 Normal 样式或 document.xml 段落取一次即可（这里跳过，标为可选）

      // ---- R47（B20）：页眉 / 页脚 / 页码域 / 目录域 / 封面 / 内容要求（此前完全不识别） ----
      const hf = readHeaderFooter(zip, parser)
      if (hf.header) result.header = hf.header
      if (hf.footer) result.footer = hf.footer
      if (hf.header || hf.footer) {
        result.pageNumber = hf.pageNumber
        result.evidence.pageNumber = `页眉/页脚检出 PAGE 域：${hf.pageNumber ? "是" : "否"}`
      }
      const docText = collectParagraphTexts(doc.documentElement, headingStyleIds)
      if (hasField(docText.rawXml, "TOC")) {
        result.toc = true
        result.evidence.toc = "正文检出 TOC 域（模板自带目录）"
      }
      result.cover = detectCover(docText.paragraphs, docText.headingTexts)
      if (result.cover) result.evidence.cover = "首页要素命中「投标文件 + 招标编号/项目名称/投标人」"
      const reqs = extractRequirementLines(docText.paragraphs)
      if (reqs.length) {
        result.requirements = reqs
        result.evidence.requirements = `模板正文命中 ${reqs.length} 条「须包含 / 应列明」式要求`
      }
    }
    // ---- R47（B20）：表格样式与标题编号规则（styles.xml + numbering.xml） ----
    if (stylesXml) {
      const doc2 = parser.parseFromString(stylesXml, "application/xml")
      const tbl = detectTableStyle(doc2, parser, zip)
      if (tbl) {
        result.table = tbl
        result.evidence.table = `表格样式：边框 ${tbl.border ?? "?"} / 内容 ${tbl.contentFont ?? "?"}`
      }
      const numbering = detectTitleNumbering(doc2, parser, zip)
      if (numbering) {
        result.titleNumbering = numbering.value
        result.evidence.titleNumbering = numbering.evidence
      }
    }
  } catch {
    // 静默失败：UI 层看到 evidence 空就提示"未提取到格式"
  }
  return result
}

// ---------------- 值映射（docx 原值 → 本项目受限枚举） ----------------
// 本项目只支持 4 种中文字体 / 12 种中文字号 / 4 种对齐（见 bidTypes 的 FORMAT_*_OPTIONS）。
// 而 docx 里常出现等线、仿宋_GB2312、Times New Roman 等表外值：直接写进 format_settings，
// 导出侧查 FORMAT_SIZE_PT / 字体映射时会取不到（NaN 或静默回退），所以统一在这里收口——
// 能映射就映射，映射不了退回该字段缺省值，并在预览里显示「原值 → 落地值」让用户看得见。
function coerceFont(v: string | undefined, fallback: FormatFont): FormatFont {
  const t = (v ?? "").trim()
  return (FORMAT_FONT_OPTIONS as string[]).includes(t) ? (t as FormatFont) : fallback
}
function coerceSize(v: string | undefined, fallback: FormatFontSize): FormatFontSize {
  const t = (v ?? "").trim()
  return (FORMAT_SIZE_OPTIONS as string[]).includes(t) ? (t as FormatFontSize) : fallback
}
function coerceAlign(v: string | undefined, fallback: FormatAlign): FormatAlign {
  const t = (v ?? "").trim()
  return FORMAT_ALIGN_OPTIONS.some((o) => o.value === t) ? (t as FormatAlign) : fallback
}
/** 预览展示：原值与落地值不同时标出「原值 → 落地值」 */
function mapNote(raw: string | undefined, mapped: string): string {
  const r = (raw ?? "").trim()
  return r && r !== mapped ? `${r} → ${mapped}` : mapped
}

/** 提取结果 → 可勾选的字段清单（供预览弹窗渲染） */
export interface FormatField {
  key: string
  label: string
  value: string
  evidence?: string
  apply: (target: Partial<FormatSettings>) => void
}

export function extractedToFields(ext: ExtractedFormat): FormatField[] {
  const fields: FormatField[] = []
  const def = DEFAULT_FORMAT_SETTINGS
  if (ext.paper) {
    // 收进局部常量：闭包里 TS 不保留对 ext.paper 的窄化
    const paper = ext.paper
    fields.push({
      key: "paper", label: "纸张", value: paper, evidence: ext.evidence.paper,
      apply: (t) => { t.paper = paper },
    })
  }
  if (ext.margins) {
    const m = ext.margins
    fields.push({
      key: "margins", label: "页边距",
      value: `上${m.top} 下${m.bottom} 左${m.left} 右${m.right} cm`,
      evidence: ext.evidence.margins,
      apply: (t) => { t.margins = m },
    })
  }
  if (ext.bodyFont) {
    const mapped = coerceFont(ext.bodyFont, def.body.font)
    fields.push({
      key: "bodyFont", label: "正文字体", value: mapNote(ext.bodyFont, mapped), evidence: ext.evidence.bodyFont,
      apply: (t) => { t.body = { ...(t.body ?? def.body), font: mapped } },
    })
  }
  if (ext.bodySize) {
    const mapped = coerceSize(ext.bodySize, def.body.size)
    fields.push({
      key: "bodySize", label: "正文字号", value: mapNote(ext.bodySize, mapped), evidence: ext.evidence.bodySize,
      apply: (t) => { t.body = { ...(t.body ?? def.body), size: mapped } },
    })
  }
  if (ext.bodyLineSpacing) {
    const ls = ext.bodyLineSpacing
    fields.push({
      key: "bodyLineSpacing", label: "正文行距", value: ls, evidence: ext.evidence.bodyLineSpacing,
      apply: (t) => { t.body = { ...(t.body ?? def.body), lineSpacing: ls } },
    })
  }
  for (const lvl of [1, 2, 3, 4, 5, 6] as const) {
    const h = ext[`heading${lvl}`]
    if (!h) continue
    const fb = def.heading[lvl - 1]
    const mapped: HeadingFormat = {
      font: coerceFont(h.font, fb.font),
      size: coerceSize(h.size, fb.size),
      align: coerceAlign(h.align, fb.align),
    }
    const parts: string[] = []
    if (h.font) parts.push(`字体 ${mapNote(h.font, mapped.font)}`)
    if (h.size) parts.push(`字号 ${mapNote(h.size, mapped.size)}`)
    if (h.align) parts.push(`对齐 ${mapNote(h.align, mapped.align)}`)
    fields.push({
      key: `heading${lvl}`, label: `${lvl} 级标题`, value: parts.join(" · "),
      evidence: ext.evidence[`heading${lvl}`],
      apply: (t) => {
        const arr: HeadingFormat[] = [...(t.heading ?? def.heading)]
        while (arr.length < def.heading.length) arr.push({ ...def.heading[arr.length] })
        arr[lvl - 1] = { ...arr[lvl - 1], ...mapped }
        t.heading = arr
      },
    })
  }
  // ---- R47（B20）：表格 / 页眉页脚 / 页码 / 目录 / 标题编号（此前只同步纸张+正文+1-3 级标题）----
  if (ext.table?.border || ext.table?.contentFont) {
    const tb = ext.table
    fields.push({
      key: "table", label: "表格样式",
      value: `边框 ${tb.border ?? def.table.border} · 内容 ${tb.contentFont ?? def.table.contentFont}`,
      evidence: ext.evidence.table,
      apply: (t) => {
        t.table = {
          border: tb.border ?? t.table?.border ?? def.table.border,
          contentFont: tb.contentFont ?? t.table?.contentFont ?? def.table.contentFont,
        }
      },
    })
  }
  if (ext.header || ext.footer) {
    const parts: string[] = []
    if (ext.header) parts.push(`页眉「${ext.header}」`)
    if (ext.footer) parts.push(`页脚「${ext.footer}」`)
    const hasPage = ext.pageNumber === true
    fields.push({
      key: "headerFooter", label: "页眉页脚",
      value: `${parts.join(" ")} → 导出开启页眉页脚`,
      evidence: ext.evidence.pageNumber,
      apply: (t) => { t.headerFooter = true },
    })
    fields.push({
      key: "pageNumber", label: "页码",
      value: hasPage ? "模板页眉/页脚带页码域 → 导出输出页码" : "模板页眉/页脚无页码域 → 导出不输出页码",
      evidence: ext.evidence.pageNumber,
      apply: (t) => { t.pageNumber = hasPage },
    })
  }
  if (ext.toc) {
    fields.push({
      key: "toc", label: "目录",
      value: "模板正文带目录域 → 导出生成目录",
      evidence: ext.evidence.toc,
      apply: (t) => { t.toc = true },
    })
  }
  if (ext.titleNumbering) {
    const numbering = ext.titleNumbering
    const label = numbering === "chapter" ? "章—节式（第N章）" : numbering === "none" ? "无编号" : "数字层级（1 / 1.1 / 1.1.1）"
    fields.push({
      key: "titleNumbering", label: "标题编号",
      value: label,
      evidence: ext.evidence.titleNumbering,
      apply: (t) => { t.titleNumbering = numbering },
    })
  }
  return fields
}
