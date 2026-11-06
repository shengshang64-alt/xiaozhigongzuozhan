import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileUp, ListPlus, Loader2, Plus, ShieldCheck, type LucideIcon } from "lucide-react"

// Phase 1 改版：首屏高频入口统一收拢到这里（原 WelcomeBanner 的两个按钮也一并收编）。
// 「添加待办」是本页原 TodoCard 的快速入口：就地展开一行输入（复用 useHome 的
// addTodo / todoAdding 状态与成功失败 toast），不再弹模态框打断视线。

type QuickAction = {
  key: string
  label: string
  hint: string
  icon: LucideIcon
}

const ACTIONS: QuickAction[] = [
  { key: "opp", label: "新建商机", hint: "客户管理", icon: Plus },
  { key: "bid", label: "导入招标文件", hint: "标书工作台", icon: FileUp },
  { key: "qual", label: "查询资质", hint: "资质台账", icon: ShieldCheck },
  { key: "todo", label: "添加待办", hint: "就地记录", icon: ListPlus },
]

type QuickActionButtonsProps = {
  /** 待办快捷输入：与首页待办卡共享同一份 useHome 状态（一处添加、两处可见） */
  todoInput: string
  setTodoInput: (v: string) => void
  todoDueDate: string
  setTodoDueDate: (v: string) => void
  addTodo: () => void
  todoAdding: boolean
}

export function QuickActionButtons({
  todoInput,
  setTodoInput,
  todoDueDate,
  setTodoDueDate,
  addTodo,
  todoAdding,
}: QuickActionButtonsProps) {
  const navigate = useNavigate()
  const [todoOpen, setTodoOpen] = useState(false)

  const handleAction = (key: string) => {
    if (key === "opp") navigate("/customer-management")
    else if (key === "bid") navigate("/bid-workspace")
    else if (key === "qual") navigate("/qual-certs")
    else setTodoOpen((prev) => !prev)
  }

  return (
    <section aria-label="快捷操作" className="mb-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ACTIONS.map((action) => {
          const expanded = action.key === "todo" && todoOpen
          return (
            <button
              key={action.key}
              type="button"
              onClick={() => handleAction(action.key)}
              aria-expanded={action.key === "todo" ? expanded : undefined}
              className={`flex items-center gap-3 rounded-xl border-2 border-dashed p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                expanded
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-card hover:border-primary/40 hover:bg-secondary/60"
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <action.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{action.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{action.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      {todoOpen ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault()
            addTodo()
          }}
        >
          <input
            type="text"
            value={todoInput}
            onChange={(e) => setTodoInput(e.target.value)}
            placeholder="要做什么？回车即可保存"
            aria-label="待办内容"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            type="date"
            value={todoDueDate}
            onChange={(e) => setTodoDueDate(e.target.value)}
            aria-label="截止日期（可选）"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="submit"
            disabled={todoAdding || !todoInput.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {todoAdding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            添加
          </button>
        </form>
      ) : null}
    </section>
  )
}
