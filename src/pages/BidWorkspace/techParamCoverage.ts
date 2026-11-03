import {
  clauseMatchesTitle,
  collectLeafTitles,
  DEVIATION_CLAUSE_SOURCES,
  extractRequirementClauses,
  techOutlineNodes,
  type DeviationTable,
  type ParseReport,
  type RequirementClause,
  type ResponseLevel,
} from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/**
 * R-022 技术参数落点（纯本地零 AI）——按第五章「技术和服务要求」全部参数逐条核对落点。
 * 现有「需求响应覆盖 N/M」（改造 3 / OutlineCoverage）上限只抽 60 条、不区分参数权重，
 * 第 2 轮 R-022 要求：全量参数逐条建节点/进偏离表，标注【评审项】/▲/一般项，
 * 联动正负偏离（负偏离每项扣 0.5，扣分随招标文件可覆盖），页面显示「已覆盖 N/总数」并高亮未覆盖。
 * 落点口径：参数命中技术大纲叶子（建节点）或出现在技术偏离表行（进偏离表）任一即视为已覆盖；
 * 偏离表行的响应级别（full/partial/deviation）来自既有 AI 判定，本模块只读取不再判定。
 */

/** 参数权重类型：【评审项】（评分/关键参数）/ ▲实质性（★▲标记）/ 一般项 */
export type ParamKind = "review" | "star" | "general"

export const PARAM_KIND_LABEL: Record<ParamKind, string> = {
  review: "【评审项】",
  star: "▲实质性",
  general: "一般项",
}

/** 负偏离每项扣分默认值（样例规则：负偏离每项扣 0.5；实际以招标文件评分细则为准，可经 opts 覆盖） */
export const DEFAULT_NEGATIVE_PENALTY = 0.5

// 【评审项】标注 / 评审项 / 关键参数等表述 → review；★▲△标记 → star；其余 general
const REVIEW_RE = /【\s*评审项\s*】|[（(]\s*评审项\s*[)）]|评审项|关键参数|主要参数|核心参数/
const STAR_RE = /[★☆▲△]/

/** 参数权重分类（导出供单测与 UI 徽标复用） */
export function classifyKind(text: string): ParamKind {
  if (REVIEW_RE.test(text ?? "")) return "review"
  if (STAR_RE.test(text ?? "")) return "star"
  return "general"
}

export type TechParamRow = {
  id: string
  text: string
  source: string
  kind: ParamKind
  /** 已进技术偏离表（有对应判定行） */
  inDeviation: boolean
  /** 偏离表判定级别（未进表为 ""） */
  deviationLevel: ResponseLevel
  /** 已建大纲技术叶子节点 */
  inOutline: boolean
  /** 已覆盖 = 进偏离表 或 建节点 */
  covered: boolean
}

export type TechParamCoverage = {
  hasParams: boolean
  total: number
  covered: number
  uncovered: number
  reviewCount: number
  starCount: number
  generalCount: number
  /** 已进偏离表条数（响应表非空核验用） */
  inDeviationCount: number
  /** 负偏离（response_level==="deviation"）条数 */
  negativeCount: number
  /** 部分响应条数（提示用，不计扣分） */
  partialCount: number
  perItemPenalty: number
  /** 负偏离预计扣分合计 = negativeCount × perItemPenalty */
  deviationPenalty: number
  rows: TechParamRow[]
  uncoveredRows: TechParamRow[]
}

/** 分值/扣分统一保留 1 位小数（兼容 0.5 步进） */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function buildTechParamCoverage(
  outline: OutlineNode[],
  report: ParseReport | null | undefined,
  deviationTable: DeviationTable | null | undefined,
  opts?: { perItemPenalty?: number; limit?: number; clauses?: RequirementClause[] },
): TechParamCoverage {
  const perItemPenalty = opts?.perItemPenalty ?? DEFAULT_NEGATIVE_PENALTY
  const empty: TechParamCoverage = {
    hasParams: false,
    total: 0,
    covered: 0,
    uncovered: 0,
    reviewCount: 0,
    starCount: 0,
    generalCount: 0,
    inDeviationCount: 0,
    negativeCount: 0,
    partialCount: 0,
    perItemPenalty,
    deviationPenalty: 0,
    rows: [],
    uncoveredRows: [],
  }
  // 全量抽取（默认上限 240，覆盖样例 116 项），拆分维度固定 l3 逐条到最小参数；
  // 来源与偏离表同口径（只取技术文件要求），否则「已覆盖 N/M」的分母里混进评分项，与偏离表行数对不上。
  // 调用方（hook）若传入 clauses，即为「同一次 resolveDeviationClauses 的产物」——偏离表/条数预告/落点三处同一口径；
  // 未传时保持旧路径（解析报告 delivery_req 分区），存量调用与单测零改动。
  const clauses: RequirementClause[] =
    opts?.clauses ??
    (report
      ? extractRequirementClauses(report, {
          limit: opts?.limit ?? 240,
          granularity: "l3",
          sources: DEVIATION_CLAUSE_SOURCES,
        })
      : [])
  if (!clauses.length) return empty

  const leaves = collectLeafTitles(techOutlineNodes(outline ?? []))
  const devRows = deviationTable?.rows ?? []

  const rows: TechParamRow[] = clauses.map((cl) => {
    const kind = classifyKind(cl.text)
    const inOutline = leaves.some((t) => clauseMatchesTitle(cl.text, t))
    // 偏离表命中：clause_id 同源，或条款文本与偏离表行公共子串≥4（同抽取口径）
    const dev = devRows.find((r) => (r.clause_id && r.clause_id === cl.id) || clauseMatchesTitle(cl.text, r.clause_text))
    const deviationLevel: ResponseLevel = dev?.response_level ?? ""
    const inDeviation = !!dev
    return {
      id: cl.id,
      text: cl.text,
      source: cl.source,
      kind,
      inDeviation,
      deviationLevel,
      inOutline,
      covered: inDeviation || inOutline,
    }
  })

  const covered = rows.filter((r) => r.covered).length
  const negativeCount = rows.filter((r) => r.deviationLevel === "deviation").length
  return {
    hasParams: true,
    total: rows.length,
    covered,
    uncovered: rows.length - covered,
    reviewCount: rows.filter((r) => r.kind === "review").length,
    starCount: rows.filter((r) => r.kind === "star").length,
    generalCount: rows.filter((r) => r.kind === "general").length,
    inDeviationCount: rows.filter((r) => r.inDeviation).length,
    negativeCount,
    partialCount: rows.filter((r) => r.deviationLevel === "partial").length,
    perItemPenalty,
    deviationPenalty: round1(negativeCount * perItemPenalty),
    rows,
    uncoveredRows: rows.filter((r) => !r.covered),
  }
}

/** 未覆盖参数 id 清单（供逐条/全部补入大纲） */
export function uncoveredParamIds(cov: TechParamCoverage): string[] {
  return cov.uncoveredRows.map((r) => r.id)
}
