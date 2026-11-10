import { Download, FileText, Landmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  formatMoney,
  groupSubtotal,
  itemSubtotal,
  normalizeDiscount,
  quoteTotal,
  quoteTotalUpper,
  type QuoteRecord,
} from "@/pages/PptQuote/pptQuoteTypes"

// ---------------------------------------------------------------------------
// 报价单预览 · 只读屏（UX-v2：prototype/ppt/quote-preview.html）。
// 整单按分组只读渲染（名称 / 规格 / 数量 / 单价 / 折扣 / 小计），底部合计与
// 人民币大写取自既有纯函数（quoteTotal / quoteTotalUpper，与编辑器同一口径），
// 导出 Excel / Word 接既有真实导出。
// 能力边界（不造假）：原型该屏的「用印信息 / 发送记录」现网没有用印与发送能力，
// 按总控铁律不渲染假记录，直接不出现这两个区块。
// ---------------------------------------------------------------------------

type QuotePreviewScreenProps = {
  quote: QuoteRecord
  onExportXlsx: () => void
  onExportWord: () => void
}

export function QuotePreviewScreen({ quote, onExportXlsx, onExportWord }: QuotePreviewScreenProps) {
  const groups = quote.groups ?? []
  const total = quoteTotal(groups)
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-10">
      {/* 单头：编号 / 版本 / 关联 / 税说明（全为档案真值） */}
      <section className="rounded-lg border border-border bg-card px-5 py-4 shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{quote.quote_name}</h2>
          {quote.version ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{quote.version}</span> : null}
          {quote.won_sample ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">结单样本</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {quote.ref_name ? <span>关联 <b className="text-card-foreground">{quote.ref_name}</b></span> : null}
          {quote.opportunity_name ? <span>商机 <b className="text-card-foreground">{quote.opportunity_name}</b></span> : null}
          {quote.tax_note ? <span>税说明 <b className="text-card-foreground">{quote.tax_note}</b></span> : null}
        </div>
      </section>

      {/* 分组只读表 */}
      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-xs text-muted-foreground shadow-md">
          这份报价单还没有分组条目——回「报价编辑」添加后再来预览。
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
            <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold text-card-foreground">{g.name}</h3>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                小计 ¥ {formatMoney(groupSubtotal(g))}
              </span>
            </header>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">条目</th>
                  <th className="px-2 py-2 font-medium">规格</th>
                  <th className="w-16 px-2 py-2 text-right font-medium">数量</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">单价</th>
                  <th className="w-16 px-2 py-2 text-right font-medium">折扣</th>
                  <th className="w-28 px-4 py-2 text-right font-medium">小计</th>
                </tr>
              </thead>
              <tbody>
                {g.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-xs text-muted-foreground">
                      本组暂无条目
                    </td>
                  </tr>
                ) : (
                  g.items.map((it) => (
                    <tr key={it.id} className="border-b border-border/40 last:border-b-0">
                      <td className="px-4 py-2 text-card-foreground">{it.item_name}</td>
                      <td className="max-w-40 truncate px-2 py-2 text-xs text-muted-foreground" title={it.spec}>
                        {it.spec || "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-card-foreground">{it.qty}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-card-foreground">¥ {formatMoney(it.price)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {normalizeDiscount(it.discount) === 100 ? "—" : `${normalizeDiscount(it.discount)}%`}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-card-foreground">¥ {formatMoney(itemSubtotal(it))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ))
      )}

      {/* 合计 + 大写（真实计算，与编辑器同一套纯函数） */}
      {groups.length > 0 && (
        <section className="rounded-lg border border-primary/30 bg-primary/5 px-5 py-4 shadow-md">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-foreground">报价总额</span>
            <span className="text-2xl font-bold tabular-nums text-primary">¥ {formatMoney(total)}</span>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Landmark className="h-3.5 w-3.5 text-primary" />
              大写 <b className="text-card-foreground">{quoteTotalUpper(groups)}</b>
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            金额单位为人民币元；折扣按条目归一后的百分比计价（与报价编辑器同一套计算函数）。
          </p>
        </section>
      )}

      {/* 导出格式（真实力） */}
      <section className="rounded-lg border border-border bg-card px-5 py-4 shadow-md">
        <header className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="text-sm font-semibold text-card-foreground">导出格式</h3>
        </header>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={onExportXlsx} className="border-border text-card-foreground hover:bg-secondary">
            <Download className="mr-1.5 h-4 w-4" />
            导出 Excel
          </Button>
          <Button variant="outline" onClick={onExportWord} className="border-border text-card-foreground hover:bg-secondary">
            <Download className="mr-1.5 h-4 w-4" />
            导出 Word
          </Button>
        </div>
        <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          本屏为只读预览；改价、折扣与分组请回「报价编辑」。
          用印与发送记录属线下流程，现网未提供登记能力，故不在此展示。
        </p>
      </section>
    </div>
  )
}
