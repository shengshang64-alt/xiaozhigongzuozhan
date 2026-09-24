import { useState } from "react"
import { ArrowLeft, FileSpreadsheet, FileText, FolderPlus, Import, Library, Plus, Sparkles, Trash2 } from "lucide-react"
import {
  formatMoney,
  isCatalogLine,
  itemSubtotal,
  type ProductItem,
  type QuoteItem,
  type QuoteRecord,
} from "@/pages/PptQuote/pptQuoteTypes"
import { targetsLabel } from "@/pages/SolutionStudio/checklistTypes"
import { fmtAmount } from "@/pages/CustomerManagement/customerTypes"
import { ProductLibraryPanel } from "./ProductLibraryPanel"

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
}: QuoteEditorProps) {
  // 价格待录入：所有分组中 price<=0 的行数（用于"后录"提示）
  const pendingPriceCount = quote.groups.reduce(
    (n, g) => n + g.items.filter((i) => !i.price || i.price <= 0).length,
    0,
  )
  const totalItems = quote.groups.reduce((n, g) => n + g.items.length, 0)

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
                  <table className="w-full min-w-[1080px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">产品/系统</th>
                        <th className="px-2 py-2 font-medium">模块功能</th>
                        <th className="w-20 px-2 py-2 font-medium">来源</th>
                        <th className="w-16 px-2 py-2 font-medium">数量</th>
                        <th className="w-16 px-2 py-2 font-medium">单位</th>
                        <th className="w-24 px-2 py-2 font-medium">单价(元)</th>
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
                            {/* 小计 */}
                            <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-foreground">
                              {formatMoney(sub)}
                              {item.discount > 0 && item.discount < 100 && (
                                <span className="ml-1 text-[10px] font-normal text-muted-foreground">({item.discount}%)</span>
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
                        <td colSpan={6} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
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
    </section>
  )
}
