import { useMemo } from "react"
import { BarChart3, TrendingUp } from "lucide-react"
import type { CustomerRow, OpportunityRow } from "@/pages/CustomerManagement/customerTypes"
import { buildWinLossReview } from "@/pages/CustomerManagement/winLossReview"

type WinLossReviewPanelProps = {
  opportunities: OpportunityRow[]
  customers: CustomerRow[]
  /** 商机或客户任一未加载全量（分页中），口径需如实标注 */
  partial: boolean
}

/** 赢单/丢单复盘面板（Round 28）：丢单原因 Pareto + 分客群胜率，挂在商机看板下方 */
export function WinLossReviewPanel({ opportunities, customers, partial }: WinLossReviewPanelProps) {
  const review = useMemo(
    () => buildWinLossReview(opportunities, customers, { partial }),
    [opportunities, customers, partial],
  )

  if (review.decidedCount === 0) return null
  const maxReason = review.lostReasonPareto[0]?.count ?? 0

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">赢单/丢单复盘</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          基于已加载 {review.decidedCount} 条终态商机（赢 {review.won} · 输 {review.lost} · 胜率{" "}
          {review.winRate == null ? "—" : `${review.winRate}%`}）{review.partial ? " · 数据未加载完整，仅供参考" : ""}
        </p>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">丢单原因 Pareto（累计占比）</p>
          {review.lostReasonPareto.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              还没有丢单记录，或丢单都未填写原因
            </p>
          ) : (
            <ul className="mt-2.5 flex flex-col gap-2.5">
              {review.lostReasonPareto.map((row) => (
                <li key={row.reason} className="flex items-center gap-2.5">
                  <span className="w-24 shrink-0 truncate text-xs text-foreground" title={row.reason}>
                    {row.reason}
                  </span>
                  <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="absolute inset-y-0 left-0 block rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${maxReason > 0 ? Math.round((row.count / maxReason) * 100) : 0}%` }}
                    />
                    {/* 累计占比刻度线：80/20 视角看头部原因覆盖了哪几类 */}
                    <span
                      className="absolute inset-y-0 w-0.5 bg-destructive/70"
                      style={{ left: `${row.cumPct}%` }}
                      title={`累计 ${row.cumPct}%`}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {row.count} · {row.pct}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">分客群胜率（按医院类型）</p>
          {review.segmentWinRates.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              暂无可分组的终态商机
            </p>
          ) : (
            <ul className="mt-2.5 flex flex-col gap-2">
              {review.segmentWinRates.map((row) => (
                <li key={row.segment} className="flex items-center gap-2.5">
                  <span className="w-24 shrink-0 truncate text-xs text-foreground" title={row.segment}>
                    {row.segment}
                  </span>
                  <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${row.winRate ?? 0}%` }}
                    />
                  </span>
                  <span className="inline-flex w-24 shrink-0 items-center justify-end gap-1 text-right text-xs tabular-nums text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-primary" />
                    {row.winRate == null ? "—" : `${row.winRate}%`}
                    <span className="text-muted-foreground/70">
                      ({row.won}/{row.won + row.lost})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
