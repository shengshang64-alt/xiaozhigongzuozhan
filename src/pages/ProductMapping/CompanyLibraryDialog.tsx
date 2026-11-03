// 公司库查看器（R-006）：ONE-LINK 标准清单的「查看 + 查询」入口。
// 背景：清单导入后此前只能做一一对照，没有任何地方能看到已导入的内容（用户传完即失明）。
// 口径：in_company=true 的 check_products 行；清单定期更新，必须能随时查当前生效版本与模块构成。
// 实现：自包含 Dialog，首开全量拉取（626 条小记录，同 useProductMapping「按页拉全」先例），
//       前端筛选 + 分页（50/页）+ 行展开详情 + 导出 CSV（复用 exportToCsv）。
import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Download, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"

type CompanyProductRow = {
  id: string
  product_line: string
  product_name: string
  module_name: string
  module_func: string
  description: string
  category: string
  module_category?: string
  charge_mode: string
  unit_price: number
  status: string
  rating_tags?: unknown
  tech_params?: unknown
  standard_name?: string
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...vibexAuthHeaders(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`)
  return (await res.json()) as T
}

const PER_PAGE = 50

function ratingText(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join("、")
  if (typeof v === "string" && v.trim() && v !== "null") {
    try {
      const arr = JSON.parse(v)
      return Array.isArray(arr) ? arr.map(String).join("、") : v
    } catch {
      return v
    }
  }
  return "—"
}

export function CompanyLibraryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rows, setRows] = useState<CompanyProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [line, setLine] = useState("")
  const [cat, setCate] = useState("")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      // 公司库 550+ 行，服务端单页上限 200，按页拉全（≤10 页防失控，同 useProductMapping 先例）
      const all: CompanyProductRow[] = []
      for (let p = 1; p <= 10; p++) {
        const d = await apiFetch<{ items: CompanyProductRow[]; totalItems: number }>(
          `/api/check_products?in_company=true&page=${p}&perPage=200&sort=-created`,
        )
        all.push(...(d.items || []))
        if (all.length >= (d.totalItems ?? 0) || !(d.items || []).length) break
      }
      setRows(all)
    } catch (e) {
      setError(e instanceof Error ? e.message : "公司库加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开 → 延迟一拍拉取（清理函数取消上一次未触发的请求）
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [open, load])

  const lines = useMemo(() => [...new Set(rows.map((r) => r.product_line).filter(Boolean))].sort(), [rows])
  const cats = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (line && r.product_line !== line) return false
      if (cat && r.category !== cat) return false
      if (!kw) return true
      return [r.product_line, r.product_name, r.module_name, r.module_func, r.description, r.standard_name]
        .some((v) => String(v || "").toLowerCase().includes(kw))
    })
  }, [rows, q, line, cat])

  const applyQ = useCallback((v: string) => { setQ(v); setPage(1) }, [])
  const applyLine = useCallback((v: string) => { setLine(v); setPage(1) }, [])
  const applyCat = useCallback((v: string) => { setCate(v); setPage(1) }, [])

  const totalPages = Math.max(Math.ceil(filtered.length / PER_PAGE), 1)
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const exportCsv = () => {
    exportToCsv(`公司库清单_${localDateStamp()}.csv`, ["产品线", "产品名", "模块名", "模块功能", "分类", "授权模式", "单价", "状态", "评级标签", "标准名"], filtered.map((r) => [
      r.product_line, r.product_name, r.module_name, r.module_func, r.category, r.charge_mode,
      r.unit_price, r.status, ratingText(r.rating_tags), r.standard_name,
    ]))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[94vw] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>公司库 · ONE-LINK 标准清单</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">
          当前生效的公司标准模块清单（导入后即入库）。支持关键字搜索与按产品线/分类筛选，点击行查看功能描述与技术参数；定期更新清单后此处即为最新版本。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={q}
              onChange={(e) => applyQ(e.target.value)}
              placeholder="搜索产品线 / 模块名 / 功能描述…"
            />
          </div>
          <select
            value={line}
            onChange={(e) => applyLine(e.target.value)}
            className="h-9 max-w-56 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">全部产品线（{lines.length}）</option>
            {lines.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={cat}
            onChange={(e) => applyCat(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">全部分类</option>
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!filtered.length} onClick={exportCsv}>
            <Download className="mr-1 h-3.5 w-3.5" />导出 CSV（{filtered.length}）
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />公司库加载中…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center text-sm text-destructive">{error}</div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 text-left font-medium">产品线</th>
                    <th className="px-2.5 py-2 text-left font-medium">模块名</th>
                    <th className="px-2.5 py-2 text-left font-medium">分类</th>
                    <th className="px-2.5 py-2 text-left font-medium">授权模式</th>
                    <th className="px-2.5 py-2 text-right font-medium">单价（万元）</th>
                    <th className="px-2.5 py-2 text-left font-medium">评级标签</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <CompanyRow key={r.id} row={r} expanded={expandedId === r.id} onToggle={() => setExpandedId(expandedId === r.id ? "" : r.id)} />
                  ))}
                  {!pageRows.length ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                        没有符合条件的模块行 —— 调整关键字或筛选条件
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
              <span>共 {rows.length} 条 · 筛选后 {filtered.length} 条 · 第 {safePage}/{totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>下一页</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CompanyRow({ row, expanded, onToggle }: { row: CompanyProductRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-border transition-colors hover:bg-muted/50" onClick={onToggle}>
        <td className="max-w-44 truncate px-2.5 py-1.5 text-foreground" title={row.product_line}>{row.product_line || "—"}</td>
        <td className="max-w-56 truncate px-2.5 py-1.5 font-medium text-foreground" title={row.module_name}>{row.module_name || row.product_name || "—"}</td>
        <td className="px-2.5 py-1.5 text-muted-foreground">{row.category || "—"}</td>
        <td className="px-2.5 py-1.5 text-muted-foreground">{row.charge_mode || "—"}</td>
        <td className="px-2.5 py-1.5 text-right tabular-nums text-foreground">{row.unit_price ?? "—"}</td>
        <td className="max-w-36 truncate px-2.5 py-1.5 text-muted-foreground" title={ratingText(row.rating_tags)}>{ratingText(row.rating_tags)}</td>
        <td className="px-2 py-1.5 text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={7} className="px-4 py-2.5">
            <div className="space-y-1.5 text-xs text-foreground">
              <div><span className="text-muted-foreground">模块功能：</span>{row.module_func || "—"}</div>
              <div><span className="text-muted-foreground">描述：</span>{row.description || "—"}</div>
              <div><span className="text-muted-foreground">产品名：</span>{row.product_name || "—"}<span className="ml-4 text-muted-foreground">状态：</span>{row.status || "—"}<span className="ml-4 text-muted-foreground">标准名：</span>{row.standard_name || "—"}</div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
