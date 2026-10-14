// ---------------------------------------------------------------------------
// fontResolve —— 字体「生效值」解析（算法级复用，来源：格式镖师 §9 字体继承解析）。
//
// 为什么需要：Word 里「某个字的字体」没有直接答案，是一层层继承来的。
//   本项目原有的做法是对 document.xml 正则扫 w:rFonts/@w:eastAsia 去重罗列，
//   两个固有毛病：①run 自身不写字体（继承样式/文档默认）时整条被漏掉；
//   ②「宋体」与「SimSun」互判为不同字体，纯中文正文也会报「字体不一致」。
//
// 本模块实现完整继承链（与格式镖师 §9.1 同序）：
//   run 自身 w:rFonts/@w:eastAsia
//     → run 自身 @w:ascii/@w:hAnsi（仅当文本不含 CJK 时才采信；本检查只统计含 CJK 的 run）
//       → run 的字符样式 w:rStyle
//         → 段落的样式 w:pStyle（沿 w:basedOn 链上溯）
//           → 文档默认 docDefaults/w:rPrDefault/w:rPr
//
// 「占位字体」黑名单（格式镖师 §9.2）：中文文档里英文字体常被设成 Arial /
//   Times New Roman / Lohit Devanagari，但中文实际仍以东亚字体显示 —— 这些值不采信，
//   继续沿继承链上溯，避免把「继承来的宋体」误判成 Arial。
//
// ⚠️ 只读：仅解析传入的 XML 文本，不改包、不写回。纯字符串实现（无 DOMParser），
//    与 docxInspect 同口径，可在 node 单测直接喂手写 OOXML 验证。
// ---------------------------------------------------------------------------

/** 部件路径 → XML 文本（与 docxInspect 的 parts 同构） */
export type FontPartsMap = Record<string, string>

/** 一种生效字体的使用统计 */
export type EffectiveFontUsage = {
  /** 归一后的字体名（见 normalizeFontName） */
  font: string
  /** 命中的含中文 run 数 */
  count: number
  /** 首处命中的文本片段（≤20 字，便于人工定位） */
  sample: string
}

export type EffectiveFontResult = {
  /** 按 count 降序的生效字体分布（空数组=未解析到，调用方应回退旧口径） */
  usages: EffectiveFontUsage[]
  /** 参与统计的含中文 run 总数 */
  cjkRuns: number
  /** 继承链走完仍未取到字体的 run 数（宁可计数上报，不瞎填一个字体） */
  unresolvedRuns: number
}

// ---- 字体名归一（格式镖师 §9.3：别名归一，避免 SimSun ↔ 宋体 互判为不同）--------

/** 常见中文字体的别名表（键=归一后的规范名，值=识别用小写别名） */
export const FONT_ALIASES: Record<string, string[]> = {
  宋体: ["宋体", "simsun", "nsimsun", "songti sc", "songti", "宋体-简", "宋体(正文)", "stsong", "stsongstdlight"],
  仿宋: ["仿宋", "fangsong", "fangsong_gb2312", "仿宋_gb2312", "仿宋-简", "stfangsong"],
  黑体: ["黑体", "simhei", "heiti sc", "heiti", "stheitisc", "黑体-简"],
  楷体: ["楷体", "kaiti", "kaiti sc", "楷体_gb2312", "楷体-简", "stkaiti"],
  微软雅黑: ["微软雅黑", "microsoft yahei", "microsoftyahei", "msyh", "yahei"],
  等线: ["等线", "dengxian", "等线体"],
  思源宋体: ["思源宋体", "source han serif", "sourcehanserif", "noto serif cjk", "notoserifcjk", "noto serif sc"],
  思源黑体: ["思源黑体", "source han sans", "sourcehansans", "noto sans cjk", "notosanscjk", "noto sans sc"],
}

/** 别名 → 规范名 的反查表（构造一次） */
const ALIAS_TO_CANON = (() => {
  const m = new Map<string, string>()
  for (const [canon, aliases] of Object.entries(FONT_ALIASES)) {
    m.set(canon.toLowerCase(), canon)
    for (const a of aliases) m.set(a.toLowerCase(), canon)
  }
  return m
})()

