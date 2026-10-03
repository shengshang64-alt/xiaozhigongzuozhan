// ---------------------------------------------------------------------------
// 全局异步错误兜底：catch React ErrorBoundary 无法捕获的 unhandled promise
// rejection 和 window.onerror。以 toast 提示的形式告知用户，防止静默失败。
// ---------------------------------------------------------------------------
import { toast } from "sonner"

// 防抖：同消息 5s 内只弹一次，避免错误风暴刷 UI
let lastMsg = ""
let lastTs = 0
const DEBOUNCE_MS = 5000

// 良性/可忽略的错误模式（不提示用户）
const IGNORE_PATTERNS = [
  /AbortError/i,              // 用户主动取消请求
  /ResizeObserver loop/i,     // 浏览器已知无害 warning
  /Loading chunk \d+ failed/i, // chunk 加载失败由 Suspense retry 处理
  /net::ERR_/i,              // 浏览器底层网络错误（已由业务层降级处理）
]

function isIgnorable(msg: string): boolean {
  return IGNORE_PATTERNS.some((re) => re.test(msg))
}

function showGlobalError(msg: string) {
  const now = Date.now()
  if (msg === lastMsg && now - lastTs < DEBOUNCE_MS) return
  lastMsg = msg
  lastTs = now
  toast.error(`系统异常：${msg}`, {
    duration: 6000,
    action: { label: "复制", onClick: () => navigator.clipboard.writeText(msg) },
  })
}

/** 注册全局兜底（应在应用入口 main.tsx 调用一次） */
export function registerGlobalErrorCatch(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : String(reason ?? "未知异步异常")
    if (isIgnorable(msg)) return
    console.error("[globalErrorCatch] unhandledrejection:", reason)
    showGlobalError(msg)
    // 不 preventDefault：保留控制台原始错误信息
  })

  window.addEventListener("error", (event) => {
    // 仅捕获 window.onerror 级别的同步未处理异常（React 内部已被 ErrorBoundary 兜住）
    if (event.error) {
      const msg = event.error.message ?? "未知运行时异常"
      if (isIgnorable(msg)) return
      console.error("[globalErrorCatch] window.error:", event.error)
      showGlobalError(msg)
    }
  })
}
