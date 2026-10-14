import { useMemo, useState } from "react"
import { AlertTriangle, ArrowLeft, ChevronDown, FileSpreadsheet, FileText, FolderPlus, History, Import, Library, Plus, Sparkles, Trash2 } from "lucide-react"
import {
  discountAmbiguity,
  formatMoney,
  isCatalogLine,
  itemSubtotal,
  normalizeDiscount,
  quoteTotal,
  quoteTotalUpper,
  scanAmbiguousDiscounts,
  type ProductItem,
  type QuoteItem,
  type QuoteRecord,
} from "@/pages/PptQuote/pptQuoteTypes"
import { targetsLabel } from "@/pages/SolutionStudio/checklistTypes"
import { fmtAmount } from "@/pages/CustomerManagement/customerTypes"
import type { Recommendation } from "@/pages/PptQuote/quoteRecommend"
import { DiscountIntentDialog, type DiscountAsk } from "./DiscountIntentDialog"
import { ProductLibraryPanel } from "./ProductLibraryPanel"
import { toast } from "sonner"

type QuoteEditorProps = {
  quote: QuoteRecord
  totals: { byGroup: Record<string, number>; total: number }
  /** @deprecated 旧常用产品库（ProductItem），UI 已降级为可选面板 */
  productItems?: ProductItem[]
  productLoading?: boolean
  onBack: () => void
  onRename: (value: string) => void
  onTaxNoteChange: (value: string) => void
  onVersionChange: (value: string) => void
  addGroup: () => void
  deleteGroup: (groupId: string) => void
  renameGroup: (groupId: string, value: string) => void
  /** @deprecated 保留兼容；新代码使用 addManualItem */
  addItem?: (groupId: string) => void
  updateItem: (groupId: string, itemId: string, patch: Partial<QuoteItem>) => void
  /** r281-quote-discount-no-entry（R285）：按组批量改折扣%（整包折让） */
  setGroupDiscount: (groupId: string, discount: number) => void
  deleteItem: (groupId: string, itemId: string) => void
  saveItemToLibrary: (item: QuoteItem, groupName: string) => void
  /** @deprecated 旧 ProductPicker 入口 */
  openPicker?: (groupId: string) => void
  /** @deprecated 旧 ProductItem→报价行 API */
  onAddProduct?: (productId: string, groupId: string) => void
  /** @deprecated */
  onRefreshProducts?: () => void
  /** @deprecated */
  onDeleteProduct?: (productId: string) => void
  onAiDraft: () => void
  onExportXlsx: () => void
  onExportWord: () => void
  // 轮次 F 轨 2：报价 ↔ 商机关联（金额同步勾选）
  syncOppAmount: boolean
  onSyncOppAmountChange: (checked: boolean) => void
  /** D6：商机金额同步失败态 */
  oppSyncFailed: boolean
  /** B4：自动保存失败横幅 */
  persistFailed: boolean
  onSaveNow: () => void
  // —— 与系统清单对接的新入口 ——
  openCheckProductPicker: () => void
  openChecklistImport: () => void
  addManualItem: (groupId: string) => void
  // quote-history-01（最小切片）：同一客户（同商机）历史报价参考与一键导入明细
  historyQuotes?: QuoteRecord[]
  onImportHistory?: (source: QuoteRecord) => void
  /** quote-history-01 二期：成交参考区间智能推荐 */
  recommendation?: Recommendation | null
}

const cellInput =
  "h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

const lockedCell =
  "h-8 w-full rounded border border-border/60 bg-muted/40 px-2 text-xs text-muted-foreground"

