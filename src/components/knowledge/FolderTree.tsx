// 左栏目录树：按 folder_path 层级展示，节点可新建/重命名/删除文件夹。
import { useState } from "react"
import { ChevronRight, ChevronsLeft, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FolderNode } from "@/pages/Knowledge/useKnowledge"

type FolderTreeProps = {
  folderTree: FolderNode
  activeFolderPath: string | null
  selectFolder: (path: string | null) => void
  openCreateFolder: (parentPath: string) => void
  openRenameFolder: (path: string) => void
  submitDeleteFolder: (path: string) => void
  onCollapse: () => void
}

function FolderRow({
  node,
  depth,
  activeFolderPath,
  selectFolder,
  openCreateFolder,
  openRenameFolder,
  askDelete,
}: {
  node: FolderNode
  depth: number
  activeFolderPath: string | null
  selectFolder: (path: string | null) => void
  openCreateFolder: (parentPath: string) => void
  openRenameFolder: (path: string) => void
  askDelete: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
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
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className={`shrink-0 rounded p-0.5 text-muted-foreground transition-transform ${hasChildren ? "" : "invisible"} ${expanded ? "rotate-90" : ""}`}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {active ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
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
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFolderPath={activeFolderPath}
              selectFolder={selectFolder}
              openCreateFolder={openCreateFolder}
              openRenameFolder={openRenameFolder}
              askDelete={askDelete}
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
}: FolderTreeProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const rootActive = activeFolderPath === null
  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-md">
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
        {folderTree.children.map((child) => (
          <FolderRow
            key={child.path}
            node={child}
            depth={0}
            activeFolderPath={activeFolderPath}
            selectFolder={selectFolder}
            openCreateFolder={openCreateFolder}
            openRenameFolder={openRenameFolder}
            askDelete={setPendingDelete}
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
