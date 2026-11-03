// ---------------------------------------------------------------------------
// numberingResolve —— 编号列表「实际编号格式」解析（来源：格式镖师 §11 OOXML 直改报告）。
//
// 为什么需要：暗标常见条款是「不得使用项目符号（•）」「编号须为 1. 2. 3.」。要判断一段文字
//   到底是自动编号还是手工敲的，只能走 numbering.xml：
//     段落 w:pPr/w:numPr/w:numId → numbering.xml 的 w:num[w:numId] → w:abstractNumId
//       → w:abstractNum[w:abstractNumId]/w:lvl[w:ilvl]/w:numFmt
//   本项目原有检查完全不读 numbering.xml（src 下 grep「numbering.xml」= 0 处），故此能力为净新增。
//
// ⚠️ 只读：仅解析传入的 XML 文本，不解包、不改包、不写回（改造编号属 FormatTool/refreshDocx 职责）。
//
// 如实声明的局限（不假装全知）：
//   · w:lvlOverride 内另写 w:numFmt 的写法不采信，仍按 w:abstractNum 原定义计；
//   · 手工键入的「•」不是自动编号，这里查不到（属文本层检查，不在此模块）；
//   · w:numId 指向 lvlOverride 里 w:startOverride 只影响起始值，不影响编号形式。
// ---------------------------------------------------------------------------

/** 部件路径 → XML 文本（与 docxInspect 的 parts 同构） */
export type NumberingPartsMap = Record<string, string>

/** 一种编号形式的使用统计 */
export type NumberingFormatUsage = {
  /** ECMA-376 的 numFmt 值（bullet / decimal / lowerLetter / chineseCounting …）；查不到时为空串 */
  format: string
  /** 命中段落数 */
  count: number
}

export type NumberingResult = {
  /** 按命中数降序的编号形式分布（空数组=本文档无自动编号段落） */
  formats: NumberingFormatUsage[]
  /** 带 w:numPr 的段落总数 */
  numberedParagraphs: number
  /** 其中编号形式为 bullet（项目符号）的段落数 */
  bulletParagraphs: number
  /** 有 numId 但在 numbering.xml 中查不到对应形式的段落数（如实计数，不瞎填） */
  unresolvedParagraphs: number
}

/** numFmt 值的可读名（仅用于展示，不影响判定） */
export const NUM_FMT_LABEL: Record<string, string> = {
  bullet: "项目符号",
  decimal: "阿拉伯数字",
  lowerLetter: "小写字母",
  upperLetter: "大写字母",
  lowerRoman: "小写罗马数字",
  upperRoman: "大写罗马数字",
  chineseCounting: "中文数字",
  chineseCountingThousand: "中文数字（千）",
  decimalFullWidth: "全角阿拉伯数字",
}

/** numFmt → 展示串（未收录的原样返回，不猜） */
export function formatLabel(numFmt: string): string {
  return NUM_FMT_LABEL[numFmt] ?? numFmt
}

/** 解析 abstractNumId → (ilvl → numFmt) */
export function parseAbstractLevels(numberingXml: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  const absRe = /<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g
  let m: RegExpExecArray | null
  while ((m = absRe.exec(numberingXml || ""))) {
    const head = m[1] ?? ""
    const body = m[2] ?? ""
    const id = /\bw:abstractNumId\s*=\s*"([^"]*)"/.exec(head)?.[1]
    if (!id) continue
    const levels = new Map<string, string>()
    const lvlRe = /<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g
    let lm: RegExpExecArray | null
    while ((lm = lvlRe.exec(body))) {
      const lvlHead = lm[1] ?? ""
      const lvlBody = lm[2] ?? ""
      const ilvl = (/\bw:ilvl\s*=\s*"([^"]*)"/.exec(lvlHead)?.[1] ?? "0").trim()
      const fmt = /<w:numFmt\b[^>]*w:val\s*=\s*"([^"]*)"/.exec(lvlBody)?.[1]
      if (fmt) levels.set(ilvl, fmt.trim())
    }
    out.set(id.trim(), levels)
  }
  return out
}

/** 解析 numId → abstractNumId */
export function parseNumToAbstract(numberingXml: string): Map<string, string> {
  const out = new Map<string, string>()
  const numRe = /<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g
  let m: RegExpExecArray | null
  while ((m = numRe.exec(numberingXml || ""))) {
    const head = m[1] ?? ""
    const body = m[2] ?? ""
    const numId = /\bw:numId\s*=\s*"([^"]*)"/.exec(head)?.[1]
    const absId = /<w:abstractNumId\b[^>]*w:val\s*=\s*"([^"]*)"/.exec(body)?.[1]
    if (numId && absId) out.set(numId.trim(), absId.trim())
  }
  return out
}

/**
 * 求某 numId + ilvl 的生效编号形式。
 * @returns 查不到返回 ""（调用方按「无法确定」计数，不猜成数字编号）
 */
export function resolveNumFmt(
  numId: string,
  ilvl: string,
  numToAbstract: Map<string, string>,
  abstractLevels: Map<string, Map<string, string>>,
): string {
  const absId = numToAbstract.get(numId)
  if (!absId) return ""
  const levels = abstractLevels.get(absId)
  if (!levels || levels.size === 0) return ""
  return levels.get(ilvl) ?? levels.get("0") ?? levels.values().next().value ?? ""
}

/** 只读解析：document.xml 里带编号的段落 × numbering.xml 的编号定义 */
export function resolveParagraphNumbering(parts: NumberingPartsMap): NumberingResult {
  const numberingXml = parts["word/numbering.xml"] ?? ""
  const documentXml = parts["word/document.xml"] ?? ""
  const result: NumberingResult = {
    formats: [],
    numberedParagraphs: 0,
    bulletParagraphs: 0,
    unresolvedParagraphs: 0,
  }
  if (!documentXml || !numberingXml) return result

  const numToAbstract = parseNumToAbstract(numberingXml)
  const abstractLevels = parseAbstractLevels(numberingXml)
  const counts = new Map<string, number>()

  const paraRe = /<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g
  let pm: RegExpExecArray | null
  while ((pm = paraRe.exec(documentXml))) {
    const paraXml = pm[0]
    const numPr = /<w:numPr\b[\s\S]*?<\/w:numPr>/.exec(paraXml)?.[0]
    if (!numPr) continue
    const numId = /<w:numId\b[^>]*w:val\s*=\s*"([^"]*)"/.exec(numPr)?.[1]
    if (!numId) continue // w:numPr 里没有 numId（如仅 w:ilvl）→ 未构成编号，不计
    result.numberedParagraphs += 1
    const ilvl = (/<w:ilvl\b[^>]*w:val\s*=\s*"([^"]*)"/.exec(numPr)?.[1] ?? "0").trim()
    const fmt = resolveNumFmt(numId.trim(), ilvl, numToAbstract, abstractLevels)
    if (!fmt) {
      result.unresolvedParagraphs += 1
      continue
    }
    counts.set(fmt, (counts.get(fmt) ?? 0) + 1)
    if (fmt === "bullet") result.bulletParagraphs += 1
  }

  result.formats = [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count || a.format.localeCompare(b.format))
  return result
}