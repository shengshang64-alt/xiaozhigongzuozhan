import { CalendarClock, Check, ChevronRight, Inbox, X } from "lucide-react"
import type { DailyIntelSelection } from "@/pages/IntelCenter/intelDaily"
import { intelDeadlineKind } from "@/pages/IntelCenter/intelDaily"
import type { IntelItemRow } from "@/pages/IntelCenter/useIntelCenter"

type Props = {
  work: DailyIntelSelection
  onOpenDetail: (item: IntelItemRow) => void
  onConfirm: (item: IntelItemRow) => void
  onIgnore: (item: IntelItemRow) => void
}

function deadlineLabel(item: IntelItemRow): { text: string; className: string } {
  const kind = intelDeadlineKind(item.structured?.deadline ?? "")
  if (kind === "overdue") return { text: "已逾期", className: "bg-destructive/10 text-destructive" }
  if (kind === "today") return { text: "今天截止", className: "bg-destructive/10 text-destructive" }
  if (kind === "week") return { text: "7天内截止", className: "bg-warning/10 text-warning" }
  return { text: "截止", className: "bg-muted text-muted-foreground" }
}

export function IntelDailyBrief({ work, onOpenDetail, onConfirm, onIgnore }: Props) {
  return (
    <section className="rounded-xl border border-primary/25 bg-card shadow-md" aria-label="今日工作">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">今日工作</h2>
        <span className="text-xs text-muted-foreground">按截止时间、关注方向与来源可信度排序，非 AI 生成</span>
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">必看 {work.top.length}</span>
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">临期 {work.deadlines.length}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">待分诊 {work.pendingCount}</span>
        </div>
      </header>

      <div className="grid lg:grid-cols-2">
        <div className="border-b border-border p-3 lg:border-b-0 lg:border-r">
          <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">今日必看 · 处理一条少一条</h3>
          {work.top.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-5 text-xs text-muted-foreground">
              <Inbox className="h-4 w-4" /> 当前筛选下没有待分诊情报
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {work.top.map((item) => (
                <li key={item.id} className="group flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(item)}
                      className="line-clamp-2 text-left text-sm font-medium leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {item.title}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(item.priority_reason ?? []).map((reason) => (
                        <span key={reason} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{reason}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onConfirm(item)}
                      title="确认并移出待分诊"
                      className="rounded p-1 text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onIgnore(item)}
                      title="忽略并移出待分诊"
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-3">
          <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">未来 7 天截止 · 含近 7 天已逾期</h3>
          {work.deadlines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-5 text-xs leading-relaxed text-muted-foreground">
              当前筛选下没有已识别的临期截止；未抽到截止时间的招标条目不会误报，可先用「修复数据」补齐要素。
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {work.deadlines.map((item) => {
                const badge = deadlineLabel(item)
                return (
                  <li key={item.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(item)}
                      className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] ${badge.className}`}>{badge.text}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors hover:text-primary">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {item.structured?.buyer ? `${item.structured.buyer} · ` : ""}{item.structured?.deadline}
                        </span>
                      </span>
                      <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
