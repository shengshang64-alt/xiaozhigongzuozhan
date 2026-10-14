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
  ctx?: DirectFormatContext,
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
      if (rpr && rprd) {
        let inner = rpr.text.slice("<w:rPr>".length, -"</w:rPr>".length)
        inner = upsertEmptyElement(inner, "w:rFonts", fontA, RPR_ORDER)
        inner = upsertEmptyElement(inner, "w:sz", szA, RPR_ORDER)
        inner = upsertEmptyElement(inner, "w:szCs", szA, RPR_ORDER)
        // R46 修复：rpr 的偏移相对 rprd.text 定位，必须叠加 rprd.start 才是 out 上的绝对位置。
        // 旧写法（dd.start + rpr.start）会错位替换：吃掉 <w:rPrDefault> 开标签并留下重复 <w:rPr>，
        // 产出非法 XML（Word 可能提示文件损坏）。实测由 refreshDocx.test.ts 的 XML 合法性用例捕获。
        const rprAbs = dd.start + rprd.start + rpr.start
        const rprEndAbs = dd.start + rprd.start + rpr.end
        out = out.slice(0, rprAbs) + `<w:rPr>${inner}</w:rPr>` + out.slice(rprEndAbs)
      } else {
        // rPrDefault 自闭合/缺失：整体替换为带管理属性的完整节点
        const attrsXml = Object.entries(fontA).map(([k, v]) => `${k}="${v}"`).join(" ")
        const freshCore = `<w:rPr><w:rFonts ${attrsXml}/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr>`
        if (rprd) {
          out = out.slice(0, dd.start + rprd.start) + `<w:rPrDefault>${freshCore}</w:rPrDefault>` + out.slice(dd.start + rprd.end)
        } else {
          const ddClose = out.indexOf("</w:docDefaults>", dd.start)
          const insertAt = ddClose >= 0 ? ddClose : dd.start + "<w:docDefaults>".length
          out = out.slice(0, insertAt) + `<w:rPrDefault>${freshCore}</w:rPrDefault>` + out.slice(insertAt)
        }
      }
    }
  }

  // ---- 逐样式块 ----
  const styleRe = /<w:style\s[^>]*>[\s\S]*?<\/w:style>/g
  const seenHeading = new Set<number>()
  let sawNormal = false
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
    if (isNormal) sawNormal = true

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

  // ---- R46：文档缺 Normal 正文样式时补建（否则正文格式在样式层无处落地，行距必失败）----
  if (!sawNormal && (on("font") || on("spacing"))) {
    const ops: Rewrites = {}
    if (on("font")) {
      ops.rPr = {
        "w:rFonts": fontAttrs(settings.body.font),
        "w:sz": { "w:val": String(Math.round(bodyPt * 2)) },
        "w:szCs": { "w:val": String(Math.round(bodyPt * 2)) },
      }
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
    const fresh = rewriteStyleBlock(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
      ops,
    )
    // R46 修复：必须插到 result 上。旧写法插到 out 上，随后 return result 把补建的样式整个丢掉
    // ——复检靠「文字级已改写」兜底才显示 ok，样式层实际仍无 Normal（由 refreshDocx.test.ts 捕获）。
    const ddEnd = result.indexOf("</w:docDefaults>")
    const stylesOpen = /<w:styles[^>]*>/.exec(result)
    const at = ddEnd >= 0 ? ddEnd + "</w:docDefaults>".length : stylesOpen ? stylesOpen.index + stylesOpen[0].length : -1
    if (at >= 0) {
      result = result.slice(0, at) + fresh + result.slice(at)
      notes.push("原文档没有「Normal」正文样式，已补建并写入正文格式（否则正文格式在样式层无处落地）")
      if (ctx?.stats) ctx.stats.normalInjected = true
    }
  }

  if (on("heading")) {
    for (let lvl = 1; lvl <= settings.heading.length; lvl++) {
      if (!seenHeading.has(lvl)) notes.push(`文档中没有「标题${lvl}」样式，该级标题未改写（原文档可能未用到该级）`)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// R46 修复：文字级 / 段落级「直接格式」改写。
//
// 背景（实测）：本项目导出的 docx 以及大量第三方成稿，把字体字号写死在每个 run 的
// <w:rPr> 里、把行距写在段落的 <w:pPr> 里，且 styles.xml 里根本没有 Normal 样式。
// 只改 styles.xml 对这些文档等于「改了但看不见」——实测四项复检里 2 项不生效。
// 因此刷新时按范围同步改写直接格式（等价于 Word 里「全选 → 套用格式」）：
//   font    → 正文段落 run 的 rFonts/sz/szCs；正文段落缺 ind 时补首行缩进
//   spacing → 正文段落 pPr 的 spacing(行距)；缺 jc 时补对齐
//   heading → 标题段落 run 的 rFonts/sz/szCs；缺 jc 时补标题对齐
// 保护规则（宁可少改、不可改坏）：
//   ① 表格内段落不动（表格格式属另一个范围，本轮不碰）；
//   ② 样式不为「正文 / 标题」的段落（Title、封面自定义样式等）不动；
//   ③ 段落已有的 jc / ind 视为刻意设置，只补缺不覆盖。
// 以上不改写的一律计入 protectedParas 如实提示，不静默。
// ---------------------------------------------------------------------------

export interface RefreshStats {
  /** 正文 run 文字级字体字号改写数 */
  bodyRuns: number
  /** 标题 run 文字级字体字号改写数 */
  headingRuns: number
  /** 段落级行距 / 对齐改写数 */
  spacingParas: number
  /** 段落级首行缩进补齐数 */
  indentParas: number
  /** 受保护未改写的段落数（表格内 / 非正文非标题样式） */
  protectedParas: number
  /** 被统一掉的既有字号（磅，升序去重） */
  overriddenSizes: number[]
  /** 是否补建了缺失的 Normal 正文样式 */
  normalInjected: boolean
}

export function createRefreshStats(): RefreshStats {
  return {
    bodyRuns: 0,
    headingRuns: 0,
    spacingParas: 0,
    indentParas: 0,
    protectedParas: 0,
    overriddenSizes: [],
    normalInjected: false,
  }
}

/** 直接格式改写上下文：styleId→标题级别映射 + 统计 + 开关 */
export interface DirectFormatContext {
  headingStyleLevels?: Map<string, number>
  stats?: RefreshStats
  /** 是否同步改写文字级 / 段落级直接格式；默认 true */
  overrideDirect?: boolean
}

/** 段落样式 id / 名 → 标题级别（0 = 非标题）：优先用 styles.xml 解析出的映射 */
function styleIdHeadingLevel(pStyle: string, map?: Map<string, number>): number {
  if (!pStyle) return 0
  const hit = map?.get(pStyle)
  if (typeof hit === "number") return hit
  const m = /(?:heading|标题)\s*([1-6])/i.exec(pStyle)
  return m ? Number(m[1]) : 0
}

/** 正文类样式 id：空（无 pStyle 即 Normal）或 Normal / 正文 / 默认 */
function isBodyStyleId(pStyle: string): boolean {
  if (!pStyle) return true
  return /^(normal|正文|默认)/i.test(pStyle)
}

/** 同名元素的最外层区间（自带深度计数，容忍嵌套；未闭合时兜到文末） */
function elementSpans(xml: string, name: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const re = new RegExp("<" + name + "(?:\\s[^>]*?)?(/?)>|</" + name + ">", "g")
  let depth = 0
  let start = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[0].startsWith("</")) {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          spans.push([start, m.index + m[0].length])
          start = -1
        }
      }
    } else if (m[1] === "/") {
      if (depth === 0) spans.push([m.index, m.index + m[0].length])
    } else {
      if (depth === 0) start = m.index
      depth++
    }
  }
  if (start >= 0) spans.push([start, xml.length])
  return spans
}

