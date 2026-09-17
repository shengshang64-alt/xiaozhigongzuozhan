import { CalendarClock } from "lucide-react"
import { useNavigate } from "react-router-dom"
import type { FollowDueOpp } from "@/pages/Home/useHome"

type FollowUpReminderCardProps = {
  items: FollowDueOpp[]
  loading: boolean
}

/** 循环 9 B1：首页「待跟进商机」提醒卡——今日到期 + 已逾期两组，点击跳 CRM 商机深链 */
export function FollowUpReminderCard({ items, loading }: FollowUpReminderCardProps) {
  const navigate = useNavigate()
  const overdue = items.filter((i) => i.overdue)
  const dueToday = items.filter((i) => !i.overdue)
  return (
    <section className="mb-5 rounded-lg border border-border bg-card shadow-md animate-in fade-in duration-500">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-primary" />
          待跟进商机
        </h2>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">已逾期 {overdue.length}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">今日到期 {dueToday.length}</span>
        </div>
      </header>
      <div className="p-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">跟进提醒加载中…</p>
        ) : items.length === 0 ? (
          <div className="py-2 text-center">
            <p className="text-sm font-medium text-foreground">暂无待跟进商机</p>
            <p className="mt-1 text-xs text-muted-foreground">在商机看板为商机设置「下次跟进时间」，到期与逾期时会在这里提醒你</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {overdue.length > 0 && (
              <div>
                <p className="text-xs font-medium text-destructive">已逾期 · {overdue.length} 个</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {overdue.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/customer-management?opp=${encodeURIComponent(o.id)}`)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-card-foreground">
                          {o.customer_name || "未关联客户"} · {o.opp_name}
                        </span>
                        <span className="shrink-0 text-xs font-medium text-destructive">{o.next_follow_date}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dueToday.length > 0 && (
              <div>
                <p className="text-xs font-medium text-primary">今日到期 · {dueToday.length} 个</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {dueToday.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/customer-management?opp=${encodeURIComponent(o.id)}`)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-card-foreground">
                          {o.customer_name || "未关联客户"} · {o.opp_name}
                        </span>
                        <span className="shrink-0 text-xs font-medium text-primary">{o.next_follow_date}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
