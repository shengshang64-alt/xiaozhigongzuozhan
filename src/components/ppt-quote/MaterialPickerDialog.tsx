// 从素材库选图（R-008）：PPT 配图区第二取图入口，与「一键配图」（联网实时搜）并存。
// 自带拉取/分类筛选/标签搜索/分页，插入走上层 attachImageFromLibrary（原图 dataURL 内嵌 deck）。
import { useCallback, useEffect, useState } from "react"
import { Loader2, PackageOpen, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { MATERIAL_CATEGORIES, MATERIAL_SOURCE_LABELS, type MaterialItem, type MaterialListResult } from "@/pages/MaterialLibrary/materialTypes"

const PER_PAGE = 60

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...vibexAuthHeaders(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    // 2026-11-04（巡检）：原来只抛 `HTTP 500`，把服务端 message 丢了——用户和我们都看不出
    // 到底是库锁了、鉴权挂了还是接口不存在。带上服务端原因（拿不到就退回状态码）。
    let detail = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { message?: string; error?: string }
      const m = String(j?.message || j?.error || "").trim()
      if (m) detail = `${detail}：${m}`
    } catch {
      /* 响应体不是 JSON：保留状态码即可 */
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

type MaterialPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 插入指定素材到当前页；返回 true 时关弹窗 */
  onPick: (materialId: string) => Promise<boolean>
}

export function MaterialPickerDialog({ open, onOpenChange, onPick }: MaterialPickerDialogProps) {
  const [items, setItems] = useState<MaterialItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState("")
  const [category, setCategory] = useState("")
  const [pickingId, setPickingId] = useState("")
  // 2026-11-04（巡检）：拉取失败此前被 catch 静默吞掉、只把 loaded 置 true，
  // 于是界面显示「素材库为空或未命中」——用户会以为库里真没素材，实际是请求失败了。
  // 两者的下一步完全不同（补素材 vs 重试），必须分开。
  const [loadError, setLoadError] = useState("")

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      setLoadError("")
      try {
        const qs = new URLSearchParams({ page: String(targetPage), perPage: String(PER_PAGE), mode: "thumbs" })
        if (q.trim()) qs.set("q", q.trim())
        if (category) qs.set("category", category)
        const data = await apiFetch<MaterialListResult>(`/api/materials?${qs.toString()}`)
        setTotal(data.totalItems ?? 0)
        setItems((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]))
        setPage(targetPage)
      } catch (e) {
        // 保留已加载的图（翻页失败不该把前面看过的清空）
        setLoadError(e instanceof Error ? e.message : "加载失败")
      } finally {
        setLoaded(true)
        setLoading(false)
      }
    },
    [q, category],
  )

  // 打开/筛选变化 → 延迟一拍拉取（顺带防抖；清理函数取消上一次未触发的请求）
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => void load(1), 0)
    return () => clearTimeout(t)
  }, [open, load])

  const pick = async (id: string) => {
    setPickingId(id)
    try {
      if (await onPick(id)) onOpenChange(false)
    } finally {
      setPickingId("")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] w-[94vw] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>从素材库选图</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void load(1) }}
              placeholder="搜素材名 / 标签（如：医院走廊、HIS 架构）…"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">全部分类</option>
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => void load(1)}>
            {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
            筛选
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-3">
          {loadError ? (
            <div className="py-10 text-center">
              <PackageOpen className="mx-auto mb-2 h-7 w-7 text-destructive/70" />
              <div className="text-sm font-medium text-destructive">素材没加载出来（不是「库里没有」）</div>
              <div className="mt-1 text-xs text-muted-foreground">技术原因：{loadError}</div>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void load(page)}>
                重试
              </Button>
              <div className="mt-2 text-[11px] text-muted-foreground">
                修不好也可以继续用「联网搜图」兜底，不影响本次插图
              </div>
            </div>
          ) : loaded && items.length === 0 ? (
            <div className="py-12 text-center">
              <PackageOpen className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                素材库为空或未命中 —— 可先到「素材库」页导入，或继续用联网搜图兜底。
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  disabled={pickingId !== ""}
                  onClick={() => void pick(it.id)}
                  className="group overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-shadow hover:shadow-md disabled:opacity-60"
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
                    {it.thumb_data ? (
                      <img src={it.thumb_data} alt={it.name} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <PackageOpen className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="p-2">
                    <div className="truncate text-xs font-medium text-foreground" title={it.name}>{it.name}</div>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="truncate">{it.category}</span>
                      <span>·</span>
                      <span>{MATERIAL_SOURCE_LABELS[it.source]}</span>
                      {pickingId === it.id ? <Loader2 className="ml-auto h-3 w-3 animate-spin" /> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
          <span>已载 {items.length}/{total} 张（点击即插入本页，原图内嵌导出）</span>
          {items.length < total ? (
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load(page + 1)}>
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              加载更多
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
