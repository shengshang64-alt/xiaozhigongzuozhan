import {
  REVIEW_DIMS,
  verdictFromTotal,
  type Chapter,
  type ChapterReviewVerdict,
  type ChapterReviewScores,
} from "./solutionTypes"

// ---------------------------------------------------------------------------
// R276 方案整本五维自检总览：把散落在各章的 AI 自检评分（ChapterSelfCheck）
// 汇总成一份「整本体检报告」——覆盖率、均分、结论分布、各维度均分与短板、
// 待重写清单、高频问题聚合。纯本地确定性计算，零 AI 零费用；结论以
// verdictFromTotal 规则重算为准，不信存量 LLM 自报 verdict（与单章自检链路一致）。
// ---------------------------------------------------------------------------

export type SelfCheckDimStat = {
  key: keyof ChapterReviewScores
  label: string
  /** 该维度在已自检章节上的均分（0-20，保留 1 位小数；无已自检章时为 0） */
  avg: number
}

export type SelfCheckRewriteItem = {
  nodeId: string
  title: string
  total: number
  verdict: ChapterReviewVerdict
}

export type SelfCheckIssueGroup = { dim: string; count: number }

export type SelfCheckOverview = {
  /** 全部章节数 */
  totalChapters: number
  /** 已有正文的章节数（自检候选池） */
  bodyChapters: number
  /** 已自检（有正文且有 selfCheck）的章节数 */
  reviewedCount: number
  /** 已生成正文但尚未自检的章节数 */
  pendingCount: number
  /** 已自检章节的平均总分（0-100，保留 1 位小数；无已自检章时为 0） */
  avgTotal: number
  /** 结论分布（按规则重算） */
  verdictDist: Record<ChapterReviewVerdict, number>
  /** 各维度均分（按 REVIEW_DIMS 固定顺序） */
  dimStats: SelfCheckDimStat[]
  /** 均分最低的维度（无已自检章时为 null） */
  weakestDim: SelfCheckDimStat | null
  /** verdict=blocked 的章节清单，按分数升序（最需要重写的排前面） */
  rewriteList: SelfCheckRewriteItem[]
  /** 高频问题：按 dim 聚合计数，降序 */
  topIssues: SelfCheckIssueGroup[]
  /** 自检覆盖率（reviewedCount/bodyChapters，百分比整数；bodyChapters=0 时为 0） */
  reviewedRatio: number
}

export function buildSelfCheckOverview(chapters: Chapter[]): SelfCheckOverview {
  const totalChapters = chapters.length
  const bodyChs = chapters.filter((c) => (c.content ?? "").trim())
  const bodyChapters = bodyChs.length
  const reviewed = bodyChs.filter((c) => c.selfCheck)
  const reviewedCount = reviewed.length
  const pendingCount = bodyChapters - reviewedCount

  const verdictDist: Record<ChapterReviewVerdict, number> = { direct: 0, review: 0, blocked: 0 }
  const dimSum: Record<string, number> = {}
  const dimCnt: Record<string, number> = {}
  const issueMap: Record<string, number> = {}
  const rewriteList: SelfCheckRewriteItem[] = []
  let totalSum = 0

  for (const c of reviewed) {
    const sc = c.selfCheck as NonNullable<Chapter["selfCheck"]>
    const verdict = verdictFromTotal(sc.total)
    verdictDist[verdict] += 1
    totalSum += sc.total
    for (const d of REVIEW_DIMS) {
      dimSum[d.key] = (dimSum[d.key] ?? 0) + (sc.scores?.[d.key] ?? 0)
      dimCnt[d.key] = (dimCnt[d.key] ?? 0) + 1
    }
    for (const iss of sc.issues ?? []) {
      const k = iss.dim?.trim() || "综合"
      issueMap[k] = (issueMap[k] ?? 0) + 1
    }
    if (verdict === "blocked") {
      rewriteList.push({ nodeId: c.node_id, title: c.title, total: sc.total, verdict })
    }
  }

  const avgTotal = reviewedCount ? Math.round((totalSum / reviewedCount) * 10) / 10 : 0
  const dimStats: SelfCheckDimStat[] = REVIEW_DIMS.map((d) => ({
    key: d.key,
    label: d.label,
    avg: dimCnt[d.key] ? Math.round(((dimSum[d.key] ?? 0) / dimCnt[d.key]) * 10) / 10 : 0,
  }))
  let weakestDim: SelfCheckDimStat | null = null
  if (reviewedCount) {
    weakestDim = dimStats.reduce((min, cur) => (cur.avg < min.avg ? cur : min), dimStats[0])
  }
  const topIssues: SelfCheckIssueGroup[] = Object.entries(issueMap)
    .map(([dim, count]) => ({ dim, count }))
    .sort((a, b) => b.count - a.count)
  rewriteList.sort((a, b) => a.total - b.total)

  return {
    totalChapters,
    bodyChapters,
    reviewedCount,
    pendingCount,
    avgTotal,
    verdictDist,
    dimStats,
    weakestDim,
    rewriteList,
    topIssues,
    reviewedRatio: bodyChapters ? Math.round((reviewedCount / bodyChapters) * 100) : 0,
  }
}

/** 汇总一段可复制到整改笔记的纯文本（本地生成，供卡片「复制总览」按钮） */
export function buildSelfCheckBriefText(ov: SelfCheckOverview): string {
  const lines: string[] = []
  lines.push(`整本 AI 自检总览：已自检 ${ov.reviewedCount}/${ov.bodyChapters} 章，均分 ${ov.avgTotal}`)
  lines.push(
    `结论分布：可直接采用 ${ov.verdictDist.direct} · 建议微调 ${ov.verdictDist.review} · 建议重写 ${ov.verdictDist.blocked}`,
  )
  if (ov.reviewedCount) {
    lines.push("各维度均分：" + ov.dimStats.map((d) => `${d.label} ${d.avg}`).join("、"))
    if (ov.weakestDim) lines.push(`最弱维度：${ov.weakestDim.label}（均 ${ov.weakestDim.avg}/20）`)
  }
  if (ov.rewriteList.length) {
    lines.push("建议重写章节：")
    for (const r of ov.rewriteList) lines.push(`  - ${r.title}（${r.total} 分）`)
  }
  if (ov.topIssues.length) {
    lines.push("高频问题：" + ov.topIssues.slice(0, 6).map((g) => `${g.dim}×${g.count}`).join("、"))
  }
  if (ov.pendingCount) lines.push(`（另有 ${ov.pendingCount} 章已生成正文但尚未自检）`)
  return lines.join("\n")
}
