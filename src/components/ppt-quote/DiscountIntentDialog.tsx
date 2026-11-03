import { AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { discountAmbiguity } from "@/lib/discountIntent"
import { formatMoney, groupSubtotalAtDiscount, type QuoteItem } from "@/pages/PptQuote/pptQuoteTypes"

// ---------------------------------------------------------------------------
// R40（backlog B8）：折扣写法歧义的二次确认弹窗。
//
// 为什么存在：「折扣(%)」按口径填「按原价的百分之多少计价」（90 = 打 9 折），但手填的人常
// 直接写「折」—— 想打 9 折就填 9，甚至填 0.9。同一个数字两种读法差 10~100 倍，而它直接乘进
// 每一行金额。R285 之后行内录入用 min=1 静默钳位：填 0.9 被悄悄改成 1（整单只剩 1%），用户
// 只看到小计「变小了」，不知道钱错了。
//
// 纪律：不静默钳位、不自动换算 —— 把两种读法各换算成真实金额让用户点，点了才落值；
// 「都不是」一字不改。金额换算复用 groupSubtotalAtDiscount（与界面小计同一分位口径），
// 本组件不自己乘一遍。
// ---------------------------------------------------------------------------

/** 一次待确认的折扣填写：row = 单行；group = 整组批量（一组的钱全会被改） */
export type DiscountAsk = {
  scope: "row" | "group"
  groupId: string
  itemId?: string
  /** 行项名或分组名，让用户知道在确认哪一笔钱 */
  label: string
  /** 用户填的原始数字（未归一、尚未落库） */
  raw: number
  /** 受影响的行：row 为该 1 行，group 为该组全部行（用来把钱算给用户看） */
  items: QuoteItem[]
}

type DiscountIntentDialogProps = {
  ask: DiscountAsk | null
  /** 队列里剩下的待确认笔数（横幅「逐行确认」时提示接着处理下一笔） */
  queued: number
  onPick: (pct: number) => void
  onCancel: () => void
}

const optionCls =
  "w-full rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

export function DiscountIntentDialog({ ask, queued, onPick, onCancel }: DiscountIntentDialogProps) {
  const amb = ask ? discountAmbiguity(ask.raw) : null
  const items = ask?.items ?? []
  const rowsText = ask && ask.scope === "group" ? `本组 ${items.length} 行` : "本行"
  const amountAt = (pct: number) => groupSubtotalAtDiscount(items, pct)
  const originalText = formatMoney(amountAt(100))

  return (
    <Dialog
      open={Boolean(ask && amb)}
      onOpenChange={(v) => {
        if (!v) onCancel()
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            折扣写法有歧义，先确认再落金额
          </DialogTitle>
          <DialogDescription>
            {`「折扣(%)」的口径是按原价的百分之多少计价（90 = 打 9 折）。你填的 ${ask ? String(ask.raw) : ""} 有两种常见读法，相差 ${amb ? String(amb.ratio) : ""} 倍；一旦乘进金额就是悄悄错，这一步不能替你猜。`}
          </DialogDescription>
        </DialogHeader>

        {amb ? (
          <div className="grid gap-3">
            {[amb.percent, amb.habit].map((r, idx) => (
              <button
                key={r.caption}
                type="button"
                onClick={() => onPick(r.pct)}
                className={`${optionCls} ${idx === 1 ? "border-primary/50 bg-primary/5 hover:border-primary" : "border-border bg-card hover:border-primary/60"}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{r.caption}</span>
                  {idx === 1 ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      习惯写「折」的人要的是这个
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {`${rowsText}小计 ¥ ${formatMoney(amountAt(r.pct))}（原价 ¥ ${originalText}）· ${r.meaning}`}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {`确认对象：${ask ? ask.label : ""} · 不选就什么都不改${queued > 0 ? ` · 确认后接着处理剩下的 ${queued} 笔` : ""}`}
        </p>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            都不是，返回改数字
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
