import { Database, Inbox, Rss, Star } from "lucide-react"

// UX-R2: 情报中心 已按 docs/ux-review-2026-11 修复 2026-11-07
// （指标卡语义化：去掉「x/y」「构成」这类并列纯数字，每张卡一句话语义 + 可点击行动；
//   「待我确认」计数来自 per_page=1 轻量探针，确认/忽略/批量操作后自动刷新）

type IntelStatsRowProps = {
  enabledCount: number
  sourceCount: number
  errorCount: number
  /** 当前筛选口径的服务端总数（浏览模式的量级） */
  totalItems: number
  /** 待我确认（per_page=1 探针的真实总数） */
  pendingTotal: number
  starredCount: number
  onOpenTodo: () => void
  onOpenBrowse: () => void
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
  pressed,
  tone = "neutral",
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  unit?: string
  hint: string
  hintClass?: string
  onClick?: () => void
  pressed?: boolean
  tone?: "neutral" | "danger" | "primary"
}) {
  const toneValue = tone === "danger" ? "text-destructive" : tone === "primary" ? "text-primary" : "text-foreground"
  const base =
    "rounded-xl border bg-card p-4 text-left shadow-md transition-shadow lg:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  const interactive = onClick
    ? " hover:shadow-lg cursor-pointer focus-visible:ring-2"
    : " cursor-default"
  const wrap = `${base} ${interactive} ${pressed ? "border-primary/60 ring-1 ring-primary/40" : "border-border"}`
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
    <button type="button" onClick={onClick} aria-pressed={pressed} title={hint} className={wrap}>
      {body}
    </button>
  ) : (
    <div className={wrap}>{body}</div>
  )
}

export function IntelStatsRow({
  enabledCount,
  sourceCount,
  errorCount,
  totalItems,
  pendingTotal,
  starredCount,
  onOpenTodo,
  onOpenBrowse,
  onOpenSources,
}: IntelStatsRowProps) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        icon={<Inbox className="h-3.5 w-3.5" />}
        label="待我确认"
        value={pendingTotal}
        unit="条"
        hint={pendingTotal > 0 ? "点击进入待办模式，逐条处理" : "没有待确认的情报，轻松"}
        hintClass={pendingTotal > 0 ? "text-primary" : undefined}
        tone={pendingTotal > 0 ? "primary" : "neutral"}
        onClick={onOpenTodo}
        pressed
      />
      <StatCard
        icon={<Database className="h-3.5 w-3.5" />}
        label="当前筛选结果"
        value={totalItems}
        unit="条"
        hint="点击进入浏览模式查看全部"
        onClick={onOpenBrowse}
      />
      <StatCard
        icon={<Rss className="h-3.5 w-3.5" />}
        label="信息源"
        value={`${enabledCount}/${sourceCount}`}
        hint={errorCount > 0 ? `${errorCount} 个源抓取失败，点击去处理` : "全部源运行正常，点击管理"}
        hintClass={errorCount > 0 ? "text-destructive" : undefined}
        tone={errorCount > 0 ? "danger" : "neutral"}
        onClick={onOpenSources}
      />
      <StatCard
        icon={<Star className="h-3.5 w-3.5" />}
        label="我的收藏"
        value={starredCount}
        unit="条"
        hint="确认/收藏每人独立状态"
      />
    </div>
  )
}
