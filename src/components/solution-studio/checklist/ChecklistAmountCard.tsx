import { Button } from "@/components/ui/button"
import {
  AMOUNT_BUCKET_LABEL,
  AMOUNT_BUCKET_ORDER,
  type AmountBreakdown,
} from "@/pages/SolutionStudio/checklistSummary"
import { formatAmountWan } from "@/pages/SolutionStudio/checklistTypes"

export function ChecklistAmountCard({
  breakdown,
  checkedCount,
  generating,
  onGenerateOutline,
}: {
  breakdown: AmountBreakdown
  checkedCount: number
  generating?: boolean
  onGenerateOutline: () => void
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-[13.5px] font-semibold text-foreground">金额汇总</h3>
        <span className="text-xs text-muted-foreground">含税</span>
      </div>
      <div className="space-y-2 px-4 py-3">
        {AMOUNT_BUCKET_ORDER.map((key) => (
          <div key={key} className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">{AMOUNT_BUCKET_LABEL[key]}</span>
            <span className="font-mono tabular-nums text-foreground">{formatAmountWan(breakdown[key])}</span>
          </div>
        ))}
        <div className="border-t border-border pt-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">合计</span>
            <span className="font-mono text-[19px] font-semibold tabular-nums text-foreground">
              {formatAmountWan(breakdown.total)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-border px-4 py-3">
        <Button
          size="sm"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={generating || checkedCount < 1}
          onClick={onGenerateOutline}
        >
          生成大纲
        </Button>
        <span className="text-[11px] text-muted-foreground">
          按勾选的 {checkedCount} 项生成大纲，未勾选项不写进正文
        </span>
      </div>
    </section>
  )
}
