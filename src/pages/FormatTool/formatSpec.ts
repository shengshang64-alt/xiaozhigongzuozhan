import { unzipSync, strFromU8 } from "fflate"
import {
  DEFAULT_FORMAT_SETTINGS,
  FORMAT_FONT_OPTIONS,
  FORMAT_SIZE_OPTIONS,
  type FormatAlign,
  type FormatFont,
  type FormatPaper,
  type FormatSettings,
  type FormatFontSize,
  type HeadingFormat,
} from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// 格式刷新工具 · 第一阶段：从一份「标准化格式方案 docx」里识别各级标题 / 正文 / 页边距
// 纯前端完成——fflate 解包 OOXML，DOMParser 解析 word/styles.xml + word/document.xml。
// 抽取结果为「原始精确」FormatSpec（任意字体名 / pt 磅 / twips 边距），
// 既用于人工核对预览，也用于：① 桥接映射到现有 FormatSettings 供标书/方案导出套用；
// ② 第二阶段刷新任意 docx 时按原始值精确改写 styles.xml。
// ---------------------------------------------------------------------------

const WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const TWIPS_PER_CM = 566.928

/** 单个段落/字符层面的原始格式事实 */
export type RawPara = {
  /** 中文字体名（w:rFonts/@w:eastAsia），如 宋体 / 黑体 / 仿宋_GB2312 / 微软雅黑 */
  fontEastAsia: string
  /** 西文字体名（@w:ascii） */
  fontAscii: string
  /** 字号（磅）——从 w:sz 半 pt 值 /2 得到 */
  sizePt: number
  bold: boolean
  align: FormatAlign | ""
  /** 归一行距描述：单倍 / 1.5倍 / 2倍 / 固定值N磅 / "" (未设) */
  lineSpacing: string
  /** 首行缩进（字符数，w:ind/@w:firstLineChars /100） */
  firstLineChars: number
  /** 字色 RGB 十六进制（w:color/@w:val，去掉自动） */
  colorRgb: string
}

/** 某一级标题样式 */
export type HeadingSpec = RawPara & {
  level: number
  styleId: string
  styleName: string
}

/** 从 docx 识别出的完整格式规范（原始精确值） */
export type FormatSpec = {
  sourceFileName: string
  page: {
    /** 纸张宽 / 高（twips） */
    paperW: number
    paperH: number
    /** 页边距（cm） */
    margin: { top: number; right: number; bottom: number; left: number }
    /** 就近判定的纸张枚举 */
    paperGuess: FormatPaper
  }
  body: RawPara & { styleId: string; styleName: string }
  /** 已识别标题样式，按 level 升序（可能不足 6 级） */
  headings: HeadingSpec[]
  /** 段落样式总数（供刷新 / 清理阶段展示） */
  paragraphStyleCount: number
  /** 未被任何标题/正文命中的段落样式数（清理预览用） */
  styleSample: { styleId: string; name: string }[]
}

// ---- XML 小工具：兼容带命名空间前缀与不带两种属性写法 --------------------

function attr(el: Element | null, local: string): string {
  if (!el) return ""
  const ns = el.getAttributeNS(WNS, local)
  if (ns !== null && ns !== "") return ns
  const plain = el.getAttribute(local)
  if (plain !== null && plain !== "") return plain
  const prefixed = el.getAttribute("w:" + local)
  return prefixed ?? ""
}

function child(parent: Element | null, local: string): Element | null {
  if (!parent) return null
  const list = parent.getElementsByTagNameNS(WNS, local)
  if (list && list.length) return list[0]
  return parent.getElementsByTagName("w:" + local)[0] ?? null
}

/** 只看元素自身直接子节点里的第一个 w:local（避免误抓孙节点） */
function directChild(parent: Element | null, local: string): Element | null {
  if (!parent) return null
  const tag = "w:" + local
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i]
    if (c.localName === local || c.tagName === tag) return c
  }
  return null
}

