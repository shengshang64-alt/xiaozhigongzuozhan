import {
  buildScoringCoverageMatrix,
  numberScoringItems,
  type ParseReport,
} from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/**
 * R-025 评分覆盖体检（纯本地零 AI）——按【分值】而非条款数统计技术评分项落点。
 * 现有「需求响应覆盖 59/60 条」只数条款、不数评分项分值（第 2 轮 M-001：建阳区 58 分技术参数、
 * 售后服务/技术培训整章缺失却仍报 60/60）。本体检复用 R31 覆盖矩阵（numberScoringItems +
 * buildScoringCoverageMatrix），输出「技术总分 / 已落点 / 未落点」与逐评分项明细，丢几分看得见。
 * 落点判定沿用现成能力：技术叶子的 [响应:Rx] 标注由 backfillResponseTags 依章节名相似度回填，
 * 故「项目实施组织与进度计划」这类近义章节能命中「项目实施方案」评分项，无需另建映射。
 */

export type ScoreCheckupRow = {
  /** 稳定编号 R1/R2…（tech） */
  id: string
  /** 评分项名 */
  name: string
  /** 分值 */
  score: number
  /** 主观分标记（R31） */
  subjective: boolean
  /** 是否已有承接章节 */
  covered: boolean
  /** 承接章节标题（按大纲顺序，去重） */
  coveredBy: string[]
}

export type ScoreCheckup = {
  /** 是否解析到技术评分项（无评分表时体检不呈现） */
  hasScoring: boolean
  /** 技术总分（评分表技术项分值合计） */
  techTotal: number
  /** 已落点分值（有对应章节的评分项合计） */
  techLanded: number
  /** 未落点分值（=techTotal-techLanded，丢分额） */
  techMissing: number
  /** 逐评分项明细（技术项，按编号序） */
  rows: ScoreCheckupRow[]
  /** 未落点明细（丢分清单，按分值降序——丢分大户在前） */
  missingRows: ScoreCheckupRow[]
}

/** 分值求和统一保留 1 位小数（评分表多为整数，兼容 0.5 步进） */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function buildScoreCheckup(
  outline: OutlineNode[],
  report: ParseReport | null | undefined,
): ScoreCheckup {
  const empty: ScoreCheckup = { hasScoring: false, techTotal: 0, techLanded: 0, techMissing: 0, rows: [], missingRows: [] }
  if (!report) return empty
  const items = numberScoringItems(report)
  if (!items.length) return empty
  const matrix = buildScoringCoverageMatrix(outline ?? [], items)
  const rows: ScoreCheckupRow[] = matrix.map((e) => ({
    id: e.item.id,
    name: e.item.item,
    score: round1(e.item.score),
    subjective: e.item.isSubjective,
    covered: e.coveredBy.length > 0,
    coveredBy: e.coveredBy,
  }))
  if (!rows.length) return empty
  const techTotal = round1(rows.reduce((acc, r) => acc + r.score, 0))
  const techLanded = round1(rows.filter((r) => r.covered).reduce((acc, r) => acc + r.score, 0))
  const missingRows = rows.filter((r) => !r.covered).sort((a, b) => b.score - a.score)
  return { hasScoring: true, techTotal, techLanded, techMissing: round1(techTotal - techLanded), rows, missingRows }
}

/** 未落点评分项 → 建议补入的技术章节标题（去重、保序） */
export function uncoveredScoreTitles(checkup: ScoreCheckup): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of checkup.missingRows) {
    const t = r.name.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
