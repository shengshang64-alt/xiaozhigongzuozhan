// 中栏文档列表：格式徽标 + 分类徽标 + 分类筛选 + 敏感/不进 AI 徽标 + 摘要首行 + 上传人 + 更新时间。
// 用户反馈轮（2026-09-17 晚）：批量管理模式（多选移动/改分类/删除）、行快捷操作（移动/删除弹窗入口）、
// 上传定位高亮（flashDocId）、搜索无结果清空动作。
import { ArrowUpDown, CheckSquare, Download, FileText, FolderInput, Loader2, ShieldAlert, Square, Trash2, Upload, User, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { categoryOf, effectivePolicy, KB_CATEGORIES } from "@/lib/kbPolicy"
import { EmptyState } from "@/components/common/DataStates"
import { exportToCsv } from "@/lib/exportCsv"
import { toast } from "sonner"
import { formatRelativeTime } from "@/lib/relativeTime"
import { localDateStamp } from "@/lib/dateStamp"
import type { DocSortKey, LibTab } from "@/pages/Knowledge/useKnowledge"
import type { KbTrashItem } from "@/pages/Knowledge/kbTrash"
import type { KbDocRow } from "@/lib/kbCore"
import { listDeletedKbDocs, notifyKbMutation, restoreKbDoc } from "@/lib/kbCore"

type DocListPanelProps = {
  sortedDocs: KbDocRow[]
  selectedDoc: KbDocRow | null
  selectDoc: (doc: KbDocRow | null) => void
  sortKey: DocSortKey
  setSortKey: (key: DocSortKey) => void
  docsLoading: boolean
  /** T9 渐进直显：全量列表仍在后台同步中（当前展示的是首批数据） */
  docsCalibrating: boolean
  libTab: LibTab
  searchQuery: string
  openUpload: () => void
  categoryFilter: string
  setCategoryFilter: (v: string) => void
  // 反馈轮：批量整理 + 行快捷 + 定位高亮
  batchMode: boolean
  batchSelectedIds: string[]
  batchBusy: boolean
  onToggleBatchMode: () => void
  onToggleBatchSelect: (docId: string) => void
  onClearBatchSelect: () => void
  onBatchMove: (folderPath: string) => void
  onBatchCategory: (category: string) => void
  onBatchDelete: () => void
  flashDocId: string | null
  allFolderPaths: string[]
  openDocAction: (mode: "rename" | "move" | "delete", doc: KbDocRow) => void
  canEditDoc: (doc: KbDocRow | null) => boolean
  onClearSearch: () => void
  // 循环 9 C1：最近删除本地回收桶入口与弹层
  trashCount: number
  onOpenTrash: () => void
  trashOpen: boolean
  onCloseTrash: () => void
  trashItems: KbTrashItem[]
  onRestoreTrash: (item: KbTrashItem) => void
  onPurgeTrash: (item: KbTrashItem) => void
  /** P1-7：服务端回收站恢复成功后刷新主列表（useKnowledge.refreshDocs） */
  onListRefresh?: () => void
}

/** 每窗渲染行数：约 3 屏高度，兼顾滚动流畅与 DOM 规模 */
const LIST_WINDOW = 60

const SORT_LABELS: Record<DocSortKey, string> = {
  updated: "最近更新",
  created: "最近上传",
  title: "按标题",
}

function formatTime(iso: string): string {
  return formatRelativeTime(iso, (d, _diff, day) =>
    day < 30
      ? `${day} 天前`
      : localDateStamp(d),
  )
}

export function DocListPanel({
  sortedDocs,
  selectedDoc,
  selectDoc,
  sortKey,
  setSortKey,
  docsLoading,
  docsCalibrating,
  libTab,
  searchQuery,
  openUpload,
  categoryFilter,
  setCategoryFilter,
  batchMode,
  batchSelectedIds,
  batchBusy,
  onToggleBatchMode,
  onToggleBatchSelect,
  onClearBatchSelect,
  onBatchMove,
  onBatchCategory,
  onBatchDelete,
  flashDocId,
  allFolderPaths,
  openDocAction,
  canEditDoc,
  onClearSearch,
  trashCount,
  onOpenTrash,
  trashOpen,
  onCloseTrash,
  trashItems,
  onRestoreTrash,
  onPurgeTrash,
  onListRefresh,
}: DocListPanelProps) {
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  // P1-7：服务端回收站状态——弹层打开时拉取软删除行；恢复成功后经 onKbMutation
  // （失效共享语料缓存）+ onListRefresh（主列表刷新）双通道同步。
  const [serverDeleted, setServerDeleted] = useState<KbDocRow[] | null>(null)
  const [serverDeletedLoading, setServerDeletedLoading] = useState(false)
  const [serverDeletedError, setServerDeletedError] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  useEffect(() => {
    if (!trashOpen) return
    // 微任务启动首拉：所有 setState 落在异步回调，规避 set-state-in-effect 保守告警（同 useBidCheck）
    void Promise.resolve().then(async () => {
      setServerDeletedLoading(true)
      setServerDeletedError(false)
      try {
        const rows = await listDeletedKbDocs()
        setServerDeleted(rows)
      } catch {
        setServerDeletedError(true)
      } finally {
        setServerDeletedLoading(false)
      }
    })
  }, [trashOpen])
  const handleRestoreServer = (row: KbDocRow) => {
    setRestoringId(row.id)
    void restoreKbDoc(row.id)
      .then((ok) => {
        if (ok) {
          setServerDeleted((prev) => (prev ?? []).filter((d) => d.id !== row.id))
          notifyKbMutation()
          onListRefresh?.()
          toast.success(`已恢复「${row.title}」`)
        } else {
          toast.error("恢复失败，请稍后重试")
        }
      })
      .catch(() => toast.error("恢复失败，请稍后重试"))
      .finally(() => setRestoringId(null))
  }
  const selectedCount = batchSelectedIds.length
  // T9 性能：窗口化渲染——一屏只挂 LIST_WINDOW 行，滚动到底自动续窗；
  // 2000+ 篇全量挂载时 5.7 万 DOM 节点会让整页交互卡死（质量台账 T9 实锤）。
  const [visibleCount, setVisibleCount] = useState(LIST_WINDOW)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const total = sortedDocs.length
  const firstId = sortedDocs[0]?.id ?? ""
  // 筛选/排序/切签或数据源整体替换（列表头变化）时重置窗口：
  // 采用 React 官方推荐的「渲染期调整状态」而非 effect 内 setState，避免级联渲染
  const filterKey = `${libTab}|${categoryFilter}|${sortKey}|${searchQuery}|${firstId}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setVisibleCount(LIST_WINDOW)
  }
  // 列表滚动位置随筛选条件复位（纯 DOM 操作，无 setState）
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [filterKey])
  // 上传定位高亮的文档落在窗口外时派生扩窗，保证 flash 可见（无 setState）
  const flashIdx = flashDocId ? sortedDocs.findIndex((d) => d.id === flashDocId) : -1
  const windowCount = flashIdx >= 0 ? Math.max(visibleCount, flashIdx + LIST_WINDOW) : visibleCount
  // 哨兵进入视口即续窗（IntersectionObserver 为浏览器原生能力，不引入新依赖）
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) setVisibleCount((v) => v + LIST_WINDOW)
      },
      { rootMargin: "400px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [windowCount, total])
  const listSlice = sortedDocs.slice(0, windowCount)
  const handleExportDocs = () => {
    const headers = ["标题", "分类", "所在目录", "上传人", "更新时间"]
    const rows = sortedDocs.map((d) => [
      d.title,
      d.doc_category || categoryOf(d) || "其他",
      d.folder_path || "",
      d.uploader_name || "",
      d.updated || "",
    ])
    exportToCsv(`知识库文档_${localDateStamp()}.csv`, headers, rows)
    // P3-3：导出语义明确化——按钮标签与结果反馈都说明「只有元数据」，消除「导出全文」的预期落差
    toast.info(`已导出 ${rows.length} 篇文档的元数据 CSV（标题/分类/目录/上传人/时间，不含正文）`)
  }

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-md lg:h-[calc(100vh-17rem)]">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="truncate text-sm font-semibold text-foreground">
          {searchQuery.trim() ? `搜索“${searchQuery.trim()}”` : "文档"}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{sortedDocs.length} 篇</span>
          {docsCalibrating ? (
            <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground" title="全量清单正在后台加载，可先浏览已加载部分">
              <Loader2 className="h-3 w-3 animate-spin" />
              后台同步中…
            </span>
          ) : null}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleExportDocs}
            disabled={sortedDocs.length === 0}
            title="导出当前列表的元数据 CSV（标题/分类/目录/上传人/更新时间，不含正文）"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            导出 CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenTrash}
            title="查看已删除文档快照，仅本机浏览器可恢复"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
            最近删除
            {trashCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{trashCount}</span>
            )}
          </Button>
          <Button
            size="sm"
            variant={batchMode ? "default" : "ghost"}
            onClick={onToggleBatchMode}
            disabled={batchBusy}
            title={batchMode ? "退出批量管理" : "多选文档后批量移动、改分类或删除"}
            className={`h-7 gap-1 px-2 text-xs ${batchMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {batchMode ? "退出批量" : "批量管理"}
          </Button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUpDown className="h-3.5 w-3.5" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="按分类筛选"
              className="h-7 max-w-24 cursor-pointer rounded-md border border-border bg-background px-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">全部分类</option>
              {KB_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as DocSortKey)}
              aria-label="文档排序方式"
              className="h-7 cursor-pointer rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {(Object.keys(SORT_LABELS) as DocSortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {batchMode ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-secondary/50 px-3 py-2">
          <span className="text-xs font-medium text-foreground">已选 {selectedCount} 篇</span>
          <select
            aria-label="批量移动到文件夹"
            disabled={batchBusy || selectedCount === 0}
            value=""
            onChange={(e) => {
              if (e.target.value !== "") onBatchMove(e.target.value === "__root__" ? "" : e.target.value)
            }}
            className="h-7 max-w-32 cursor-pointer rounded-md border border-border bg-background px-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">移动到…</option>
            <option value="__root__">根目录</option>
            {allFolderPaths.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            aria-label="批量修改分类"
            disabled={batchBusy || selectedCount === 0}
            value=""
            onChange={(e) => {
              if (e.target.value !== "") onBatchCategory(e.target.value)
            }}
            className="h-7 max-w-28 cursor-pointer rounded-md border border-border bg-background px-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">改分类…</option>
            {KB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={batchBusy || selectedCount === 0}
            onClick={() => setBatchDeleteOpen(true)}
            className="h-7 gap-1 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
          <Button size="sm" variant="ghost" disabled={batchBusy} onClick={onClearBatchSelect} className="h-7 px-2 text-xs text-muted-foreground">
            取消选择
          </Button>
          {batchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
        </div>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {docsLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在加载文档…
          </div>
        ) : sortedDocs.length === 0 ? (
          (() => {
            // 2026-11-04（R69 审计 P2-7）：空态原先只判 searchQuery，不看分类筛选。
            // 用户选了「合同商务」这类没有文档的分类 → 显示「团队知识库还是空的 / 上传第一批文档」，
            // 而左栏明明写着 2175 篇。这会让人以为库被清空了。
            // 现在按「哪些筛选条件生效」分别措辞，并给出对应的清除入口。
            const hasSearch = !!searchQuery.trim()
            const hasCategory = !!categoryFilter
            const filtered = hasSearch || hasCategory
            const title = filtered
              ? "当前筛选条件下没有文档"
              : libTab === "team"
                ? "团队知识库还是空的"
                : "你还没有个人笔记"
            const hint = filtered
              ? [hasSearch ? "搜索词" : "", hasCategory ? `分类「${categoryFilter}」` : ""]
                  .filter(Boolean)
                  .join(" + ") + " 一起把结果筛空了；清掉筛选即可看到全部文档"
              : "上传 Obsidian 笔记（.md），或把整个笔记库打包成 zip 一次导入，目录结构会自动保留"
            return (
              <EmptyState
                className="mt-6"
                title={title}
                hint={hint}
                icon={<FileText className="h-8 w-8 text-muted-foreground" />}
                action={
                  filtered ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onClearSearch()
                        setCategoryFilter("")
                      }}
                      className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                      清除筛选
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={openUpload}
                      className="gap-1.5 bg-primary text-primary-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      上传第一批文档
                    </Button>
                  )
                }
              />
            )
          })()
        ) : (
          listSlice.map((doc) => {
            const active = selectedDoc?.id === doc.id
            const checked = batchSelectedIds.includes(doc.id)
            const editable = canEditDoc(doc)
            const firstLine = (doc.summary || doc.content || "").replace(/\s+/g, " ").trim().slice(0, 60)
            const policy = effectivePolicy(doc)
            const category = categoryOf(doc)
            return (
              <div
                key={doc.id}
                className={`group relative block w-full rounded-lg border px-3 py-2.5 text-left transition-all ${
                  flashDocId === doc.id ? "ring-2 ring-primary/60" : ""
                } ${
                  active
                    ? "border-primary border-l-2 border-l-primary bg-primary/5 shadow-md"
                    : "border-border bg-background shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                }`}
              >
                <button
                  type="button"
                  // P2-5：显式 accessible name——渐进加载两阶段的名称计算曾出现回退
                  // （内容派生名称在加载完成后丢失），显式标注对屏幕阅读器与自动化测试都稳定
                  aria-label={`打开文档：${doc.title}${doc.folder_path ? `（${doc.folder_path}）` : ""}`}
                  onClick={() => (batchMode ? onToggleBatchSelect(doc.id) : selectDoc(doc))}
                  className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
                >
                  <span className="flex items-center gap-2">
                    {batchMode ? (
                      <span className="shrink-0 text-primary" aria-hidden>
                        {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs uppercase ${
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {doc.doc_format || "md"}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>
                      {doc.title}
                    </span>
                    {policy.is_sensitive ? (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        <ShieldAlert className="h-3 w-3" />
                        敏感
                      </span>
                    ) : null}
                    {policy.ai_context_mode === "blocked" ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        不进 AI
                      </span>
                    ) : null}
                  </span>
                  {firstLine ? <span className="mt-1.5 block truncate text-xs text-muted-foreground">{firstLine}</span> : null}
                  {/* 循环 10 小改 5：消费 keywords 字段——行内关键词徽标（最多 3 + 「+N」），搜索命中词加 primary 描边 */}
                  {doc.keywords && doc.keywords.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {doc.keywords.slice(0, 3).map((kw) => {
                        const q = searchQuery.trim()
                        const hit = q.length > 1 && kw.includes(q)
                        return (
                          <span
                            key={kw}
                            className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                              hit
                                ? "border border-primary/60 bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {kw}
                          </span>
                        )
                      })}
                      {doc.keywords.length > 3 && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          +{doc.keywords.length - 3}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="shrink-0 rounded-full border border-border bg-muted/50 px-1.5 py-0.5">{category}</span>
                    {doc.folder_path ? <span className="truncate">📁 {doc.folder_path}</span> : null}
                    {libTab === "team" && doc.uploader_name ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <User className="h-3 w-3" />
                        {doc.uploader_name}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0">{formatTime(doc.updated)}</span>
                  </span>
                </button>
                {!batchMode && editable ? (
                  <span className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      title="移动到文件夹"
                      onClick={() => openDocAction("move", doc)}
                      className="rounded-md border border-border bg-background p-1 text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <FolderInput className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="删除文档"
                      onClick={() => openDocAction("delete", doc)}
                      className="rounded-md border border-border bg-background p-1 text-muted-foreground shadow-sm hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : null}
              </div>
            )
          })
        )}
        {!docsLoading && sortedDocs.length > 0 && windowCount < sortedDocs.length ? (
          <div ref={sentinelRef} className="flex items-center justify-center py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setVisibleCount((v) => Math.max(v, windowCount) + LIST_WINDOW)}
              className="h-7 gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              加载更多 · 剩余 {sortedDocs.length - windowCount} 篇
            </Button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={(open) => {
          if (!batchBusy) setBatchDeleteOpen(open)
        }}
        title={`删除已选的 ${selectedCount} 篇文档？`}
        description="删除后索引同步移除，问知识库将不再检索这些文档。此操作不可恢复。"
        confirmText="确认删除"
        tone="danger"
        busy={batchBusy}
        onConfirm={() => {
          setBatchDeleteOpen(false)
          void onBatchDelete()
        }}
      />
      {/* P1-7：回收站弹层——本地快照（历史遗留）+ 服务端软删除行（团队删除均可恢复） */}
      <Dialog open={trashOpen} onOpenChange={(open) => !open && onCloseTrash()}>
        <DialogContent className="max-w-lg rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-lg text-foreground">最近删除</DialogTitle>
            <DialogDescription>
              已删除文档进入服务端回收站（团队全员可恢复，历史快照仅存本机）；恢复后文档回到主列表。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {/* P1-7：服务端回收站（软删除行） */}
            <p className="mb-1.5 text-xs font-medium text-foreground">服务端回收站</p>
            {serverDeletedLoading ? (
              <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> 加载中…
              </p>
            ) : serverDeletedError ? (
              <p className="py-4 text-center text-xs text-muted-foreground">回收站加载失败，可关闭后重试</p>
            ) : !serverDeleted || serverDeleted.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">回收站是空的</p>
            ) : (
              <ul className="mb-2 flex flex-col gap-1.5">
                {serverDeleted.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{d.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {d.updated ? `${formatTime(d.updated)}删除` : ""}
                        {d.folder_path ? ` · ${d.folder_path}` : ""}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoringId === d.id}
                      onClick={() => void handleRestoreServer(d)}
                      className="h-7 border-primary/40 px-2 text-xs text-primary hover:bg-primary/10"
                    >
                      {restoringId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      恢复
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {/* 本地快照（历史遗留通道，P1-4 前的删除记录） */}
            {trashItems.length > 0 ? (
              <>
                <p className="mb-1.5 mt-1 border-t border-border pt-2 text-xs font-medium text-muted-foreground">本机快照（历史记录）</p>
                <ul className="flex flex-col gap-1.5">
                  {trashItems.map((t) => (
                    <li key={t.trashed_at} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{t.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatTime(t.trashed_at)}删除
                          {t.folder_path ? ` · ${t.folder_path}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void onRestoreTrash(t)}
                          className="h-7 border-primary/40 px-2 text-xs text-primary hover:bg-primary/10"
                        >
                          恢复
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onPurgeTrash(t)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        >
                          彻底移除
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {trashItems.length === 0 && (serverDeleted?.length ?? 0) === 0 && !serverDeletedLoading && !serverDeletedError ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无可恢复的文档</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