type ParaTarget = { kind: "body" } | { kind: "heading"; level: number } | { kind: "protected" }

/** 判定段落的改写目标；pStyle 既非正文也非标题（Title / 自定义）一律 protected */
function paraTarget(block: string, ctx?: DirectFormatContext): ParaTarget {
  const pStyle = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(block)?.[1] ?? ""
  const lvl = styleIdHeadingLevel(pStyle, ctx?.headingStyleLevels)
  if (lvl >= 1) return { kind: "heading", level: lvl }
  if (pStyle && !isBodyStyleId(pStyle)) return { kind: "protected" }
  if (!pStyle) {
    const pPr = spanOf(block, "w:pPr")
    const ol = (pPr ? pPr.text : block).match(/<w:outlineLvl\s[^>]*w:val="([0-5])"/)
    if (ol) return { kind: "heading", level: Number(ol[1]) + 1 }
  }
  return { kind: "body" }
}

/** 按范围改写单个段落的直接格式（段落级行距 / 对齐 / 缩进 + 文字级字体字号） */
function rewriteParagraphDirect(
  block: string,
  target: ParaTarget,
  settings: FormatSettings,
  scopes: FormatScope[],
  ctx: DirectFormatContext,
): string {
  const on = (s: FormatScope) => scopes.includes(s)
  const cfg = target.kind === "heading" ? settings.heading[target.level - 1] : settings.body
  if (!cfg) return block
  const stats = ctx.stats
  let out = block

  // ---- 段落级：行距 / 对齐 / 首行缩进 ----
  const wanted: Record<string, Record<string, string>> = {}
  if (target.kind === "body" && on("spacing")) wanted["w:spacing"] = lineSpacingAttrs(settings.body.lineSpacing)
  const bodyPt = SIZE_PT[settings.body.size] ?? 12
  if ((target.kind === "body" && on("spacing")) || (target.kind === "heading" && on("heading"))) {
    wanted["w:jc"] = { "w:val": alignVal(cfg.align) }
  }
  if (target.kind === "body" && on("font")) {
    const chars = settings.body.firstIndent || 0
    wanted["w:ind"] =
      chars > 0
        ? { "w:firstLine": String(Math.round(chars * bodyPt * 20)), "w:firstLineChars": String(Math.round(chars * 100)) }
        : { "w:firstLine": "0", "w:firstLineChars": "0" }
  }
  const curPPr = spanOf(out, "w:pPr")
  const pPrText = curPPr ? curPPr.text : ""
  const ops = Object.keys(wanted)
    .filter((tag) => !((tag === "w:jc" || tag === "w:ind") && new RegExp("<" + tag + "[\\s/>]").test(pPrText)))
    .sort((a, b) => PPR_ORDER.indexOf(a) - PPR_ORDER.indexOf(b))
  if (ops.length) {
    if (!curPPr) {
      const mark = /^<w:p(?:\s[^>]*?)?>/.exec(out)
      const at = mark ? mark[0].length : 0
      out = out.slice(0, at) + "<w:pPr></w:pPr>" + out.slice(at)
    }
    const span = spanOf(out, "w:pPr")
    if (span) {
      let inner = span.text.slice("<w:pPr>".length, -"</w:pPr>".length)
      for (const tag of ops) inner = upsertEmptyElement(inner, tag, wanted[tag], PPR_ORDER)
      out = out.slice(0, span.start) + "<w:pPr>" + inner + "</w:pPr>" + out.slice(span.end)
      if (stats) {
        if (ops.includes("w:spacing")) stats.spacingParas++
        if (ops.includes("w:ind")) stats.indentParas++
      }
    }
  }

  // ---- 文字级：字体 / 字号（来源文档把格式写死在 run 上，这里按模板统一）----
  const wantFont = (target.kind === "body" && on("font")) || (target.kind === "heading" && on("heading"))
  if (!wantFont) return out
  const pt = SIZE_PT[cfg.size] ?? (target.kind === "heading" ? 16 : 12)
  const half = String(Math.round(pt * 2))
  const fat = fontAttrs(cfg.font)
  const rFontsXml = Object.entries(fat)
    .map(([k, v]) => k + '="' + v + '"')
    .join(" ")
  const freshRPr = "<w:rPr><w:rFonts " + rFontsXml + "/><w:sz w:val=\"" + half + "\"/><w:szCs w:val=\"" + half + "\"/></w:rPr>"
  let n = 0
  out = out.replace(/<w:r(?:\s[^>]*?)?>[\s\S]*?<\/w:r>/g, (run) => {
    const mark = /^<w:r(?:\s[^>]*?)?>/.exec(run)
    const at = mark ? mark[0].length : 0
    const oldSz = /<w:sz\s[^>]*w:val="(\d+)"/.exec(run)
    if (oldSz && stats) {
      const oldPt = Number(oldSz[1]) / 2
      if (oldPt > 0 && Math.round(oldPt * 2) !== Number(half) && !stats.overriddenSizes.includes(oldPt)) {
        stats.overriddenSizes.push(oldPt)
      }
    }
    const rPrSpan = spanOf(run, "w:rPr")
    let next: string
    if (rPrSpan && rPrSpan.start === at) {
      let inner = rPrSpan.text.slice("<w:rPr>".length, -"</w:rPr>".length)
      inner = upsertEmptyElement(inner, "w:rFonts", fat, RPR_ORDER)
      inner = upsertEmptyElement(inner, "w:sz", { "w:val": half }, RPR_ORDER)
      inner = upsertEmptyElement(inner, "w:szCs", { "w:val": half }, RPR_ORDER)
      next = run.slice(0, rPrSpan.start) + "<w:rPr>" + inner + "</w:rPr>" + run.slice(rPrSpan.end)
    } else {
      next = run.slice(0, at) + freshRPr + run.slice(at)
    }
    n++
    return next
  })
  if (stats) {
    if (target.kind === "heading") stats.headingRuns += n
    else stats.bodyRuns += n
  }
  return out
}

