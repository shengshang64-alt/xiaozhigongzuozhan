import { useNavigate } from "react-router-dom"
import { Building2, CalendarCheck, Loader2, Target } from "lucide-react"
import { STAGE_LABEL, fmtDate, type OppStage } from "@/pages/CustomerManagement/customerTypes"

// 类型导出被 useHome 引用，字段与命名保持稳定，不可删改
export type CrmOppBrief = {
  id: string
  opp_name: string
  customer_name: string
  stage: string
  updated: string
}

export type CrmStats = {
  customerCount: number
  activeOppCount: number
  monthFollowCount: number
  // D1：聚合拉取满 200 条（hook 上限）时置 true，数字显示「N+」提示可能截断
  customerCountCapped?: boolean
  activeOppCountCapped?: boolean
  monthFollowCountCapped?: boolean
}

type OppsCardProps = {
  stats: CrmStats
  recentOpps: CrmOppBrief[]
  loading: boolean
}

export function OppsCard({ stats, recentOpps, loading }: OppsCardProps) {
  const navigate = useNavigate()
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">最近商机动态</h2>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          最近 3 条
        </span>
      </header>

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-secondary-foreground">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          客户 {stats.customerCount}
          {stats.customerCountCapped ? "+" : ""}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-secondary-foreground">
          <Target className="h-3.5 w-3.5 text-primary" />
          在跟商机 {stats.activeOppCount}
          {stats.activeOppCountCapped ? "+" : ""}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-secondary-foreground">
          <CalendarCheck className="h-3.5 w-3.5 text-primary" />
          本月跟进 {stats.monthFollowCount}
          {stats.monthFollowCountCapped ? "+" : ""}
        </span>
        <button
          type="button"
          onClick={() => navigate("/customer-management")}
          className="ml-auto rounded-md border border-primary/40 px-2.5 py-1 font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          进入客户管理
        </button>
      </div>

      <div className="mt-3 flex-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            商机动态加载中…
          </div>
        ) : recentOpps.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              还没有商机动态
            </p>
            <p className="text-xs text-muted-foreground">
              去客户管理建第一条商机，动态会汇总到这里
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentOpps.map((opp) => (
              <li key={opp.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/customer-management?opp=${opp.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{opp.opp_name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {opp.customer_name || "未知客户"} · 更新于 {fmtDate(opp.updated)}
                    </p>
                  </div>
                  <span
                    className={
                      opp.stage === "won"
                        ? "badge-success shrink-0"
                        : opp.stage === "lost"
                          ? "badge-danger shrink-0"
                          : "badge-neutral shrink-0"
                    }
                  >
                    {STAGE_LABEL[(opp.stage || "lead") as OppStage] ?? opp.stage}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
