/**
 * 技术参数响应表（招标技术要求 → 逐条原文响应）的**素材与装配**层（纯本地、零 AI）。
 *
 * 用户 2026-10-15 的三条口径：
 *  ① 参数来源不固定：常在「采购需求 / 技术规格」章节，偶尔在附件——且**可以由使用者自己描述**，
 *     所以本模块先按用户描述定位，再按标题关键词兜底，最后才回退解析报告分区；
 *  ② 重点条款（★/▲）先扫出来、在表头汇总标注，并**按招标文件原文**响应；
 *  ③ 其他参数按招标文件要求**一一响应**：原文响应，只调整要求类字眼（改由 paramRewrite 完成）。
 *
 * 行序保持招标原文顺序（一一对应、便于专家按编号查找），★/▲ 只在表头另列汇总，不打乱行序。
 */

import { classifyKind, type ParamKind } from "./techParamCoverage"
import { leadingClauseNo, type ParseReport } from "./bidTypes"
import { rewriteRequirementToResponse, type ParamRewriteChange } from "./paramRewrite"

/** 参数来源标题关键词（按优先级）：采购需求/技术规格最常见，附件兜底 */
export const TECH_PARAM_SOURCE_HINTS = [
  "采购需求",
  "技术规格",
  "技术规范",
  "技术参数",
  "技术需求",
  "技术要求",
  "需求清单",
  "货物需求",
  "采购清单",
  "需求一览表",
  "招标需求",
  "技术标准",
  "服务要求",
  "附件",
] as const

/** 判定标题层级：第X章=1、第X节=3、一、=2、1./1.1=2/3，非标题=0 */
function headingLevel(line: string): number {
  const t = line.trim()
  if (!t || t.length > 60) return 0
  if (/^第\s*[0-9一二三四五六七八九十百]+\s*[章篇部分]/.test(t)) return 1
  if (/^第\s*[0-9一二三四五六七八九十百]+\s*节/.test(t)) return 3
  if (/^[一二三四五六七八九十]+\s*[、.．]/.test(t)) return 2
  const num = t.match(/^(\d+(?:\.\d+)*)\s*[、.．:：]?\s*\S/)
  if (num) return num[1].split(".").length + 1
  return 0
}

/**
 * 在招标原文里按标题定位一个章节：命中行起到下一个**同级或更高级**标题为止。
 * 找不到返回 null（调用方继续兜底，绝不猜一段正文出来）。
 */
export function locateTenderSection(text: string, hint: string): { heading: string; body: string } | null {
  const key = (hint ?? "").trim()
  if (!key) return null
  const lines = (text ?? "").split(/\r?\n/)
  let start = -1
  let level = 1
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (!t || !t.includes(key)) continue
    // 命中行优先当标题；命中行不是标题（说明是正文里的引用）时也接受，但按章级处理
    const lv = headingLevel(t)
    start = i
    level = lv || 1
    break
  }
  if (start < 0) return null
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const lv = headingLevel(lines[i])
    if (lv > 0 && lv <= level) break
    body.push(lines[i])
  }
  return { heading: lines[start].trim(), body: body.join("\n").trim() }
}

export type TechParamSource = {
  text: string
  /** custom=用户描述命中 / heading=招标原文标题关键词命中 / parse=解析报告分区兜底 / none=没找到 */
  how: "custom" | "heading" | "parse" | "none"
  /** 展示用来源说明（面板/导出都要能看出「这条从哪来的」） */
  label: string
}

/**
 * 参数来源解析（优先级：用户描述 → 标题关键词 → 解析报告分区）。
 * 用户描述命中不到时**不静默回退**——label 里写清楚实际用了哪一处，避免「我以为看的是附件，其实看的是交货要求」。
 */
export function resolveTechParamSource(
  tenderText: string | null | undefined,
  report: ParseReport | null | undefined,
  customHint?: string,
): TechParamSource {
  const tender = (tenderText ?? "").trim()
  const hint = (customHint ?? "").trim()
  // 描述没命中时**不静默回退**：label 里必须写清「你的描述没找到，实际用的是哪一处」，
  // 否则使用者会以为看的是附件、其实看的是交货要求，参数漏响应都发现不了。
  const miss = hint ? `未在招标原文里找到「${hint}」，` : ""
  if (tender && hint) {
    const hit = locateTenderSection(tender, hint)
    if (hit && hit.body.trim()) {
      return { text: hit.body, how: "custom", label: `按你的描述定位：${hit.heading}` }
    }
  }
  if (tender) {
    for (const k of TECH_PARAM_SOURCE_HINTS) {
      const hit = locateTenderSection(tender, k)
      if (hit && hit.body.trim()) {
        return { text: hit.body, how: "heading", label: `${miss}按招标原文标题定位：${hit.heading}` }
      }
    }
  }
  const sec = (report?.sections ?? []).find((s) => s.key === "delivery_req" && (s.content ?? "").trim())
  if (sec) {
    return { text: sec.content ?? "", how: "parse", label: `${miss}已回退解析报告分区：${sec.title || "交货和服务要求"}` }
  }
  return { text: "", how: "none", label: hint ? `${miss}且解析报告里没有可用的技术需求分区` : "未找到技术参数来源" }
}