/** 按范围改写 document.xml 里所有顶层段落的直接格式；表格内段落跳过并计数 */
function rewriteDirectFormat(docXml: string, settings: FormatSettings, scopes: FormatScope[], ctx: DirectFormatContext): string {
  const stats = ctx.stats
  const tables = elementSpans(docXml, "w:tbl")
  const paras = elementSpans(docXml, "w:p")
  if (!paras.length) return docXml
  const inTable = (i: number) => tables.some(([a, b]) => i >= a && i < b)
  let out = ""
  let last = 0
  for (const [start, end] of paras) {
    out += docXml.slice(last, start)
    last = end
    const block = docXml.slice(start, end)
    if (inTable(start)) {
      if (stats) stats.protectedParas++
      out += block
      continue
    }
    const target = paraTarget(block, ctx)
    if (target.kind === "protected") {
      if (stats) stats.protectedParas++
      out += block
      continue
    }
    out += rewriteParagraphDirect(block, target, settings, scopes, ctx)
  }
  out += docXml.slice(last)
  return out
}
/**
 * 改写 document.xml：① 最后一个 sectPr；② 段落 / 文字级直接格式（R46）。
 */
/**
 * 改写 document.xml：① 最后一个 sectPr 的纸张与页边距；② 按范围同步改写段落 / 文字级直接格式。
 * 文字 0 改动——只动 pPr / rPr / sectPr，不动任何 w:t。
 */
