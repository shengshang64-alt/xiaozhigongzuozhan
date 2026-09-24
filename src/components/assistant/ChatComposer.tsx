import { useEffect, useRef } from "react"
import { Loader2, SendHorizonal, X } from "lucide-react"

type ChatComposerProps = {
  draftInput: string
  setDraftInput: (value: string) => void
  onSend: () => void
  busy: boolean
  contextLabel: string | null
  onCloseContext: () => void
  compact?: boolean
  modelSlot?: React.ReactNode
  /** 数值变化时聚焦输入框（深链 ?q= 预填后使用） */
  focusSignal?: number
  /** p1-ux：忙态可点「取消」中断本轮生成；缺省不渲染取消按钮 */
  onCancel?: () => void
  /** p1-ux：本轮已用秒数（>0 时展示 "已 Xs"），配合 onCancel 使用 */
  elapsedSec?: number
}

export function ChatComposer({
  draftInput,
  setDraftInput,
  onSend,
  busy,
  contextLabel,
  onCloseContext,
  compact,
  modelSlot,
  focusSignal,
  onCancel,
  elapsedSec = 0,
}: ChatComposerProps) {
  const canSend = draftInput.trim().length > 0 && !busy
  const showCancel = busy && !!onCancel
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (focusSignal && focusSignal > 0) textareaRef.current?.focus()
  }, [focusSignal])
  return (
    <footer className={`shrink-0 border-t border-border bg-card ${compact ? "p-2.5" : "p-4"}`}>
      {contextLabel ? (
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            已联动：{contextLabel}
            <button
              type="button"
              onClick={onCloseContext}
              aria-label="关闭页面联动"
              className="rounded-full p-0.5 transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          {modelSlot}
        </div>
      ) : (
        modelSlot ? <div className="mb-2 flex items-center gap-2">{modelSlot}</div> : null
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) onSend()
        }}
      >
        <textarea
          ref={textareaRef}
          value={draftInput}
          onChange={(e) => setDraftInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              if (canSend) onSend()
            }
          }}
          rows={compact ? 1 : 2}
          placeholder={busy ? "小智正在回复中，可先输入下一个问题…" : "输入你的问题，Enter 发送，Shift+Enter 换行"}
          aria-label="向小智提问"
          className={`flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${compact ? "max-h-20" : "max-h-32"}`}
        />
        {showCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消本轮生成"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${compact ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm"}`}
          >
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {elapsedSec > 0 ? `已 ${elapsedSec}s · 取消` : "取消"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${compact ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm"}`}
          >
            <SendHorizonal className="h-4 w-4" />
            发送
          </button>
        )}
      </form>
    </footer>
  )
}
