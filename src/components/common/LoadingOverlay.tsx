import { Loader2 } from "lucide-react"

// Phase 1（任务 1.3）：全站通用异步操作遮罩。
// 使用约定（与全站规范一致）：
//  - 预期 ≤3s 的读取优先用 DataStates.LoadingState / 骨架屏，不遮操作；
//  - 提交类异步（保存 / 删除 / 导入等不可中断动作）用本组件罩住触发区域，
//    防止用户连点造成重复提交；fullscreen 仅用于整页级阻塞（慎用）。

type LoadingOverlayProps = {
  /** 进行中的动作说明（如「正在保存…」），必须说清在等什么 */
  message?: string
  /** true 时固定全屏（z-50），false 时相对铺满最近的 relative 祖先 */
  fullscreen?: boolean
}

export function LoadingOverlay({ message = "正在处理…", fullscreen = false }: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center ${fullscreen ? "fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px]" : "absolute inset-0 z-20 rounded-[inherit] bg-background/60"}`}
    >
      <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-lg">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        {message}
      </span>
    </div>
  )
}
