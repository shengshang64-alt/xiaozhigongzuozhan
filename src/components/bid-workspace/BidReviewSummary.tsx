import { useMemo } from "react"
import { TrendingUp } from "lucide-react"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { formatMoney } from "@/lib/money"

// R006（B-3 阶段一）：投标复盘汇总——纯统计零 AI。bid_result/bid_amount(万元)/lost_reason 字段
// 早已存在，本组件只做聚合展示；落标原因结构化表单列为阶段二。

type BidReviewStats = {
  total: number
  finished: number
  won: number
  lost: number
  winRate: number | null
  wonAmount: number
  pendingCount: number
  topReasons: [string, number][]
  smallSample: boolean
}

export function summarizeBidResults(projects: BidProjectRecord[]): BidReviewStats {
  const active = (projects ?? []).filter((r) => !r.deleted_at)
  const won = active.filter((r) => r.bid_result === "won")
  const lost = active.filter((r) => r.bid_result === "lost")
  const finished = won.length + lost.length
  const wonAmount = won.reduce((acc, r) => acc + (Number(r.bid_amount) || 0), 0)
  const pendingCount = active.length - finished
  const reasonCounts = new Map<string, number>()
  for (const r of lost) {
    const reason = (r.lost_reason ?? "").trim()
    if (!reason) continue
    // R012（B-3 阶段二）：优先按「【类别】明细」前缀聚合；无前缀旧数据按原文截断回退
    const coded = reason.match(/^【([^】]+)】/)
    const key = coded
      ? coded[1]
      : reason.length > 24
        ? `${reason.slice(0, 24)}…`
        : reason
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return {
    total: active.length,
    finished,
    won: won.length,
    lost: lost.length,
    winRate: finished > 0 ? Math.round((won.length / finished) * 100) : null,
    wonAmount,
    pendingCount,
    topReasons,
    smallSample: finished > 0 && finished < 5,
  }
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function BidReviewSummary({ projects }: { projects: BidProjectRecord[] }) {
  const stats = useMemo(() => summarizeBidResults(projects), [projects])
  if (stats.finished === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] text-sky-950">
        <TrendingUp className="h-3.5 w-3.5 text-sky-700" />
        <div className="min-w-0 flex-1">
          暂无已结束项目（已结束 {stats.finished} · 中标 {stats.won} · 落标 {stats.lost}），出结果后这里会生成复盘：中标率、中标金额、落标原因 Top3。
        </div>
        <a href="/review" className="shrink-0 text-xs font-medium text-primary hover:underline">
          投标复盘 →
        </a>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-5 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-primary" />
          投标复盘
        </h2>
        {stats.smallSample && (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs text-warning">
            已结束样本不足 5 个，中标率仅供参考
          </span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="投标项目" value={`${stats.total}`} hint={`已结束 ${stats.finished} · 中标 ${stats.won} · 落标 ${stats.lost}`} />
        <StatCard
          label="中标率"
          value={stats.winRate === null ? "—" : `${stats.winRate}%`}
          hint={stats.winRate === null ? "暂无已结束项目" : `${stats.won}/${stats.finished} 个已结束项目`}
        />
        <StatCard label="中标金额合计" value={formatMoney(stats.wonAmount)} hint="单位：万元（按项目录入值累计）" />
        <StatCard label="结果待回填" value={`${stats.pendingCount}`} hint="在项目详情录入中标/落标与金额" />
        <StatCard
          label="落标原因 Top3"
          value={stats.topReasons.length ? `${stats.topReasons[0][1]} 条` : "—"}
          hint={stats.topReasons.length ? stats.topReasons.map(([r, n]) => `${r}（${n}）`).join("；") : "暂无落标记录或未填原因"}
        />
      </div>
    </div>
  )
}
