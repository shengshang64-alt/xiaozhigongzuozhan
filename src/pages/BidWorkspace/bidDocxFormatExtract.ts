// ---------------------------------------------------------------------------
// R-042 底稿 docx 格式提取器（纯浏览器，零上传，零 AI）
//
// 背景：商务同事给的标书模板 docx 里已经排好版（字体/字号/边距/行距/标题层级样式），
// 用户上传底稿做「底稿增量合并」时，希望这些格式能自动同步到本项目的 format_settings，
// 导出成稿时与模板一致。
//
// 实现：docx 本质是 zip，用 fflate 解包 → DOMParser 读 word/styles.xml + word/document.xml，
// 提取 docDefaults（默认字体/字号/行距）+ Heading1-3 样式 + sectPr（页面尺寸/边距）。
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

      // ---- Heading1-3 样式 ----
      const styles = qa(doc.documentElement, "style")
      for (const s of styles) {
        const id = attr(s, "styleId") ?? ""
        if (!/^Heading[123]$/i.test(id)) continue
        const lvl = id.replace(/heading/i, "") as "1" | "2" | "3"
        const key = `heading${lvl}` as "heading1" | "heading2" | "heading3"
        const rPr2 = q(s, "rPr")
        if (!rPr2) continue
        const fonts = q(rPr2, "rFonts")
        const ea = attr(fonts, "eastAsia")
        const sz2 = attr(q(rPr2, "sz"), "val")
        const jc = attr(q(s, "pPr") ? q(q(s, "pPr")!, "jc") : null, "val")
        const obj: { font?: string; size?: string; align?: string } = {}
        if (ea) obj.font = ea
        if (sz2) obj.size = halfPtToChineseSize(Number(sz2))
        if (jc) obj.align = jc === "both" ? "justify" : jc
        if (Object.keys(obj).length) {
          result[key] = obj
          result.evidence[key] = `style#${id}: font=${ea ?? "?"} sz=${sz2 ?? "?"}pt=${sz2 ? Number(sz2) / 2 : "?"} align=${jc ?? "?"}`
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
  for (const lvl of [1, 2, 3] as const) {
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
  return fields
}
