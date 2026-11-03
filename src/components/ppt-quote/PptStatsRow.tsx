import { Presentation, ReceiptText, Coins } from "lucide-react"

/** 统计卡（对齐原型 stat-card：标签 + 大数字 + 说明行） */
function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  hint: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-md lg:p-5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 text-3xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

type PptStatsRowProps = {
  deckCount: number
  deckDone: number
  quoteCount: number
  quoteTotalAmount: string
}

/** PPT 与报价 landing 统计行：真实数据口径（全量列表汇总） */
export function PptStatsRow({ deckCount, deckDone, quoteCount, quoteTotalAmount }: PptStatsRowProps) {
  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        icon={<Presentation className="h-3.5 w-3.5" />}
        label="汇报 PPT"
        value={deckCount}
        hint={`已完成 ${deckDone} 份 · 通用 / 规划 / 专题`}
      />
      <StatCard
        icon={<ReceiptText className="h-3.5 w-3.5" />}
        label="报价清单"
        value={quoteCount}
        hint="支持多版本谈判与 Excel / Word 导出"
      />
      <StatCard
        icon={<Coins className="h-3.5 w-3.5" />}
        label="报价总金额"
        value={quoteCount > 0 ? `¥ ${quoteTotalAmount}` : "0.00"}
        hint={`全部 ${quoteCount} 套清单行项合计`}
      />
    </div>
  )
}
