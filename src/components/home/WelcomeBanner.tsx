import { CalendarDays } from "lucide-react"

type WelcomeBannerProps = {
  dateLabel: string
  greeting: string
  displayName: string | null
}

export function WelcomeBanner({ dateLabel, greeting, displayName }: WelcomeBannerProps) {
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
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          今日待办、项目进度与行业情报一屏掌握，各功能模块已全部就绪，陪你跑赢每一个售前项目。
        </p>
      </header>
    </section>
  )
}