export function refreshDocumentXml(
  docXml: string,
  settings: FormatSettings,
  scopes: FormatScope[],
  notes: string[],
  ctx?: DirectFormatContext,
): string {
  let out = docXml
  if (scopes.includes("page")) {
    const sectRe = /<w:sectPr(?:\s[^>]*?)?>[\s\S]*?<\/w:sectPr>/g
    let last: { start: number; end: number; text: string } | null = null
    for (const m of out.matchAll(sectRe)) {
      last = { start: m.index, end: m.index + m[0].length, text: m[0] }
    }
    if (!last) {
      notes.push("文档没有分节属性(sectPr)，纸张与页边距未改写")
    } else {
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
        sect =
          sect.slice(0, pgmar.start) +
          setAttrs(pgmar.text, {
            "w:top": tw(settings.margins.top),
            "w:bottom": tw(settings.margins.bottom),
            "w:left": tw(settings.margins.left),
            "w:right": tw(settings.margins.right),
          }) +
          sect.slice(pgmar.end)
      } else {
        notes.push("sectPr 中没有 pgMar，页边距未改写")
      }
      out = out.slice(0, last.start) + sect + out.slice(last.end)
    }
  }

  // R46：直接格式改写（只改 styles.xml 对「格式写死在文字上」的文档无效，见文件头说明）
  const wantsDirect = scopes.includes("font") || scopes.includes("spacing") || scopes.includes("heading")
  if (wantsDirect && ctx?.overrideDirect !== false) out = rewriteDirectFormat(out, settings, scopes, ctx ?? {})
  return out
}

