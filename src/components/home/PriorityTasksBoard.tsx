import { useNavigate } from "react-router-dom"
import { AlertOctagon, ArrowRight, CheckCircle2, Target, type LucideIcon } from "lucide-react"
import type { PriorityTask } from "@/pages/Home/homeLayout"

// Phase 1 改版：「当天最重要的 3 件事」——数据来自 mustSee（逾期 → 今日到期 → 进行中），
// 排序与截断在 homeLayout.priorityTasksOf，本组件不二次排序。
// 逾期 / 今日到期 / 进行中三档用色与今日必看条一致，保证同一语义全站同色。

const GROUP_TONE: Record<
  PriorityTask["group"],
  { label: string; Icon: LucideIcon; bar: string; title: string; chip: string; button: string; action: string }
> = {
  overdue: {
    label: "已逾期",
    Icon: AlertOctagon,
    bar: "bg-destructive",
    title: "text-destructive",
    chip: "bg-destructive/10 text-destructive",
    button: "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
    action: "去处理",
  },
  dueToday: {
    label: "今日到期",
    Icon: Target,
    bar: "bg-warning",
    title: "text-foreground",
    chip: "bg-warning/10 text-warning",
    button: "bg-warning text-warning-foreground hover:bg-warning/90 focus-visible:ring-warning",
    action: "今日完成",
  },
  active: {
    label: "进行中",
    Icon: ArrowRight,
    bar: "bg-primary",
    title: "text-foreground",
    chip: "bg-primary/10 text-primary",
    button: "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary",
    action: "继续推进",
  },
}

type PriorityTasksBoardProps = {
  tasks: PriorityTask[]
  /** mustSee.total：含未进前 3 的剩余项，用于「共 N 项」与溢出提示 */
  total: number
  loading?: boolean
  onOpenProject: (task: PriorityTask) => void
}

export function PriorityTasksBoard({ tasks, total, loading = false, onOpenProject }: PriorityTasksBoardProps) {
  const navigate = useNavigate()
  const overflow = Math.max(0, total - tasks.length)
  return (
    <section className="mb-4 rounded-xl border border-border bg-card shadow-md">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Target className="h-4 w-4" />
        </div>
        <h2 className="text-base font-semibold text-foreground">今日优先任务</h2>
        {total > 0 ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            共 {total} 项
          </span>
        ) : null}
        {overflow > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground">
            另有 {overflow} 项见下方「今日必看」
          </span>
        ) : null}
      </header>

      <div className="p-4">
        {loading ? (
          <div className="flex flex-col gap-3" role="status">
            <span className="sr-only">正在汇总今日行动项…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden="true" className="h-[86px] animate-pulse rounded-lg bg-muted/70" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-foreground">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            今天没有逾期或到期事项，专注推进就好
          </div>
        ) : (
          <ol className="grid gap-3 lg:grid-cols-3">
            {tasks.map((task, index) => {
              const tone = GROUP_TONE[task.group]
              const open = () => {
                if (task.project) {
                  onOpenProject(task)
                  return
                }
                if (task.route) navigate(task.route)
              }
              return (
                <li
                  key={task.id}
                  className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-background p-4 transition-shadow hover:shadow-md"
                >
                  <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} aria-hidden="true" />
                  <div className="mb-1.5 flex items-center gap-2 pl-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}>
                      {tone.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">第 {index + 1} 优先</span>
                  </div>
                  <h3 className="mb-1 line-clamp-2 pl-2 text-sm font-semibold leading-snug text-foreground" title={task.title}>
                    {task.title}
                  </h3>
                  <p className="mb-3 truncate pl-2 text-xs text-muted-foreground" title={`${task.meta} · ${task.detail}`}>
                    {task.meta} · {task.detail}
                  </p>
                  {task.progress !== null ? (
                    <div className="mb-3 pl-2">
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>进度</span>
                        <span className="tabular-nums">{task.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" data-testid="progress-track">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-auto pl-2">
                    <button
                      type="button"
                      onClick={open}
                      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${tone.button}`}
                    >
                      {tone.action}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
