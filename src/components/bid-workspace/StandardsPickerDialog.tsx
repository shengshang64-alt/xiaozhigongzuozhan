import { useMemo, useState } from "react"
import { Check, Library, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  BASIS_CATEGORY_BADGE,
  BASIS_STYLE_OPTIONS,
  MEDICAL_STANDARDS,
  STANDARD_CATEGORIES,
  basisItemKey,
  type BasisStyle,
  type StandardCategory,
} from "@/pages/BidWorkspace/bidTypes"
import { detectStaleVersionRefs, staleRefHint } from "@/pages/BidWorkspace/standardCurrency"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type StandardsPickerDialogProps = Pick<
  UseBidWorkspace,
  | "standardsPickerOpen"
  | "closeStandardsPicker"
  | "basisStyle"
  | "setBasisStyle"
  | "basisParsedItems"
  | "basisExtraItems"
  | "basisMergedItems"
  | "toggleBasisStandard"
  | "clearBasisExtra"
>

type CategoryFilter = StandardCategory | "all"

/**
 * 第十七轮 17B：「规范库补选」对话框——医疗信息化常用规范库（MEDICAL_STANDARDS）
 * 类别筛选 tab + 名称/编号搜索 + checkbox 多选 + 已选分色徽标；
 * 解析提取项始终列入合并清单（行内置灰勾选、标「解析提取」，不可取消）；
 * 勾选结果增量保存到项目（compilation_basis_extra），撰写样式三选一并在此设置（basis_style）。
 */
export function StandardsPickerDialog(p: StandardsPickerDialogProps) {
  const [query, setQuery] = useState("")
  const [catFilter, setCatFilter] = useState<CategoryFilter>("all")

  const parsedKeys = useMemo(() => new Set(p.basisParsedItems.map(basisItemKey)), [p.basisParsedItems])
  const extraKeys = useMemo(() => new Set(p.basisExtraItems.map(basisItemKey)), [p.basisExtraItems])
  const staleRefs = useMemo(() => detectStaleVersionRefs(p.basisParsedItems), [p.basisParsedItems])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return MEDICAL_STANDARDS.filter((it) => {
      if (catFilter !== "all" && it.category !== catFilter) return false
      if (!q) return true
      return it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q)
    })
  }, [catFilter, query])

  const catCount = (cat: CategoryFilter) =>
    cat === "all" ? MEDICAL_STANDARDS.length : MEDICAL_STANDARDS.filter((it) => it.category === cat).length

  return (
    <Dialog open={p.standardsPickerOpen} onOpenChange={(open) => !open && p.closeStandardsPicker()}>
      <DialogContent className="max-w-3xl rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <Library className="h-3.5 w-3.5" />
            规范库补选
          </p>
          <DialogTitle className="text-xl text-foreground">编制依据与规范库</DialogTitle>
          <DialogDescription>
            从医疗信息化常用规范库勾选补充编制依据，随项目保存；解析提取项始终列入。合并清单会注入正文生成，按下方撰写样式列示。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">撰写样式</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {BASIS_STYLE_OPTIONS.map((opt) => {
                const active = p.basisStyle === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => p.setBasisStyle(opt.value as BasisStyle)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-background hover:bg-secondary"
                    }`}
                  >
                    <span className={`block text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}>
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{opt.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {staleRefs.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">
                版本提示：解析提取的 {staleRefs.length} 条编制依据引用了旧版标准，注入正文前请核实（仅提示，不拦截）
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {staleRefs.map((r) => (
                  <li key={`${r.item.code}-${r.citedYear}`} className="text-xs leading-snug text-warning">
                    {staleRefHint(r)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", ...STANDARD_CATEGORIES] as CategoryFilter[]).map((cat) => {
              const active = catFilter === cat
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCatFilter(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:text-card-foreground"
                  }`}
                >
                  {cat === "all" ? "全部" : cat} {catCount(cat)}
                </button>
              )
            })}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索规范名称或编号，如「电子病历」「GB/T 22239」"
              className="border-border bg-background pl-9 focus-visible:shadow-[var(--focus-ring)]"
            />
          </div>

          <ul className="max-h-96 min-h-40 overflow-y-auto rounded-lg border border-border bg-background p-2">
            {filtered.length === 0 && (
              <li className="flex flex-col items-center gap-1 py-10 text-center text-sm text-muted-foreground">
                <span>没有匹配的规范条目，换个关键词或类别试试</span>
                {(query.trim() || catFilter !== "all") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setQuery("")
                      setCatFilter("all")
                    }}
                    className="mt-1 gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                    清除筛选
                  </Button>
                )}
              </li>
            )}
            {filtered.map((it) => {
              const key = basisItemKey(it)
              const fromParsed = parsedKeys.has(key)
              const checked = fromParsed || extraKeys.has(key)
              return (
                <li key={key}>
                  <label
                    className={`mb-1 flex items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${
                      fromParsed
                        ? "cursor-not-allowed border-border bg-muted/50 opacity-80"
                        : checked
                          ? "cursor-pointer border-primary/40 bg-primary/5 shadow-sm"
                          : "cursor-pointer border-transparent hover:bg-secondary"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={fromParsed}
                      onChange={() => p.toggleBasisStandard(it)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug text-foreground">{it.name}</span>
                      {it.code && <span className="mt-0.5 block text-xs text-muted-foreground">{it.code}</span>}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {fromParsed && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          解析提取
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BASIS_CATEGORY_BADGE[it.category]}`}>
                        {it.category}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-primary" />
              合并清单 {p.basisMergedItems.length} 条（解析提取 {p.basisParsedItems.length} · 补选 {p.basisExtraItems.length}，已去重）
            </p>
            <div className="flex items-center gap-2">
              {p.basisExtraItems.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={p.clearBasisExtra}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  清空补选
                </Button>
              )}
              <Button
                size="sm"
                onClick={p.closeStandardsPicker}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
              >
                完成
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
