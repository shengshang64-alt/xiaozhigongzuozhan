import { Suspense, lazy, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Bot, GripHorizontal, Maximize2, X } from "lucide-react"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { ChatComposer } from "@/components/assistant/ChatComposer"
import { LAST_BIZ_PATH_KEY } from "@/lib/assistantCore"
import { useAssistant } from "@/pages/Assistant/useAssistant"

// R124 性能：浮动助手挂载在全局 Shell（每页都在），ChatStream 静态依赖 docx（Word 导出，数百 kB）。
// 上一版把 docx 运行时拖进入口 chunk，所有页面首访共同买单；改为首次展开对话窗时才按需加载该 chunk。
const ChatStreamLazy = lazy(() =>
  import("@/components/assistant/ChatStream").then((m) => ({ default: m.ChatStream })),
)

export function FloatingAssistant() {
  const navigate = useNavigate()
  const loc = useLocation()
  const vm = useAssistant({ floatMode: true })
  const [open, setOpen] = useState(false)
  const [winPos, setWinPos] = useState<{ left: number; top: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; originLeft: number; originTop: number } | null>(null)
  const winRef = useRef<HTMLDivElement>(null)

  // 在非助手页记录最近业务页路径，供全屏对话页做「已联动」上下文
  useEffect(() => {
    if (loc.pathname === "/assistant") return
    try {
      window.sessionStorage.setItem(LAST_BIZ_PATH_KEY, loc.pathname)
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [loc.pathname])

  const openWindow = () => {
    // B2：开窗不再调 newSession——避免把挂载时从 pending 桶恢复的失败消息清掉；
    // 「新对话」的清存储语义只保留给全屏对话页的显式按钮
    setOpen(true)
  }

  const goFullScreen = () => {
    setOpen(false)
    navigate("/assistant")
  }

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = winRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, originLeft: rect.left, originTop: rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const rect = winRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    const left = Math.min(Math.max(8, drag.originLeft + e.clientX - drag.startX), window.innerWidth - rect.width - 8)
    const top = Math.min(Math.max(8, drag.originTop + e.clientY - drag.startY), window.innerHeight - rect.height - 8)
    setWinPos({ left, top })
  }

  const onDragEnd = () => {
    dragRef.current = null
  }

  return (
    <>
      {open ? (
        <div
          ref={winRef}
          className={`fixed z-50 flex h-[520px] max-h-[calc(100vh-5rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300 ${
            winPos ? "" : "bottom-24 right-6"
          }`}
          style={winPos ? { left: winPos.left, top: winPos.top } : undefined}
        >
          <div
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            className="flex min-h-11 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b border-border bg-secondary/60 px-3 active:cursor-grabbing"
          >
            <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
              小智 · 快捷问答
            </span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={goFullScreen}
              aria-label="进入全屏对话"
              title="进入全屏"
              className="rounded p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(false)}
              aria-label="收起小智聊天窗"
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                对话窗加载中…
              </div>
            }
          >
            <ChatStreamLazy
              messages={vm.convMessages}
              sendState={vm.sendState}
              fetchBadge={vm.fetchBadge}
              compact
              onRetry={vm.retryLast}
              onDismiss={vm.dismissFailedMsg}
            />
          </Suspense>

          <ChatComposer
            draftInput={vm.draftInput}
            setDraftInput={vm.setDraftInput}
            onSend={() => vm.sendMessage()}
            busy={vm.sendState !== "idle"}
            contextLabel={vm.contextLabel}
            onCloseContext={vm.closeContext}
            onCancel={vm.cancelSend}
            elapsedSec={vm.sendElapsedTick}
            compact
          />

          <CostConfirmDialog {...vm.costConfirm} />
        </div>
      ) : (
        <button
          type="button"
          onClick={openWindow}
          aria-label="打开小智快捷问答"
          title="小智助手"
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}
    </>
  )
}
