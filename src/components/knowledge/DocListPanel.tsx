// 中栏文档列表：格式徽标 + 分类徽标 + 分类筛选 + 敏感/不进 AI 徽标 + 摘要首行 + 上传人 + 更新时间。
// 用户反馈轮（2026-09-17 晚）：批量管理模式（多选移动/改分类/删除）、行快捷操作（移动/删除弹窗入口）、
// 上传定位高亮（flashDocId）、搜索无结果清空动作。
import { ArrowUpDown, CheckSquare, FileText, FolderInput, Loader2, ShieldAlert, Square, Trash2, Upload, User, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { categoryOf, effectivePolicy, KB_CATEGORIES } from "@/lib/kbPolicy"
import type { DocSortKey, LibTab } from "@/pages/Knowledge/useKnowledge"
import type { KbTrashItem } from "@/pages/Knowledge/kbTrash"
import type { KbDocRow } from "@/lib/kbCore"

type DocListPanelProps = {
  sortedDocs: KbDocRow[]
  selectedDoc: KbDocRow | null
  selectDoc: (doc: KbDocRow | null) => void
  sortKey: DocSortKey
  setSortKey: (key: DocSortKey) => void
  docsLoading: boolean
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
}

const SORT_LABELS: Record<DocSortKey, string> = {
  updated: "最近更新",
  created: "最近上传",
  title: "按标题",
}

function formatTime(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "刚刚"
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function DocListPanel({
  sortedDocs,
  selectedDoc,
  selectDoc,
  sortKey,
  setSortKey,
  docsLoading,
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
}: DocListPanelProps) {
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const selectedCount = batchSelectedIds.length
  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-md">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="truncate text-sm font-semibold text-foreground">
          {searchQuery.trim() ? `搜索“${searchQuery.trim()}”` : "文档"}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{sortedDocs.length} 篇</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
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
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {docsLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在加载文档…
          </div>
        ) : sortedDocs.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {searchQuery.trim() ? "没有匹配的文档" : libTab === "team" ? "团队知识库还是空的" : "你还没有个人笔记"}
            </p>
            <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
              {searchQuery.trim()
                ? "换个关键词试试，或清空搜索浏览全部文档"
                : "上传 Obsidian 笔记（.md），或把整个笔记库打包成 zip 一次导入，目录结构会自动保留"}
            </p>
            {searchQuery.trim() ? (
              <Button size="sm" variant="outline" onClick={onClearSearch} className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary">
                <X className="h-3.5 w-3.5" />
                清空搜索
              </Button>
            ) : (
              <Button size="sm" onClick={openUpload} className="gap-1.5 bg-primary text-primary-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md">
                <Upload className="h-3.5 w-3.5" />
                上传第一批文档
              </Button>
            )}
          </div>
        ) : (
          sortedDocs.map((doc) => {
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
      {/* 循环 9 C1：最近删除本地回收桶弹层（仅本机可恢复，上限 20 条） */}
      <Dialog open={trashOpen} onOpenChange={(open) => !open && onCloseTrash()}>
        <DialogContent className="max-w-lg rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-lg text-foreground">最近删除</DialogTitle>
            <DialogDescription>
              已删除文档的快照仅保存在本机浏览器（最多最近 20 条）；恢复会新建一篇文档，彻底移除则从本列表删除。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {trashItems.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">暂无可恢复的文档</p>
            ) : (
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
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