function num(v: string, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 从 rPr 元素抽取字体/字号/加粗/颜色 */
function readRunProps(rPr: Element | null): Partial<RawPara> {
  const out: Partial<RawPara> = {}
  if (!rPr) return out
  const rFonts = directChild(rPr, "rFonts")
  out.fontEastAsia = attr(rFonts, "eastAsia")
  out.fontAscii = attr(rFonts, "ascii")
  const sz = directChild(rPr, "sz")
  if (sz) out.sizePt = num(attr(sz, "val")) / 2
  out.bold = !!directChild(rPr, "b") && attr(directChild(rPr, "b"), "val") !== "0" && attr(directChild(rPr, "b"), "val") !== "false"
  const color = directChild(rPr, "color")
  const cv = attr(color, "val")
  out.colorRgb = color && cv && cv.toLowerCase() !== "auto" ? cv.replace(/^#/, "") : ""
  return out
}

/** 从 pPr 元素抽取对齐/行距/首行缩进 */
function readParaProps(pPr: Element | null): Partial<RawPara> {
  const out: Partial<RawPara> = {}
  if (!pPr) return out
  const jc = directChild(pPr, "jc")
  const jcv = attr(jc, "val")
  out.align = (jcv === "center" || jcv === "right" || jcv === "both" || jcv === "left")
    ? (jcv === "both" ? "justify" : (jcv as FormatAlign))
    : ""
  const spacing = directChild(pPr, "spacing")
  if (spacing) {
    const line = num(attr(spacing, "line"))
    const rule = attr(spacing, "lineRule")
    if (line > 0) {
      if (rule === "exact" || rule === "atLeast") {
        out.lineSpacing = `固定值${Math.round(line / 20)}磅`
      } else {
        const ratio = line / 240
        if (Math.abs(ratio - 1) < 0.05) out.lineSpacing = "单倍"
        else if (Math.abs(ratio - 1.5) < 0.05) out.lineSpacing = "1.5倍"
        else if (Math.abs(ratio - 2) < 0.06) out.lineSpacing = "2倍"
        else out.lineSpacing = `${Math.round(ratio * 10) / 10}倍`
      }
    }
  }
  const ind = directChild(pPr, "ind")
  const chars = num(attr(ind, "firstLineChars"))
  if (chars > 0) out.firstLineChars = Math.round((chars / 100) * 10) / 10
  return out
}

function mergePara(base: RawPara, patch: Partial<RawPara>): RawPara {
  const m: RawPara = { ...base }
  if (patch.fontEastAsia) m.fontEastAsia = patch.fontEastAsia
  if (patch.fontAscii) m.fontAscii = patch.fontAscii
  if (patch.sizePt) m.sizePt = patch.sizePt
  if (patch.bold) m.bold = true
  if (patch.align) m.align = patch.align
  if (patch.lineSpacing) m.lineSpacing = patch.lineSpacing
  if (patch.firstLineChars) m.firstLineChars = patch.firstLineChars
  if (patch.colorRgb) m.colorRgb = patch.colorRgb
  return m
}

const EMPTY_PARA: RawPara = {
  fontEastAsia: "",
  fontAscii: "",
  sizePt: 0,
  bold: false,
  align: "",
  lineSpacing: "",
  firstLineChars: 0,
  colorRgb: "",
}

/** 解析样式名 → 标题级别（英文 heading 1 / 中文 标题 1 / outlineLvl） */
function headingLevelOf(styleEl: Element, pPr: Element | null): number {
  const name = attr(child(styleEl, "name"), "val").toLowerCase()
  const m = /(?:heading|标题)\s*([1-6])/.exec(name)
  if (m) return Number(m[1])
  const outline = directChild(pPr, "outlineLvl")
  if (outline) {
    const lvl = num(attr(outline, "val"), -1)
    if (lvl >= 0 && lvl <= 5) return lvl + 1
  }
  return 0
}

function guessPaper(w: number, h: number): FormatPaper {
  const long = Math.max(w, h)
  // A4 高 16838、A3 高 23811、16K 高 14740（twips），取最接近
  const table: [FormatPaper, number][] = [["16K", 14740], ["A4", 16838], ["A3", 23811]]
  let best: FormatPaper = "A4"
  let bestDiff = Infinity
  for (const [p, hv] of table) {
    const d = Math.abs(long - hv)
    if (d < bestDiff) {
      bestDiff = d
      best = p
    }
  }
  return best
}

/**
 * 从 .docx 二进制识别格式规范。只读 styles.xml / document.xml，不落库、不上传。
 * 抛错交由上层捕获并提示（例如非 zip / 加密 / 缺部件）。
 */
export async function extractFormatSpecFromFile(file: File): Promise<FormatSpec> {
  const buf = await file.arrayBuffer()
  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(new Uint8Array(buf))
  } catch {
    throw new Error("文件无法解压，可能不是有效的 .docx（或已加密）")
  }
  const stylesRaw = zip["word/styles.xml"]
  const docRaw = zip["word/document.xml"]
  if (!stylesRaw && !docRaw) throw new Error("压缩包内未找到 word 文档部件，请确认上传的是 Word 文档")
  const parser = new DOMParser()
  const stylesDoc = stylesRaw ? parser.parseFromString(strFromU8(stylesRaw), "application/xml") : null
  const docXml = docRaw ? parser.parseFromString(strFromU8(docRaw), "application/xml") : null

  // ---- 默认（docDefaults）作为基准 ----
  let defaults: RawPara = { ...EMPTY_PARA }
  const docDefaults = stylesDoc ? child(stylesDoc.documentElement, "docDefaults") : null
  if (docDefaults) {
    const rPrDefault = child(docDefaults, "rPrDefault")
    const pPrDefault = child(docDefaults, "pPrDefault")
    defaults = mergePara(defaults, readRunProps(child(rPrDefault, "rPr")))
    defaults = mergePara(defaults, readParaProps(child(pPrDefault, "pPr")))
  }

  // ---- 遍历段落样式 ----
  const styleEls: Element[] = stylesDoc ? Array.from(stylesDoc.getElementsByTagNameNS(WNS, "style")) : []
  const byId = new Map<string, Element>()
  for (const el of styleEls) byId.set(attr(el, "styleId"), el)

  const resolvedHeadings = new Map<number, HeadingSpec>()
  let bodySpec: RawPara & { styleId: string; styleName: string }
  let normalEl: Element | null = null
  const sample: { styleId: string; name: string }[] = []
  let paragraphStyleCount = 0

  for (const el of styleEls) {
    if (attr(el, "type") !== "paragraph") continue
    paragraphStyleCount++
    const styleId = attr(el, "styleId")
    const name = attr(child(el, "name"), "val")
    sample.push({ styleId, name })
    const level = headingLevelOf(el, child(el, "pPr"))
    if (level > 0 && !resolvedHeadings.has(level)) {
      let acc = defaults
      // 逐级合并 basedOn
      const chain: Element[] = [el]
      const seen = new Set<string>([styleId])
      let cur: Element | null = el
      for (let guard = 0; guard < 8; guard++) {
        const basedOn = attr(child(cur, "basedOn"), "val")
        if (!basedOn || seen.has(basedOn)) break
        const b = byId.get(basedOn) ?? null
        if (!b) break
        chain.unshift(b)
        seen.add(basedOn)
        cur = b
      }
      for (const node of chain) {
        const np = child(node, "pPr")
        const nr = child(node, "rPr")
        acc = mergePara(acc, readRunProps(nr))
        acc = mergePara(acc, readParaProps(np))
      }
      resolvedHeadings.set(level, { ...acc, level, styleId, styleName: name })
    }
    const isNormal = /normal|正文/i.test(name) || attr(el, "default") === "1"
    if (isNormal && !normalEl) normalEl = el
  }

  // ---- 正文：优先 Normal 样式，否则 docDefaults ----
  {
    let acc = defaults
    if (normalEl) {
      const np = child(normalEl, "pPr")
      const nr = child(normalEl, "rPr")
      acc = mergePara(acc, readRunProps(nr))
      acc = mergePara(acc, readParaProps(np))
    }
    bodySpec = { ...acc, styleId: normalEl ? attr(normalEl, "styleId") : "", styleName: normalEl ? attr(child(normalEl, "name"), "val") : "默认正文" }
  }

  // ---- 页边距 / 纸张：document.xml 最后一个 sectPr（主文档节） ----
  const page = { paperW: 11906, paperH: 16838, margin: { top: 2.54, right: 3.18, bottom: 2.54, left: 3.18 }, paperGuess: "A4" as FormatPaper }
  if (docXml) {
    const sects = docXml.getElementsByTagNameNS(WNS, "sectPr")
    const sect = sects && sects.length ? sects[sects.length - 1] : null
    const pgSz = sect ? directChild(sect, "pgSz") : null
    const pgMar = sect ? directChild(sect, "pgMar") : null
    if (pgSz) {
      page.paperW = num(attr(pgSz, "w"), page.paperW)
      page.paperH = num(attr(pgSz, "h"), page.paperH)
    }
    if (pgMar) {
      const cm = (v: string, fb: number) => (v ? Math.round((num(v) / TWIPS_PER_CM) * 100) / 100 : fb)
      page.margin = {
        top: cm(attr(pgMar, "top"), page.margin.top),
        right: cm(attr(pgMar, "right"), page.margin.right),
        bottom: cm(attr(pgMar, "bottom"), page.margin.bottom),
        left: cm(attr(pgMar, "left"), page.margin.left),
      }
    }
    page.paperGuess = guessPaper(page.paperW, page.paperH)
  }

  const headings = Array.from(resolvedHeadings.values()).sort((a, b) => a.level - b.level)

  return {
    sourceFileName: file.name,
    page,
    body: bodySpec,
    headings,
    paragraphStyleCount,
    styleSample: sample,
  }
}

// ---------------------------------------------------------------------------
// FormatSpec → 现有 FormatSettings 桥接（供标书 / 方案导出套用）
// 现有导出枚举受限（字体仅 宋/黑/仿/楷，字号仅 12 档中文字号），映射不上的取最近并记 notes。
// ---------------------------------------------------------------------------

/** 中文字号 → 磅 */
export const SIZE_PT: Record<FormatFontSize, number> = {
  初号: 42, 小初: 36, 一号: 26, 小一: 24, 二号: 22, 小二: 18,
  三号: 16, 小三: 15, 四号: 14, 小四: 12, 五号: 10.5, 小五: 9,
}

function nearestSize(pt: number): FormatFontSize {
  if (!pt) return "四号"
  let best: FormatFontSize = "四号"
  let diff = Infinity
  for (const s of FORMAT_SIZE_OPTIONS) {
    const d = Math.abs(SIZE_PT[s] - pt)
    if (d < diff) {
      diff = d
      best = s
    }
  }
  return best
}

function mapFont(raw: string, fallback: FormatFont, notes: Set<string>): FormatFont {
  const f = (raw || "").trim()
  if ((FORMAT_FONT_OPTIONS as string[]).includes(f)) return f as FormatFont
  if (/仿宋/.test(f)) return "仿宋"
  if (/黑/.test(f)) return "黑体"
  if (/宋|serif|songti/i.test(f)) return "宋体"
  if (/楷/.test(f)) return "楷体"
  if (f) notes.add(`导出枚举不含「${f}」，套用导出时就近为宋体（刷新原文时保留 ${f}）`)
  return fallback
}

/** 归一 FormatSpec → FormatSettings，并返回映射说明（近似项） */
export function specToFormatSettings(spec: FormatSpec): { settings: FormatSettings; notes: string[] } {
  const notesSet = new Set<string>()
  const d = DEFAULT_FORMAT_SETTINGS

  const headByLevel = new Map<number, HeadingSpec>()
  for (const h of spec.headings) headByLevel.set(h.level, h)

  const heading: HeadingFormat[] = d.heading.map((_, i) => {
    const lvl = i + 1
    const hs = headByLevel.get(lvl)
    if (!hs) {
      // 未识别到的级别：以就近的更高级标题为基准，否则缺省
      const fallback = spec.headings.find((x) => x.level < lvl)
      if (!fallback) return { font: "黑体", size: "三号", align: "left" }
      return { font: mapFont(fallback.fontEastAsia, "黑体", notesSet), size: nearestSize(fallback.sizePt), align: (fallback.align || "left") as FormatAlign }
    }
    return {
      font: mapFont(hs.fontEastAsia, "黑体", notesSet),
      size: nearestSize(hs.sizePt),
      align: (hs.align || "left") as FormatAlign,
    }
  })

  const body = {
    font: mapFont(spec.body.fontEastAsia, "仿宋", notesSet),
    size: nearestSize(spec.body.sizePt),
    firstIndent: spec.body.firstLineChars || 2,
    align: (spec.body.align || "justify") as FormatAlign,
    lineSpacing: spec.body.lineSpacing || "1.5倍",
  }
  if (spec.body.sizePt && Math.abs(spec.body.sizePt - SIZE_PT[body.size]) > 0.6) {
    notesSet.add(`正文字号 ${spec.body.sizePt}pt 就近映射为 ${body.size}`)
  }
  if (spec.body.lineSpacing && !["单倍", "1.5倍", "2倍"].includes(spec.body.lineSpacing) && !/^固定值\d+磅$/.test(spec.body.lineSpacing)) {
    notesSet.add(`正文行距 ${spec.body.lineSpacing} 超出导出档位，套用时会就近处理`)
  }

  const settings: FormatSettings = {
    ...d,
    paper: spec.page.paperGuess,
    margins: {
      top: spec.page.margin.top,
      bottom: spec.page.margin.bottom,
      left: spec.page.margin.left,
      right: spec.page.margin.right,
    },
    heading,
    body,
  }
  return { settings, notes: Array.from(notesSet) }
}
