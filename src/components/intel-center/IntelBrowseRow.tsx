import { ExternalLink, Star } from "lucide-react"
import {
  fmtIntelTime,
  ITEM_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  type IntelItemRow,
} from "@/pages/IntelCenter/useIntelCenter"
import { isIntelFutureDate } from "@/pages/IntelCenter/intelDateQuality"

// UX-R2: 情报中心 已按 docs/ux-review-2026-11 修复 2026-11-07
// （浏览模式的紧凑行式列表：单行约 64px、标题截断，点行开详情；对比待办模式的大卡片）

type IntelBrowseRowProps = {
  item: IntelItemRow
  starred: boolean
  focused: boolean
  onOpenDetail: (item: IntelItemRow) => void
  onToggleStar: (item: IntelItemRow) => void
}

function statusDotClass(myStatus: string): string {
  if (myStatus === "confirmed") return "bg-emerald-500"
  if (myStatus === "ignored") return "bg-muted-foreground/40"
  return "bg-amber-500"
}

export function IntelBrowseRow({ item, starred, focused, onOpenDetail, onToggleStar }: IntelBrowseRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-intel-row
      onClick={() => onOpenDetail(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpenDetail(item)
        }
      }}
      className={`flex h-16 w-full cursor-pointer items-center gap-3 border-b border-border/70 px-3 text-left transition-colors last:border-b-0 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
        focused ? "bg-primary/5" : "bg-card"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(item.my_status || "pending")}`} aria-hidden="true" />
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${item.item_type === "bid" ? "badge-warning" : item.item_type === "policy" ? "badge-success" : "badge-neutral"}`}>
        {SOURCE_TYPE_LABEL[item.item_type] ?? "情报"}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={item.title}>
        {item.title}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.source_name}</span>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${item.my_status === "confirmed" ? "badge-success" : item.my_status === "ignored" ? "badge-neutral line-through" : "badge-warning"}`}>
        {ITEM_STATUS_LABEL[item.my_status || "pending"] ?? "待确认"}
      </span>
      {isIntelFutureDate(item.published_at) ? (
        <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning" title="发布日待核">
          待核
        </span>
      ) : (
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {fmtIntelTime(item.published_at || item.created)}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleStar(item)
        }}
        title={starred ? "取消收藏" : "收藏"}
        aria-label={`${starred ? "取消收藏" : "收藏"} ${item.title}`}
        className="shrink-0 rounded-md p-1 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Star className={starred ? "h-3.5 w-3.5 fill-primary text-primary" : "h-3.5 w-3.5 text-muted-foreground/50"} />
      </button>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="查看原文"
          aria-label={`查看原文 ${item.title}`}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  )
}