/** 去引号/空白统一小写 */
function foldFont(name: string): string {
  return (name || "").trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").toLowerCase()
}

/**
 * 字体名归一：命中别名表返回规范中文名（如 SimSun → 宋体），否则返回原样（去空白）。
 */
export function normalizeFontName(name: string): string {
  const raw = (name || "").trim()
  if (!raw) return ""
  const canon = ALIAS_TO_CANON.get(foldFont(raw))
  return canon ?? raw
}

/** 两个字体名是否同一字体（别名归一 + 大小写不敏感） */
export function isSameFont(a: string, b: string): boolean {
  const fa = foldFont(normalizeFontName(a))
  const fb = foldFont(normalizeFontName(b))
  return !!fa && fa === fb
}

// ---- 占位字体（格式镖师 §9.2：中文文档里这些值不代表中文字体）----------------

const PLACEHOLDER_FONTS = new Set(["lohit devanagari", "arial", "times new roman"])

function isPlaceholderFont(name: string): boolean {
  return PLACEHOLDER_FONTS.has(foldFont(name))
}

// ---- XML 小工具 -----------------------------------------------------------

/** 首个 <w:rFonts .../> 的 eastAsia/ascii/hAnsi（兼容自闭合与成对写法） */
export function readRFonts(xml: string): { eastAsia: string; ascii: string; hAnsi: string } {
  const m = /<w:rFonts\b([^>]*?)\/?>/.exec(xml || "")
  const attrs = m ? m[1] : ""
  const pick = (k: string): string => {
    const a = new RegExp(`w:${k}\\s*=\\s*"([^"]*)"`).exec(attrs)
    return a ? a[1].trim() : ""
  }
  return { eastAsia: pick("eastAsia"), ascii: pick("ascii"), hAnsi: pick("hAnsi") }
}

/** 取某个属性值（如 w:val） */
function attrVal(xml: string, tag: string, attr = "val"): string {
  const m = new RegExp(`<w:${tag}\\b[^>]*?w:${attr}\\s*=\\s*"([^"]*)"`).exec(xml || "")
  return m ? m[1].trim() : ""
}

/** 去掉成对/自闭合的 w:pPr 块（样式定义里 pPr 内可能带段落标记的 rPr，须先剥离） */
function stripPPr(xml: string): string {
  return xml.replace(/<w:pPr\b[^>]*\/>/g, "").replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/g, "")
}

/** 含 CJK（中日韩统一表意 + 兼容区）——与格式镖师 _contains_east_asian_text 同口径 */
export function containsCjk(text: string): boolean {
  return /[\u2e80-\u9fff\uf900-\ufaff]/.test(text || "")
}

/** 文档默认字体：docDefaults/w:rPrDefault/w:rPr/w:rFonts */
export function parseDocDefaultFont(stylesXml: string): string {
  const dd = /<w:docDefaults\b[\s\S]*?<\/w:docDefaults>/.exec(stylesXml || "")
  if (!dd) return ""
  const rPr = /<w:rPrDefault\b[\s\S]*?<\/w:rPrDefault>/.exec(dd[0])
  if (!rPr) return ""
  const f = readRFonts(rPr[0])
  return f.eastAsia || f.ascii || f.hAnsi || ""
}

type StyleDef = { id: string; type: string; isDefault: boolean; basedOn: string; font: string }

/** 解析 styles.xml 的样式定义表 */
export function parseStyleDefs(stylesXml: string): StyleDef[] {
  const out: StyleDef[] = []
  const re = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stylesXml || ""))) {
    const head = m[1] ?? ""
    const body = m[2] ?? ""
    const id = (/\bw:styleId\s*=\s*"([^"]*)"/.exec(head)?.[1] ?? "").trim()
    if (!id) continue
    const type = (/\bw:type\s*=\s*"([^"]*)"/.exec(head)?.[1] ?? "paragraph").trim()
    const isDefault = /\bw:default\s*=\s*"(1|true)"/.test(head)
    const basedOn = attrVal(/<w:basedOn\b[^>]*\/?>/.exec(body)?.[0] ?? "", "basedOn")
    const f = readRFonts(stripPPr(body))
    out.push({ id, type, isDefault, basedOn, font: f.eastAsia || f.ascii || f.hAnsi || "" })
  }
  return out
}

