import { isTerminalStage, type CustomerRow, type OpportunityRow } from "./customerTypes"
import { lostReasonCategory } from "@/lib/lostReason"

// ---------------------------------------------------------------------------
// 赢单/丢单复盘纯聚合（Round 28）：输入当前已加载的商机+客户，输出 Pareto 与分客群胜率
// 口径诚实：数据受分页限制时 partial=true，界面必须标注「基于已加载 N 条」
// ---------------------------------------------------------------------------

export interface LostReasonParetoRow {
  reason: string
  count: number
  /** 占丢单总数百分比（0-100，四舍五入） */
  pct: number
  /** 按数量降序后的累计百分比（0-100，四舍五入） */
  cumPct: number
}

export interface SegmentWinRateRow {
  segment: string
  won: number
  lost: number
  /** won/(won+lost) 百分比；终态数为 0 时为 null */
  winRate: number | null
}

export interface WinLossReview {
  decidedCount: number
  won: number
  lost: number
  /** 赢单率百分比（0-100）；无终态商机时 null */
  winRate: number | null
  lostReasonPareto: LostReasonParetoRow[]
  segmentWinRates: SegmentWinRateRow[]
  /** 商机或客户任一仍在分页状态（未加载全量） */
  partial: boolean
}

export function buildWinLossReview(
  opportunities: OpportunityRow[],
  customers: CustomerRow[],
  opts?: { partial?: boolean },
): WinLossReview {
  const decided = opportunities.filter((o) => isTerminalStage(o.stage))
  const won = decided.filter((o) => o.stage === "won")
  const lost = decided.filter((o) => o.stage === "lost")
  const winRate = decided.length > 0 ? Math.round((won.length / decided.length) * 100) : null

  // 丢单原因 Pareto：按类别计数降序，附累计百分比（80/20 视角）
  const reasonCount = new Map<string, number>()
  for (const o of lost) {
    const reason = lostReasonCategory(o.lost_reason ?? "")
    reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1)
  }
  const sorted = [...reasonCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
  let acc = 0
  const lostReasonPareto: LostReasonParetoRow[] = sorted.map(([reason, count]) => {
    acc += count
    return {
      reason,
      count,
      pct: Math.round((count / lost.length) * 100),
      cumPct: Math.round((acc / lost.length) * 100),
    }
  })

  // 分客群胜率：hospital_type 分组；商机找不到客户档案归「未知类型」
  const typeById = new Map(customers.map((c) => [c.id, (c.hospital_type || "").trim() || "未知类型"]))
  const segAgg = new Map<string, { won: number; lost: number }>()
  for (const o of decided) {
    const seg = typeById.get(o.customer_id) ?? "未知类型"
    const cur = segAgg.get(seg) ?? { won: 0, lost: 0 }
    if (o.stage === "won") cur.won += 1
    else cur.lost += 1
    segAgg.set(seg, cur)
  }
  const segmentWinRates: SegmentWinRateRow[] = [...segAgg.entries()]
    .map(([segment, v]) => ({
      segment,
      won: v.won,
      lost: v.lost,
      winRate: v.won + v.lost > 0 ? Math.round((v.won / (v.won + v.lost)) * 100) : null,
    }))
    .sort((a, b) => b.won + b.lost - (a.won + a.lost) || a.segment.localeCompare(b.segment, "zh-CN"))

  return {
    decidedCount: decided.length,
    won: won.length,
    lost: lost.length,
    winRate,
    lostReasonPareto,
    segmentWinRates,
    partial: opts?.partial === true,
  }
}
