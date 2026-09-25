import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import { SIZE_PT } from "./formatSpec"
import type { FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import type { FormatScope } from "./formatDiff"

// ---------------------------------------------------------------------------
// 格式刷新 · 第二阶段（R58 落地）：按模板配置精确改写上传 docx 的 styles.xml 与
// document.xml 的 sectPr，重打包下载。文字 0 改动——只动样式定义与节属性。
// 实现为纯字符串手术（不依赖 DOMParser，可在 node 单测），改写范围与第 3 步
// computeFormatDiff 的 scope 勾选严格同口径：
//   font    → docDefaults + Normal 的 rFonts/sz + Normal 的 ind(首行缩进)
//   spacing → Normal 的 spacing(行距) + jc(对齐)
//   heading → 各级标题样式的 rFonts/sz/jc
//   page    → 最后一个 sectPr 的 pgSz/pgMar
// 已知边界（报告 notes 里如实提示）：段落级直接格式化(跑内 rPr)不受样式改写影响；
// 多节文档只改主节(最后一个 sectPr)；文档缺少「标题N」样式时该级跳过并记 notes。
// ---------------------------------------------------------------------------

const TWIPS_PER_CM = 566.928
const PAPER_TWIPS: Record<string, [number, number]> = {
  A4: [11906, 16838],
  A3: [16838, 23811],
  "16K": [10431, 14740],
}

/** rPr 子元素的 schema 顺序（管理面 + 常见锚点，用于缺失时定位插入点） */
const RPR_ORDER = [
  "w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike",
  "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid",
  "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position",
  "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText",
  "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath",
]
/** pPr 子元素的 schema 顺序（同上） */
const PPR_ORDER = [
  "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl",
  "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens",
  "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
  "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing",
  "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment",
  "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
]

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * 在容器 XML 内插入/替换一个空元素（统一序列化为自闭合）。
 * 已存在时做【属性级合并】：未管理的属性（如 spacing 的 w:after）原样保留，
 * 只覆盖本次管理的键；缺失时按 schema 顺序找插入点。
 */
function upsertEmptyElement(container: string, tag: string, attrs: Record<string, string>, order: string[]): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</${tag}>)`)
  const existing = re.exec(container)
  if (existing && existing.index !== undefined) {
    const merged: Record<string, string> = {}
    for (const m of existing[0].matchAll(/([\w:]+)="([^"]*)"/g)) merged[m[1]] = m[2]
    Object.assign(merged, attrs)
    const attrsXml = Object.entries(merged).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")
    return container.slice(0, existing.index) + `<${tag} ${attrsXml}/>` + container.slice(existing.index + existing[0].length)
  }
  const fresh = `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`
  const rank = order.indexOf(tag)
  for (let i = rank + 1; i < order.length; i++) {
    const anchor = order[i]
    const m = new RegExp(`<${anchor}[\\s/>]`).exec(container)
    if (m && m.index !== undefined) {
      return container.slice(0, m.index) + fresh + container.slice(m.index)
    }
  }
  // 没有任何后继锚点 → 插到容器收尾前
  const local = tag.includes(":") ? tag.split(":")[1] : tag
  const closeRe = new RegExp(`</${local}>$`)
  const closeMatch = closeRe.exec(container)
  if (closeMatch && closeMatch.index !== undefined) {
    return container.slice(0, closeMatch.index) + fresh + container.slice(closeMatch.index)
  }
  return container + fresh
}

/** 空元素属性赋值：属性存在则替换值，不存在则插入 `/>` 前 */
function setAttrs(elXml: string, attrs: Record<string, string>): string {
  let out = elXml
  for (const [name, val] of Object.entries(attrs)) {
    const attrRe = new RegExp(`(${name.replace("w:", "w:")}=")[^"]*(")`)
    if (attrRe.test(out)) out = out.replace(attrRe, `$1${esc(val)}$2`)
    else out = out.replace(/\s*\/>$/, "") + ` ${name}="${esc(val)}"/>`
  }
  return out
}

