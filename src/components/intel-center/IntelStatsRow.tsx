import { Rss, Database, Star, Layers } from "lucide-react"

/** 统计卡（对齐原型 stat-card：标签 + 大数字 + 说明行） */
function StatCard({
  icon,
  label,
  value,
  hint,
  hintClass,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  hint: string
  hintClass?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-md lg:p-5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 text-3xl font-bold tabular-nums text-foreground">{value}</p>
      <p className={`mt-1 text-xs ${hintClass ?? "text-muted-foreground"}`}>{hint}</p>
    </div>
  )
}

type IntelStatsRowProps = {
  enabledCount: number
  sourceCount: number
  errorCount: number
  totalItems: number
  starredCount: number
  builtinCount: number
  customCount: number
}

/** 情报中心 landing 统计行：全部取页面已有真实数据，不新增请求 */
export function IntelStatsRow({
  enabledCount,
  sourceCount,
  errorCount,
  totalItems,
  starredCount,
  builtinCount,
  customCount,
}: IntelStatsRowProps) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        icon={<Rss className="h-3.5 w-3.5" />}
        label="启用信息源"
        value={`${enabledCount}/${sourceCount}`}
        hint={errorCount > 0 ? `${errorCount} 个源抓取失败` : "全部源运行正常"}
        hintClass={errorCount > 0 ? "text-destructive" : undefined}
      />
      <StatCard
        icon={<Database className="h-3.5 w-3.5" />}
        label="情报总数"
        value={totalItems}
        hint="当前筛选口径"
      />
      <StatCard
        icon={<Layers className="h-3.5 w-3.5" />}
        label="信息源构成"
        value={sourceCount}
        hint={`内置 ${builtinCount} 个 · 自定义 ${customCount} 个`}
      />
      <StatCard
        icon={<Star className="h-3.5 w-3.5" />}
        label="我的收藏"
        value={starredCount}
        hint="确认/收藏每人独立状态"
      />
    </div>
  )
}
