// UX-R2: 素材库 已按 docs/ux-review-2026-11 修复 2026-11-07（单视图+动作面板/统计卡瘦身/空态四要素/使用排行）
// 素材库页（R-008）：素材总览 / 联网抓取 / 本地导入 / 库设置 四个 Tab。
// 风格沿用现有页面规范（max-w-6xl 版心 + shadcn Tabs + badge-* + sonner toast）。
// 授权链差异（需求提示词 §3a）：Pixabay License 允许 AI 生成内容；Pexels 条款 7B 明令禁止 —— 在联网抓取 Tab 明示。
import { useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  Download,
  FolderInput,
  Globe,
  ImagePlus,
  Loader2,
  PackageOpen,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatBytes } from "./materialCore"
import {
  MATERIAL_CATEGORIES,
  MATERIAL_SOURCE_LABELS,
  type InternalSourceConfig,
  type MaterialItem,
  type MaterialSource,
} from "./materialTypes"
import type { UseMaterialLibrary } from "./useMaterialLibrary"
import { getImageSearchKey } from "@/pages/PptQuote/imageSearch"

const SOURCE_OPTIONS: MaterialSource[] = ["manual", "internal", "pexels", "unsplash", "pixabay"]

// 联网抓取的预设场景词（需求提示词 §5 联网抓取 Tab）
const SCENE_PRESETS = ["医院外景", "智慧病房", "门诊大厅", "手术室", "机房", "医生沟通", "患者服务", "系统界面"]

