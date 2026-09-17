import { Archive, Library, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatMoney, type ProductItem, type QuoteGroup } from "@/pages/PptQuote/pptQuoteTypes"

type ProductLibraryPanelProps = {
  items: ProductItem[]
  loading: boolean
  groups: QuoteGroup[]
  onRefresh: () => void
  onAddProduct: (productId: string, groupId: string) => void
  onDeleteProduct: (productId: string) => void
}

export function ProductLibraryPanel({ items, loading, groups, onRefresh, onAddProduct, onDeleteProduct }: ProductLibraryPanelProps) {
  return (
    <aside className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Library className="h-4 w-4 text-primary" />
          常用产品库
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{items.length}</span>
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="刷新"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        </button>
      </div>
      <div className="max-h-[620px] flex-1 space-y-2 overflow-y-auto p-3">
        {loading && !items.length ? (
          <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            加载中…
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Library className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">产品库还是空的</p>
            <p className="text-xs text-muted-foreground">在报价行项上点「存入库」即可沉淀常用产品</p>
          </div>
        ) : (
          items.map((product) => (
            <div key={product.id} className="rounded-md border border-border bg-background p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{product.item_name}</p>
                <button
                  type="button"
                  onClick={() => onDeleteProduct(product.id)}
                  aria-label="删除"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {product.spec && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{product.spec}</p>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">
                  ¥ {formatMoney(product.ref_price || 0)}
                  <span className="ml-1 font-normal text-muted-foreground">/ {product.unit || "套"}</span>
                </span>
                {product.category && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{product.category}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <select
                  defaultValue={groups[0]?.id ?? ""}
                  id={`lib-group-${product.id}`}
                  className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="选择加入的分组"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={(e) => {
                    const select = e.currentTarget.previousElementSibling as HTMLSelectElement | null
                    const gid = select?.value ?? groups[0]?.id ?? ""
                    if (gid) onAddProduct(product.id, gid)
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Plus className="h-3 w-3" />
                  加入报价
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

type ProductPickerDialogProps = {
  open: boolean
  onClose: () => void
  items: ProductItem[]
  loading: boolean
  groupName: string
  onPick: (productId: string) => void
}

export function ProductPickerDialog({ open, onClose, items, loading, groupName, onPick }: ProductPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4 text-primary" />
            从产品库添加到「{groupName}」
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              加载中…
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              产品库还是空的，可在报价行项上点「存入库」沉淀常用产品
            </p>
          ) : (
            items.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onPick(product.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{product.item_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {product.spec || "无规格说明"} · {product.category || "未分类"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-primary">
                  ¥ {formatMoney(product.ref_price || 0)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">/ {product.unit || "套"}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
