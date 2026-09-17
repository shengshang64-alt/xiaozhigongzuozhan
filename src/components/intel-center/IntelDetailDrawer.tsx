import { useEffect } from "react"
import { BriefcaseBusiness, Check, ExternalLink, Sparkles, Star, X } from "lucide-react"
import {
  fmtIntelTime,
  ITEM_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  type IntelItemRow,
} from "@/pages/IntelCenter/useIntelCenter"

type IntelDetailDrawerProps = {
  item: IntelItemRow | null
  starred: boolean
  aiTagging: boolean
  onClose: () => void
  onConfirm: (item: IntelItemRow) => void
  onIgnore: (item: IntelItemRow) => void
  onAiTag: (item: IntelItemRow) => void
  onToggleStar: (item: IntelItemRow) => void
  onConvertToOpp: (item: IntelItemRow) => void
}

export function IntelDetailDrawer({
  item,
  starred,
  aiTagging,
  onClose,
  onConfirm,
  onIgnore,
  onAiTag,
  onToggleStar,
  onConvertToOpp,
}: IntelDetailDrawerProps) {
  // Escape 关闭抽屉（hooks 必须在早返回之前）
  useEffect(() => {
    if (!item) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [item, onClose])
  if (!item) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭详情"
        onClick={onClose}
        className="flex-1 cursor-default"
        tabIndex={-1}
      />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-300">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">情报详情</h2>
          <span
            className={
              item.my_status === "confirmed"
                ? "badge-success"
                : item.my_status === "ignored"
                  ? "badge-neutral"
                  : "badge-warning"
            }
          >
            {ITEM_STATUS_LABEL[item.my_status || "pending"] ?? "待确认"}
          </span>
          {item.visibility === "personal" ? (
            <span className="rounded-full border border-dashed border-primary/40 px-2 py-0.5 text-xs text-primary">个人 · 我的</span>
          ) : (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">公共</span>
          )}
          <button
            type="button"
            onClick={() => onToggleStar(item)}
            className="ml-auto rounded-md p-1.5 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title={starred ? "取消收藏" : "收藏"}
          >
            <Star className={starred ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4 text-muted-foreground"} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <h3 className="text-lg font-semibold leading-snug text-foreground">{item.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {item.item_type && (
              <span className="rounded-full bg-muted px-2 py-0.5">{SOURCE_TYPE_LABEL[item.item_type] ?? item.item_type}</span>
            )}
            {item.region && <span className="rounded-full border border-dashed border-border px-2 py-0.5">{item.region}</span>}
            <span>{item.source_name || (item.added_by === "manual" ? "手动录入" : "未知来源")}</span>
            <span>{fmtIntelTime(item.published_at || item.created)}</span>
          </div>

          {item.summary && (
            <section className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
              <p className="text-xs font-semibold text-primary">AI 摘要</p>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground">{item.summary}</p>
            </section>
          )}

          {item.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {item.content_snippet && (
            <section className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground">内容片段</p>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-border bg-card p-3.5 text-sm leading-relaxed text-muted-foreground shadow-sm">
                {item.content_snippet}
              </p>
            </section>
          )}

          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-card-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ExternalLink className="h-4 w-4 text-primary" />
              查看原文
            </a>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => onAiTag(item)}
            disabled={aiTagging}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Sparkles className={aiTagging ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {aiTagging ? "AI 分析中…" : item.summary ? "重新打标" : "AI 摘要打标"}
          </button>
          <button
            type="button"
            onClick={() => onConvertToOpp(item)}
            title="带情报预填信息跳转客户管理新建商机"
            className="flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BriefcaseBusiness className="h-4 w-4" />
            转为商机
          </button>
          {item.my_status !== "confirmed" && (
            <button
              type="button"
              onClick={() => onConfirm(item)}
              title="只更新你自己的确认状态"
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-card-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Check className="h-4 w-4 text-primary" />
              确认
            </button>
          )}
          {item.my_status !== "ignored" && (
            <button
              type="button"
              onClick={() => onIgnore(item)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-4 w-4" />
              忽略
            </button>
          )}
        </footer>
      </aside>
    </div>
  )
}
