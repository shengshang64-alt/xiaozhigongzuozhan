// UX-R2: 情报中心 已按 docs/ux-review-2026-11 修复 2026-11-07（双模式/指标语义化/ⓘ弹层/筛选收敛/操作分层+滑出动画）
import { Check, CheckSquare, ExternalLink, Flag, MoreHorizontal, Sparkles, Square, Star, X } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  fmtIntelTime,
  ITEM_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  type IntelItemRow,
} from "@/pages/IntelCenter/useIntelCenter"
import { cleanIntelSnippet, cleanIntelSummary } from "@/pages/IntelCenter/intelBodyClean"
import { isIntelFutureDate } from "@/pages/IntelCenter/intelDateQuality"

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
  // UX-R2（docs/ux-review-2026-11 §三）：待办模式大卡片 + 确认后滑出动画
  todoMode?: boolean
  exiting?: boolean
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
  todoMode = false,
  exiting = false,
}: IntelItemCardProps) {
  // R64：摘要统一走展示层清洗（剥站点名前缀/JSON 元数据块），与首页动态卡同口径。
  // 2026-11-03：无 AI 摘要时回退到清洗后的原文片段——先让列表可读，AI 只在用户点开/打标时调用。
  const summaryText = item.summary
    ? cleanIntelSummary(item.summary, 160)
    : cleanIntelSnippet(item.content_snippet, { title: item.title, max: 160 })
  return (
    <article
      data-intel-card
      className={`group flex flex-col rounded-lg border bg-card shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        todoMode ? "p-5" : "p-4"
      } ${
        exiting
          ? "animate-out fade-out-0 slide-out-to-right-8 duration-300"
          : batchMode && selected
            ? "border-primary/60 ring-1 ring-primary/40"
            : "border-border"
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
        {(item.duplicate_count ?? 0) > 1 && (
          <span
            className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
            title={`同题来源：${(item.duplicate_sources ?? []).join("、")}（仅聚合展示，未删除任何记录）`}
          >
            同题 ×{item.duplicate_count}
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
        className={`mt-2.5 text-left font-semibold leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          todoMode ? "text-lg" : "text-base"
        }`}
      >
        {item.title}
      </button>

      {summaryText && (
        <p className={`mt-2 text-sm leading-relaxed text-muted-foreground ${todoMode ? "line-clamp-3" : "line-clamp-2"}`}>{summaryText}</p>
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

      {item.structured && (item.structured.buyer || item.structured.code || item.structured.budget || item.structured.deadline || item.structured.won_amount || item.structured.winner) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {item.structured.buyer && (
            <span className="max-w-72 truncate rounded bg-primary/10 px-1.5 py-0.5 text-primary" title={item.structured.buyer}>
              采购人 {item.structured.buyer}
            </span>
          )}
          {item.structured.code && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">编号 {item.structured.code}</span>
          )}
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
        {isIntelFutureDate(item.published_at) ? (
          <span
            className="rounded bg-warning/10 px-1.5 py-0.5 text-warning"
            title="发布日超过当前日期，可能是正文中的课程/实施日期被误识别；可在信息源管理执行「修复数据」复核，不会自动删除"
          >
            日期待核 {String(item.published_at).slice(0, 10)}
          </span>
        ) : (
          <span>{fmtIntelTime(item.published_at || item.created)}</span>
        )}
      </div>

      {/* UX-R2：操作分层——「确认」是唯一实心主按钮（待办模式加大并靠右），其余收进 ⋯ 菜单；
          批量模式保持平铺（勾选场景需要全部快捷键直达）。确认后焦点自动落到下一条（单键流保留） */}
      <div className={`mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3 ${todoMode ? "min-h-12" : ""}`}>
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
            className={`flex items-center gap-1 rounded-md bg-primary font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              todoMode ? "ml-auto px-5 py-2 text-sm" : "px-3 py-1.5 text-xs"
            }`}
          >
            <Check className="h-4 w-4" />
            确认
          </button>
        )}

        {batchMode ? (
          <>
            <button
              type="button"
              onClick={() => onAiTag(item)}
              disabled={aiTagging}
              className="flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Sparkles className={aiTagging ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              {aiTagging ? "AI 分析中…" : item.summary ? "重新打标" : "AI 摘要打标"}
            </button>
            {item.my_status !== "ignored" && (
              <button
                type="button"
                data-confirm-btn
                onClick={(e) => {
                  onIgnore(item)
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
              <Flag className={`h-3.5 w-3.5 ${lead ? "fill-violet-500 text-violet-600" : "text-muted-foreground group-hover:text-foreground"}`} />
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
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {aiTagging ? "AI 分析中…" : item.summary ? "已 AI 打标" : "未打标"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="更多操作"
                  title="AI 摘要打标 / 忽略 / 标线索 / 原文"
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  更多
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => onAiTag(item)} disabled={aiTagging} className="gap-2">
                  <Sparkles className={`h-3.5 w-3.5 text-primary ${aiTagging ? "animate-spin" : ""}`} />
                  {aiTagging ? "AI 分析中…" : item.summary ? "重新打标" : "AI 摘要打标"}
                </DropdownMenuItem>
                {item.my_status !== "ignored" && (
                  <DropdownMenuItem
                    onSelect={() => {
                      onIgnore(item)
                    }}
                    className="gap-2"
                  >
                    <X className="h-3.5 w-3.5" />
                    忽略
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onToggleLead(item)} className="gap-2">
                  <Flag className={`h-3.5 w-3.5 ${lead ? "fill-violet-500 text-violet-600" : ""}`} />
                  {lead ? "取消线索标记" : "标为项目线索"}
                </DropdownMenuItem>
                {item.url && (
                  <DropdownMenuItem asChild>
                    <a href={item.url} target="_blank" rel="noreferrer" className="gap-2">
                      <ExternalLink className="h-3.5 w-3.5" />
                      查看原文
                    </a>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </article>
  )
}