/** 定位 <tag ...>...</tag> 片段（含自闭合）；找不到返回 null */
function spanOf(xml: string, tag: string, from = 0): { start: number; end: number; text: string } | null {
  const open = new RegExp(`<${tag}(?:\\s[^>]*?)?(?:/>|>)`)
  const m = open.exec(xml.slice(from))
  if (!m || m.index === undefined) return null
  const start = from + m.index
  if (m[0].endsWith("/>")) return { start, end: start + m[0].length, text: m[0] }
  const close = `</${tag}>`
  const end = xml.indexOf(close, start)
  if (end < 0) return null
  return { start, end: end + close.length, text: xml.slice(start, end + close.length) }
}

type Rewrites = { rPr?: Record<string, Record<string, string>>; pPr?: Record<string, Record<string, string>> }

/** 对单个 <w:style> 块执行 rPr/pPr 管理元素改写；容器缺失时按 schema 位置创建 */
function rewriteStyleBlock(block: string, ops: Rewrites): string {
  let out = block
  const needPPR = !!ops.pPr && Object.keys(ops.pPr).length > 0
  const needRPR = !!ops.rPr && Object.keys(ops.rPr).length > 0

  // ---- pPr（style 的直接子节点；块内第一个 pPr 即直接子节点）----
  let pPrSpan = spanOf(out, "w:pPr")
  if (needPPR) {
    if (!pPrSpan) {
      const insertAt = spanOf(out, "w:rPr")?.start ?? out.indexOf("</w:style>")
      if (insertAt < 0) return out
      const created = `<w:pPr></w:pPr>`
      out = out.slice(0, insertAt) + created + out.slice(insertAt)
      pPrSpan = spanOf(out, "w:pPr")
    }
    if (pPrSpan) {
      let inner = pPrSpan.text.slice("<w:pPr>".length, -"</w:pPr>".length)
      for (const [tag, attrs] of Object.entries(ops.pPr ?? {})) inner = upsertEmptyElement(inner, tag, attrs, PPR_ORDER)
      out = out.slice(0, pPrSpan.start) + `<w:pPr>${inner}</w:pPr>` + out.slice(pPrSpan.end)
    }
  }

  // ---- rPr（style 的直接子节点 = pPr 之后的第一个 rPr，避免抓到 pPr 内的段落标记 rPr）----
  if (needRPR) {
    const searchFrom = pPrSpan ? pPrSpan.end : 0
    let rPrSpan = spanOf(out, "w:rPr", searchFrom)
    if (!rPrSpan) {
      const insertAt = out.indexOf("</w:style>")
      if (insertAt < 0) return out
      out = out.slice(0, insertAt) + `<w:rPr></w:rPr>` + out.slice(insertAt)
      rPrSpan = spanOf(out, "w:rPr", searchFrom)
    }
    if (rPrSpan) {
      let inner = rPrSpan.text.slice("<w:rPr>".length, -"</w:rPr>".length)
      for (const [tag, attrs] of Object.entries(ops.rPr ?? {})) inner = upsertEmptyElement(inner, tag, attrs, RPR_ORDER)
      out = out.slice(0, rPrSpan.start) + `<w:rPr>${inner}</w:rPr>` + out.slice(rPrSpan.end)
    }
  }
  return out
}

function fontAttrs(font: string): Record<string, string> {
  const f = esc(font)
  return { "w:ascii": f, "w:hAnsi": f, "w:eastAsia": f, "w:cs": f }
}

/** 行距描述 → w:spacing 管理属性（未管理的 w:before/w:after 由属性合并保留） */
function lineSpacingAttrs(ls: string): Record<string, string> {
  const fixed = /^固定值(\d+(?:\.\d+)?)磅$/.exec(ls)
  if (fixed) return { "w:line": String(Math.round(Number(fixed[1]) * 20)), "w:lineRule": "exact" }
  const mult = /^(\d+(?:\.\d+)?)倍$/.exec(ls)
  if (mult) return { "w:line": String(Math.round(Number(mult[1]) * 240)), "w:lineRule": "auto" }
  if (ls === "单倍") return { "w:line": "240", "w:lineRule": "auto" }
  return { "w:line": "360", "w:lineRule": "auto" }
}

function alignVal(a: string): string {
  return a === "justify" ? "both" : a || "both"
}

/** 样式名/styleId → 标题级别（0 = 非标题）；镜像 formatSpec.ts 的判定口径 */
function headingLevelOfStyle(block: string): number {
  const nameM = /<w:name w:val="([^"]*)"/.exec(block)
  const name = (nameM?.[1] ?? "").toLowerCase()
  const m = /(?:heading|标题)\s*([1-6])/.exec(name)
  if (m) return Number(m[1])
  const outline = /<w:outlineLvl w:val="([0-5])"/.exec(block)
  if (outline) return Number(outline[1]) + 1
  return 0
}