export type ParamResponseRow = {
  /** 招标文件行内原编号（5.3.2 / （一）/ ①），无则空串 */
  no: string
  /** 1 起的表内序号 */
  index: number
  kind: ParamKind
  /** 招标要求原文（逐字，保留 ★/▲ 标记）——原文响应要求「招标要求」列必须是原文 */
  original: string
  /** 响应式表述（只调整要求类字眼；未改写时与原文一致） */
  response: string
  changes: ParamRewriteChange[]
  rewritten: boolean
  needs_review: boolean
  reason: string
}

/** 表头汇总用的 ★/▲ 重点条款 */
export type StarParamClause = { no: string; text: string }

const PARAM_LINE_MIN = 6

/**
 * 逐行装配参数响应行：保持招标原文顺序，逐条做字眼转换。
 * 过滤：过短行、纯编号行、以及「以“★”标示…」这类标记说明行（与 starClauseNoise 同口径的轻量判定）。
 */
export function buildParamResponseRows(sourceText: string, opts?: { cap?: number }): ParamResponseRow[] {
  const cap = Math.max(1, opts?.cap ?? 400)
  const out: ParamResponseRow[] = []
  for (const raw of (sourceText ?? "").split(/\r?\n/)) {
    const line = raw.trim()
    // \s 已覆盖全角空格，字符类里不再写字面量（那会触发 no-irregular-whitespace）
    if (line.replace(/\s/g, "").length < PARAM_LINE_MIN) continue
    // 标记说明行（「注：以“★”标示的为实质性条款」）不是参数，不建行
    if (/^[（(【]?\s*注\s*[：:）)】]/.test(line) || /以.{0,3}[★☆▲△].{0,6}(标示|标注|标记)/.test(line)) continue
    const rw = rewriteRequirementToResponse(line)
    out.push({
      no: leadingClauseNo(line),
      index: out.length + 1,
      kind: classifyKind(line),
      original: line,
      response: rw.response,
      changes: rw.changes,
      rewritten: rw.rewritten,
      needs_review: rw.needs_review,
      reason: rw.reason,
    })
    if (out.length >= cap) break
  }
  return out
}

export type ParamResponseSummary = {
  total: number
  /** 【评审项】/关键参数 */
  review: number
  /** ★/▲ 实质性/重点条款 */
  star: number
  general: number
  /** 已按字眼转换改写的条数 */
  rewritten: number
  /** 需人工确认口径的条数（禁止类/许可类/非投标人义务/未识别谓语） */
  needs_review: number
  /** 表头汇总：★/▲ 重点条款（按招标原文顺序，逐字） */
  starClauses: StarParamClause[]
}

export function summarizeParamResponse(rows: ParamResponseRow[]): ParamResponseSummary {
  const list = rows ?? []
  return {
    total: list.length,
    review: list.filter((r) => r.kind === "review").length,
    star: list.filter((r) => r.kind === "star").length,
    general: list.filter((r) => r.kind === "general").length,
    rewritten: list.filter((r) => r.rewritten).length,
    needs_review: list.filter((r) => r.needs_review).length,
    starClauses: list.filter((r) => r.kind === "star" || r.kind === "review").map((r) => ({ no: r.no, text: r.original })),
  }
}

/** 覆盖核对用的轻量归一化：只留汉字/字母/数字（与原文比对同口径） */
function normForCoverage(s: string): string {
  return String(s ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
}

export type ParamResponseCoverage = {
  /** 从解析报告抽到的条款数 */
  clause_count: number
  /** 参数响应表行数 */
  row_count: number
  /** 抽到条款但表里没有对应行的（点名，便于逐条补） */
  missing: string[]
}

/**
 * 覆盖核对：抽取条款 ↔ 参数响应表行（行数应等于条款数）。
 * 两侧文本口径不同（解析报告条款 vs 招标原文参数行），因此按归一化包含匹配，命不中即点名。
 */
export function checkParamResponseCoverage(clauseTexts: string[], rows: ParamResponseRow[]): ParamResponseCoverage {
  const hay = (rows ?? []).map((r) => normForCoverage(r.original))
  const missing = (clauseTexts ?? []).filter((t) => {
    const key = normForCoverage(t)
    if (!key) return false
    return !hay.some((h) => h.includes(key) || key.includes(h))
  })
  return { clause_count: (clauseTexts ?? []).length, row_count: (rows ?? []).length, missing }
}
