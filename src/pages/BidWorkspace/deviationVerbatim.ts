import {
  deviationResponseText,
  type DeviationAlignment,
  type DeviationRow,
  type RequirementClause,
} from "./bidTypes"

/**
 * 偏离表「原文响应」与「一一对应」的零 AI 兜底（2026-10-15 用户裁定）。
 * 两条硬要求：① 响应内容必须是投标文件原文（逐字），② 招标要求与响应材料一一对应、方便专家查。
 *
 * 为什么必须由程序判、而不能只靠提示词：模型很擅长把原文「整理」成通顺摘要——
 * 摘要读起来更像响应，但专家拿它回正文逐字找原句会找不到，评审现场说不清。
 * 判定只在正文范围内做：命中即通过；不命中只标 not_verbatim（面板角标 + 交卷体检 warn），
 * 不删改、不阻断导出——「检索不到」也可能是分块/归一化导致的假阴性，最终由人确认。
 */

/** 归一化：只留汉字/字母/数字——空白、全角空格与各类标点在比对时一律忽略（PDF 提取件字符间常夹空格与竖线） */
export function normalizeQuoteText(s: string): string {
  return String(s ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
}

/** 省略标记：允许用「……」省掉中间，但两端必须逐字（省掉的只能是中间） */
const ELISION_RE = /(?:…+|\.{3,}|⋯+|——+)/
/** 片段最短长度：短于 4 字的片段没有区分度（「支持」「提供」到处都是），不参与命中判定 */
const MIN_SEGMENT_LEN = 4

/** 拆成需要逐字命中的片段（去省略标记后仍 ≥4 字的才算） */
export function splitQuoteSegments(quote: string): string[] {
  return String(quote ?? "")
    .split(ELISION_RE)
    .map((s) => normalizeQuoteText(s))
    .filter((s) => s.length >= MIN_SEGMENT_LEN)
}

export type VerbatimCheck = {
  /** 是否真的比对过：响应内容为空、或全是短片段时 false——没有可比的东西，不得据此判「非原文」 */
  checked: boolean
  verbatim: boolean
  /** 正文里检索不到的片段（排查用） */
  missing: string[]
}

/** 单条响应内容的原文核对：所有片段都能在正文里逐字找到才算原文响应 */
export function checkQuoteVerbatim(quote: string, bidText: string): VerbatimCheck {
  const normText = normalizeQuoteText(bidText)
  const segments = splitQuoteSegments(quote)
  if (!normText || !segments.length) return { checked: false, verbatim: false, missing: [] }
  const missing = segments.filter((s) => !normText.includes(s))
  return { checked: true, verbatim: missing.length === 0, missing }
}

/**
 * 逐行标 not_verbatim：响应内容在正文里检索不到即疑似改写/概括/编造。
 * 「待人工核对」行（本次不可见）不参与——它们本来就没有可比对的响应内容。
 */
export function markNonVerbatimRows(rows: DeviationRow[], bidText: string): DeviationRow[] {
  const text = String(bidText ?? "")
  if (!text.trim()) return rows
  return rows.map((r) => {
    if (r.needs_review === true) return r
    const res = checkQuoteVerbatim(deviationResponseText(r), text)
    return res.checked && !res.verbatim ? { ...r, not_verbatim: true } : r
  })
}

export type DeviationVerbatimReport = {
  total: number
  /** 参与原文比对的条数（有响应内容且非待核对行） */
  checked: number
  verbatim: number
  not_verbatim: number
  /** 响应内容为空的条数（排除待人工核对行）——空响应同样要人补 */
  missing_text: number
}

export function deviationVerbatimReport(rows: DeviationRow[] | null | undefined): DeviationVerbatimReport {
  let checked = 0
  let verbatim = 0
  let notVerbatim = 0
  let missingText = 0
  for (const r of rows ?? []) {
    if (r.needs_review === true) continue
    if (!deviationResponseText(r)) {
      missingText += 1
      continue
    }
    checked += 1
    if (r.not_verbatim === true) notVerbatim += 1
    else verbatim += 1
  }
  return { total: (rows ?? []).length, checked, verbatim, not_verbatim: notVerbatim, missing_text: missingText }
}

/**
 * 一一对应核对：招标条款 ↔ 偏离表行。规整阶段已保证「每条条款一行、同条款不重复」，
 * 这里把结论算出来存进 response_map，供面板与交卷体检直接显示，而不是让使用者自己数行数。
 */
export function checkDeviationAlignment(rows: DeviationRow[], clauses: RequirementClause[]): DeviationAlignment {
  const seen = new Map<string, number>()
  for (const r of rows ?? []) seen.set(r.clause_id, (seen.get(r.clause_id) ?? 0) + 1)
  return {
    clause_count: clauses.length,
    row_count: (rows ?? []).length,
    missing: clauses.filter((c) => !seen.has(c.id)).map((c) => c.id),
    duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id),
  }
}