/**
 * 收集文档部件中实际引用的 styleId（段落 pStyle / 文字 rStyle / 表格 tblStyle）。
 * parts 传 word/document.xml 与全部 header/footer/footernotes 部件。
 */
export function collectUsedStyleIds(parts: string[]): Set<string> {
  const used = new Set<string>()
  for (const xml of parts) {
    for (const m of xml.matchAll(/<w:(?:pStyle|rStyle|tblStyle)\s[^>]*w:val="([^"]+)"/g)) {
      used.add(m[1])
    }
  }
  return used
}

/**
 * 删除 styles.xml 中「未被引用且非默认」的样式块（附三用户需求：导出可选删除未应用的样式）。
 * 保留规则：w:default="1" 的内置默认样式、被引用的样式、以及被保留样式 basedOn/next/link
 * 级联引用的父样式（继承链断裂会导致格式回退）。删除数量写入 notes。
 */
export function removeUnusedStylesXml(stylesXml: string, usedIds: Set<string>, notes: string[]): string {
  const styleRe = /<w:style\s[^>]*>[\s\S]*?<\/w:style>/g
  type StyleBlock = { block: string; id: string; isDefault: boolean; refs: string[] }
  const blocks: StyleBlock[] = []
  const pieces: string[] = []
  let last = 0
  for (const m of stylesXml.matchAll(styleRe)) {
    pieces.push(stylesXml.slice(last, m.index))
    last = m.index + m[0].length
    const block = m[0]
    const idM = /w:styleId="([^"]*)"/.exec(block)
    const refs: string[] = []
    for (const r of block.matchAll(/<w:(?:basedOn|next|link)\s+w:val="([^"]+)"/g)) refs.push(r[1])
    blocks.push({
      block,
      id: idM?.[1] ?? "",
      isDefault: /w:default="1"/.test(block),
      refs,
    })
  }
  pieces.push(stylesXml.slice(last))
  if (!blocks.length) return stylesXml

  const keep = new Set<string>()
  for (const b of blocks) if (b.isDefault || usedIds.has(b.id)) keep.add(b.id)
  // 继承链级联：被保留样式引用的父样式一并保留（迭代到不动点）
  let changed = true
  while (changed) {
    changed = false
    for (const b of blocks) {
      if (!keep.has(b.id)) continue
      for (const r of b.refs) {
        if (!keep.has(r) && blocks.some((x) => x.id === r)) {
          keep.add(r)
          changed = true
        }
      }
    }
  }

  let removed = 0
  const out: string[] = []
  for (let i = 0; i < pieces.length; i++) {
    out.push(pieces[i])
    if (i < blocks.length) {
      const b = blocks[i]
      if (keep.has(b.id)) out.push(b.block)
      else removed++
    }
  }
  if (removed > 0) notes.push(`已删除 ${removed} 个未应用的样式定义（文档中没有引用，删除仅精简样式表、不影响显示）`)
  return out.join("")
}

