import { ArrowDown, ArrowUp, Plus, Presentation } from "lucide-react"
import type { Slide } from "@/pages/PptQuote/pptQuoteTypes"

type SlideListNavProps = {
  slides: Slide[]
  currentIndex: number
  onSelect: (index: number) => void
  onAdd: () => void
  onDelete: (index: number) => void
  onMove: (index: number, dir: -1 | 1) => void
  /** R166：导出前自检 warn 级命中页（0 基下标集合）；未传或空集合时不渲染任何徽标 */
  warnPages?: ReadonlySet<number>
}

export function SlideListNav({ slides, currentIndex, onSelect, onAdd, onDelete, onMove, warnPages }: SlideListNavProps) {
  return (
    <aside className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Presentation className="h-4 w-4 text-primary" />
          页面列表
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{slides.length}</span>
        </h3>
      </div>
      <div className="max-h-[560px] flex-1 space-y-1 overflow-y-auto p-2">
        {slides.map((slide, index) => {
          const active = index === currentIndex
          return (
            <div
              key={slide.id}
              className={
                active
                  ? "group rounded-md border border-primary bg-primary/5 px-2 py-1.5 transition-colors"
                  : "group rounded-md border border-transparent px-2 py-1.5 transition-colors hover:bg-secondary"
              }
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                <span
                  className={
                    active
                      ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                      : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                  }
                >
                  {index + 1}
                </span>
                <span className={active ? "min-w-0 flex-1 truncate text-sm font-medium text-foreground" : "min-w-0 flex-1 truncate text-sm text-muted-foreground"}>
                  {slide.title || "（未命名页）"}
                </span>
                {warnPages?.has(index) ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                    title="导出前自检：本页有需要处理的项"
                  />
                ) : null}
              </button>
              <div className="mt-0.5 flex items-center justify-end gap-0.5 opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  disabled={index === slides.length - 1}
                  onClick={() => onMove(index, 1)}
                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="删除本页"
                  onClick={() => onDelete(index)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          新增一页
        </button>
      </div>
    </aside>
  )
}
