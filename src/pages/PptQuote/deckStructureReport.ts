// ---------------------------------------------------------------------------
// 生成/导出前结构自检报告（2026-11-04，E 项）
//
// 用户要求：「导出前结构自检：空页、缺 figure、纯文字比例，结果写进生成报告或 toast。」
//
// 与 deckLint 的分工：
//   · deckLint 是**规则引擎**（哪里有问题、什么级别、是否阻断），面向门禁；
//   · 本模块是**报告层**：把 lint 结果 + 页型统计压成人能一眼看懂的几句话，
//     生成完立刻告诉用户「这一册的版面结构到底怎么样」，而不是等导出才弹一堆告警。
//
// 只读不改：不做任何自动修改，也不改变 lint 的阻断契约。
// ---------------------------------------------------------------------------

import type { Slide } from "./pptQuoteTypes"
import { lintDeck, type DeckLintIssue } from "./deckLint"
import { bulletsBudgetOf, kindQuotaFor } from "./deckOutlineQuota"

export interface StructureReport {
  /** 结构是否达标（没有空页、没有"该有图却没图"的页、纯文字比例在配额内） */
  ok: boolean
  totalPages: number
  /** 内容页数（扣掉封面/目录/章节/致谢） */
  contentPages: number
  /** 空页页码（1 基） */
  emptyPages: number[]
  /** 声明了结构化页型却没画出来的页（1 基） */
  noFigurePages: number[]
  /** 有结构化图示（figures/chart/kpi/配图）的页数 */
  figurePages: number
  /** 纯文字页数 */
  textOnlyPages: number
  /** 纯文字页占内容页比例（0-1） */
  textOnlyRatio: number
  /** 页型分布（kind → 页数） */
  kinds: Record<string, number>
  /** 未达页型配额的中文描述（空数组=达标） */
  missingQuota: string[]
  /** deckLint 的完整告警清单（供自检面板/日志复用） */
  issues: DeckLintIssue[]
  /** 一句话人话摘要（可直接 toast，≤60 字） */
  summaryLine: string
  /** 逐条明细（给生成报告/自检面板用） */
  detailLines: string[]
}

/** 不参与内容页统计的页型 */
const EXEMPT_KINDS = new Set(["cover", "agenda", "section", "summary"])

/** 声明为这些页型的页，必须自带可渲染图示（否则就是"说了要画却没画"） */
const MUST_HAVE_FIGURE_KINDS = new Set(["architecture", "flow", "table"])

/** 该页是否有可视化载体（图示/图表/KPI/真实配图） */
function hasVisualCarrier(s: Slide): boolean {
  return Boolean(s.figures?.length || s.chart || s.kpi?.length || s.image)
}

/** 该页是否"纯文字"（无任何可视化载体，且不是章节过渡页） */
function isTextOnly(s: Slide): boolean {
  if (hasVisualCarrier(s)) return false
  return (s.layout ?? "auto") !== "section"
}

/** 页型判定：优先用大纲声明的 kind，没有就按位置/视觉载体反推 */
function kindOf(s: Slide, idx = -1, total = 0): string {
  if (s.kind) return s.kind
  if (s.chart) return "chart"
  if (s.kpi?.length) return "kpi"
  if (s.image) return "image"
  const fig = s.figures?.[0]
  if (fig) return fig.type // architecture / flow / table / iconGrid / demo
  if ((s.layout ?? "auto") === "section") return "section"
  // 兼容旧数据/单发路径没带 kind：首尾页按封面/致谢处理，
  // 否则「封面 + 致谢」会被算成两个空内容页，整册配额直接从第 1 页就判不达标。
  if (total >= 3) {
    if (idx === 0) return "cover"
    if (idx === total - 1) return "summary"
  }
  return "bullets"
}

/**
 * 生成结构自检报告（纯函数）。
 *
 * 口径与 deckOutlineQuota / deckLint 对齐：
 *   · 内容页 = 总页数 − 封面/目录/章节/致谢
 *   · 纯文字配额 = floor(内容页 × 30%)（与 B 项大纲配额同一个函数，避免两套标准）
 *   · 缺 figure = 声明 architecture/flow/table 但没有任何可视化载体
 */
