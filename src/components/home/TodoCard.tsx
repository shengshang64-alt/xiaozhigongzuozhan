import { useState } from "react"
import { Link } from "react-router-dom"
import { CalendarClock, CheckCircle2, ChevronDown, Circle, ExternalLink, ListTodo, Loader2, Plus, Trash2, Undo2 } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { TodoBucketView, TodoItem } from "@/pages/Home/useHome"

type TodoCardProps = {
  buckets: TodoBucketView[]
  todosLoading: boolean
  todoInput: string
  setTodoInput: (value: string) => void
  todoDueDate: string
  setTodoDueDate: (value: string) => void
  addTodo: () => void
  todoAdding: boolean
  toggleTodo: (item: TodoItem) => void
  deleteTodo: (item: TodoItem) => void
  pendingTodoCount: number
  overdueTodoCount: number
  /** C2：拉满 200 条上限时为 true，列表底部显示截断提示行 */
  todosCapped: boolean
}

function bucketChipClass(key: string): string {
  // 徽标语义四档（全站设计规范 v1）：逾期=danger，今天/明天=warning，其余=neutral
  if (key === "overdue") return "badge-danger"
  if (key === "today" || key === "tomorrow") return "badge-warning"
  return "badge-neutral"
}

export function TodoCard({
  buckets,
  todosLoading,
  todoInput,
  setTodoInput,
  todoDueDate,
  setTodoDueDate,
  addTodo,
  todoAdding,
  toggleTodo,
  deleteTodo,
  pendingTodoCount,
  overdueTodoCount,
  todosCapped,
}: TodoCardProps) {
  const [pendingDeleteTodo, setPendingDeleteTodo] = useState<TodoItem | null>(null)
  // 折叠覆盖态：未手动操作过的桶按 defaultOpen（今天与逾期默认展开，其余收起带计数）
  const [collapseOverride, setCollapseOverride] = useState<Record<string, boolean>>({})

  const toggleBucket = (key: string, currentOpen: boolean) => {
    setCollapseOverride((prev) => ({ ...prev, [key]: !currentOpen }))
  }

  const totalVisible = buckets.reduce((acc, b) => acc + b.items.length, 0)

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">待办事项</h2>
        <span className="flex shrink-0 items-center gap-1.5">
          {overdueTodoCount > 0 ? <span className="badge-danger">逾期 {overdueTodoCount}</span> : null}
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {pendingTodoCount} 项待处理
          </span>
        </span>
      </header>

      <div className="mt-3 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={todoInput}
          onChange={(e) => setTodoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (!todoAdding) addTodo()
            }
          }}
          placeholder="输入待办内容，回车即添加"
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <div className="flex shrink-0 items-center gap-2">
          <label className="relative flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-primary">
            <CalendarClock className="h-4 w-4 shrink-0" />
            <input
              type="date"
              value={todoDueDate}
              onChange={(e) => setTodoDueDate(e.target.value)}
              aria-label="到期日（可留空）"
              className="h-full bg-transparent text-sm text-foreground focus-visible:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={addTodo}
            disabled={todoAdding}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {todoAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {todoAdding ? "添加中…" : "添加"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex-1">
        {todosLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            待办加载中…
          </div>
        ) : totalVisible === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
            <ListTodo className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              还没有待办
            </p>
            <p className="text-xs text-muted-foreground">
              在上方输入内容，可顺便设个到期日，回车即可添加
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {buckets.map((bucket) => {
              const open = collapseOverride[bucket.key] ?? bucket.defaultOpen
              return (
                <div key={bucket.key} className="rounded-lg border border-border bg-background shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleBucket(bucket.key, open)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
                    />
                    <span className="text-sm font-semibold text-foreground">{bucket.label}</span>
                    <span className={`ml-auto ${bucketChipClass(bucket.key)}`}>{bucket.items.length}</span>
                  </button>
                  {open ? (
                    <ul className="flex flex-col gap-1.5 border-t border-border p-2">
                      {bucket.items.map((item) => (
                        <li
                          key={item.id}
                          className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md"
                        >
                          <button
                            type="button"
                            onClick={() => toggleTodo(item)}
                            aria-label={item.done ? "撤销完成" : "标记为完成"}
                            className="shrink-0 rounded-full text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {item.done ? (
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                            ) : (
                              <Circle className="h-5 w-5" />
                            )}
                          </button>
                          <span className="min-w-0 flex-1">
                            <span
                              className={
                                item.done
                                  ? "block truncate text-sm text-muted-foreground line-through"
                                  : "block truncate text-sm text-foreground"
                              }
                            >
                              {item.content}
                            </span>
                            {item.due_date ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                到期 {String(item.due_date).slice(0, 10)}
                              </span>
                            ) : null}
                            {item.link ? (
                              <Link
                                to={item.link}
                                className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                <ExternalLink className="h-3 w-3" />
                                来自商机，查看
                              </Link>
                            ) : null}
                          </span>
                          {item.done ? (
                            <span className="flex shrink-0 items-center gap-1">
                              <span className="badge-success hidden sm:inline-flex">已完成</span>
                              <button
                                type="button"
                                onClick={() => toggleTodo(item)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                                撤销
                              </button>
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setPendingDeleteTodo(item)}
                            aria-label="删除待办"
                            className="shrink-0 rounded-full p-1 text-muted-foreground opacity-60 transition-opacity hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
            {todosCapped ? (
              <p className="pt-1 text-center text-xs text-muted-foreground">仅显示最近 200 条待办</p>
            ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteTodo)}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteTodo(null)
        }}
        title="删除待办"
        description={pendingDeleteTodo ? `确定删除「${pendingDeleteTodo.content}」吗？删除后不可恢复。` : ""}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (pendingDeleteTodo) deleteTodo(pendingDeleteTodo)
          setPendingDeleteTodo(null)
        }}
      />
    </section>
  )
}
