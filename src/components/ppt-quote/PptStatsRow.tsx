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
  /** UX-R2：随 Tab 联动——"deck" 只显示 PPT 指标，"quote" 显示报价金额 / 清单数 */
  view: "deck" | "quote"
  deckCount: number
  deckDone: number
  quoteCount: number
  quoteTotalAmount: string
}

/** PPT 与报价 landing 统计行：真实数据口径（全量列表汇总），随当前 Tab 联动 */
export function PptStatsRow({ view, deckCount, deckDone, quoteCount, quoteTotalAmount }: PptStatsRowProps) {
  if (view === "deck") {
    return (
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          icon={<Presentation className="h-3.5 w-3.5" />}
          label="汇报 PPT"
          value={deckCount}
          hint={`已完成 ${deckDone} 份 · 通用 / 规划 / 专题`}
        />
        <StatCard
          icon={<Coins className="h-3.5 w-3.5" />}
          label="报价总金额"
          value={quoteCount > 0 ? `¥ ${quoteTotalAmount}` : "0.00"}
          hint={`来自报价 Tab 的 ${quoteCount} 套清单行项合计`}
        />
      </div>
    )
  }
  return (
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <StatCard
        icon={<ReceiptText className="h-3.5 w-3.5" />}
        label="报价清单"
        value={quoteCount}
        hint={`累计金额 ¥ ${quoteTotalAmount} · 支持 Excel / Word 导出`}
      />
      <StatCard
        icon={<Presentation className="h-3.5 w-3.5" />}
        label="汇报 PPT"
        value={deckCount}
        hint={`已完成 ${deckDone} 份（切到 PPT Tab 查看）`}
      />
    </div>
  )
}