export function buildStructureReport(slides: Slide[]): StructureReport {
  const issues = lintDeck(slides)
  const totalPages = slides.length
  const kinds: Record<string, number> = {}
  const emptyPages: number[] = []
  const noFigurePages: number[] = []
  let contentPages = 0
  let figurePages = 0
  let textOnlyPages = 0

  slides.forEach((s, i) => {
    const page = i + 1
    const k = kindOf(s, i, slides.length)
    kinds[k] = (kinds[k] ?? 0) + 1
    const exempt = EXEMPT_KINDS.has(k) || (s.layout ?? "auto") === "section"
    if (hasVisualCarrier(s)) figurePages += 1
    if (exempt) return
    contentPages += 1
    if (isTextOnly(s)) textOnlyPages += 1
    // 空页：既无要点也无任何可视化载体
    const hasBullets = (s.bullets ?? []).some((b) => (b ?? "").trim())
    if (!hasBullets && !hasVisualCarrier(s)) emptyPages.push(page)
    // 声明了结构化页型却没画出来
    if (s.kind && MUST_HAVE_FIGURE_KINDS.has(s.kind) && !hasVisualCarrier(s)) noFigurePages.push(page)
  })

  const textOnlyRatio = contentPages > 0 ? textOnlyPages / contentPages : 0
  const quota = kindQuotaFor(totalPages)
  const bulletsMax = bulletsBudgetOf(Math.max(1, contentPages))
  const archPages = slides.filter((s, i) => kindOf(s, i, slides.length) === "architecture").length
  const flowPages = slides.filter((s, i) => kindOf(s, i, slides.length) === "flow").length
  const dataPages = slides.filter((s, i) => ["kpi", "table", "chart"].includes(kindOf(s, i, slides.length))).length

  const missingQuota: string[] = []
  if (quota.architectureMin && archPages < quota.architectureMin) missingQuota.push(`缺 ${quota.architectureMin - archPages} 页分层架构图`)
  if (quota.flowMin && flowPages < quota.flowMin) missingQuota.push(`缺 ${quota.flowMin - flowPages} 页流程/分期路径图`)
  if (quota.dataMin && dataPages < quota.dataMin) missingQuota.push(`缺 ${quota.dataMin - dataPages} 页 KPI/对照页`)
  if (textOnlyPages > bulletsMax) missingQuota.push(`纯文字 ${textOnlyPages} 页，超过上限 ${bulletsMax} 页`)

  const ok = emptyPages.length === 0 && noFigurePages.length === 0 && textOnlyPages <= bulletsMax

  const detailLines: string[] = []
  if (emptyPages.length) detailLines.push(`空白页：第 ${emptyPages.join("、")} 页（无要点也无图示）`)
  if (noFigurePages.length) detailLines.push(`声明要画图却没画：第 ${noFigurePages.join("、")} 页`)
  if (missingQuota.length) detailLines.push(`页型配额：${missingQuota.join("；")}`)
  if (quota.architectureMin || quota.flowMin || quota.dataMin) {
    detailLines.push(`页型分布：架构 ${archPages} 页、流程 ${flowPages} 页、KPI/对照 ${dataPages} 页、纯文字 ${textOnlyPages} 页`)
  }

  return {
    ok,
    totalPages,
    contentPages,
    emptyPages,
    noFigurePages,
    figurePages,
    textOnlyPages,
    textOnlyRatio,
    kinds,
    missingQuota,
    issues,
    summaryLine: summaryLineOf({ ok, contentPages, emptyPages, noFigurePages, textOnlyPages, textOnlyRatio, missingQuota }),
    detailLines,
  }
}

/** 组装一句话摘要（人话、带关键数字、≤60 字） */
function summaryLineOf(r: {
  ok: boolean
  contentPages: number
  emptyPages: number[]
  noFigurePages: number[]
  textOnlyPages: number
  textOnlyRatio: number
  missingQuota: string[]
}): string {
  const pct = Math.round(r.textOnlyRatio * 100)
  if (!r.contentPages) return "结构自检：本册还没有内容页"
  const head = r.ok ? "结构自检通过" : "结构自检有问题"
  const bits: string[] = [`${r.contentPages} 页内容页`]
  if (r.emptyPages.length) bits.push(`${r.emptyPages.length} 页空白`)
  if (r.noFigurePages.length) bits.push(`${r.noFigurePages.length} 页缺图示`)
  bits.push(`纯文字 ${pct}%`)
  const tail = r.ok ? "" : `（${r.missingQuota[0] ?? "建议补图示"}）`
  return `${head}：${bits.join("，")}${tail}`
}

/** 生成后/导出前的 toast 文案：摘要 + 一句可执行建议 */
export function reportToastLine(report: StructureReport): string {
  if (!report.totalPages) return ""
  if (report.ok) return `${report.summaryLine}，可逐页精修后导出`
  const tips: string[] = []
  if (report.emptyPages.length) tips.push("补全空白页")
  if (report.noFigurePages.length) tips.push("把声明要画图页的图示补上")
  if (report.textOnlyPages > bulletsMaxOf(report)) tips.push("把纯文字页改成架构/流程/对照")
  return `${report.summaryLine}；建议${tips.length ? tips.join("、") : "导出前逐页复核"}`
}

function bulletsMaxOf(report: StructureReport): number {
  return bulletsBudgetOf(Math.max(1, report.contentPages))
}
