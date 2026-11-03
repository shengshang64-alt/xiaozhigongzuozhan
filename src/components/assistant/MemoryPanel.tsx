import { useState } from "react"
import { Brain, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import {
  MEMORY_GROUPS,
  type MemoryGroup,
  type MemoryRow,
} from "@/lib/assistantCore"

type MemoryPanelProps = {
  memoryRows: MemoryRow[]
  onAdd: (group: MemoryGroup, content: string) => Promise<boolean>
  onUpdate: (row: MemoryRow, group: MemoryGroup, content: string) => Promise<boolean>
  onDelete: (row: MemoryRow) => void
}

export function MemoryPanel({ memoryRows, onAdd, onUpdate, onDelete }: MemoryPanelProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [addGroup, setAddGroup] = useState<MemoryGroup>("preference")
  const [addContent, setAddContent] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editGroup, setEditGroup] = useState<MemoryGroup>("preference")
  const [editContent, setEditContent] = useState("")
  const [pendingDeleteMemory, setPendingDeleteMemory] = useState<MemoryRow | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [editBusy, setEditBusy] = useState(false)

  const submitAdd = async () => {
    if (addBusy) return
    setAddBusy(true)
    try {
      const ok = await onAdd(addGroup, addContent)
      if (ok) {
        setAddContent("")
        setAddOpen(false)
      }
    } finally {
      setAddBusy(false)
    }
  }

  const startEdit = (row: MemoryRow) => {
    setEditingId(row.id)
    setEditGroup((row.memory_group as MemoryGroup) ?? "fact")
    setEditContent(row.content)
  }

  const submitEdit = async (row: MemoryRow) => {
    if (editBusy) return
    setEditBusy(true)
    try {
      const ok = await onUpdate(row, editGroup, editContent)
      if (ok) setEditingId(null)
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-xs leading-relaxed text-muted-foreground">
        小智会在对话中自动记住你的偏好和习惯，也可以在这里手动管理。
      </p>

      <button
        type="button"
        onClick={() => setAddOpen((v) => !v)}
        className="mb-3 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/50 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        手动添加记忆
      </button>

      {addOpen ? (
        <div className="mb-3 shrink-0 rounded-lg border border-border bg-background p-2.5 shadow-sm">
          <div className="mb-2 flex w-fit gap-1 rounded-full bg-muted p-0.5">
            {MEMORY_GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setAddGroup(g.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  addGroup === g.key
                    ? "bg-card font-medium text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <textarea
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            rows={2}
            placeholder="例如：回复尽量用表格汇总，先给结论再给依据"
            aria-label="记忆内容"
            className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submitAdd()}
              disabled={addBusy}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {addBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              保存
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {MEMORY_GROUPS.map((g) => {
          const rows = memoryRows.filter((m) => m.memory_group === g.key)
          return (
            <section key={g.key} className="mb-4">
              <header className="mb-1.5 flex items-baseline justify-between">
                <h4 className="text-xs font-semibold text-foreground">{g.label}</h4>
                <span className="text-xs text-muted-foreground">{rows.length} 条</span>
              </header>
              {rows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                  {g.desc}（暂无）
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {rows.map((row) => (
                    <li
                      key={row.id}
                      className="group rounded-lg border border-border bg-background px-2.5 py-2 shadow-sm"
                    >
                      {editingId === row.id ? (
                        <div>
                          <div className="mb-1.5 flex w-fit gap-1 rounded-full bg-muted p-0.5">
                            {MEMORY_GROUPS.map((gg) => (
                              <button
                                key={gg.key}
                                type="button"
                                onClick={() => setEditGroup(gg.key)}
                                className={`rounded-full px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                  editGroup === gg.key
                                    ? "bg-card font-medium text-primary shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {gg.label}
                              </button>
                            ))}
                          </div>
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={2}
                            aria-label="编辑记忆内容"
                            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                          <div className="mt-1.5 flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              aria-label="取消编辑"
                              className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void submitEdit(row)}
                              aria-label="保存编辑"
                              disabled={editBusy}
                              className="rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              {editBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5">
                          <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">{row.content}</p>
                          {row.source === "auto" ? (
                            <span className="badge-neutral inline-flex shrink-0 items-center gap-0.5">
                              <Brain className="h-2.5 w-2.5" />
                              对话沉淀
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label="编辑记忆"
                            onClick={() => startEdit(row)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label="删除记忆"
                            onClick={() => setPendingDeleteMemory(row)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteMemory)}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteMemory(null)
        }}
        title="删除记忆"
        description="确定删除这条记忆吗？删除后小智将不再记得该内容，且不可恢复。"
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (pendingDeleteMemory) onDelete(pendingDeleteMemory)
          setPendingDeleteMemory(null)
        }}
      />
    </div>
  )
}
