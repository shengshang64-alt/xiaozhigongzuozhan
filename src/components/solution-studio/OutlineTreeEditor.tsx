import { useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { OutlineNode, OutlinePart } from "@/pages/SolutionStudio/solutionTypes"

type OutlineTreeEditorProps = {
  nodes: OutlineNode[]
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onAddChild: (parentId: string, depth: number) => void
  onAddRoot: () => void
  /** 标书第十三轮：顶层章「商务/技术」归属切换（方案编制页不传则不显示徽标） */
  onSetPart?: (id: string, part: OutlinePart) => void
}

function NodeRow({
  node,
  depth,
  prefix,
  index,
  onRename,
  onRequestDelete,
  onMove,
  onAddChild,
  onSetPart,
}: {
  node: OutlineNode
  depth: number
  prefix: string
  index: number
  onRename: OutlineTreeEditorProps["onRename"]
  onRequestDelete: (id: string, title: string) => void
  onMove: OutlineTreeEditorProps["onMove"]
  onAddChild: OutlineTreeEditorProps["onAddChild"]
  onSetPart?: OutlineTreeEditorProps["onSetPart"]
}) {
  const no = prefix ? `${prefix}.${index + 1}` : `${index + 1}`
  const isBiz = depth === 0 && node.part === "biz"
  return (
    <li>
      <div
        className={`group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-secondary/60 ${
          depth === 0 ? "mt-1" : ""
        }`}
      >
        <span
          className={`w-10 shrink-0 text-right font-mono text-xs ${
            depth === 0 ? "font-semibold text-primary" : "text-muted-foreground"
          }`}
        >
          {no}
        </span>
        <input
          value={node.title}
          onChange={(e) => onRename(node.id, e.target.value)}
          className={`min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-background focus:shadow-[var(--focus-ring)] ${
            depth === 0 ? "text-sm font-medium" : "text-sm"
          }`}
        />
        {depth === 0 && onSetPart && (
          <button
            type="button"
            title={isBiz ? "当前为商务骨架章（只列小节、线下填写），点击切换为技术章" : "当前为技术章（生成详细正文），点击切换为商务骨架章"}
            onClick={() => onSetPart(node.id, isBiz ? "tech" : "biz")}
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isBiz ? "bg-muted text-muted-foreground hover:bg-secondary" : "bg-primary/10 text-primary hover:bg-primary/20"
            }`}
          >
            {isBiz ? "商务·线下填写" : "技术"}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <button type="button" title="上移" onClick={() => onMove(node.id, -1)} className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="下移" onClick={() => onMove(node.id, 1)} className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          {depth < 2 && (
            <button type="button" title="添加下级" onClick={() => onAddChild(node.id, depth + 1)} className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-primary">
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" title="删除" onClick={() => onRequestDelete(node.id, node.title)} className="rounded-sm p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {node.children?.length > 0 && (
        <ul className={`${depth === 0 ? "ml-4 border-l border-border pl-2" : "ml-4"}`}>
          {node.children.map((child, i) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              prefix={no}
              index={i}
              onRename={onRename}
              onRequestDelete={onRequestDelete}
              onMove={onMove}
              onAddChild={onAddChild}
              onSetPart={onSetPart}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function OutlineTreeEditor({ nodes, onRename, onRemove, onMove, onAddChild, onAddRoot, onSetPart }: OutlineTreeEditorProps) {
  // 删除大纲节点（含其下级）前走模态确认，确认状态挂在顶层
  const [pendingRemoveNode, setPendingRemoveNode] = useState<{ id: string; title: string } | null>(null)
  const requestDelete = (id: string, title: string) => setPendingRemoveNode({ id, title })
  return (
    <div className="rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 items-center justify-between border-b border-border px-4">
        <div>
          <p className="text-sm font-semibold text-foreground">方案大纲</p>
          <p className="text-xs text-muted-foreground">可直接改名、增删、上下移动，确认后开始生成正文</p>
        </div>
        <button
          type="button"
          onClick={onAddRoot}
          className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          添加章
        </button>
      </div>
      <ul className="max-h-96 overflow-y-auto p-3">
        {nodes.length === 0 ? (
          <li className="rounded-md border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            大纲为空，点右上角「添加章」手动搭建
          </li>
        ) : (
          nodes.map((n, i) => (
            <NodeRow
              key={n.id}
              node={n}
              depth={0}
              prefix=""
              index={i}
              onRename={onRename}
              onRequestDelete={requestDelete}
              onMove={onMove}
              onAddChild={onAddChild}
              onSetPart={onSetPart}
            />
          ))
        )}
      </ul>
      <ConfirmDialog
        open={Boolean(pendingRemoveNode)}
        onOpenChange={(o) => {
          if (!o) setPendingRemoveNode(null)
        }}
        title="删除大纲节点"
        description={pendingRemoveNode ? `确定删除「${pendingRemoveNode.title}」吗？其下级节点将一并删除，且不可恢复。` : ""}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (pendingRemoveNode) onRemove(pendingRemoveNode.id)
          setPendingRemoveNode(null)
        }}
      />
    </div>
  )
}
