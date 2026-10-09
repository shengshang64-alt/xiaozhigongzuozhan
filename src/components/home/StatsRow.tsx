import { FolderKanban, ListTodo, TrendingUp } from "lucide-react"
import { formatActiveWorkBreakdown, type ActiveWorkKind } from "@/pages/Home/activeWork"

type StatsRowProps = {
  activeWorkCount: number
  activeWorkByKind: Record<ActiveWorkKind, number>
  pendingTodoCount: number
  doneTodoCount: number
  overdueTodoCount: number
}

function StatItem({
  icon,
  value,
  label,
  valueDanger,
  valueSuffix,
  valueTitle,
}: {
  icon: React.ReactNode
  label: string
  value: number
  valueDanger?: boolean
  valueSuffix?: string
  /** 循环 9 B3：截断「+」后缀的悬停说明，与 TodoCard 提示行同口径句式 */
  valueTitle?: string
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-md transition-shadow hover:shadow-lg lg:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p
          title={valueTitle}
          className={`text-2xl font-bold leading-none tabular-nums ${
            valueDanger ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
          {valueSuffix ?? ""}
        </p>
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

export function StatsRow({ activeWorkCount, activeWorkByKind, pendingTodoCount, doneTodoCount, overdueTodoCount }: StatsRowProps) {
  return (
    <section className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <StatItem
        icon={<FolderKanban className="h-5 w-5" />}
        value={activeWorkCount}
        label="工作台进行中事项"
        valueTitle={activeWorkCount > 0 ? formatActiveWorkBreakdown(activeWorkByKind) : undefined}
      />
      <StatItem
        icon={<ListTodo className="h-5 w-5" />}
        value={pendingTodoCount}
        label={overdueTodoCount > 0 ? `未完成待办 · 逾期 ${overdueTodoCount}` : "未完成待办"}
        valueDanger={overdueTodoCount > 0}
      />
      <StatItem icon={<TrendingUp className="h-5 w-5" />} value={doneTodoCount} label="已完成待办" />
    </section>
  )
}