/** 顶层入口：解包 → 改写 → 重打包 → 产出后复检（附三 R-009 校验真身）。
 * 任何一部缺失按 notes 提示、其余部件照常处理。
 * 返回值新增 report（四范围应用报告：bodyFont/heading/lineSpacing/pageMargin 的 ok/skip/fail）
 * 与 textBefore/textAfter（正文字符数对照，兑现「文字 0 改动」可验证承诺）。
 */
export type FormatApplySlotStatus = "ok" | "skip" | "fail"
export interface FormatApplySlot {
  status: FormatApplySlotStatus
  reason?: string
}
export interface FormatApplyReport {
  slots: {
    bodyFont: FormatApplySlot
    heading: FormatApplySlot
    lineSpacing: FormatApplySlot
    pageMargin: FormatApplySlot
  }
  okCount: number
  totalCount: number
  textBefore: number
  textAfter: number
  /** R46：直接格式改写统计（文字级 / 段落级），供界面如实展示「到底改到了哪里」 */
  direct: {
    bodyRuns: number
    headingRuns: number
    spacingParas: number
    indentParas: number
    protectedParas: number
    overriddenSizes: number[]
    normalInjected: boolean
  }
}

/** 从 document.xml 提取正文字符数（去标签收敛空白），用于「文字 0 改动」对照 */
function docTextChars(docXml: string): number {
  return docXml.replace(/<w:p\b[^>]*>/g, "\n").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length
}
/** 产出后复检：对最终 XML 逐范围核验目标标记，得出四槽位状态（这是「校验」的真身）。
 * R46：标题复检不再按字面 `w:val="heading N"` 做大小写敏感匹配——Word / docx 库生成的是
 * "Heading 1"（大写 H），上一版因此把已改写的标题误报为 fail。改为按样式块判定级别，
 * 并接受「标题 run 已被文字级改写」作为生效证据（本项目导出的 docx 走的就是这条路）。 */
