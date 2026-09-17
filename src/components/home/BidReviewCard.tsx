import { Loader2, TrendingUp, Trophy, XCircle } from "lucide-react"

/** 胜负复盘聚合数据（内存聚合当前用户商机 stage/lost_reason + 标书 bid_result，零后端） */
export type BidReview = {
  won: number
  lost: number
  winRate: number | null
  lostReasonTop: { reason: string; count: number }[]
  /** D1：聚合源拉满 200 条（hook 上限）时置 true，卡片加小字提示仅聚合最近 200 条 */
  sourceCapped?: boolean
}

type BidReviewCardProps = {
  review: BidReview
  loading: boolean
}

/** 轮次 F 轨 2：胜负复盘只读聚合卡（内存聚合当前用户商机 stage/lost_reason，零后端） */
export function BidReviewCard({ review, loading }: BidReviewCardProps) {
  const decided = review.won + review.lost
  const maxCount = review.lostReasonTop.reduce((m, r) => Math.max(m, r.count), 0)
  return (
    <section className="mb-5 rounded-xl border border-border bg-card p-4 shadow-md lg:p-5 animate-in fade-in duration-500">
      <header className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-primary" />
          胜负复盘
        </h2>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          已出结果商机 {decided} 个
        </span>
      </header>

      {review.sourceCapped && !loading && (
        <p className="mt-1 text-xs text-muted-foreground">仅聚合最近 200 条</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          复盘数据加载中…
        </div>
      ) : decided === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
          <Trophy className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">还没有分出胜负的商机</p>
          <p className="text-xs text-muted-foreground">
            在客户管理里把商机推进到「赢单 / 输单」并填写输单原因，这里会自动汇总胜率
          </p>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
          <div className="flex flex-col justify-center rounded-lg border border-border bg-background p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">胜率（赢单 / 已出结果）</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-primary">
              {review.winRate == null ? "—" : `${review.winRate}%`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
                <Trophy className="h-3.5 w-3.5" />
                赢单 {review.won}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 font-medium text-destructive">
                <XCircle className="h-3.5 w-3.5" />
                输单 {review.lost}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">输单原因 Top {review.lostReasonTop.length || 5}</p>
            {review.lostReasonTop.length === 0 ? (
              <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                输单商机还没填写原因，去客户管理推进阶段时补一下，复盘会更有参考价值
              </p>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-2">
                {review.lostReasonTop.map((row) => (
                  <li key={row.reason} className="flex items-center gap-2.5">
                    <span className="w-32 shrink-0 truncate text-xs text-foreground" title={row.reason}>
                      {row.reason}
                    </span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0}%` }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
