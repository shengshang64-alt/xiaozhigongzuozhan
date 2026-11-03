/** 解析报告三栏摘要面板（对标喜鹊解析首屏）。点击任意卡片 → 回到明细视图并选中该项。 */
import { Card } from "@/components/ui/card"
import type { SummaryColumn } from "@/pages/BidWorkspace/parseSummary"

const STATUS_TONE: Record<string, string> = {
  ok: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  pending: "bg-muted text-muted-foreground",
  miss: "bg-amber-500/10 text-amber-600",
}

export function ParseSummaryBoard({
  columns,
  onOpen,
}: {
  columns: SummaryColumn[]
  /** 点卡片：进明细视图并选中该解析项 */
  onOpen: (key: string) => void
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      {columns.map((col) => (
        <section key={col.id} className="flex flex-col gap-2">
          <div className="px-1">
            <h3 className="text-sm font-semibold text-foreground">{col.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{col.hint}</p>
          </div>
          {col.cards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              本栏暂无解析项
            </p>
          ) : (
            col.cards.map((card) => (
              <Card
                key={card.key}
                className="cursor-pointer border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/40 hover:bg-secondary/40"
                onClick={() => onOpen(card.key)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{card.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[card.status] ?? STATUS_TONE.pending}`}>
                    {card.statusLabel}
                  </span>
                </div>
                {card.meta && <p className="mt-1 text-[11px] text-muted-foreground">{card.meta}</p>}
                {card.fields.length > 0 ? (
                  <dl className="mt-2 flex flex-col gap-1">
                    {card.fields.slice(0, 6).map((f, i) => (
                      <div key={`${f.label}-${i}`} className="flex gap-2 text-xs leading-relaxed">
                        <dt className="w-20 shrink-0 text-muted-foreground">{f.label}</dt>
                        <dd className="min-w-0 flex-1 text-foreground">{f.value}</dd>
                      </div>
                    ))}
                    {card.fields.length > 6 && (
                      <p className="text-[11px] text-muted-foreground">…另有 {card.fields.length - 6} 个字段，点开看全部</p>
                    )}
                  </dl>
                ) : card.lines.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {card.lines.map((l, i) => (
                      <li key={i} className="truncate text-xs leading-relaxed text-foreground" title={l}>
                        {l}
                      </li>
                    ))}
                    {card.count > card.lines.length && (
                      <li className="text-[11px] text-muted-foreground">…共 {card.count} 条，点开看全部</li>
                    )}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">（无内容，点开可单项重解析）</p>
                )}
              </Card>
            ))
          )}
        </section>
      ))}
    </div>
  )
}