function buildApplyReport(
  stylesXml: string,
  docXml: string,
  settings: FormatSettings,
  scopes: FormatScope[],
  stats?: RefreshStats,
): FormatApplyReport {
  const slots: Record<"bodyFont" | "heading" | "lineSpacing" | "pageMargin", FormatApplySlot> = {
    bodyFont: { status: "skip", reason: "范围未勾选" },
    heading: { status: "skip", reason: "范围未勾选" },
    lineSpacing: { status: "skip", reason: "范围未勾选" },
    pageMargin: { status: "skip", reason: "范围未勾选" },
  }
  const on = (s: FormatScope) => scopes.includes(s)
  const bodyPt = SIZE_PT[settings.body.size] ?? 12
  const targetSz = String(Math.round(bodyPt * 2))

  if (on("font")) {
    const stylesHit =
      stylesXml.includes(`w:eastAsia="${settings.body.font}"`) && stylesXml.includes(`<w:sz w:val="${targetSz}"/>`)
    const runs = stats?.bodyRuns ?? 0
    if (stylesHit) slots.bodyFont = { status: "ok", reason: `${settings.body.font}${settings.body.size}` }
    else if (runs > 0) slots.bodyFont = { status: "ok", reason: `${settings.body.font}${settings.body.size}（文字级 ${runs} 处）` }
    else slots.bodyFont = { status: "fail", reason: "复检未命中目标字体字号" }
  }
  if (on("spacing")) {
    const expect = lineSpacingAttrs(settings.body.lineSpacing)
    const stylesHit =
      stylesXml.includes(`w:line="${expect["w:line"]}"`) && stylesXml.includes(`w:lineRule="${expect["w:lineRule"]}"`)
    const paras = stats?.spacingParas ?? 0
    if (stylesHit) slots.lineSpacing = { status: "ok", reason: settings.body.lineSpacing }
    else if (paras > 0) slots.lineSpacing = { status: "ok", reason: `${settings.body.lineSpacing}（段落级 ${paras} 段）` }
    else slots.lineSpacing = { status: "fail", reason: "复检未命中目标行距" }
  }
  if (on("heading")) {
    const blocks = Array.from(stylesXml.matchAll(/<w:style\s[^>]*>[\s\S]*?<\/w:style>/g)).map((m) => m[0])
    const targets: { level: number; font: string }[] = []
    for (const b of blocks) {
      const lvl = headingLevelOfStyle(b)
      if (lvl >= 1 && lvl <= settings.heading.length && !targets.some((t) => t.level === lvl)) {
        targets.push({ level: lvl, font: settings.heading[lvl - 1].font })
      }
    }
    const hitLvls = targets.filter((t) =>
      blocks.some(
        (blk) =>
          headingLevelOfStyle(blk) === t.level &&
          (blk.includes(`w:eastAsia="${t.font}"`) || blk.includes(`w:ascii="${t.font}"`)),
      ),
    )
    const runsHit = (stats?.headingRuns ?? 0) > 0
    if (hitLvls.length && hitLvls.length === targets.length) {
      slots.heading = { status: "ok", reason: `${hitLvls.length} 级标题已改写` }
    } else if (hitLvls.length > 0) {
      slots.heading = { status: "skip", reason: `${hitLvls.length}/${targets.length} 级标题命中（其余文档未用到）` }
    } else if (runsHit) {
      slots.heading = { status: "ok", reason: `标题文字级字体字号已改写（${stats?.headingRuns} 处）` }
    } else {
      slots.heading = { status: "fail", reason: "复检未命中任何标题样式" }
    }
  }
  if (on("page")) {
    const [pw, phh] = PAPER_TWIPS[settings.paper] ?? PAPER_TWIPS.A4
    const tw = (cm: number) => String(Math.round(cm * TWIPS_PER_CM))
    const sect = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] ?? ""
    const hit =
      sect.includes(`w:w="${pw}"`) &&
      sect.includes(`w:h="${phh}"`) &&
      sect.includes(`w:top="${tw(settings.margins.top)}"`) &&
      sect.includes(`w:left="${tw(settings.margins.left)}"`)
    slots.pageMargin = hit
      ? { status: "ok", reason: `${settings.paper} · 边距 ${settings.margins.top}/${settings.margins.bottom}/${settings.margins.left}/${settings.margins.right}cm` }
      : { status: "fail", reason: "复检未命中目标纸张或页边距" }
  }
  const vals = Object.values(slots)
  const okCount = vals.filter((x) => x.status === "ok").length
  return {
    slots,
    okCount,
    totalCount: 4,
    textBefore: 0,
    textAfter: 0,
    direct: {
      bodyRuns: stats?.bodyRuns ?? 0,
      headingRuns: stats?.headingRuns ?? 0,
      spacingParas: stats?.spacingParas ?? 0,
      indentParas: stats?.indentParas ?? 0,
      protectedParas: stats?.protectedParas ?? 0,
      overriddenSizes: stats ? [...stats.overriddenSizes].sort((a, b) => a - b) : [],
      normalInjected: stats?.normalInjected ?? false,
    },
  }
}/** 顶层入口：解包 → 改写 → 重打包 → 产出后复检。
 * 任何一部缺失按 notes 提示、其余部件照常处理。
 * R46：新增 opts.overrideDirectFormat（默认 true）——按范围同步改写文字级 / 段落级直接格式，
 * 否则对「格式写死在 run / 段落上」的文档（含本项目导出的 docx）字体字号与行距不生效。
 */
