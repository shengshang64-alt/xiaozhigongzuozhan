import { BadgeCheck, Copy, Download, Loader2, Plus, ReceiptText, Search, Trash2 } from "lucide-react"
import { CompanyTemplateHint } from "@/components/common/CompanyTemplateHint"
import { formatMoney, quoteTotal, type QuoteRecord } from "@/pages/PptQuote/pptQuoteTypes"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"
import { formatShortDateTime } from "@/lib/dateDisplay"

type QuoteListPanelProps = {
  quotes: QuoteRecord[]
  listLoading: boolean
  search: string
  setSearch: (value: string) => void
  onNew: () => void
  onOpen: (quote: QuoteRecord) => void
  onCopy: (quote: QuoteRecord) => void
  onDelete: (quote: QuoteRecord) => void
  /** R79 quote-history-2 第一步：标记/取消「成交参考样本」（PATCH 沉淀字段，由调用方落库） */
  onToggleWonSample: (quote: QuoteRecord) => void
}

export function QuoteListPanel({
  quotes,
  listLoading,
  search,
  setSearch,
  onNew,
  onOpen,
  onCopy,
  onDelete,
  onToggleWonSample,
}: QuoteListPanelProps) {
  const handleExportQuotes = () => {
    const headers = ["报价名称", "关联项目", "医院等级", "版本", "创建时间", "更新时间"]
    const rows = quotes.map((q) => [q.quote_name, q.ref_name || q.opportunity_name, q.hospital_level ?? "", q.version, q.created, q.updated])
    exportToCsv(`报价列表_${localDateStamp()}.csv`, headers, rows)
  }

  return (
    <section className="pb-16">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-8 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-primary">报价清单</p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
              医疗项目<span className="text-primary">报价管理</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              行项报价自动算小计，按产品库分类或自定义分组汇总；可关联方案或标书项目让 AI 推荐行项初稿，支持多版本谈判与 Excel / Word 导出。
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportQuotes}
            disabled={quotes.length === 0}
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Download className="h-4 w-4" />
            导出
          </button>
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            新建报价
          </button>
        </div>
        {/* R-203：对外报价单的公司标准表式（范本开标一览表/分项报价表），点击即下载 */}
        <CompanyTemplateHint scenario="quote" />
      </header>

      <div className="mt-5 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索报价名称或关联项目"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <span className="text-xs text-muted-foreground">共 {quotes.length} 套</span>
      </div>

      {listLoading ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在加载…
        </p>
      ) : quotes.length === 0 && search.trim() ? (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <Search className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">没有匹配的结果</p>
          <p className="max-w-sm text-xs text-muted-foreground">换个关键词试试，或清除搜索浏览全部报价</p>
          <button
            type="button"
            onClick={() => setSearch("")}
            className="rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            清除筛选
          </button>
        </div>
      ) : quotes.length === 0 ? (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <ReceiptText className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">还没有报价方案</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            点击「新建报价」手动录入行项，或关联方案 / 标书项目让 AI 按建设内容推荐报价初稿。
            <br />
            报价清单支持多版本谈判（初稿 / 复核 / 终稿），可一键导出 Excel 谈判表与 Word 报价书。
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {quotes.map((quote) => {
            const total = quoteTotal(quote.groups ?? [])
            const itemCount = (quote.groups ?? []).reduce((n, g) => n + (g.items?.length ?? 0), 0)
            return (
              <article
                key={quote.id}
                className="group flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg lg:p-5"
              >
                <button type="button" onClick={() => onOpen(quote)} className="rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-base font-semibold text-foreground group-hover:text-primary">{quote.quote_name}</h3>
                    <span className="badge-neutral shrink-0">
                      {quote.version || "v1"}
                    </span>
                    {quote.won_sample ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-semibold text-[#17704f]" title="已标记为成交参考样本，可作报价历史区间依据">
                        <BadgeCheck className="h-3 w-3" />
                        成交样本
                      </span>
                    ) : null}
                  </div>
                </button>
                <p className="mt-2 text-2xl font-bold tabular-nums text-primary">
                  ¥ {formatMoney(total)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{itemCount} 条行项</span>
                  {quote.ref_name && <span className="truncate">关联：{quote.ref_name}</span>}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  <span className="text-xs text-muted-foreground">更新于 {formatShortDateTime(quote.updated)}</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpen(quote)}
                      className="rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      打开编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleWonSample(quote)}
                      aria-label={quote.won_sample ? "取消成交参考样本" : "标记为成交参考样本"}
                      title={quote.won_sample ? "取消成交参考样本" : "标记为成交参考样本（沉淀报价历史）"}
                      className={
                        "rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                        (quote.won_sample
                          ? "text-[#17704f] hover:bg-success-bg"
                          : "text-muted-foreground hover:bg-primary/10 hover:text-primary")
                      }
                    >
                      <BadgeCheck className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopy(quote)}
                      aria-label="复制为新版本"
                      title="复制为新版本"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(quote)}
                      aria-label="删除"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