/**
 * 改写 styles.xml。返回新 XML；跳过项写入 notes（不改写不静默）。
 */
export function refreshStylesXml(
  stylesXml: string,
  settings: FormatSettings,
  scopes: FormatScope[],
  notes: string[],
): string {
  const on = (s: FormatScope) => scopes.includes(s)
  let out = stylesXml
  const bodyPt = SIZE_PT[settings.body.size] ?? 12

  // ---- docDefaults（font 范围：正文默认字体字号兜底；空/缺失时从零创建 rPrDefault）----
  if (on("font")) {
    let dd = spanOf(out, "w:docDefaults")
    if (!dd) {
      const open = /<w:styles[^>]*>/.exec(out)
      if (open && open.index !== undefined) {
        const insertAt = open.index + open[0].length
        const created = `<w:docDefaults><w:rPrDefault><w:rPr></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`
        out = out.slice(0, insertAt) + created + out.slice(insertAt)
        dd = spanOf(out, "w:docDefaults")
      }
    }
    if (dd) {
      const half = String(Math.round(bodyPt * 2))
      const fontA = fontAttrs(settings.body.font)
      const szA = { "w:val": half }
      const rprd = spanOf(dd.text, "w:rPrDefault")
      const rpr = rprd && !rprd.text.endsWith("/>") ? spanOf(rprd.text, "w:rPr") : null
      if (rpr) {
        let inner = rpr.text.slice("<w:rPr>".length, -"</w:rPr>".length)
        inner = upsertEmptyElement(inner, "w:rFonts", fontA, RPR_ORDER)
        inner = upsertEmptyElement(inner, "w:sz", szA, RPR_ORDER)
        inner = upsertEmptyElement(inner, "w:szCs", szA, RPR_ORDER)
        out = out.slice(0, dd.start + rpr.start) + `<w:rPr>${inner}</w:rPr>` + out.slice(dd.start + rpr.end)
      } else {
        // rPrDefault 自闭合/缺失：整体替换为带管理属性的完整节点
        const attrsXml = Object.entries(fontA).map(([k, v]) => `${k}="${v}"`).join(" ")
        const freshCore = `<w:rPr><w:rFonts ${attrsXml}/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr>`
        if (rprd) {
          out = out.slice(0, dd.start + rprd.start) + `<w:rPrDefault>${freshCore}</w:rPrDefault>` + out.slice(dd.start + rprd.end)
        } else {
          const insertAt = dd.start + "<w:docDefaults>".length
          out = out.slice(0, insertAt) + `<w:rPrDefault>${freshCore}</w:rPrDefault>` + out.slice(insertAt)
        }
      }
    }
  }

  // ---- 逐样式块 ----
  const styleRe = /<w:style\s[^>]*>[\s\S]*?<\/w:style>/g
  const seenHeading = new Set<number>()
  let result = ""
  let last = 0
  for (const m of out.matchAll(styleRe)) {
    const block = m[0]
    result += out.slice(last, m.index)
    last = m.index + block.length

    const isParagraph = /w:type="paragraph"/.test(block)
    const nameM = /<w:name w:val="([^"]*)"/.exec(block)
    const name = nameM?.[1] ?? ""
    const isNormal = isParagraph && (/normal|正文/i.test(name) || /w:default="1"/.test(block))

    if (isNormal && (on("font") || on("spacing"))) {
      const ops: Rewrites = {}
      if (on("font")) {
        ops.rPr = {
          "w:rFonts": fontAttrs(settings.body.font),
          "w:sz": { "w:val": String(Math.round(bodyPt * 2)) },
          "w:szCs": { "w:val": String(Math.round(bodyPt * 2)) },
        }
        // 首行缩进按 diff 口径归 font 范围
        const chars = settings.body.firstIndent || 0
        ops.pPr = {
          "w:ind":
            chars > 0
              ? { "w:firstLine": String(Math.round(chars * bodyPt * 20)), "w:firstLineChars": String(Math.round(chars * 100)) }
              : { "w:firstLine": "0", "w:firstLineChars": "0" },
        }
      }
      if (on("spacing")) {
        ops.pPr = {
          ...(ops.pPr ?? {}),
          "w:spacing": lineSpacingAttrs(settings.body.lineSpacing),
          "w:jc": { "w:val": alignVal(settings.body.align) },
        }
      }
      result += rewriteStyleBlock(block, ops)
      continue
    }

    if (isParagraph && on("heading")) {
      const lvl = headingLevelOfStyle(block)
      if (lvl >= 1 && lvl <= settings.heading.length) {
      const cfg = settings.heading[lvl - 1]
      const pt = SIZE_PT[cfg.size] ?? 16
      result += rewriteStyleBlock(block, {
        rPr: {
          "w:rFonts": fontAttrs(cfg.font),
          "w:sz": { "w:val": String(Math.round(pt * 2)) },
          "w:szCs": { "w:val": String(Math.round(pt * 2)) },
        },
        pPr: { "w:jc": { "w:val": alignVal(cfg.align) } },
      })
        seenHeading.add(lvl)
        continue
      }
    }

    result += block
  }
  result += out.slice(last)

  if (on("heading")) {
    for (let lvl = 1; lvl <= settings.heading.length; lvl++) {
      if (!seenHeading.has(lvl)) notes.push(`文档中没有「标题${lvl}」样式，该级标题未改写（原文档可能未用到该级）`)
    }
  }
  return result
}

