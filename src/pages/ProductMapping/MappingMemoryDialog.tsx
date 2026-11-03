import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, Loader2, Pencil, Search, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { pbJsonRequest } from "@/lib/pbJson"
import type { CheckMapping, CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import { candidateLabel } from "./mappingCore"
import { ProductPickerDialog } from "./ProductPickerDialog"

// ---------------------------------------------------------------------------
// 映射记忆库（2026-10-28 多对多版）：人工确认过的「外部名称 → 公司模块」沉淀在
// check_mappings（一对 = 一行；一对多 = 多行）。本对话框按外部名分组管理：
// 查看 / 搜索 / 改映射（多选）/ 删除 / 导出 xlsx / 导入 xlsx（批量沉淀历史经验）。
// ---------------------------------------------------------------------------

type MemoryRow = CheckMapping & { created?: string; updated?: string }

type ListResponse<T> = { items: T[]; totalItems: number }

const normKey = (s: string) => (s ?? "").replace(/\s+/g, "").toLowerCase()

/** 按外部名分组（一对多 = 一组多行） */
type MemoryGroup = {
  norm: string
  pairs: MemoryRow[]
  hitTotal: number
  updated: string
}

export function MappingMemoryDialog({
  open,
  onOpenChange,
  products,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: CheckProduct[]
  onChanged?: () => void
}) {
  const [rows, setRows] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<MemoryGroup | null>(null)
  const [confirmDel, setConfirmDel] = useState<string>("")
  const importRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all: MemoryRow[] = []
      for (let page = 1; page <= 10; page += 1) {
        const d = await pbJsonRequest<ListResponse<MemoryRow>>(`/api/check_mappings?page=${page}&perPage=200&sort=-hit_count`)
        all.push(...(d.items ?? []))
        if (!(d.items ?? []).length || all.length >= (d.totalItems ?? all.length)) break
      }
      setRows(all)
    } catch {
      toast.error("记忆库加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开 → 延迟一拍拉取（set-state-in-effect 口径，同 CompanyLibraryDialog 先例）
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [open, load])

  const groups = useMemo<MemoryGroup[]>(() => {
    const map = new Map<string, MemoryRow[]>()
    for (const r of rows) {
      const list = map.get(r.customer_norm) ?? []
      list.push(r)
      map.set(r.customer_norm, list)
    }
    return [...map.entries()]
      .map(([norm, pairs]) => ({
        norm,
        pairs,
        hitTotal: pairs.reduce((n, x) => n + (Number(x.hit_count) || 0), 0),
        updated: pairs.map((x) => x.updated ?? x.created ?? "").sort().reverse()[0] ?? "",
      }))
      .sort((a, b) => b.hitTotal - a.hitTotal)
  }, [rows])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return groups
    return groups.filter(
      (g) => g.norm.toLowerCase().includes(kw) || g.pairs.some((x) => x.company_product_name.toLowerCase().includes(kw)),
    )
  }, [groups, q])

  /** 多选编辑后同步该外部名的全部 pair：新增的补建、保留的更新名、取消的删除 */
  const syncGroup = useCallback(
    async (group: MemoryGroup, productIds: string[]) => {
      try {
        const keep = new Set(productIds)
        for (const pair of group.pairs) {
          if (!keep.has(pair.product_id)) {
            await pbJsonRequest(`/api/check_mappings/${pair.id}`, { method: "DELETE" })
          }
        }
        for (const pid of productIds) {
          const p = products.find((x) => x.id === pid)
          if (!p) continue
          const exist = group.pairs.find((x) => x.product_id === pid)
          if (exist) {
            await pbJsonRequest(`/api/check_mappings/${exist.id}`, {
              method: "PATCH",
              body: JSON.stringify({ company_product_name: candidateLabel(p), product_id: pid }),
            })
          } else {
            await pbJsonRequest("/api/check_mappings", {
              method: "POST",
              body: JSON.stringify({ customer_norm: group.norm, company_product_name: candidateLabel(p), product_id: pid, hit_count: 1 }),
            })
          }
        }
        toast.success(`已更新「${group.norm}」的映射（${productIds.length} 个模块）`)
        void load()
        onChanged?.()
      } catch {
        toast.error("修改失败，请稍后重试")
      }
    },
    [products, load, onChanged],
  )

  const removeGroup = useCallback(
    async (group: MemoryGroup) => {
      try {
        await Promise.all(group.pairs.map((x) => pbJsonRequest(`/api/check_mappings/${x.id}`, { method: "DELETE" })))
        setConfirmDel("")
        toast.success(`已删除记忆「${group.norm}」（${group.pairs.length} 对）`)
        void load()
        onChanged?.()
      } catch {
        toast.error("删除失败，请稍后重试")
      }
    },
    [load, onChanged],
  )

  const exportXlsx = useCallback(async () => {
    const flat = filtered.flatMap((g) => g.pairs)
    if (!flat.length) return
    const XLSX = await import("xlsx-js-style")
    const aoa: (string | number)[][] = [["外部名称", "公司模块", "命中次数", "最近更新"]]
    for (const g of filtered) {
      for (const r of g.pairs) {
        aoa.push([g.norm, r.company_product_name, r.hit_count ?? 0, (r.updated ?? r.created ?? "").slice(0, 19).replace("T", " ")])
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = [{ wch: 34 }, { wch: 34 }, { wch: 10 }, { wch: 20 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "映射记忆库")
    XLSX.writeFile(wb, "产品映射-记忆库.xlsx")
    toast.success(`已导出 ${flat.length} 条记忆（${filtered.length} 个外部名）`)
  }, [filtered])

  const importXlsx = useCallback(
    async (file: File) => {
      try {
        const XLSX = await import("xlsx")
        const wb = XLSX.read(await file.arrayBuffer())
        const ws = wb.Sheets[wb.SheetNames[0]]
        const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })
        if (!grid.length) throw new Error("empty")
        const header = (grid[0] ?? []).map((c) => String(c ?? ""))
        const colExt = header.findIndex((h) => /外部|客户|条目|名称/.test(h))
        const colMod = header.findIndex((h) => /公司|模块|映射/.test(h) && !/次数/.test(h))
        if (colExt < 0 || colMod < 1) throw new Error("columns")
        const labelToProduct = new Map<string, CheckProduct>()
        for (const p of products) {
          const key = normKey(candidateLabel(p))
          if (key && !labelToProduct.has(key)) labelToProduct.set(key, p)
        }
        // pair 级查重：同一外部名可导入多对（一对多）
        const exist = new Set(rows.map((r) => `${normKey(r.customer_norm)}::${r.product_id}`))
        let added = 0
        let skipped = 0
        for (let i = 1; i < grid.length; i += 1) {
          const row = grid[i] ?? []
          const ext = String(row[colExt] ?? "").trim()
          const mod = String(row[colMod] ?? "").trim()
          if (!ext || !mod) continue
          const p = labelToProduct.get(normKey(mod))
          if (!p || exist.has(`${normKey(ext)}::${p.id}`)) {
            skipped += 1
            continue
          }
          await pbJsonRequest("/api/check_mappings", {
            method: "POST",
            body: JSON.stringify({ customer_norm: ext, company_product_name: candidateLabel(p), product_id: p.id, hit_count: 1 }),
          })
          exist.add(`${normKey(ext)}::${p.id}`)
          added += 1
        }
        toast.success(`导入完成：新增 ${added} 对${skipped ? `，跳过 ${skipped} 行（模块名对不上或已存在）` : ""}`)
        void load()
        onChanged?.()
      } catch {
        toast.error("导入失败：请使用「外部名称 / 公司模块」两列表头的 xlsx")
      }
    },
    [products, rows, load, onChanged],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] w-[94vw] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>映射记忆库</DialogTitle>
          <DialogDescription>
            人工确认过的「外部名称 → 公司模块」沉淀在这里（支持一对多），之后的项目自动命中（蓝色「记忆」标记）。可修改、删除、导入导出。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索外部名称 / 公司模块…" />
          </div>
          <Button size="sm" variant="outline" disabled={!filtered.length} onClick={() => void exportXlsx()}>
            <Download className="mr-1 h-3.5 w-3.5" />导出（{filtered.length}）
          </Button>
          <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>
            <Upload className="mr-1 h-3.5 w-3.5" />导入
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importXlsx(f)
              e.target.value = ""
            }}
          />
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />记忆库加载中…
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-secondary/80 text-xs text-muted-foreground backdrop-blur">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">外部名称</th>
                  <th className="px-3 py-2 text-left font-medium">公司模块（一对多为多个）</th>
                  <th className="px-3 py-2 text-right font-medium">命中次数</th>
                  <th className="px-3 py-2 text-left font-medium">最近更新</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <tr key={g.norm} className="border-b border-border/60 last:border-0 align-top">
                    <td className="max-w-56 px-3 py-2 text-foreground">
                      <span className="whitespace-pre-wrap break-words">{g.norm}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {g.pairs.map((x) => (
                          <span key={x.id} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground" title={x.company_product_name}>
                            {x.company_product_name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{g.hitTotal}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{g.updated.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(g)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {confirmDel === g.norm ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => void removeGroup(g)}>确认</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmDel("")}>取消</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDel(g.norm)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                      {rows.length ? "没有符合条件的记忆条目" : "记忆库还是空的——在对照表里人工指定模块后会自动沉淀进来"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          共 {groups.length} 个外部名 · {rows.length} 对映射{q ? ` · 筛选后 ${filtered.length} 个` : ""}
        </p>

        {editing && (
          <ProductPickerDialog
            key={editing.norm}
            open={Boolean(editing)}
            onOpenChange={(o) => !o && setEditing(null)}
            customerLabel={editing.norm}
            products={products}
            currentIds={editing.pairs.map((x) => x.product_id).filter(Boolean)}
            onApply={(ids) => void syncGroup(editing, ids)}
            onResolution={() => setEditing(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
