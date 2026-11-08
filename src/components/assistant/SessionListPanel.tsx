import { useCallback, useRef, useState } from "react"
import * as HoverCard from "@radix-ui/react-hover-card"
import { Loader2, MessageSquarePlus, MessagesSquare, Star, Trash2 } from "lucide-react"
import type { SessionRow } from "@/lib/assistantCore"
import { formatRelativeTime } from "@/lib/relativeTime"
import { localDateStamp } from "@/lib/dateStamp"

function formatSessionTime(iso: string): string {
  return formatRelativeTime(iso, (d, _diff, day) =>
    day < 30 ? `${day} 天前` : localDateStamp(d),
  )
}

type SessionListPanelProps = {
  sessions: SessionRow[]
  /** A2-9：会话列表加载态（首次加载时显示 Loader2） */
  loading?: boolean
  /** B6：分页三件套——满页判定还有更多 / 点击追加 / 追加请求进行中（禁点防乱序） */
  hasMore?: boolean
  onLoadMore?: () => void
  loadingMore?: boolean
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onNew: () => void
  onTogglePin: (row: SessionRow) => void
  onRequestDelete: (row: SessionRow) => void
  /** UX-R2：hover 惰性拉取该会话最新 2 条消息预览（返回 [] 表示加载失败/为空） */
  onLoadPreview?: (sessionId: string) => Promise<Array<{ role: string; content: string }>>
}

export function SessionListPanel({
  sessions,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
  activeSessionId,
  onSelect,
  onNew,
  onTogglePin,
  onRequestDelete,
  onLoadPreview,
}: SessionListPanelProps) {
  // UX-R2：hover 预览缓存（sessionId → 最新两条 { role, content }），本次挂载内不重复请求
  const previewCacheRef = useRef(new Map<string, Array<{ role: string; content: string }>>())
  const [previewMap, setPreviewMap] = useState<Map<string, Array<{ role: string; content: string }>>>(new Map())
  const fetchPreview = useCallback(
    (sessionId: string) => {
      if (!onLoadPreview || previewCacheRef.current.has(sessionId)) return
      previewCacheRef.current.set(sessionId, [])
      void onLoadPreview(sessionId).then((msgs) => {
        previewCacheRef.current.set(sessionId, msgs)
        setPreviewMap(new Map(previewCacheRef.current))
      })
    },
    [onLoadPreview],
  )
  const previewTextOf = (sessionId: string): string => {
    const msgs = previewMap.get(sessionId)
    if (!msgs || msgs.length === 0) return "暂无消息预览"
    return msgs
      .map((m) => `${m.role === "user" ? "你" : "小智"}：${m.content.replace(/\s+/g, " ").slice(0, 40)}`)
      .join("\n")
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onNew}
        className="mb-3 inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-card text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <MessageSquarePlus className="h-4 w-4" />
        新对话
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading && sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">正在加载会话列表…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-3 py-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">还没有历史会话</p>
            <p className="mt-1 text-xs text-muted-foreground">点「新对话」或直接发消息开始</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((s) => {
              const active = s.id === activeSessionId
              return (
                <li key={s.id}>
                  <div
                    className={`group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 transition-colors ${
                      active
                        ? "border-primary/40 bg-primary/10"
                        : "border-transparent hover:border-border hover:bg-secondary/60"
                    }`}
                    onClick={() => onSelect(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSelect(s.id)
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="min-w-0 flex-1">
                      {/* UX-R2：hover 显示该会话最新两条消息预览（惰性拉取 + 挂载内缓存） */}
                      <HoverCard.Root
                        openDelay={250}
                        onOpenChange={(o) => {
                          if (o) fetchPreview(s.id)
                        }}
                      >
                        <HoverCard.Trigger asChild>
                          <p
                            className={`truncate text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}
                          >
                            {s.session_title || "未命名会话"}
                          </p>
                        </HoverCard.Trigger>
                        <HoverCard.Portal>
                          <HoverCard.Content side="right" align="start" sideOffset={8} className="z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-lg animate-in fade-in zoom-in-95 duration-150">
                            <p className="text-[11px] font-medium text-muted-foreground">最近消息预览</p>
                            <pre className="mt-1.5 whitespace-pre-wrap break-all font-sans text-xs leading-relaxed text-foreground">
                              {previewTextOf(s.id)}
                            </pre>
                            <p className="mt-2 text-[11px] text-muted-foreground">创建于 {formatSessionTime(s.created)}</p>
                          </HoverCard.Content>
                        </HoverCard.Portal>
                      </HoverCard.Root>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatSessionTime(s.created)}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={s.pinned ? "取消置顶" : "置顶会话"}
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(s)
                      }}
                      className={`shrink-0 rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        s.pinned
                          ? "text-primary"
                          : "text-muted-foreground opacity-60 hover:text-primary md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${s.pinned ? "fill-current" : ""}`} />
                    </button>
                    <button
                      type="button"
                      aria-label="删除会话"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRequestDelete(s)
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-60 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {hasMore && onLoadMore && sessions.length > 0 ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded py-1.5 text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            加载更多会话
          </button>
        ) : null}
      </div>
    </div>
  )
}