// A2-8：数字单元格非法输入行内提示（编辑期保留草稿原文，失焦归一到合法值）
function NumCell({
  value,
  min,
  max,
  fallback,
  ariaLabel,
  highlightZero,
  onCommit,
}: {
  value: number
  min: number
  max?: number
  fallback: number
  ariaLabel: string
  /** 单价为 0 时高亮底色（提示"待录入"） */
  highlightZero?: boolean
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [hint, setHint] = useState("")
  const shown = draft ?? String(value)
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n))
  const zeroTint = highlightZero && value <= 0 ? " bg-amber-50/60" : ""
  return (
    <div>
      <input
        type="number"
        min={min}
        max={max}
        aria-label={ariaLabel}
        aria-invalid={Boolean(hint)}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === "") {
            setHint("不能为空")
            return
          }
          const n = Number(raw)
          if (!Number.isFinite(n)) {
            setHint("请输入有效数字")
            return
          }
          if (n < min || (max !== undefined && n > max)) {
            setHint(max === undefined ? `不能小于 ${min}` : `应在 ${min}–${max} 之间`)
            onCommit(clamp(n))
            return
          }
          setHint("")
          onCommit(n)
        }}
        onBlur={() => {
          const raw = draft ?? ""
          const n = Number(raw)
          const next = raw.trim() === "" || !Number.isFinite(n) ? clamp(fallback) : clamp(n)
          onCommit(next)
          setDraft(null)
          setHint("")
        }}
        className={`${cellInput} text-right${zeroTint} ${hint ? "border-destructive focus-visible:ring-destructive" : ""}`}
      />
      {hint && <p className="mt-0.5 text-xs leading-tight text-destructive">{hint}，失焦后自动修正</p>}
    </div>
  )
}

// B8（R40）：折扣单元格。与 NumCell 的分工差别就一条：**不许静默钳位**。
//  - 0 < 值 < 5（可能想写「几折」）：失焦/回车时不写值，交回 DiscountIntentDialog 确认读法；
//  - ≤0 / 空：沿用 R285 口径按原价 100 计并行内说明（旧实现 min=1 会把 0.9 悄悄钳成 1，
//    整行金额只剩原价的 1%，且只在输入瞬间闪一句「应在 1–100 之间」）；
//  - >100：归一到 100 并行内说明（与 normalizeDiscount 同口径）；
//  - 只在 blur/Enter 落值：逐键提交会把「输入 90 途中经过 9」误判成歧义。
export function DiscountCell({
  value,
  ariaLabel,
  onAsk,
  onCommit,
}: {
  value: number
  ariaLabel: string
  onAsk: (raw: number) => void
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [hint, setHint] = useState("")
  const shown = draft ?? String(value)

  const commit = (raw: string) => {
    const t = raw.trim()
    if (t === "") {
      onCommit(100)
      setDraft(null)
      setHint("")
      return
    }
    const n = Number(t)
    if (!Number.isFinite(n)) {
      setDraft(null)
      setHint("不是有效数字，已回到原值")
      return
    }
    if (discountAmbiguity(n)) {
      // 不写值、不钳位：把两种读法换算成钱，交回用户确认
      setDraft(null)
      setHint("")
      onAsk(n)
      return
    }
    const next = normalizeDiscount(n)
    setDraft(null)
    setHint(
      next === n ? "" : n <= 0 ? "不填或 ≤0 按原价 100% 计（不会当成 0 折）" : "超过 100 按原价 100% 计",
    )
    onCommit(next)
  }

  return (
    <div>
      <input
        type="number"
        min={0}
        max={100}
        step="any"
        aria-label={ariaLabel}
        aria-invalid={Boolean(hint)}
        title="按百分比计价：90 = 打 9 折；100 或不填 = 原价。想表达 9 折请填 90，不要填 9 或 0.9"
        value={shown}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          setHint(discountAmbiguity(Number(raw)) ? "这个数可能是「折」，失焦后先让你确认" : "")
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const el = e.target as HTMLInputElement
            commit(el.value)
            el.blur()
          }
        }}
        className={`${cellInput} text-right${hint ? " border-amber-500 focus-visible:ring-amber-500" : ""}`}
      />
      {hint && <p className="mt-0.5 text-xs leading-tight text-amber-600">{hint}</p>}
    </div>
  )
}

