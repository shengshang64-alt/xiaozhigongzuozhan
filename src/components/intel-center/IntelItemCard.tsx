import { Check, CheckSquare, ExternalLink, Flag, Sparkles, Square, Star, X } from "lucide-react"
import {
  fmtIntelTime,
  ITEM_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  type IntelItemRow,
} from "@/pages/IntelCenter/useIntelCenter"

type IntelItemCardProps = {
  item: IntelItemRow
  starred: boolean
  aiTagging: boolean
  focused: boolean
  // 重构轮：项目线索标记（个人态）
  lead: boolean
  onToggleLead: (item: IntelItemRow) => void
  onOpenDetail: (item: IntelItemRow) => void
  onConfirm: (item: IntelItemRow) => void
  onIgnore: (item: IntelItemRow) => void
  onAiTag: (item: IntelItemRow) => void
  onToggleStar: (item: IntelItemRow) => void
  // 循环 10 小改 2：批量选择
  batchMode: boolean
  selected: boolean
  onToggleSelect: (itemId: string) => void
}

function typeBadgeClass(itemType: string): string {
  // 徽标语义四档（全站设计规范 v1）：政策=主色档，招标=关注档，其余=中性档
  if (itemType === "policy") return "badge-success"
  if (itemType === "bid") return "badge-warning"
  return "badge-neutral"
}

function statusBadgeClass(myStatus: string): string {
  if (myStatus === "confirmed") return "badge-success"
  if (myStatus === "ignored") return "badge-neutral line-through"
  return "badge-warning"
}

export function IntelItemCard({
  item,
  starred,
  aiTagging,
  focused,
  lead,
  onToggleLead,
  onOpenDetail,
  onConfirm,
  onIgnore,
  onAiTag,
  onToggleStar,
  batchMode,
  selected,
  onToggleSelect,
}: IntelItemCardProps) {
  return (
    <article
      data-intel-card
      className={`group flex flex-col rounded-lg border bg-card p-4 shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        batchMode && selected ? "border-primary/60 ring-1 ring-primary/40" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {batchMode && (
          <button
            type="button"
            onClick={() => onToggleSelect(item.id)}
            title={selected ? "取消选择" : "选择该情报"}
            className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
        {focused && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            关注
          </span>
        )}
        {item.item_type && (
          <span className={typeBadgeClass(item.item_type)}>
            {SOURCE_TYPE_LABEL[item.item_type] ?? item.item_type}
          </span>
        )}
        <span className={statusBadgeClass(item.my_status || "pending")}>
          {ITEM_STATUS_LABEL[item.my_status || "pending"] ?? "待确认"}
        </span>
        {lead && (
          <span className="rounded-full border border-violet-400/60 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600">
            已标线索
          </span>
        )}
        {item.visibility === "personal" ? (
          <span className="rounded-full border border-dashed border-primary/40 px-2 py-0.5 text-xs text-primary">
            个人 · 我的
          </span>
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">公共</span>
        )}
        {item.region && (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
            {item.region}
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggleStar(item)}
          title={starred ? "取消收藏" : "收藏"}
          className="ml-auto rounded-md p-1 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Star
            className={
              starred
                ? "h-4 w-4 fill-primary text-primary"
                : "h-4 w-4 text-muted-foreground group-hover:text-foreground"
            }
          />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        className="mt-2.5 text-left text-base font-semibold leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {item.title}
      </button>

      {item.summary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
      )}

      {item.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {item.structured && (item.structured.budget || item.structured.deadline || item.structured.won_amount || item.structured.winner) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {item.structured.deadline && (
            <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">截止 {item.structured.deadline}</span>
          )}
          {item.structured.budget && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">预算 {item.structured.budget}</span>
          )}
          {item.structured.winner && (
            <span className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 text-muted-foreground">中标 {item.structured.winner}</span>
          )}
          {item.structured.won_amount && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">中标额 {item.structured.won_amount}</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="truncate">{item.source_name || (item.added_by === "manual" ? "手动录入" : "未知来源")}</span>
        <span>{fmtIntelTime(item.published_at || item.created)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onAiTag(item)}
          disabled={aiTagging}
          className="flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Sparkles className={aiTagging ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {aiTagging ? "AI 分析中…" : item.summary ? "重新打标" : "AI 摘要打标"}
        </button>
        {item.my_status !== "confirmed" && (
          <button
            type="button"
            data-confirm-btn
            onClick={(e) => {
              onConfirm(item)
              // 单键流（UX 走查 2026-09-28）：确认后焦点自动落到下一张卡片的确认按钮，键盘 Enter 可连续处理
              const card = e.currentTarget.closest("[data-intel-card]")
              const next = card?.nextElementSibling?.querySelector("[data-confirm-btn]")
              if (next) window.setTimeout(() => (next as HTMLElement).focus(), 80)
            }}
            title="只更新你自己的确认状态（确认后自动聚焦下一条）"
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Check className="h-3.5 w-3.5 text-primary" />
            确认
          </button>
        )}
        {item.my_status !== "ignored" && (
          <button
            type="button"
            data-confirm-btn
            onClick={(e) => {
              onIgnore(item)
              // 与确认键对称：忽略后焦点也自动落到下一张卡片的确认按钮
              const card = e.currentTarget.closest("[data-intel-card]")
              const next = card?.nextElementSibling?.querySelector("[data-confirm-btn]")
              if (next) window.setTimeout(() => (next as HTMLElement).focus(), 80)
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" />
            忽略
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleLead(item)}
          title={lead ? "取消项目线索标记" : "标记为项目线索（个人视角，便于跟进）"}
          className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
            lead
              ? "border-violet-400/60 bg-violet-500/10 text-violet-600"
              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <Flag
            className={`h-3.5 w-3.5 ${
              lead ? "fill-violet-500 text-violet-600" : "text-muted-foreground group-hover:text-foreground"
            }`}
          />
          {lead ? "已标线索" : "标线索"}
        </button>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            原文
          </a>
        )}
      </div>
    </article>
  )
}
