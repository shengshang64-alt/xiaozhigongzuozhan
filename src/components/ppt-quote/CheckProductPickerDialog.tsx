import { useMemo, useState } from "react"
import { Loader2, Search, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatMoney } from "@/pages/PptQuote/pptQuoteTypes"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"

type CheckProductPickerDialogProps = {
  open: boolean
  onClose: () => void
  products: CheckProduct[]
  loading: boolean
  onConfirm: (picks: { productId: string; qty: number }[]) => void
}

/**
 * 报价「从产品库追加」：与建设清单同源，多选 CheckProduct 一键导入。
 * 加入时按 category 自动归组、价格默认 0（后录），qty 可在勾选后微调。
 */
export function CheckProductPickerDialog({ open, onClose, products, loading, onConfirm }: CheckProductPickerDialogProps) {
  const [keyword, setKeyword] = useState("")
  const [activeCategory, setActiveCategory] = useState("")
  const [picks, setPicks] = useState<Record<string, number>>({})

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category) set.add(p.category)
    return Array.from(set).sort()
  }, [products])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return products.filter((p) => {
      if (activeCategory && p.category !== activeCategory) return false
      if (!kw) return true
      return [p.product_name, p.module_name, p.module_func, p.category, p.product_line].some((v) =>
        String(v ?? "").toLowerCase().includes(kw),
      )
    })
  }, [products, keyword, activeCategory])

  const toggle = (id: string) => {
    setPicks((prev) => {
      const next = { ...prev }
      if (next[id] != null) delete next[id]
      else next[id] = 1
      return next
    })
  }
  const setQty = (id: string, qty: number) => {
    setPicks((prev) => (prev[id] == null ? prev : { ...prev, [id]: Math.max(1, Math.round(qty) || 1) }))
  }

  const totalPicks = Object.keys(picks).length
  const reset = () => {
    setPicks({})
    setKeyword("")
    setActiveCategory("")
  }
  const confirmPicks = () => {
    const list = Object.entries(picks).map(([productId, qty]) => ({ productId, qty }))
    if (!list.length) return
    onConfirm(list)
    reset()
    onClose()
  }
  const closeAll = () => {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeAll()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">从产品库追加</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            多选后一次性导入报价；系统按产品类别自动分组，价格默认留空待录入
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          <aside className="w-40 shrink-0 border-r border-border pr-2">
            <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">按类别</p>
            <button
              type="button"
              onClick={() => setActiveCategory("")}
              className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors ${
                activeCategory === "" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              全部类别（{products.length}）
            </button>
            {categories.map((cat) => {
              const count = products.filter((p) => p.category === cat).length
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    activeCategory === cat ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary"
                  }`}
                  title={cat}
                >
                  {cat}（{count}）
                </button>
              )
            })}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索：产品名 / 模块 / 功能 / 类别"
                className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="搜索产品库"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-2 max-h-[52vh] overflow-y-auto rounded-md border border-border">
              {loading && !products.length ? (
                <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  加载产品库…
                </p>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {products.length === 0 ? "产品库为空，请先在建设清单里初始化" : "没有匹配的搜索结果"}
                </p>
              ) : (
                <ul>
                  {filtered.map((p) => {
                    const checked = picks[p.id] != null
                    const qty = picks[p.id] ?? 1
                    return (
                      <li
                        key={p.id}
                        className={`flex items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 ${
                          checked ? "bg-primary/5" : "hover:bg-secondary/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(p.id)}
                          className="h-3.5 w-3.5 shrink-0 accent-[color:var(--primary)]"
                          aria-label={`选择 ${p.product_name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {p.product_name}
                            {p.module_name ? (
                              <span className="ml-1.5 text-xs text-muted-foreground">· {p.module_name}</span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.category || "未分类"} · {p.module_func || p.description || "—"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs">
                          <p className="font-semibold text-primary">¥ {formatMoney(Number(p.unit_price) || 0)}</p>
                          <p className="text-muted-foreground">参考价 · 后录</p>
                        </div>
                        {checked && (
                          <input
                            type="number"
                            min={1}
                            value={qty}
                            onChange={(e) => setQty(p.id, Number(e.target.value))}
                            className="h-8 w-16 rounded border border-border bg-background px-1.5 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={`${p.product_name} 数量`}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="mr-auto text-xs text-muted-foreground">已选 {totalPicks} 条 · 价格默认留空待录入</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeAll}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmPicks}
              disabled={!totalPicks}
              className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              加入报价
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
