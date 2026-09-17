import { LogIn } from "lucide-react"
import { redirectToRhLogin } from "@/lib/rhLogin"

/**
 * 全站统一登录过期横幅：destructive 提示底 + 登录动作按钮（outline 主色描边，
 * 不与页面主 CTA 抢 bg-primary）。
 */
type LoginBannerProps = {
  onLogin?: () => void
  compact?: boolean
  message?: string
}

const DEFAULT_MESSAGE =
  "RunningHub 登录态已过期或未登录，请重新登录后再继续，AI 能力与数据保存都依赖登录态"

export function LoginBanner({ onLogin, compact = false, message }: LoginBannerProps) {
  return (
    <div
      role="alert"
      className={
        compact
          ? "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 shadow-sm"
          : "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 shadow-sm"
      }
    >
      <p className={compact ? "text-xs text-foreground" : "text-sm text-foreground"}>
        {message ?? DEFAULT_MESSAGE}
      </p>
      <button
        type="button"
        onClick={onLogin ?? redirectToRhLogin}
        className={
          compact
            ? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            : "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3.5 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        }
      >
        <LogIn className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        用 RunningHub 重新登录
      </button>
    </div>
  )
}