export function QuoteEditor({
  quote,
  totals,
  productItems,
  productLoading,
  onBack,
  onRename,
  onTaxNoteChange,
  onVersionChange,
  addGroup,
  deleteGroup,
  renameGroup,
  updateItem,
  setGroupDiscount,
  deleteItem,
  saveItemToLibrary,
  onAddProduct,
  onRefreshProducts,
  onDeleteProduct,
  onAiDraft,
  onExportXlsx,
  onExportWord,
  syncOppAmount,
  onSyncOppAmountChange,
  oppSyncFailed,
  persistFailed,
  onSaveNow,
  openCheckProductPicker,
  openChecklistImport,
  addManualItem,
  historyQuotes,
  onImportHistory,
  recommendation,
}: QuoteEditorProps) {
  // 价格待录入：所有分组中 price<=0 的行数（用于"后录"提示）
  const pendingPriceCount = quote.groups.reduce(
    (n, g) => n + g.items.filter((i) => !i.price || i.price <= 0).length,
    0,
  )
  const totalItems = quote.groups.reduce((n, g) => n + g.items.length, 0)
  // quote-history-01：历史报价参考面板默认展开（有历史记录才渲染）
  const [historyOpen, setHistoryOpen] = useState(true)
  const histQuotes = historyQuotes ?? []
  // quote-history-01 二期：成交参考区间面板默认展开
  const [recOpen, setRecOpen] = useState(true)

  // B8（R40）：折扣歧义确认队列。填了个有歧义的数不再悄悄改金额，先让用户点清读法。
  const [askQueue, setAskQueue] = useState<DiscountAsk[]>([])
  const discountAsk = askQueue[0] ?? null
  // 已落库数据里的歧义行（老记录里可能有被旧 min=1 钳位改成的 1%）：只盘点、不改写
  const ambiguousRows = useMemo(() => scanAmbiguousDiscounts(quote.groups ?? []), [quote.groups])

  const askDiscount = (a: DiscountAsk) => setAskQueue((q) => [...q, a])

  const pickDiscount = (pct: number) => {
    const cur = askQueue[0]
    if (!cur) return
    const d = normalizeDiscount(pct)
    if (cur.scope === "row" && cur.itemId) updateItem(cur.groupId, cur.itemId, { discount: d })
    else setGroupDiscount(cur.groupId, d)
    setAskQueue((q) => q.slice(1))
    toast.success(
      cur.scope === "group"
        ? `已把本组 ${cur.items.length} 行按 ${d}% 计价`
        : `本行已按 ${d}% 计价`,
    )
  }

  // 横幅「逐行确认」：把盘出来的歧义行按原样入队，逐笔点，绝不一键换算
  const queueAmbiguousRows = () =>
    setAskQueue(
      ambiguousRows.map(
        (l): DiscountAsk => {
          const g = (quote.groups ?? []).find((x) => x.id === l.groupId)
          const it = (g?.items ?? []).find((x) => x.id === l.itemId)
          return {
            scope: "row",
            groupId: l.groupId,
            itemId: l.itemId,
            label: l.itemName,
            raw: l.raw,
            items: it ? [it] : [],
          }
        },
      ),
    )

  return (
    <section className="py-6 pb-16">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-5 py-4 shadow-md animate-in fade-in duration-500">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            列表
          </button>
          <input
            value={quote.quote_name}
            onChange={(e) => onRename(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold text-foreground hover:border-border focus-visible:border-border focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            版本
            <input
              value={quote.version}
              onChange={(e) => onVersionChange(e.target.value)}
              className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          {quote.ref_name && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              关联：{quote.ref_name}
            </span>
          )}
          {quote.opportunity_name && (
            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              关联商机：{quote.opportunity_name}
            </span>
          )}
          {oppSyncFailed && (
            <span
              className="shrink-0 rounded-full border border-warning/50 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
              title="商机金额同步失败，报价已保存但商机预计金额未更新"
            >
              商机金额未同步
            </span>
          )}
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCheckProductPicker}
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3 py-2 text-sm font-medium text-primary shadow-sm transition-all hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Library className="h-4 w-4" />
              从产品库追加
            </button>
            <button
              type="button"
              onClick={openChecklistImport}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-all hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Import className="h-4 w-4" />
              从建设清单导入
            </button>
            <button
              type="button"
              onClick={onAiDraft}
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3 py-2 text-sm font-medium text-primary shadow-sm transition-all hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Sparkles className="h-4 w-4" />
              AI 生成初稿
            </button>
            <button
              type="button"
              onClick={onExportWord}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-all hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <FileText className="h-4 w-4" />
              Word 报价单
            </button>
            <button
              type="button"
              onClick={onExportXlsx}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              导出 Excel
            </button>
          </div>
        </div>
      </header>

      {persistFailed ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-sm animate-in fade-in duration-300">
          <span>自动保存失败，改动暂存在本页，请检查网络后重试</span>
          <button
            type="button"
            onClick={onSaveNow}
            className="inline-flex items-center rounded-md border border-destructive/50 bg-card px-2.5 py-1 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            立即保存
          </button>
        </div>
      ) : null}

      {histQuotes.length > 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-sm font-medium text-foreground"
          >
            <History className="h-4 w-4 shrink-0 text-primary" />
            该客户的历史报价（{histQuotes.length}）
            <span className="text-xs font-normal text-muted-foreground">{historyOpen ? "可一键导入明细作参考" : "点击展开"}</span>
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${historyOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {historyOpen ? (
            <ul className="mt-2.5 space-y-1.5">
              {histQuotes.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs"
                >
                  <span className="min-w-0 max-w-[40%] truncate font-medium text-foreground" title={q.quote_name}>
                    {q.quote_name}
                  </span>
                  <span className="text-muted-foreground">{q.version || "v1"}</span>
                  <span className="text-muted-foreground">{String(q.updated ?? "").slice(0, 10)}</span>
                  <span className="text-muted-foreground">合计 ¥{formatMoney(quoteTotal(q.groups))}</span>
                  <button
                    type="button"
                    onClick={() => onImportHistory?.(q)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Import className="h-3 w-3" />
                    导入明细
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {recommendation && recommendation.available ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <button
            type="button"
            onClick={() => setRecOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-sm font-medium text-foreground"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            成交参考区间
            {recommendation.total_range ? (
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                相似成交总价 ¥{formatMoney(recommendation.total_range.low)} ~ ¥{formatMoney(recommendation.total_range.high)}（中位 ¥{formatMoney(recommendation.total_range.median)}）
              </span>
            ) : null}
            <span className="ml-auto shrink-0 rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
              {recommendation.matches.length} 相似 / {recommendation.total_range?.count ?? 0} 样本
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${recOpen ? "" : "-rotate-90"}`} />
          </button>
          {recOpen ? (
            <div className="mt-2.5 space-y-2.5">
              {recommendation.note ? <p className="text-xs leading-relaxed text-muted-foreground">{recommendation.note}</p> : null}
              {recommendation.total_range ? (
                (() => {
                  const t = totals.total
                  const { low, high } = recommendation.total_range!
                  const pos = t <= 0 ? null : t < low ? "below" : t > high ? "above" : "within"
                  return (
                    <p className={`text-xs font-medium ${pos === "above" ? "text-warning" : pos === "below" ? "text-primary" : "text-foreground"}`}>
                      当前合计 ¥{formatMoney(t)}
                      {pos === "above"
                        ? " 高于参考区间上限，注意超预算/价格竞争失分风险"
                        : pos === "below"
                          ? " 低于参考区间下限，可复核是否漏项或单价偏低"
                          : pos === "within"
                            ? " 落在历史成交参考区间内"
                            : ""}
                    </p>
                  )
                })()
              ) : null}
              {recommendation.projected_total ? (
                <p className="text-xs leading-relaxed text-foreground">
                  <span className="font-medium text-primary">按当前 {recommendation.current_beds} 床折算：</span>
                  建议总价 ¥{formatMoney(recommendation.projected_total.low)} ~ ¥{formatMoney(recommendation.projected_total.high)}（中位 ¥{formatMoney(recommendation.projected_total.median)}）
                  {recommendation.per_bed_range ? (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      · 历史每床 ¥{formatMoney(recommendation.per_bed_range.low)}~{formatMoney(recommendation.per_bed_range.high)}（{recommendation.per_bed_range.count} 样本）
                    </span>
                  ) : null}
                </p>
              ) : null}
              {recommendation.matches.length ? (
                <ul className="space-y-1.5">
                  {recommendation.matches.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
                      <span className="min-w-0 max-w-[40%] truncate font-medium text-foreground" title={m.name}>{m.name}</span>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {m.level === "same" ? "同等级" : m.level === "near" ? "同级" : "跨级"}
                      </span>
                      {m.module_overlap > 0 ? <span className="shrink-0 text-[10px] text-muted-foreground">模块重合 {Math.round(m.module_overlap * 100)}%</span> : null}
                      {m.beds_ratio > 0 ? <span className="shrink-0 text-[10px] text-muted-foreground">床位相近 {Math.round(m.beds_ratio * 100)}%</span> : null}
                      <span className="ml-auto shrink-0 text-muted-foreground">成交 ¥{formatMoney(m.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {recommendation.module_ranges.length ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">逐模块单价参考（历史成交）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {recommendation.module_ranges.map((r) => (
                      <span key={r.name} className="rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground">
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-1 text-muted-foreground">¥{formatMoney(r.low)}~{formatMoney(r.high)} 中¥{formatMoney(r.median)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {ambiguousRows.length > 0 && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 leading-relaxed">
            {`有 ${ambiguousRows.length} 行的折扣小于 5%（例：「${ambiguousRows[0].itemName}」填了 ${ambiguousRows[0].raw}），可能是按「几折」而不是按「百分之几」填的 —— 现在这些行按原价的百分之几计入合计，金额会悄悄错。`}
          </span>
          <button
            type="button"
            onClick={queueAmbiguousRows}
            className="rounded-md border border-amber-500/60 bg-background px-2.5 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            逐行确认
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {quote.groups.map((group) => (
            <div key={group.id} className="rounded-lg border border-border bg-card shadow-md">
              <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <Library className="h-4 w-4 shrink-0 text-primary" />
                <input
                  value={group.name}
                  onChange={(e) => renameGroup(group.id, e.target.value)}
                  className="h-8 w-40 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground hover:border-border focus-visible:border-border focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{group.items.length} 条</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground" title="批量改折扣：整包折让时一次改全组，逐行仍可单独覆盖（90 = 按 90% 计价）">
                    整组折扣%
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      aria-label="整组折扣百分比"
                      placeholder="100"
                      className="h-7 w-14 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onBlur={(e) => {
                        const raw = e.target.value.trim()
                        if (raw === "") return
                        const n = Number(raw)
                        if (!Number.isFinite(n) || n <= 0) {
                          e.target.value = ""
                          return
                        }
                        // B8（R40）：整组批量一次改 N 行，写错就是 N 倍金额同时错，歧义必须先确认
                        if (discountAmbiguity(n)) {
                          e.target.value = ""
                          askDiscount({
                            scope: "group",
                            groupId: group.id,
                            label: group.name || "未命名分组",
                            raw: n,
                            items: group.items ?? [],
                          })
                          return
                        }
                        setGroupDiscount(group.id, n)
                        e.target.value = ""
                        toast.success(`已把本组 ${group.items.length} 行折扣设为 ${normalizeDiscount(n)}%`)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={openCheckProductPicker}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    从产品库追加
                  </button>
                  <button
                    type="button"
                    onClick={openChecklistImport}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    从建设清单导入
                  </button>
                  <button
                    type="button"
                    onClick={() => addManualItem(group.id)}
                    className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Plus className="h-3 w-3" />
                    手工加行
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteGroup(group.id)}
                    aria-label="删除分组"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {group.items.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  本组暂无行项。用「从产品库追加」挑一条 CheckProduct，或「从建设清单导入」一键带入既有清单，也可以「手工加行」补充临时外购项。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1160px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">产品/系统</th>
                        <th className="px-2 py-2 font-medium">模块功能</th>
                        <th className="w-20 px-2 py-2 font-medium">来源</th>
                        <th className="w-16 px-2 py-2 font-medium">数量</th>
                        <th className="w-16 px-2 py-2 font-medium">单位</th>
                        <th className="w-24 px-2 py-2 font-medium">单价(元)</th>
                        <th className="w-20 px-2 py-2 font-medium" title="按百分比计价：90 = 打 9 折；100 或不填 = 原价（与表尾「小计 = 数量 × 单价 × 折扣%」及导出 Excel 公式同口径）。想表达 9 折填 90，不要填 9 或 0.9 —— 小于 5 的数会先弹确认，不再静默改金额">
                          折扣(%)
                        </th>
                        <th className="w-28 px-2 py-2 text-right font-medium">小计(元)</th>
                        <th className="w-24 px-2 py-2 font-medium">评级关联</th>
                        <th className="px-2 py-2 font-medium">备注</th>
                        <th className="w-20 px-2 py-2 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const sub = itemSubtotal(item)
                        const catalog = isCatalogLine(item)
                        const rating = targetsLabel(item.rating_hits ?? [])
                        const sourceLabel =
                          item.source === "company" ? "本公司" : item.source === "external" ? "外购" : catalog ? "产品库" : "手录"
                        return (
                          <tr
                            key={item.id}
                            className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-secondary/40"
                          >
                            {/* 产品/系统 */}
                            <td className="px-1.5 py-1.5">
                              {catalog ? (
                                <div
                                  className={lockedCell}
                                  title={
                                    item.product_id
                                      ? "来自产品库，如需修改请在产品库中调整"
                                      : "由建设清单导入，如需修改请回到清单"
                                  }
                                >
                                  <span className="block truncate leading-8">{item.product_name || item.item_name}</span>
                                </div>
                              ) : (
                                <input
                                  value={item.item_name}
                                  onChange={(e) => updateItem(group.id, item.id, { item_name: e.target.value })}
                                  placeholder="行项名称"
                                  className={cellInput}
                                />
                              )}
                            </td>
                            {/* 模块功能 */}
                            <td className="px-1.5 py-1.5">
                              {catalog ? (
                                <div
                                  className={lockedCell}
                                  title="模块 / 功能来自产品库，如需修改请在产品库中调整"
                                >
                                  <span className="block truncate leading-8">
                                    {item.module_name
                                      ? item.module_func
                                        ? `${item.module_name} · ${item.module_func}`
                                        : item.module_name
                                      : item.module_func || item.spec || "—"}
                                  </span>
                                </div>
                              ) : (
                                <input
                                  value={item.spec}
                                  onChange={(e) => updateItem(group.id, item.id, { spec: e.target.value })}
                                  placeholder="规格 / 范围说明"
                                  className={cellInput}
                                />
                              )}
                            </td>
                            {/* 来源 */}
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">
                              <span
                                className={
                                  item.source === "company" || catalog
                                    ? "rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                                    : "rounded-full bg-muted px-2 py-0.5"
                                }
                              >
                                {sourceLabel}
                              </span>
                            </td>
                            {/* 数量 */}
                            <td className="px-1.5 py-1.5">
                              <NumCell
                                ariaLabel="数量"
                                value={item.qty}
                                min={0}
                                fallback={0}
                                onCommit={(n) => updateItem(group.id, item.id, { qty: n })}
                              />
                            </td>
                            {/* 单位 */}
                            <td className="px-1.5 py-1.5">
                              {catalog ? (
                                <div className={lockedCell} title="单位来自产品库，如需修改请在产品库中调整">
                                  <span className="block truncate leading-8">{item.unit || "套"}</span>
                                </div>
                              ) : (
                                <input
                                  value={item.unit}
                                  onChange={(e) => updateItem(group.id, item.id, { unit: e.target.value })}
                                  placeholder="套"
                                  className={cellInput}
                                />
                              )}
                            </td>
                            {/* 单价 */}
                            <td className="px-1.5 py-1.5">
                              <NumCell
                                ariaLabel="单价（元）"
                                value={item.price}
                                min={0}
                                fallback={0}
                                highlightZero
                                onCommit={(n) => updateItem(group.id, item.id, { price: n })}
                              />
                            </td>
                            {/* 折扣%（R285 补上入口；R40/B8 改为歧义确认：不再静默钳位，≤0 仍按原价） */}
                            <td className="px-1.5 py-1.5">
                              <DiscountCell
                                ariaLabel="折扣（百分比）"
                                value={normalizeDiscount(item.discount)}
                                onCommit={(n) => updateItem(group.id, item.id, { discount: normalizeDiscount(n) })}
                                onAsk={(raw) =>
                                  askDiscount({
                                    scope: "row",
                                    groupId: group.id,
                                    itemId: item.id,
                                    label: item.item_name || "未命名行",
                                    raw,
                                    items: [item],
                                  })
                                }
                              />
                            </td>
                            {/* 小计 */}
                            <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-foreground">
                              {formatMoney(sub)}
                              {normalizeDiscount(item.discount) < 100 && (
                                <span className="ml-1 text-[10px] font-normal text-muted-foreground">（{normalizeDiscount(item.discount)}%计价）</span>
                              )}
                            </td>
                            {/* 评级关联 */}
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">
                              <span className="block truncate" title={rating}>
                                {rating || "—"}
                              </span>
                            </td>
                            {/* 备注 */}
                            <td className="px-1.5 py-1.5">
                              <input
                                value={item.remark ?? ""}
                                onChange={(e) => updateItem(group.id, item.id, { remark: e.target.value })}
                                placeholder="备注 / 折扣说明"
                                className={cellInput}
                              />
                            </td>
                            {/* 操作 */}
                            <td className="px-1.5 py-1.5">
                              <span className="flex items-center justify-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => saveItemToLibrary(item, group.name)}
                                  title="存入常用产品库"
                                  aria-label="存入常用产品库"
                                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  <FolderPlus className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteItem(group.id, item.id)}
                                  title="删除行项"
                                  aria-label="删除行项"
                                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/40">
                        <td colSpan={7} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                          {group.name}小计
                        </td>
                        <td className="px-2 py-2 text-right text-sm font-bold tabular-nums text-primary">
                          {formatMoney(totals.byGroup[group.id] ?? 0)}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addGroup}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-3 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-4 w-4" />
            新增分组
          </button>

          <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">税率与含税说明</span>
                <textarea
                  value={quote.tax_note}
                  onChange={(e) => onTaxNoteChange(e.target.value)}
                  rows={2}
                  placeholder="如：软件与服务按 6% 增值税计，硬件按 13% 计"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">报价总计</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-primary">¥ {formatMoney(totals.total)}</p>
                {/* R34：大写金额单源派生（导出同源），改数量后不会出现小写重算、大写停在旧值的不一致 */}
                {totals.total > 0 && (
                  <p className="mt-0.5 text-xs font-medium text-foreground">{quoteTotalUpper(quote.groups ?? [])}</p>
                )}
                {/* 循环 10 小改 4：万元口径旁注 */}
                {totals.total > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">≈ {fmtAmount(totals.total)}</p>
                )}
                {pendingPriceCount > 0 && (
                  <p className="mt-1 text-xs font-medium text-amber-600">
                    {pendingPriceCount} 条行项价格待录入（不影响保存）
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {totalItems} 条行项 · 小计 = 数量 × 单价 × 折扣% · 自动保存
                </p>
                {quote.opportunity_id && (
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                    <input
                      type="checkbox"
                      checked={syncOppAmount}
                      onChange={(e) => onSyncOppAmountChange(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[color:var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    保存时同步金额到商机预计金额
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 老「我的常用」面板降级为可选：仅当上游还传 productItems 时展示 */}
        {productItems ? (
          <ProductLibraryPanel
            items={productItems}
            loading={productLoading ?? false}
            groups={quote.groups}
            onRefresh={onRefreshProducts ?? (() => undefined)}
            onAddProduct={onAddProduct ?? (() => undefined)}
            onDeleteProduct={onDeleteProduct ?? (() => undefined)}
          />
        ) : (
          <aside className="flex h-full flex-col rounded-lg border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground shadow-sm">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Library className="h-4 w-4 text-primary" />
              我的常用
            </h3>
            <p className="leading-relaxed">
              主入口已切至「从产品库追加」（系统清单 CheckProduct）。老常用面板保留在旧数据源里，如需继续用请从上游传入
              <code className="mx-1 rounded bg-muted px-1">productItems</code>。
            </p>
          </aside>
        )}
      </div>
      <DiscountIntentDialog
        ask={discountAsk}
        queued={askQueue.length - 1}
        onPick={pickDiscount}
        onCancel={() => setAskQueue([])}
      />
    </section>
  )
}
