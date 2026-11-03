import { useMemo, useState } from "react"
import { Ban, Check, ChevronDown, ChevronRight, PackageX, Search, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { CheckProduct, MatchRow } from "@/pages/SolutionStudio/checklistTypes"
import { candidateLabel, fieldText } from "./mappingCore"

// ---------------------------------------------------------------------------
// 公司目录选择器 v2（2026-10-28 多对多重构）：
//  ① 按公司产品清单结构展示：产品归属 → 产品类别 → 产品名称 → 模块（对齐 ONE-LINK 目录）；
//  ② 多选：一行客户条目可挂多个模块，点击顺序即优先级（第一个 = 主干）；
//  ③ 顶部搜索跨全库过滤；系统建议置顶；外购/忽略/清除同窗完成。
// ---------------------------------------------------------------------------

type TreeData = {
  belong: string
  categories: {
    cat: string
    products: { name: string; rows: CheckProduct[] }[]
  }[]
}[]

function buildTree(products: CheckProduct[]): TreeData {
  const belongMap = new Map<string, Map<string, Map<string, CheckProduct[]>>>()
  for (const p of products) {
    const belong = fieldText(p, "product_belong") || "（未分组）"
    const cat = fieldText(p, "category") || "（未分类）"
    const name = fieldText(p, "product_name") || "（未命名产品）"
    if (!belongMap.has(belong)) belongMap.set(belong, new Map())
    const catMap = belongMap.get(belong)!
    if (!catMap.has(cat)) catMap.set(cat, new Map())
    const prodMap = catMap.get(cat)!
    if (!prodMap.has(name)) prodMap.set(name, [])
    prodMap.get(name)!.push(p)
  }
  return [...belongMap.entries()].map(([belong, catMap]) => ({
    belong,
    categories: [...catMap.entries()].map(([cat, prodMap]) => ({
      cat,
      products: [...prodMap.entries()].map(([name, rows]) => ({ name, rows })),
    })),
  }))
}

export function ProductPickerDialog({
  open,
  onOpenChange,
  customerLabel,
  suggestion,
  products,
  currentIds,
  onApply,
  onResolution,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerLabel: string
  suggestion?: MatchRow["suggestion"] | null
  products: CheckProduct[]
  /** 当前已选（有序，首位为主干） */
  currentIds?: string[]
  /** 应用选择（有序 id 列表；空数组 = 清除映射） */
  onApply: (productIds: string[]) => void
  onResolution: (res: MatchRow["resolution"]) => void
}) {
  // Radix Dialog 关闭即卸载内容，重开时 useState 初始化值自动刷新——无需 effect 重置
  const [selected, setSelected] = useState<string[]>(currentIds ?? [])
  const [kw, setKw] = useState("")
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => new Set())
  const [activeProduct, setActiveProduct] = useState("")

  const tree = useMemo(() => buildTree(products), [products])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const suggestionProduct = useMemo(
    () => (suggestion ? (byId.get(suggestion.product_id) ?? null) : null),
    [suggestion, byId],
  )

  const searchResults = useMemo(() => {
    const q = kw.trim().toLowerCase()
    if (!q) return null
    return products.filter((p) =>
      [candidateLabel(p), fieldText(p, "standard_name"), fieldText(p, "product_name"), fieldText(p, "module_category"), fieldText(p, "category")]
        .some((v) => v.toLowerCase().includes(q)),
    )
  }, [kw, products])

  const visibleRows = useMemo(() => {
    if (searchResults) return searchResults
    if (!activeProduct) return products
    return products.filter((p) => fieldText(p, "product_name") === activeProduct)
  }, [searchResults, activeProduct, products])

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleNode = (key: string) => {
    setOpenNodes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = () => {
    onApply(selected)
    onOpenChange(false)
  }

  const setRes = (res: MatchRow["resolution"]) => {
    onResolution(res)
    onOpenChange(false)
  }

  const adoptSuggestion = () => {
    if (!suggestionProduct) return
    setSelected((prev) => (prev.includes(suggestionProduct.id) ? prev : [suggestionProduct.id, ...prev]))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] w-[95vw] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="text-base">指定公司模块（可多选）</DialogTitle>
          <DialogDescription className="line-clamp-2 text-xs">
            客户条目：{customerLabel} · 点击顺序即优先级，第一个为主干模块
          </DialogDescription>
        </DialogHeader>

        {/* 已选区 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2.5">
          <span className="text-xs text-muted-foreground">已选 {selected.length} 个：</span>
          {selected.length === 0 && <span className="text-xs text-muted-foreground">（未选择，从左侧目录或搜索中勾选）</span>}
          {selected.map((id, i) => {
            const p = byId.get(id)
            if (!p) return null
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary">
                {i === 0 && <span className="rounded bg-primary px-1 text-[10px] text-primary-foreground">主干</span>}
                {candidateLabel(p)}
                <button type="button" aria-label="移除" onClick={() => toggle(id)} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
          <span className="flex-1" />
          {suggestionProduct && suggestion && !selected.includes(suggestionProduct.id) && (
            <button
              type="button"
              title={suggestion.reason}
              onClick={adoptSuggestion}
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
            >
              <Sparkles className="h-3 w-3" />
              加入建议：{suggestion.label}
              <span className="opacity-70">{Math.round(suggestion.score * 100)}%</span>
            </button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => setRes("external")}>
            <PackageX className="mr-1 h-3.5 w-3.5" />标为外购
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setRes("ignore")}>
            <Ban className="mr-1 h-3.5 w-3.5" />忽略此行
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左：公司目录树（产品归属 → 产品类别 → 产品名称） */}
          <div className="w-64 shrink-0 overflow-y-auto border-r border-border p-2">
            <button
              type="button"
              onClick={() => setActiveProduct("")}
              className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${!activeProduct ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
            >
              全部产品（{products.length} 个模块）
            </button>
            {tree.map(({ belong, categories }) => {
              const bKey = `b:${belong}`
              const bOpen = openNodes.has(bKey)
              const bCount = categories.reduce((n, c) => n + c.products.reduce((m, x) => m + x.rows.length, 0), 0)
              return (
                <div key={belong} className="mb-0.5">
                  <button type="button" onClick={() => toggleNode(bKey)} className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs font-medium text-foreground hover:bg-muted">
                    {bOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{belong}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{bCount}</span>
                  </button>
                  {bOpen &&
                    categories.map(({ cat, products: prods }) => {
                      const cKey = `c:${belong}/${cat}`
                      const cOpen = openNodes.has(cKey)
                      const cCount = prods.reduce((n, x) => n + x.rows.length, 0)
                      return (
                        <div key={cKey} className="ml-3">
                          <button type="button" onClick={() => toggleNode(cKey)} className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-foreground hover:bg-muted">
                            {cOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{cat}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{cCount}</span>
                          </button>
                          {cOpen &&
                            prods.map(({ name, rows }) => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => setActiveProduct(activeProduct === name ? "" : name)}
                                className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-1 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                                  activeProduct === name ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                              >
                                <span className="truncate">{name}</span>
                                <span className="ml-auto text-[10px]">{rows.length}</span>
                              </button>
                            ))}
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </div>

          {/* 右：模块列表（多选） */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-8 pl-8 text-xs" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索模块名称 / 标准名称 / 产品名称…" />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                {searchResults ? `搜索命中 ${visibleRows.length} 个模块` : activeProduct ? `${activeProduct} · ${visibleRows.length} 个模块` : `全部 ${visibleRows.length} 个模块（可点左侧目录收窄）`}
              </p>
              {visibleRows.map((p) => {
                const on = selected.includes(p.id)
                const order = on ? selected.indexOf(p.id) + 1 : 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      on ? "bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
                      {on ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${on ? "font-medium text-primary" : "text-foreground"}`}>
                        {candidateLabel(p)}
                        {order === 1 && selected.length > 0 && <span className="ml-1.5 rounded bg-primary px-1 text-[10px] text-primary-foreground">主干</span>}
                        {order > 1 && <span className="ml-1.5 text-[10px] text-muted-foreground">#{order}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[fieldText(p, "product_name"), fieldText(p, "module_category"), fieldText(p, "standard_name")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {fieldText(p, "recommendation") ? (
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] ${fieldText(p, "recommendation") === "必选" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        {fieldText(p, "recommendation")}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {!visibleRows.length && <p className="px-2 py-10 text-center text-sm text-muted-foreground">没有匹配的公司模块，可改用「标为外购」</p>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setSelected([])} disabled={!selected.length}>
            清空选择
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={apply}>确定（已选 {selected.length} 个）</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
