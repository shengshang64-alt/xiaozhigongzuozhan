import { useNavigate } from "react-router-dom"
import { ArrowRight, FileCheck2 } from "lucide-react"
import { ACTIVE_WORK_KIND_LABEL, type ActiveWorkItem } from "@/pages/Home/activeWork"
import type { ActivityEvent } from "@/hooks/useActivityFeed"
import { PROGRESS_PANEL_LIMIT } from "@/pages/Home/homeLayout"

// Phase 1 改版：双栏紧凑进度面板——左「工作台进行中」（activeWork 前 5 项），
// 右「今日动态」（活动流里今天的更新）。完整列表仍在下方折叠区的
// ActiveWorkSection / ActivityFeedSection，这里只做速览，零新增请求。

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2 py-1" role="status">
      <span className="sr-only">正在加载…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-9 animate-pulse rounded-md bg-muted/70" />
      ))}
    </div>
  )
}

type CompactProgressPanelProps = {
  activeWork: ActiveWorkItem[]
  activeWorkTotal: number
  activeWorkLoading: boolean
  /** 已过滤为「今天」的活动流事件（homeLayout.eventsTodayOf） */
  todayEvents: ActivityEvent[]
  eventsLoading: boolean
}

export function CompactProgressPanel({
  activeWork,
  activeWorkTotal,
  activeWorkLoading,
  todayEvents,
  eventsLoading,
}: CompactProgressPanelProps) {
  const navigate = useNavigate()
  const workRows = activeWork.slice(0, PROGRESS_PANEL_LIMIT)
  const eventRows = todayEvents.slice(0, PROGRESS_PANEL_LIMIT)
  const workOverflow = Math.max(0, activeWork.length - workRows.length)
  return (
    <section aria-label="进度速览" className="mb-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-md">
        <header className="mb-3 flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">
            工作台进行中
            {activeWorkTotal > 0 ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                共 {activeWorkTotal} 项
              </span>
            ) : null}
          </h2>
        </header>
        {activeWorkLoading ? (
          <PanelSkeleton rows={3} />
        ) : workRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            各工作台暂无进行中事项，新建标书 / 方案 / PPT / 报价后会出现在这里
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {workRows.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => navigate(item.route)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {ACTIVE_WORK_KIND_LABEL[item.kind]}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.statusLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
            {workOverflow > 0 ? (
              <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
                另有 {workOverflow} 项，见下方「工作台进行中事项」
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-md">
        <header className="mb-3 flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">今日动态</h2>
          {eventRows.length > 0 ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{eventRows.length} 条</span>
          ) : null}
        </header>
        {eventsLoading ? (
          <PanelSkeleton rows={3} />
        ) : eventRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">今天还没有新动态，客户、商机与标书的更新会汇总到这里</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {eventRows.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => navigate(event.route)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={`${event.title} · ${event.desc}`}>
                    {event.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{event.timeLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
