import { CalendarDays } from "lucide-react"

// Phase 1 改版：替代原 WelcomeBanner 的轻量欢迎条。
// 原横幅是大渐变卡（约 200px 高 + 两个入口按钮），改版后入口统一收进 QuickActionButtons，
// 这里只保留「问候 + 日期 + 今日行动摘要」一行半，为 1200px 首屏高度预算让路。
// 原组件文件保留不删（零破坏性重构），历史引用可随时回滚。

type CompactWelcomeBarProps = {
  dateLabel: string
  greeting: string
  displayName: string | null
  /** 今日行动摘要（真实计数，如「3 条待办已逾期」），空数组时退回静态文案 */
  summaryLines: string[]
}

export function CompactWelcomeBar({ dateLabel, greeting, displayName, summaryLines }: CompactWelcomeBarProps) {
  return (
    <section className="mb-4 rounded-xl border border-border bg-card px-5 py-4 shadow-md">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {greeting}
          {displayName ? `，${displayName}` : ""}
        </h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {dateLabel}
        </span>
      </div>
      {summaryLines.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {summaryLines.map((line) => (
            <span key={line} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              {line}
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">今日待办、项目进度与行业情报一屏掌握</p>
      )}
    </section>
  )
}
