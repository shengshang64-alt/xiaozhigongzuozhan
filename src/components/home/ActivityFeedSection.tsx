import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  FileText,
  Loader2,
  Newspaper,
  Target,
  type LucideIcon,
} from "lucide-react"
import type { ActivityEvent, ActivityKind } from "@/hooks/useActivityFeed"

// 首页活动流 View：跨实体最新动态聚合，点击条目走深链跳转。

const KIND_ICONS: Record<ActivityKind, LucideIcon> = {
  customer: Building2,
  opportunity: Target,
  follow: CalendarCheck,
  bid: FileCheck2,
  solution: FileText,
  intel: Newspaper,
}

const COLLAPSED_LIMIT = 6

type ActivityFeedSectionProps = {
  events: ActivityEvent[]
  loading: boolean
}

export function ActivityFeedSection({ events, loading }: ActivityFeedSectionProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  // home-01：按可见签名去重合并（同 kind+标题+描述的重复条目只保留最新一条），再限高折叠
  const deduped = useMemo(() => {
    const seen = new Set<string>()
    const out: ActivityEvent[] = []
    for (const e of events) {
      const key = `${e.kind}|${e.title}|${e.desc}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
    return out
  }, [events])
  const visible = expanded ? deduped : deduped.slice(0, COLLAPSED_LIMIT)
  return (
    <section className="mb-5 rounded-xl border border-border bg-card shadow-md">
      <header className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Activity className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">最新动态</h2>
          <p className="truncate text-xs text-muted-foreground">客户、商机、跟进、标书、方案与情报的最新进展，点击直达详情</p>
        </div>
        <span className="ml-auto hidden shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline-flex">
          最近 {deduped.length} 条
        </span>
      </header>

      <div className="p-4">
        {loading && deduped.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            动态加载中…
          </div>
        ) : deduped.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <Activity className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              还没有业务动态
            </p>
            <p className="text-xs text-muted-foreground">
              录入客户、跟进商机或采集情报后，动态会实时汇总到这里
            </p>
          </div>
        ) : (
          <>
          <ul className="flex flex-col">
            {visible.map((event) => {
              const Icon = KIND_ICONS[event.kind] ?? Activity
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => navigate(event.route)}
                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {event.title}
                        <span className="ml-2 font-normal text-muted-foreground">{event.desc}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{event.timeLabel}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-primary" />
                  </button>
                </li>
              )
            })}
          </ul>
          {deduped.length > COLLAPSED_LIMIT && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-primary"
            >
              {expanded ? (
                <>
                  收起
                  <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  查看全部 {deduped.length} 条
                  <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}
          </>
        )}
      </div>
    </section>
  )
}
