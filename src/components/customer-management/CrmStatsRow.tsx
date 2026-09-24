import { Building2, CalendarCheck, Target } from "lucide-react"

type CrmStatsRowProps = {
  customerCount: number
  activeOppCount: number
  monthFollowCount: number
  /** 本轮（B-03）：客户首屏拉满、总数未知时数字加「+」后缀，避免把已加载条数读成精确总数 */
  customerCountCapped?: boolean
  /** A3：商机首屏拉满 200 条时数字加「+」后缀，提示实际可能更多 */
  activeOppCountCapped?: boolean
  /** A3：跟进首屏拉满 200 条时数字加「+」后缀 */
  monthFollowCountCapped?: boolean
}

function CrmStatItem({
  icon,
  value,
  label,
  capped = false,
}: {
  icon: React.ReactNode
  value: number
  label: string
  capped?: boolean
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-md transition-shadow hover:shadow-lg lg:p-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p
          className="text-2xl font-bold leading-none tabular-nums text-foreground"
          title={capped ? "基于当前已加载的数据统计，实际数量可能更多" : undefined}
        >
          {value}
          {capped ? <span className="text-base font-semibold text-muted-foreground">+</span> : null}
        </p>
        <p className="mt-1.5 truncate text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

export function CrmStatsRow({
  customerCount,
  activeOppCount,
  monthFollowCount,
  customerCountCapped,
  activeOppCountCapped,
  monthFollowCountCapped,
}: CrmStatsRowProps) {
  return (
    <section className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <CrmStatItem
        icon={<Building2 className="h-5 w-5" />}
        value={customerCount}
        label="客户总数"
        capped={customerCountCapped}
      />
      <CrmStatItem
        icon={<Target className="h-5 w-5" />}
        value={activeOppCount}
        label="在跟商机"
        capped={activeOppCountCapped}
      />
      <CrmStatItem
        icon={<CalendarCheck className="h-5 w-5" />}
        value={monthFollowCount}
        label="本月新增跟进"
        capped={monthFollowCountCapped}
      />
    </section>
  )
}
