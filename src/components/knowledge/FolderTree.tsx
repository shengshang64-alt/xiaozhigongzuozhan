// 左栏目录树：按 folder_path 层级展示，节点可新建/重命名/删除文件夹。
// P2-2（2026-10-25）：树内搜索（保留命中祖先链、搜索时强制展开）+ 展开状态记忆
// （localStorage 按 用户×库 分桶；未记忆的走默认规则：顶层展开、深层折叠）。
import { useCallback, useMemo, useState } from "react"
import { ChevronRight, ChevronsLeft, Folder, FolderOpen, FolderPlus, Pencil, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { filterFolderTree, readExpandedPrefs, writeExpandedPref } from "./folderTreeFilter"
import type { FolderNode } from "@/pages/Knowledge/useKnowledge"

type FolderTreeProps = {
  folderTree: FolderNode
  activeFolderPath: string | null
  selectFolder: (path: string | null) => void
  openCreateFolder: (parentPath: string) => void
  openRenameFolder: (path: string) => void
  submitDeleteFolder: (path: string) => void
  onCollapse: () => void
  /** 展开记忆的分桶键（建议 `${userId}:${libTab}`）；缺省用 "default" */
  storageScope?: string
}

function FolderRow({
  node,
  depth,
  activeFolderPath,
  selectFolder,
  openCreateFolder,
  openRenameFolder,
  askDelete,
  searchActive,
  initExpanded,
  onExpandChange,
}: {
  node: FolderNode
  depth: number
  activeFolderPath: string | null
  selectFolder: (path: string | null) => void
  openCreateFolder: (parentPath: string) => void
  openRenameFolder: (path: string) => void
  askDelete: (path: string) => void
  /** 搜索态：命中链路全部强制展开 */
  searchActive: boolean
  /** 非搜索态的展开初值（含记忆） */
  initExpanded: (path: string, depth: number) => boolean
  onExpandChange?: (path: string, expanded: boolean) => void
}) {
  const expandedInit = searchActive || initExpanded(node.path, depth)
  // T9 性能：默认仅顶层目录展开（depth===0 由 expandedInit 表达），深层子目录懒展开——
  // 数千篇笔记的旧笔记库全展开时整棵树会渲染上千节点，拖慢首屏与交互
  const [expanded, setExpanded] = useState(expandedInit)
  const active = activeFolderPath === node.path
  const hasChildren = node.children.length > 0
  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-1 text-sm transition-colors ${
          active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => selectFolder(node.path || null)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") selectFolder(node.path || null)
        }}
      >
        <button
          type="button"
          aria-label={expanded ? "收起" : "展开"}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => {
              const next = !v
              if (onExpandChange) onExpandChange(node.path, next)
              return next
            })
          }}
          className={`shrink-0 rounded p-0.5 text-muted-foreground transition-transform ${hasChildren ? "" : "invisible"} ${expanded ? "rotate-90" : ""}`}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {active ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate" title={node.path || node.label}>{node.label}</span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground group-hover:bg-background">{node.count}</span>
        <span className="flex shrink-0 items-center opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <button type="button" aria-label="新建子文件夹" onClick={(e) => { e.stopPropagation(); openCreateFolder(node.path) }} className="rounded p-0.5 text-muted-foreground hover:text-primary">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="重命名文件夹" onClick={(e) => { e.stopPropagation(); openRenameFolder(node.path) }} className="rounded p-0.5 text-muted-foreground hover:text-primary">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="删除文件夹" onClick={(e) => { e.stopPropagation(); askDelete(node.path) }} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {expanded && hasChildren ? (
        <div>
          {node.children.map((child) => (
            <FolderRow
              key={child.path + (searchActive ? "~s" : "")}
              node={child}
              depth={depth + 1}
              activeFolderPath={activeFolderPath}
              selectFolder={selectFolder}
              openCreateFolder={openCreateFolder}
              openRenameFolder={openRenameFolder}
              askDelete={askDelete}
              searchActive={searchActive}
              initExpanded={initExpanded}
              onExpandChange={searchActive ? undefined : onExpandChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function FolderTree({
  folderTree,
  activeFolderPath,
  selectFolder,
  openCreateFolder,
  openRenameFolder,
  submitDeleteFolder,
  onCollapse,
  storageScope = "default",
}: FolderTreeProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  // P2-2：树内搜索 + 展开记忆
  const [treeQuery, setTreeQuery] = useState("")
  const searching = treeQuery.trim().length > 0
  const expandedPrefs = useMemo(() => readExpandedPrefs(storageScope), [storageScope])
  const onExpandChange = useCallback(
    (path: string, expanded: boolean) => writeExpandedPref(storageScope, path, expanded),
    [storageScope],
  )
  const initExpanded = useCallback(
    (path: string, depth: number) =>
      expandedPrefs && path in expandedPrefs ? expandedPrefs[path] : depth === 0,
    [expandedPrefs],
  )
  const filteredTree = useMemo(() => filterFolderTree(folderTree, treeQuery), [folderTree, treeQuery])
  const matchCount = useMemo(() => {
    if (!searching) return 0
    let n = 0
    const walk = (node: FolderNode) => {
      for (const c of node.children) {
        n += 1
        walk(c)
      }
    }
    walk(filteredTree)
    return n
  }, [filteredTree, searching])
  const rootActive = activeFolderPath === null
  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-md lg:h-[calc(100vh-17rem)]">
      <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold text-foreground">目录</h2>
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCollapse}
            title="收起目录列，给列表和阅读区让出宽度"
            className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openCreateFolder("")} className="h-7 gap-1 text-xs text-primary hover:text-primary">
            <FolderPlus className="h-3.5 w-3.5" />
            新建
          </Button>
        </span>
      </header>
      <div className="shrink-0 px-2 pt-2">
        <label className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={treeQuery}
            onChange={(e) => setTreeQuery(e.target.value)}
            placeholder="搜索目录…"
            aria-label="搜索目录"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {searching ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">{matchCount} 个目录</span>
          ) : null}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div
          className={`mb-1 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
            rootActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
          }`}
          onClick={() => selectFolder(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") selectFolder(null)
          }}
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          <span className="flex-1">全部文档</span>
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{folderTree.count}</span>
        </div>
        {searching && filteredTree.children.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
            没有匹配的目录（搜索只过滤目录名，文档搜索请用上方列表搜索框）
          </p>
        ) : null}
        {filteredTree.children.map((child) => (
          <FolderRow
            key={child.path + (searching ? "~s" : "")}
            node={child}
            depth={0}
            searchActive={searching}
            activeFolderPath={activeFolderPath}
            selectFolder={selectFolder}
            openCreateFolder={openCreateFolder}
            openRenameFolder={openRenameFolder}
            askDelete={setPendingDelete}
            initExpanded={initExpanded}
            onExpandChange={searching ? undefined : onExpandChange}
          />
        ))}
        {folderTree.children.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
            还没有目录。上传 zip 整包会自动保留目录结构，也可以点「新建」手动建目录。
          </p>
        ) : null}
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除文件夹</DialogTitle>
            <DialogDescription>
              确定删除「{pendingDelete ?? ""}」吗？其中的文档不会被删除，会移动到上级目录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const path = pendingDelete
                setPendingDelete(null)
                if (path) void submitDeleteFolder(path)
              }}
            >
              删除文件夹
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