/**
 * 改写 document.xml 的最后一个 sectPr（主文档节，与识别口径一致）：纸张 + 页边距。
 */
export function refreshDocumentXml(
  docXml: string,
  settings: FormatSettings,
  scopes: FormatScope[],
  notes: string[],
): string {
  if (!scopes.includes("page")) return docXml
  const sectRe = /<w:sectPr(?:\s[^>]*?)?>[\s\S]*?<\/w:sectPr>/g
  let last: { start: number; end: number; text: string } | null = null
  for (const m of docXml.matchAll(sectRe)) {
    last = { start: m.index, end: m.index + m[0].length, text: m[0] }
  }
  if (!last) {
    notes.push("文档没有分节属性(sectPr)，纸张与页边距未改写")
    return docXml
  }
  let sect = last.text
  const [pw, ph] = PAPER_TWIPS[settings.paper] ?? PAPER_TWIPS.A4
  const pgsz = spanOf(sect, "w:pgSz")
  if (pgsz) {
    sect = sect.slice(0, pgsz.start) + setAttrs(pgsz.text, { "w:w": String(pw), "w:h": String(ph) }) + sect.slice(pgsz.end)
  } else {
    notes.push("sectPr 中没有 pgSz，纸张尺寸未改写")
  }
  const tw = (cm: number) => String(Math.round(cm * TWIPS_PER_CM))
  const pgmar = spanOf(sect, "w:pgMar")
  if (pgmar) {
    sect = sect.slice(0, pgmar.start) + setAttrs(pgmar.text, {
      "w:top": tw(settings.margins.top),
      "w:bottom": tw(settings.margins.bottom),
      "w:left": tw(settings.margins.left),
      "w:right": tw(settings.margins.right),
    }) + sect.slice(pgmar.end)
  } else {
    notes.push("sectPr 中没有 pgMar，页边距未改写")
  }
  return docXml.slice(0, last.start) + sect + docXml.slice(last.end)
}

/** 顶层入口：解包 → 改写 → 重打包。任何一部缺失按 notes 提示、其余部件照常处理 */
export async function refreshDocxFile(
  file: File,
  settings: FormatSettings,
  scopes: FormatScope[],
): Promise<{ blob: Blob; notes: string[] }> {
  const notes: string[] = []
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const out: Record<string, Uint8Array> = {}
  let touched = false
  for (const key of Object.keys(zip)) {
    if (key === "word/styles.xml") {
      out[key] = strToU8(refreshStylesXml(strFromU8(zip[key]), settings, scopes, notes))
      touched = true
    } else if (key === "word/document.xml") {
      out[key] = strToU8(refreshDocumentXml(strFromU8(zip[key]), settings, scopes, notes))
    } else {
      out[key] = zip[key]
    }
  }
  if (!touched) notes.push("压缩包内没有 word/styles.xml，样式未改写（可能不是 Word 文档）")
  const packed = zipSync(out)
  const blob = new Blob([packed as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })
  return { blob, notes }
}