/**
 * 沿 w:basedOn 链上溯求某样式的生效字体（带环保护与深度上限）。
 * @returns 取不到返回 ""（交由调用方继续往 docDefaults 走）
 */
export function resolveStyleFont(styles: StyleDef[], styleId: string): string {
  const byId = new Map(styles.map((s) => [s.id, s]))
  const seen = new Set<string>()
  let cur = styleId
  for (let depth = 0; depth < 10 && cur && !seen.has(cur); depth += 1) {
    seen.add(cur)
    const def = byId.get(cur)
    if (!def) break
    if (def.font) return def.font
    cur = def.basedOn
  }
  return ""
}

/**
 * 解析「生效字体」分布（只统计含中文的 run —— 暗标字体检查的对象是中文正文）。
 * @param parts 部件路径 → XML（至少需要 word/document.xml；styles.xml 缺省时继承链退化为 run 自身 + docDefaults）
 */
export function resolveEffectiveFonts(parts: FontPartsMap): EffectiveFontResult {
  const stylesXml = parts["word/styles.xml"] ?? ""
  const documentXml = parts["word/document.xml"] ?? ""
  const result: EffectiveFontResult = { usages: [], cjkRuns: 0, unresolvedRuns: 0 }
  if (!documentXml) return result

  const styles = parseStyleDefs(stylesXml)
  const docDefaultFont = parseDocDefaultFont(stylesXml)
  const defaultParaStyleId = styles.find((s) => s.isDefault && s.type === "paragraph")?.id || "Normal"

  const counts = new Map<string, { count: number; sample: string }>()
  const bump = (font: string, sample: string): void => {
    const key = normalizeFontName(font)
    if (!key) return
    const cur = counts.get(key)
    if (cur) cur.count += 1
    else counts.set(key, { count: 1, sample: sample.slice(0, 20) })
  }

  // 段落：styleId → 段落级生效字体
  const paraRe = /<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g
  let pm: RegExpExecArray | null
  while ((pm = paraRe.exec(documentXml))) {
    const paraXml = pm[0]
    const pStyleId = attrVal(paraXml, "pStyle")
    const paraFont =
      (pStyleId ? resolveStyleFont(styles, pStyleId) : "") ||
      resolveStyleFont(styles, defaultParaStyleId) ||
      docDefaultFont

    const runRe = /<w:r\b[^>]*\/>|<w:r\b[\s\S]*?<\/w:r>/g
    let rm: RegExpExecArray | null
    while ((rm = runRe.exec(paraXml))) {
      const runXml = rm[0]
      // run 文本（拼齐 w:t；w:tab / w:br 不含文字，跳过）
      const texts: string[] = []
      const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
      let tm: RegExpExecArray | null
      while ((tm = tRe.exec(runXml))) texts.push(tm[1] ?? "")
      const text = texts.join("")
      if (!containsCjk(text)) continue
      result.cjkRuns += 1

      const rPr = /<w:rPr\b[^>]*\/>|<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0] ?? ""
      const rf = readRFonts(rPr)
      const rStyleId = attrVal(rPr, "rStyle")
      const rStyleFont = rStyleId ? resolveStyleFont(styles, rStyleId) : ""

      // 继承链取值：占位字体不采信，继续上溯
      const candidates = [rf.eastAsia, rf.ascii, rf.hAnsi, rStyleFont, paraFont, docDefaultFont]
      const picked = candidates.find((c) => c && !isPlaceholderFont(c))
      if (!picked) {
        result.unresolvedRuns += 1
        continue
      }
      bump(picked, text)
    }
  }

  result.usages = [...counts.entries()]
    .map(([font, v]) => ({ font, count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count || a.font.localeCompare(b.font, "zh-Hans-CN"))
  return result
}
