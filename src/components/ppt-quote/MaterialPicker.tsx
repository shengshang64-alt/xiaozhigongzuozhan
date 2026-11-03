import { useState } from "react"
import { Link } from "react-router-dom"
import { Check, FileText, FileCheck2, Loader2 } from "lucide-react"
import type { MaterialOption, MaterialRef } from "@/pages/PptQuote/pptQuoteTypes"

type MaterialPickerProps = {
  solutionOptions: MaterialOption[]
  bidOptions: MaterialOption[]
  loading: boolean
  value: MaterialRef | null
  onChange: (ref: MaterialRef | null) => void
}

export function MaterialPicker({ solutionOptions, bidOptions, loading, value, onChange }: MaterialPickerProps) {
  const [tab, setTab] = useState<"solution" | "bid">("solution")
  const options = tab === "solution" ? solutionOptions : bidOptions
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          从已有工作引入素材<span className="ml-2 text-xs font-normal text-muted-foreground">选填，取大纲与正文摘要作为生成材料</span>
        </p>
        <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setTab("solution")}
            className={
              tab === "solution"
                ? "rounded-full bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm"
                : "rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            方案编制
          </button>
          <button
            type="button"
            onClick={() => setTab("bid")}
            className={
              tab === "bid"
                ? "rounded-full bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm"
                : "rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            标书项目
          </button>
        </div>
      </div>

      {value && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-primary bg-primary/5 px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Check className="h-4 w-4 text-primary" />
            已选择：{value.name}
            <span className="text-xs text-muted-foreground">{value.type === "solution" ? "方案" : "标书项目"}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            取消引入
          </button>
        </div>
      )}

      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在加载素材列表…
          </p>
        ) : options.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              {tab === "solution" ? "还没有方案" : "还没有标书项目"}
            </p>
            <Link
              to={tab === "solution" ? "/solution-studio" : "/bid-workspace"}
              className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              去「{tab === "solution" ? "方案编制" : "标书工作"}」创建
            </Link>
          </div>
        ) : (
          options.map((opt) => {
            const selected = value?.type === opt.type && value?.id === opt.id
            const Icon = opt.type === "solution" ? FileText : FileCheck2
            return (
              <button
                key={`${opt.type}-${opt.id}`}
                type="button"
                onClick={() => onChange(selected ? null : { type: opt.type, id: opt.id, name: opt.name })}
                className={
                  selected
                    ? "flex w-full items-center gap-3 rounded-md border border-primary bg-primary/5 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    : "flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                }
              >
                <Icon className={selected ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 text-muted-foreground"} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{opt.name}</span>
                  {opt.desc && <span className="block truncate text-xs text-muted-foreground">{opt.desc}</span>}
                </span>
                {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
