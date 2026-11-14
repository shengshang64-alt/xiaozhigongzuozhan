import { CalendarClock, Inbox, Rss } from "lucide-react"

type IntelStatsRowProps = {
  pendingRecentTotal: number
  pendingTotal: number
  deadlineBidCount: number
  deadlineKnown: boolean
  enabledCount: number
  sourceCount: number
  enabledErrorCount: number
  silentEmptyCount: number
  onOpenTodo: () => void
  onOpenDeadlines: () => void
  onOpenSources: () => void
}

function StatCard({
  icon,
  label,
  value,
  unit,
  hint,
  hintClass,
  onClick,
  tone = "neutral",
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  unit?: string
  hint: string
  hintClass?: string
  onClick?: () => void
  tone?: "neutral" | "danger" | "primary"
}) {
  const toneValue = tone === "danger" ? "text-destructive" : tone === "primary" ? "text-primary" : "text-foreground"
  const base =
    "rounded-xl border bg-card p-4 text-left shadow-md transition-shadow lg:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  const interactive = onClick ? " hover:shadow-lg cursor-pointer focus-visible:ring-2" : " cursor-default"
  const wrap = `${base} ${interactive} border-border`
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className={`mt-1.5 text-3xl font-bold tabular-nums ${toneValue}`}>
        {value}
        {unit ? <span className="ml-1 text-sm font-medium">{unit}</span> : null}
      </p>
      <p className={`mt-1 text-xs ${hintClass ?? "text-muted-foreground"}`}>{hint}</p>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} title={hint} className={wrap}>
      {body}
    </button>
  ) : (
    <div className={wrap}>{body}</div>
  )
}

export function IntelStatsRow({
  pendingRecentTotal,
  pendingTotal,
  deadlineBidCount,
  deadlineKnown,
  enabledCount,
  sourceCount,
  enabledErrorCount,
  silentEmptyCount,
  onOpenTodo,
  onOpenDeadlines,
  onOpenSources,
}: IntelStatsRowProps) {
  const backlog = Math.max(0, pendingTotal - pendingRecentTotal)
  const sourceHint = enabledErrorCount > 0
    ? `启用中 ${enabledErrorCount} 个源抓取失败${silentEmptyCount > 0 ? `；另有静默空源 ${silentEmptyCount} 个` : ""}`
    : silentEmptyCount > 0
      ? `启用源运行中，另有静默空源 ${silentEmptyCount} 个`
      : "启用中的源运行正常，点击管理"
  const deadlineHint = deadlineKnown
    ? "点击查看近 7 天截止的招标（仅统计已抽到截止日的条目）"
    : "尚未抽到截止日，数是 0 不是漏算；可在更多操作里用「修复数据」补齐"

  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        icon={<Inbox className="h-3.5 w-3.5" />}
        label="近 7 天新增待看"
        value={pendingRecentTotal}
        unit="条"
        hint={backlog > 0 ? `历史待确认积压 ${pendingTotal} 条` : pendingRecentTotal > 0 ? "点击查看待确认" : "近 7 天没有新的待确认"}
        hintClass={backlog > 0 || pendingRecentTotal > 0 ? "text-primary" : undefined}
        tone={pendingRecentTotal > 0 ? "primary" : "neutral"}
        onClick={onOpenTodo}
      />
      <StatCard
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        label="7 天内截止招标"
        value={deadlineBidCount}
        unit="条"
        hint={deadlineHint}
        onClick={onOpenDeadlines}
      />
      <StatCard
        icon={<Rss className="h-3.5 w-3.5" />}
        label="信息源"
        value={`${enabledCount}/${sourceCount}`}
        hint={sourceHint}
        hintClass={enabledErrorCount > 0 ? "text-destructive" : undefined}
        tone={enabledErrorCount > 0 ? "danger" : "neutral"}
        onClick={onOpenSources}
      />
    </div>
  )
}
