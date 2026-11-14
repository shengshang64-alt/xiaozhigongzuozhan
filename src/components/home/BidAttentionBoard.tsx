// 工作台总览第一屏「标书要事」：距开标、还没写完、待回填结果。
// 自持拉取 bid_projects（与 BidNodesCard 同接口），投标节点 Tab 仍保留 60 天时间轴。
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { FileWarning } from "lucide-react"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import {
  BID_ATTENTION_HORIZON_DAYS,
  BID_ATTENTION_LIMIT,
  buildBidAttention,
  type BidAttentionItem,
  type BidAttentionRow,
} from "@/pages/Home/bidAttention"

function rhUid(): string {
  const h = vibexAuthHeaders() as Record<string, string>
  return h["X-Rh-User-Id"] || "local-user"
}

function daysLabel(item: BidAttentionItem, kind: "upcoming" | "pending" | "incomplete"): string {
  if (item.daysLeft == null) return kind === "incomplete" ? item.stageLabel : "未填开标日"
  if (kind === "upcoming") {
    if (item.daysLeft === 0) return "今天开标"
    return `还剩 ${item.daysLeft} 天`
  }
  if (kind === "pending") return `已过开标 ${Math.abs(item.daysLeft)} 天`
  if (item.daysLeft < 0) return `已过开标 ${Math.abs(item.daysLeft)} 天`
  if (item.daysLeft === 0) return "今天开标"
  return `还剩 ${item.daysLeft} 天`
}

function toneClass(item: BidAttentionItem, kind: "upcoming" | "pending" | "incomplete"): string {
  if (kind === "pending") return "text-destructive"
  if (item.daysLeft == null) return "text-muted-foreground"
  if (item.daysLeft <= 0) return "text-destructive"
  if (item.daysLeft <= 7) return "text-destructive"
  if (item.daysLeft <= 30) return "text-amber-600"
  return "text-muted-foreground"
}

function Column({
  title,
  items,
  empty,
  kind,
  onOpen,
}: {
  title: string
  items: BidAttentionItem[]
  empty: string
  kind: "upcoming" | "pending" | "incomplete"
  onOpen: (href: string) => void
}) {
  const shown = items.slice(0, BID_ATTENTION_LIMIT)
  const rest = items.length - shown.length
  return (
    <div className="min-w-0">
      <h4 className="mb-2 flex items-baseline justify-between gap-2 text-[13px] font-semibold text-foreground">
        <span>{title}</span>
        <span className="text-[11px] font-normal text-muted-foreground">{items.length} 项</span>
      </h4>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-2.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.href)}
                className="flex w-full min-w-0 flex-col rounded-md border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="truncate text-[12.5px] font-medium text-foreground" title={item.title}>
                  {item.title}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className={toneClass(item, kind)}>{daysLabel(item, kind)}</span>
                  {kind === "incomplete" ? <span>{item.chapterLine || item.stageLabel}</span> : null}
                  {kind === "pending" ? <span>{item.stageLabel}</span> : null}
                  {item.date && kind === "upcoming" ? <span className="font-mono">{item.date}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">还有 {rest} 项，打开项目后可继续处理</p>
      ) : null}
    </div>
  )
}

export function BidAttentionBoard({ todayMs }: { todayMs: number }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<BidAttentionRow[]>([])
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${getPocketBaseUrl()}/api/bid_projects?rh_user_id=${encodeURIComponent(rhUid())}&page=1&perPage=200`, {
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { items?: BidAttentionRow[] }) => {
        if (!alive) return
        setRows((data.items ?? []).filter((b) => !b.deleted_at))
        setLoading(false)
      })
      .catch(() => {
        if (alive) setHidden(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const lists = useMemo(
    () => buildBidAttention(rows, todayMs, BID_ATTENTION_HORIZON_DAYS),
    [rows, todayMs],
  )

  if (hidden) return null

  return (
    <section className="mb-5 rounded-xl border border-border bg-card p-4 shadow-md">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileWarning className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">标书要事</h3>
        <Link
          to="/?tab=calendar"
          className="text-[12px] text-primary hover:underline"
        >
          查看投标节点
        </Link>
      </header>
      {loading ? (
        <div
          className="grid gap-4 md:grid-cols-3"
          aria-busy="true"
          aria-label="标书要事加载中"
        >
          {["距开标", "还没写完", "待回填结果"].map((title) => (
            <div key={title} className="min-w-0">
              <h4 className="mb-2 flex items-baseline justify-between gap-2 text-[13px] font-semibold text-foreground">
                <span>{title}</span>
                <span className="h-3 w-8 animate-pulse rounded bg-muted/80" aria-hidden="true" />
              </h4>
              <div className="flex flex-col gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    aria-hidden="true"
                    className="h-[52px] animate-pulse rounded-md border border-border bg-muted/70"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Column
              title="距开标"
              items={lists.upcoming}
              empty={`未来 ${BID_ATTENTION_HORIZON_DAYS} 天没有开标项目`}
              kind="upcoming"
              onOpen={(href) => navigate(href)}
            />
            <Column
              title="还没写完"
              items={lists.incomplete}
              empty="没有进行中的编制项目"
              kind="incomplete"
              onOpen={(href) => navigate(href)}
            />
            <Column
              title="待回填结果"
              items={lists.pendingResults}
              empty="没有待登记结果的项目"
              kind="pending"
              onOpen={(href) => navigate(href)}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            「还没写完」按项目阶段和已写章节统计，不展开每份标书里的待填写处。点项目会打开标书工作台；开标已过且结果未登的会直接进入归档复盘。
          </p>
        </>
      )}
    </section>
  )
}
