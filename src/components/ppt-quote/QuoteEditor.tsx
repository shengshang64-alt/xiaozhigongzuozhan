import { useState } from "react"
import { ArrowLeft, FileSpreadsheet, FileText, FolderPlus, Library, Plus, Sparkles, Trash2 } from "lucide-react"
import { formatMoney, itemSubtotal, type ProductItem, type QuoteItem, type QuoteRecord } from "@/pages/PptQuote/pptQuoteTypes"
import { fmtAmount } from "@/pages/CustomerManagement/customerTypes"
import { ProductLibraryPanel } from "./ProductLibraryPanel"

type QuoteEditorProps = {
  quote: QuoteRecord
  totals: { byGroup: Record<string, number>; total: number }
  productItems: ProductItem[]
  productLoading: boolean
  onBack: () => void
  onRename: (value: string) => void
  onTaxNoteChange: (value: string) => void
  onVersionChange: (value: string) => void
  addGroup: () => void
  deleteGroup: (groupId: string) => void
  renameGroup: (groupId: string, value: string) => void
  addItem: (groupId: string) => void
  updateItem: (groupId: string, itemId: string, patch: Partial<QuoteItem>) => void
  deleteItem: (groupId: string, itemId: string) => void
  saveItemToLibrary: (item: QuoteItem, groupName: string) => void
  openPicker: (groupId: string) => void
  onAddProduct: (productId: string, groupId: string) => void
  onRefreshProducts: () => void
  onDeleteProduct: (productId: string) => void
  onAiDraft: () => void
  onExportXlsx: () => void
  onExportWord: () => void
  // 轮次 F 轨 2：报价 ↔ 商机关联（金额同步勾选）
  syncOppAmount: boolean
  onSyncOppAmountChange: (checked: boolean) => void
  /** D6：商机金额同步失败态——头部 chip 标黄提示「金额未同步」 */
  oppSyncFailed: boolean
  /** B4：自动保存失败横幅（非阻断）+ 手动立即保存 */
  persistFailed: boolean
  onSaveNow: () => void
}

const cellInput =
  "h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

// A2-8：数字单元格非法输入行内提示（编辑期保留草稿原文，失焦归一到合法值）
function NumCell({
  value,
  min,
  max,
  fallback,
  ariaLabel,
  onCommit,
}: {
  value: number
  min: number
  max?: number
  fallback: number
  ariaLabel: string
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [hint, setHint] = useState("")
  const shown = draft ?? String(value)
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n))
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
        className={`${cellInput} text-right ${hint ? "border-destructive focus-visible:ring-destructive" : ""}`}
      />
      {hint && <p className="mt-0.5 text-xs leading-tight text-destructive">{hint}，失焦后自动修正</p>}
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
  addItem,
  updateItem,
  deleteItem,
  saveItemToLibrary,
  openPicker,
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
}: QuoteEditorProps) {
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
                  <button
                    type="button"
                    onClick={() => openPicker(group.id)}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    产品库添加
                  </button>
                  <button
                    type="button"
                    onClick={() => addItem(group.id)}
                    className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Plus className="h-3 w-3" />
                    加行项
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
                  本组暂无行项，点「加行项」手动录入，或「产品库添加」快速引入常用产品
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <th className="w-10 px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">名称</th>
                        <th className="px-2 py-2 font-medium">规格说明</th>
                        <th className="w-16 px-2 py-2 font-medium">单位</th>
                        <th className="w-16 px-2 py-2 font-medium">数量</th>
                        <th className="w-24 px-2 py-2 font-medium">单价(元)</th>
                        <th className="w-20 px-2 py-2 font-medium">折扣%</th>
                        <th className="w-28 px-2 py-2 text-right font-medium">小计(元)</th>
                        <th className="w-20 px-2 py-2 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, idx) => {
                        const sub = itemSubtotal(item)
                        return (
                          <tr key={item.id} className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-secondary/40">
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-1.5 py-1.5">
                              <input
                                value={item.item_name}
                                onChange={(e) => updateItem(group.id, item.id, { item_name: e.target.value })}
                                placeholder="行项名称"
                                className={cellInput}
                              />
                            </td>
                            <td className="px-1.5 py-1.5">
                              <input
                                value={item.spec}
                                onChange={(e) => updateItem(group.id, item.id, { spec: e.target.value })}
                                placeholder="规格 / 范围说明"
                                className={cellInput}
                              />
                            </td>
                            <td className="px-1.5 py-1.5">
                              <input
                                value={item.unit}
                                onChange={(e) => updateItem(group.id, item.id, { unit: e.target.value })}
                                placeholder="套"
                                className={cellInput}
                              />
                            </td>
                            <td className="px-1.5 py-1.5">
                              <NumCell
                                ariaLabel="数量"
                                value={item.qty}
                                min={0}
                                fallback={0}
                                onCommit={(n) => updateItem(group.id, item.id, { qty: n })}
                              />
                            </td>
                            <td className="px-1.5 py-1.5">
                              <NumCell
                                ariaLabel="单价（元）"
                                value={item.price}
                                min={0}
                                fallback={0}
                                onCommit={(n) => updateItem(group.id, item.id, { price: n })}
                              />
                            </td>
                            <td className="px-1.5 py-1.5">
                              <NumCell
                                ariaLabel="折扣百分比"
                                value={item.discount}
                                min={0}
                                max={100}
                                fallback={100}
                                onCommit={(n) => updateItem(group.id, item.id, { discount: n })}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-foreground">
                              {formatMoney(sub)}
                            </td>
                            <td className="px-1.5 py-1.5">
                              <span className="flex items-center justify-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => saveItemToLibrary(item, group.name)}
                                  title="存入产品库"
                                  aria-label="存入产品库"
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
                        <td />
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
                {/* 循环 10 小改 4：万元口径旁注（与 CRM 商机金额显示同口径，便于与客户口径对齐） */}
                {totals.total > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">≈ {fmtAmount(totals.total)}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {quote.groups.reduce((n, g) => n + g.items.length, 0)} 条行项 · 小计 = 数量 × 单价 × 折扣% · 自动保存
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

        <ProductLibraryPanel
          items={productItems}
          loading={productLoading}
          groups={quote.groups}
          onRefresh={onRefreshProducts}
          onAddProduct={onAddProduct}
          onDeleteProduct={onDeleteProduct}
        />
      </div>
    </section>
  )
}