const SOURCE_BADGE: Record<MaterialSource, string> = {
  manual: "badge-neutral",
  internal: "badge-warning",
  pexels: "badge-success",
  unsplash: "badge-success",
  pixabay: "badge-success",
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function MaterialCard({ it, onClick }: { it: MaterialItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
        {it.thumb_data ? (
          <img src={it.thumb_data} alt={it.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <PackageOpen className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="p-2.5">
        <div className="truncate text-sm font-medium text-foreground" title={it.name}>{it.name}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="badge-neutral">{it.category}</span>
          <span className={SOURCE_BADGE[it.source] || "badge-neutral"}>{MATERIAL_SOURCE_LABELS[it.source]}</span>
          {it.usage > 0 ? <span className="badge-neutral">已用 {it.usage} 次</span> : null}
        </div>
      </div>
    </button>
  )
}

/** 详情/编辑对话框：大图 + 元数据 + 授权链 + 编辑（编辑态用 key 重挂载初始化，不走 effect 回填） */
function DetailDialog({ p }: { p: UseMaterialLibrary }) {
  const it = p.detail
  if (!it) return null
  return (
    <Dialog open onOpenChange={(open) => { if (!open) p.setDetail(null) }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>素材详情</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
          <div className="flex max-h-[46vh] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {it.image_data || it.thumb_data ? (
              <img src={it.image_data || it.thumb_data} alt={it.name} className="max-h-[46vh] w-full object-contain" />
            ) : (
              <PackageOpen className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <DetailFields key={it.id} it={it} p={p} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DetailFields({ it, p }: { it: MaterialItem; p: UseMaterialLibrary }) {
  const [name, setName] = useState(it.name)
  const [category, setCategory] = useState(it.category)
  const [tagsText, setTagsText] = useState((it.tags || []).join("，"))
  const [note, setNote] = useState(it.note || "")
  const saveEdit = () => {
    void p.updateItem(it.id, {
      name: name.trim() || it.name,
      category,
      tags: tagsText.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 8),
      note,
    })
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">素材名</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">分类</div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MATERIAL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">标签（逗号分隔）</div>
        <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="医院，走廊" />
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">备注</div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className={SOURCE_BADGE[it.source] || "badge-neutral"}>{MATERIAL_SOURCE_LABELS[it.source]}</span>
          <span>{it.width}×{it.height}</span>
          <span>{formatBytes(it.bytes)}</span>
          <span>引用 {it.usage} 次</span>
        </div>
        <div className="mt-1 truncate">授权：{it.license || "—"}</div>
        {it.sourceUrl ? <div className="truncate" title={it.sourceUrl}>来源：{it.sourceUrl}</div> : null}
        {it.photographer ? <div>作者：{it.photographer}</div> : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={saveEdit}>保存修改</Button>
        {it.trashed ? (
          <Button size="sm" variant="outline" onClick={() => void p.restoreItem(it.id)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />恢复
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void p.trashItem(it.id)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />移入回收站
          </Button>
        )}
      </div>
    </div>
  )
}

/** 内部源区块（库设置 Tab 用）：地址未配置显示「未配置」，不报错不阻塞 */
function InternalSourceList({ p }: { p: UseMaterialLibrary }) {
  const [name, setName] = useState("公司共享盘素材")
  const [url, setUrl] = useState("")
  const addSource = () => {
    if (!url.trim()) return
    const src: InternalSourceConfig = {
      id: `internal_${Date.now().toString(36)}`,
      name: name.trim() || "内部源",
      type: "http-list",
      url: url.trim(),
      enabled: true,
    }
    p.upsertInternalSource(src)
    setUrl("")
  }
  return (
    <div className="space-y-2.5">
      {p.internalSources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          内部源未配置 —— 填写下方清单地址后可一键拉取公司共享素材（不影响其他功能）。
        </div>
      ) : (
        p.internalSources.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5">
            <span className="text-sm font-medium text-foreground">{s.name}</span>
            <span className="badge-neutral">http-list</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={s.url}>
              {s.url || "未配置"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!s.url || p.internalBusy === s.id}
              onClick={() => void p.importFromInternalSource(s)}
            >
              {p.internalBusy === s.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
              拉取入库
            </Button>
            <Button size="sm" variant="ghost" onClick={() => p.removeInternalSource(s.id)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))
      )}
      {p.internalProgress ? (
        <div className="text-xs text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          正在拉取 {p.internalProgress.done}/{p.internalProgress.total}…
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input className="w-44" value={name} onChange={(e) => setName(e.target.value)} placeholder="源名称" />
        <Input className="min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="清单地址（返回 [{name,url,tags?}] 的 JSON）" />
        <Button size="sm" variant="outline" onClick={addSource} disabled={!url.trim()}>
          <ImagePlus className="mr-1 h-3.5 w-3.5" />添加内部源
        </Button>
      </div>
    </div>
  )
}

/** 库设置 Tab：图库 Key（沿用 localStorage 机制）+ 内部源 + 清理/导出 */
function SettingsTab({ p }: { p: UseMaterialLibrary }) {
  const [keys, setKeys] = useState<Record<string, string>>({
    pexels: getImageSearchKey("pexels"),
    unsplash: getImageSearchKey("unsplash"),
    pixabay: getImageSearchKey("pixabay"),
  })
  // Phase 1（任务 1.3）：清空回收站改走全站统一 ConfirmDialog，替代原生 window.confirm
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false)
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-foreground">图库 API Key</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          存本机浏览器 localStorage（与 PPT 配图共用同一套 Key）。Pixabay 支持中文直搜，医疗场景优先。
        </p>
        <div className="space-y-2.5">
          {(["pixabay", "pexels", "unsplash"] as const).map((prov) => (
            <div key={prov} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-sm text-foreground">{MATERIAL_SOURCE_LABELS[prov]}</span>
              <Input
                className="min-w-0 flex-1"
                type="password"
                value={keys[prov]}
                onChange={(e) => setKeys((prev) => ({ ...prev, [prov]: e.target.value }))}
                placeholder={`${prov} API Key`}
              />
              <Button size="sm" variant="outline" onClick={() => p.setProviderKey(prov, keys[prov])}>保存</Button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-foreground">内部源</h3>
        <p className="mb-3 text-xs text-muted-foreground">公司自有素材清单（http-list：JSON [{`{name,url,tags?}`}]）。入库来源标「内部源」，授权默认「公司内部素材」。</p>
        <InternalSourceList p={p} />
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-foreground">存储与索引</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          素材存于服务端 material_library 集合（原图 + 400px 缩略图，按账号隔离，sha256 去重）。
          回收站 {p.stats?.trashed ?? 0} 条。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void p.exportIndex()}>
            <Download className="mr-1 h-3.5 w-3.5" />导出索引 JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!p.stats?.trashed}
            onClick={() => setPurgeConfirmOpen(true)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />清空回收站
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={purgeConfirmOpen}
        onOpenChange={setPurgeConfirmOpen}
        title="彻底删除回收站全部素材？"
        description={`共 ${p.stats?.trashed ?? 0} 条素材将被彻底删除，此操作不可恢复。`}
        confirmText="彻底删除"
        tone="danger"
        onConfirm={() => void p.purgeTrashed()}
      />
    </div>
  )
}

export function MaterialLibraryPage({ p }: { p: UseMaterialLibrary }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const detail = useMemo(() => p.detail, [p.detail])
  // UX-R2（docs/ux-review-2026-11 §十六）：四 Tab 收敛为单视图——素材网格常驻，
  // 「联网抓取 / 本地导入 / 库设置」改为右上角动作按钮，按需展开对应面板
  const [panel, setPanel] = useState<null | "web" | "import" | "settings">(null)
  const togglePanel = (key: "web" | "import" | "settings") => setPanel((prev) => (prev === key ? null : key))
  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">素材库</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            本地优先的售前素材中心：架构图 / 系统截图 / 现场照手工投放，氛围图联网抓取；PPT 生成时优先命中本地库，取不到再实时搜图。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={panel === "import" ? "default" : "outline"}
            onClick={() => togglePanel("import")}
            title="批量导入本地图片（架构图 / 系统截图 / 现场照）"
          >
            <FolderInput className="mr-1 h-3.5 w-3.5" />本地导入
          </Button>
          <Button
            size="sm"
            variant={panel === "web" ? "default" : "outline"}
            onClick={() => togglePanel("web")}
            title="联网抓取氛围图（Pixabay / Pexels / Unsplash）"
          >
            <Globe className="mr-1 h-3.5 w-3.5" />联网抓取
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => togglePanel("settings")}
            title="图库 API Key 与存储管理"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="sr-only">库设置</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void p.exportIndex()}>
            <Download className="mr-1 h-3.5 w-3.5" />导出索引
          </Button>
        </div>
      </header>

      {/* UX-R2：单视图——素材网格常驻，抓取/导入/设置为按需面板 */}
      <div className="space-y-4">
        {/* UX-R2：统计卡只留「素材总数」；回收站为 0 时整卡隐藏（统计卡纪律） */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="素材总数" value={String(p.stats?.total ?? 0)} hint={`磁盘占用 ${formatBytes(p.stats?.bytes ?? 0)} · 不含回收站`} />
          {(p.stats?.trashed ?? 0) > 0 ? <StatCard label="回收站" value={String(p.stats?.trashed ?? 0)} hint="软删除可恢复，见下方回收站视图" /> : null}
        </div>


          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" value={p.q} onChange={(e) => p.setQ(e.target.value)} placeholder="搜索素材名 / 标签…" />
            </div>
            <Select value={p.category || "all"} onValueChange={(v) => p.setCategory(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="全部分类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {MATERIAL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={p.source || "all"} onValueChange={(v) => p.setSource(v === "all" ? "" : v)}>
              <SelectTrigger className="w-32"><SelectValue placeholder="全部来源" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{MATERIAL_SOURCE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={p.trashedView ? "default" : "outline"}
              onClick={() => p.setTrashedView(!p.trashedView)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />回收站{p.stats?.trashed ? `（${p.stats.trashed}）` : ""}
            </Button>
          </div>

          {!p.itemsLoaded && p.itemsLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />素材加载中…
            </div>
          ) : p.items.length === 0 ? (
            p.trashedView ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center">
                <Trash2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">回收站为空</div>
                <div className="mt-1 text-xs text-muted-foreground">删除的素材会先进入回收站，可随时恢复。</div>
                <Button size="sm" variant="outline" className="mt-4" onClick={() => p.setTrashedView(false)}>
                  返回素材列表
                </Button>
              </div>
            ) : (
              /* UX-R2：空态四要素（图标 / 一句话 / 主行动双路径实体卡 / 次要帮助链接） */
              <div className="rounded-lg border border-dashed border-border p-10 text-center">
                <PackageOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">素材库还是空的</div>
                <div className="mt-1 text-xs text-muted-foreground">两条入库路径，选一条开始：</div>
                <div className="mx-auto mt-4 grid max-w-md gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => togglePanel("import")}
                    className="rounded-xl border-2 border-dashed border-border bg-background p-4 text-left transition-colors hover:border-primary/60 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <FolderInput className="mb-1.5 h-5 w-5 text-primary" />
                    <p className="text-sm font-semibold text-foreground">本地导入</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">架构图 / 系统截图 / 现场照批量入库</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePanel("web")}
                    className="rounded-xl border-2 border-dashed border-border bg-background p-4 text-left transition-colors hover:border-primary/60 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Globe className="mb-1.5 h-5 w-5 text-primary" />
                    <p className="text-sm font-semibold text-foreground">联网抓取</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">按场景词抓取氛围图，自动留档</p>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => togglePanel("settings")}
                  className="mt-4 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  抓图前先到「库设置」配置图库 API Key →
                </button>
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {p.items.map((it) => (
                  <MaterialCard key={it.id} it={it} onClick={() => void p.openDetail(it)} />
                ))}
              </div>

              {/* UX-R2：素材使用排行（按被引用次数 Top10；无引用数据则整块隐藏） */}
              {(() => {
                const top = [...p.items]
                  .filter((it) => !it.trashed && (it.usage ?? 0) > 0)
                  .sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0))
                  .slice(0, 10)
                if (top.length === 0) return null
                const max = top[0]?.usage ?? 1
                return (
                  <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-foreground">素材使用排行</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">按被 PPT / 方案引用次数排序（基于已加载素材）</p>
                    <ul className="mt-3 space-y-1.5">
                      {top.map((it, i) => (
                        <li key={it.id} className="flex items-center gap-2 text-xs">
                          <span className="w-4 shrink-0 text-center tabular-nums text-muted-foreground">{i + 1}</span>
                          <button
                            type="button"
                            onClick={() => void p.openDetail(it)}
                            className="min-w-0 flex-1 truncate text-left text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title={it.name}
                          >
                            {it.name}
                          </button>
                          <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(((it.usage ?? 0) / Math.max(max, 1)) * 100)}%` }} />
                          </span>
                          <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{it.usage} 次</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })()}

              {p.hasMore && (
                <div className="flex justify-center pt-2">
                  <Button size="sm" variant="outline" disabled={p.itemsLoading} onClick={p.loadMore}>
                    {p.itemsLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    加载更多（已载 {p.items.length}/{p.totalItems}）
                  </Button>
                </div>
              )}
            </>
          )}
        {panel === "web" ? (
          <div className="space-y-4 rounded-lg border border-primary/30 bg-card/60 p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">联网抓取</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="收起联网抓取面板" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={p.webProvider} onValueChange={(v) => p.setWebProvider(v as typeof p.webProvider)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pixabay">Pixabay</SelectItem>
                  <SelectItem value="pexels">Pexels</SelectItem>
                  <SelectItem value="unsplash">Unsplash</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="min-w-52 flex-1"
                value={p.webQuery}
                onChange={(e) => p.setWebQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void p.runWebSearch() }}
                placeholder={p.webProvider === "pixabay" ? "中文直搜，如：智慧病房" : "搜图关键词（中文自动映射英文）"}
              />
              <Button size="sm" disabled={p.webSearching} onClick={() => void p.runWebSearch()}>
                {p.webSearching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
                搜索
              </Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {SCENE_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void p.runWebSearch(s)}
                  className="badge-neutral transition-colors hover:bg-primary/10"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              {!p.hasWebKey ? "⚠️ 未配置当前图库 API Key，请到「库设置」填写（不影响本地导入）。" : null}
              {p.webProvider === "pexels" ? " 授权提示：Pexels 条款 7B 禁止上传 AI 生成内容；Pixabay 允许（需上传者打标签）。" : ""}
              {" "}入库图片自动落库到「05_图库素材」，授权说明与来源页链接强制留档。
            </p>
          </div>

          {p.webMessage ? (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">{p.webMessage}</div>
          ) : null}

          {p.webHits.length > 0 ? (
            <>
              {p.selectedUrls.length > 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
                  <span className="text-sm text-foreground">已选 {p.selectedUrls.length} 张</span>
                  <Button size="sm" disabled={!!p.savingUrl} onClick={() => void p.saveSelectedHits()}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />批量入库
                  </Button>
                  <Button size="sm" variant="ghost" onClick={p.clearSelection}>
                    <X className="mr-1 h-3.5 w-3.5" />取消选择
                  </Button>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {p.webHits.map((hit) => {
                  const saved = p.savedUrls[hit.url]
                  const selected = p.selectedUrls.includes(hit.url)
                  return (
                    <div key={hit.url} className={`overflow-hidden rounded-lg border bg-card shadow-sm ${selected ? "border-primary" : "border-border"}`}>
                      <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
                        <img src={hit.url} alt={hit.alt} loading="lazy" className="h-full w-full object-cover" />
                      </div>
                      <div className="space-y-1.5 p-2.5">
                        <div className="truncate text-xs text-muted-foreground" title={hit.alt}>{hit.alt || hit.url}</div>
                        <div className="flex items-center gap-1.5">
                          {saved ? (
                            <span className="badge-success">已入库</span>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!!p.savingUrl} onClick={() => void p.saveWebHit(hit)}>
                                {p.savingUrl === hit.url ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ImagePlus className="mr-1 h-3 w-3" />}
                                存入素材库
                              </Button>
                              <Button
                                size="sm"
                                variant={selected ? "default" : "ghost"}
                                className="h-7 px-2 text-xs"
                                onClick={() => p.toggleSelectUrl(hit.url)}
                              >
                                {selected ? "取消选" : "选中"}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
          </div>
        ) : null}

        {panel === "import" ? (
          <div className="space-y-4 rounded-lg border border-primary/30 bg-card/60 p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">本地导入</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="收起本地导入面板" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-1 text-sm font-semibold text-foreground">批量导入本地图片</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              命名规范：来源_内容_日期.jpg（如 pexels_医院走廊_20261008.jpg），日期段与扩展名自动剥除转为名称与标签；
              自动生成 400px 缩略图、按 sha256 去重（重复文件自动跳过）；单图上限 6MB，超限自动压缩。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={p.importCategory} onValueChange={p.setImportCategory}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATERIAL_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!!p.importProgress} onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="mr-1 h-3.5 w-3.5" />选择图片（可多选）
              </Button>
              {p.importProgress ? (
                <Button size="sm" variant="outline" onClick={p.cancelImport}>
                  <X className="mr-1 h-3.5 w-3.5" />取消
                </Button>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = [...(e.target.files || [])]
                  e.target.value = ""
                  if (files.length) void p.importFiles(files)
                }}
              />
            </div>
            {p.importProgress ? (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">正在入库：{p.importProgress.current}</span>
                  <span className="tabular-nums">{p.importProgress.done}/{p.importProgress.total}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round((p.importProgress.done / Math.max(p.importProgress.total, 1)) * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {p.importResult ? (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="text-foreground">
                  导入完成：新增 <b className="tabular-nums">{p.importResult.added}</b> / 重复{" "}
                  <b className="tabular-nums">{p.importResult.duplicated}</b> / 失败{" "}
                  <b className="tabular-nums">{p.importResult.failed.length}</b>
                </div>
                {p.importResult.failed.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-destructive">
                    {p.importResult.failed.slice(0, 8).map((f, i) => (
                      <li key={i} className="truncate">· {f.name}：{f.reason}</li>
                    ))}
                    {p.importResult.failed.length > 8 ? <li>… 共 {p.importResult.failed.length} 条失败</li> : null}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
        ) : null}

        {panel === "settings" ? (
          <div className="rounded-lg border border-primary/30 bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">库设置</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="收起库设置面板" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <SettingsTab p={p} />
          </div>
        ) : null}
      </div>

      <DetailDialog p={{ ...p, detail }} />
    </div>
  )
}
