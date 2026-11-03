import { CalendarDays, Radar, Search } from "lucide-react"
import { useNavigate } from "react-router-dom"

type WelcomeBannerProps = {
  dateLabel: string
  greeting: string
  displayName: string | null
  /** R76/F-驾驶舱：行动摘要（真实计数），空数组时退回静态文案 */
  summaryLines: string[]
}

export function WelcomeBanner({ dateLabel, greeting, displayName, summaryLines }: WelcomeBannerProps) {
  const navigate = useNavigate()
  const hasActions = summaryLines.length > 0
  return (
    <section className="relative mb-5 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/10 via-secondary to-card shadow-md">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
      <header className="relative animate-in fade-in slide-in-from-bottom-4 px-6 py-8 duration-500 lg:px-8">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <CalendarDays className="h-3.5 w-3.5 text-primary" />
          {dateLabel}
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
          {greeting}
          {displayName ? `，${displayName}` : ""}，欢迎回到
          <span className="text-primary">售前工作台</span>
        </h1>
        {/* R76/F-驾驶舱：把「今天该干什么」放进口号的下一行——真实计数 + 一键入口 */}
        {hasActions ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-foreground">
            {summaryLines.map((line) => (
              <span key={line} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {line}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            今日待办、项目进度与行业情报一屏掌握，各功能模块已全部就绪，陪你跑赢每一个售前项目。
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/intel-center")}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Radar className="h-3.5 w-3.5" />
            处理情报
          </button>
          <button
            type="button"
            onClick={() => navigate("/bid-workspace")}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Search className="h-3.5 w-3.5" />
            继续标书
          </button>
        </div>
      </header>
    </section>
  )
}