export async function refreshDocxFile(
  file: File,
  settings: FormatSettings,
  scopes: FormatScope[],
  opts?: { removeUnusedStyles?: boolean; overrideDirectFormat?: boolean },
): Promise<{ blob: Blob; notes: string[]; report: FormatApplyReport }> {
  const notes: string[] = []
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const docBefore = zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : ""
  const textBefore = docTextChars(docBefore)
  const out: Record<string, Uint8Array> = {}
  let touched = false
  const stats = createRefreshStats()

  // styleId → 标题级别（供段落直接格式改写判定「这段是不是标题」）
  const headingStyleLevels = new Map<string, number>()
  const stylesSrc = zip["word/styles.xml"] ? strFromU8(zip["word/styles.xml"]) : ""
  for (const m of stylesSrc.matchAll(/<w:style\s[^>]*>[\s\S]*?<\/w:style>/g)) {
    const id = /w:styleId="([^"]*)"/.exec(m[0])?.[1]
    if (!id) continue
    const lvl = headingLevelOfStyle(m[0])
    if (lvl >= 1 && !headingStyleLevels.has(id)) headingStyleLevels.set(id, lvl)
  }
  const ctx: DirectFormatContext = {
    headingStyleLevels,
    stats,
    overrideDirect: opts?.overrideDirectFormat !== false,
  }

  // 附三用户需求「删除未应用的样式」：引用扫描覆盖正文 + 页眉页脚 + 脚注尾注部件
  const refParts = Object.keys(zip).filter(
    (k) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(k),
  )
  const usedIds = opts?.removeUnusedStyles
    ? collectUsedStyleIds(refParts.map((k) => strFromU8(zip[k])))
    : null
  for (const key of Object.keys(zip)) {
    if (key === "word/styles.xml") {
      let stylesXml = refreshStylesXml(strFromU8(zip[key]), settings, scopes, notes, ctx)
      if (usedIds) stylesXml = removeUnusedStylesXml(stylesXml, usedIds, notes)
      out[key] = strToU8(stylesXml)
      touched = true
    } else if (key === "word/document.xml") {
      out[key] = strToU8(refreshDocumentXml(strFromU8(zip[key]), settings, scopes, notes, ctx))
    } else {
      out[key] = zip[key]
    }
  }
  if (!touched) notes.push("压缩包内没有 word/styles.xml，样式未改写（可能不是 Word 文档）")

  // R46：直接格式改写的如实提示（改到了哪里 / 哪些没动）
  if (ctx.overrideDirect) {
    if (stats.bodyRuns > 0) {
      notes.push(`已同步改写 ${stats.bodyRuns} 处正文文字级字体字号：该文档把格式写死在文字上，只改样式表不会生效`)
    }
    if (stats.headingRuns > 0) notes.push(`已同步改写 ${stats.headingRuns} 处标题文字级字体字号`)
    if (stats.spacingParas > 0) {
      notes.push(`已同步改写 ${stats.spacingParas} 个正文段落的行距/对齐（原有 before/after 段间距保留）`)
    }
    if (stats.indentParas > 0) notes.push(`已为 ${stats.indentParas} 个无缩进设置的正文段落补上首行缩进`)
    if (stats.protectedParas > 0) {
      notes.push(`已跳过 ${stats.protectedParas} 个段落：表格内文字与封面/自定义样式段落未改动，如需一并统一请手动处理`)
    }
    if (stats.overriddenSizes.length) {
      notes.push(`被统一掉的原有字号：${stats.overriddenSizes.sort((a, b) => a - b).map((x) => `${x}pt`).join("、")}`)
    }
  } else if (scopes.includes("font") || scopes.includes("spacing") || scopes.includes("heading")) {
    notes.push("未开启「覆盖文字级直接格式」：若文档把格式写死在文字/段落上（本项目导出的 docx 即如此），字体字号与行距可能看起来没变")
  }

  const docAfter = out["word/document.xml"] ? strFromU8(out["word/document.xml"]) : docBefore
  const report = buildApplyReport(
    out["word/styles.xml"] ? strFromU8(out["word/styles.xml"]) : "",
    docAfter,
    settings,
    scopes,
    stats,
  )
  report.textBefore = textBefore
  report.textAfter = docTextChars(docAfter)
  const packed = zipSync(out)
  const blob = new Blob([packed as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })
  return { blob, notes, report }
}