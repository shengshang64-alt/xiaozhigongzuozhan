import type { ReactNode } from "react"
import { AlertTriangle, Inbox, Loader2, PackageOpen, RefreshCw, Search, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * 全站统一的「空态 / 失败态 / 加载态」组件（2026-11-04）。
 *
 * ## 为什么要有它
 *
 * R69 审计一次挖出 11 处「用户看不懂发生了什么」的问题，其中 4 处是同一类：
 * **把「加载失败」显示成「没有数据」**——
 *   · 知识库正文检索 401 → 显示「没有找到包含该关键词的文档」
 *   · 素材选择器 500 → 显示「素材库为空，可先到素材库页导入」
 *   · 情感/情报/方案多处空态没有区分初始态与筛选后为 0
 * 两者对用户的意义完全不同：前者该点「重试」或看技术原因，后者该去补数据。
 *
 * 全仓当时有 **123 处**空态文案、**15 处**失败态、262 处加载态，各写一遍，
 * 于是每新增一处就多一次写错的机会。本组件把三类状态收成一处，
 * 并用**类型**强制区分（`EmptyState` 没有 error 属性，`ErrorState` 必须有 reason），
 * 让「把失败说成空」在代码层面写不出来。
 *
 * ## 语义约定（不要绕开）
 *
 * - `LoadingState`：请求在飞。**不要**在加载中同时显示空态，否则用户会以为真没数据。
 * - `EmptyState`：请求成功、确实没有数据。可带 `hint`（为什么空）与 `action`（下一步做什么）。
 * - `ErrorState`：请求失败/解析失败。**必须**给 `reason`；`onRetry` 有值就渲染重试按钮。
 *   文案里要明确「不是没有数据」，避免用户误判。
 */

type Tone = "default" | "compact"

const frameBase = "flex flex-col items-center justify-center gap-2 text-center"
const frameSize: Record<Tone, string> = {
  default: "rounded-lg border border-dashed border-border bg-card px-6 py-14 shadow-md",
  compact: "px-3 py-6",
}

function Frame({ tone, className, children }: { tone: Tone; className?: string; children: ReactNode }) {
  return <div className={cn(frameBase, frameSize[tone], className)}>{children}</div>
}

/** 加载中。用于「首次加载」；后续增量加载请用行内 spinner，别整块替换已有内容。 */
export function LoadingState({
  text = "正在加载…",
  hint,
  tone = "default",
  className,
}: {
  text?: string
  hint?: string
  tone?: Tone
  className?: string
}) {
  return (
    <Frame tone={tone} className={className}>
      <Loader2 className={cn("animate-spin text-primary", tone === "compact" ? "h-4 w-4" : "h-6 w-6")} />
      <p className={cn("font-medium text-foreground", tone === "compact" ? "text-xs" : "text-sm")}>{text}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </Frame>
  )
}

/** 成功但无数据。不要用它表达「加载失败」——那种情况用 ErrorState。 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
  tone = "default",
  className,
}: {
  title: string
  /** 为什么空 / 什么情况下才会有数据 */
  hint?: string
  icon?: ReactNode
  /** 下一步该做什么（如「清除筛选」「去导入」） */
  action?: ReactNode
  tone?: Tone
  className?: string
}) {
  const defaultIcon = <Inbox className={cn("text-muted-foreground", tone === "compact" ? "h-5 w-5" : "h-8 w-8")} />
  return (
    <Frame tone={tone} className={className}>
      {icon ?? defaultIcon}
      <p className={cn("font-medium text-foreground", tone === "compact" ? "text-xs" : "text-sm")}>{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </Frame>
  )
}

/**
 * 失败态。必须给 reason（技术原因），并默认把话说明白：「不是没有数据」。
 * 这样即使用户不看 reason，也不会误判成「库里真没有」。
 */
export function ErrorState({
  title = "加载失败",
  reason,
  hint,
  onRetry,
  retryLabel = "重试",
  notEmptyHint = true,
  icon,
  tone = "default",
  className,
}: {
  title?: string
  /** 技术原因（原始错误串）；必填——没有原因的失败态等于让用户猜 */
  reason: string
  /** 告诉用户还能怎么办 */
  hint?: string
  onRetry?: () => void
  retryLabel?: string
  /** 是否加一句「不是没有数据」（默认加；纯表单提交失败之类可关） */
  notEmptyHint?: boolean
  icon?: ReactNode
  tone?: Tone
  className?: string
}) {
  const defaultIcon = (
    <AlertTriangle className={cn("text-destructive", tone === "compact" ? "h-5 w-5" : "h-8 w-8")} />
  )
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-12 text-center",
        tone === "compact" && "px-3 py-5",
        className,
      )}
    >
      {icon ?? defaultIcon}
      <p className={cn("font-medium text-destructive", tone === "compact" ? "text-xs" : "text-sm")}>
        {title}
        {notEmptyHint && "（不是「没有数据」）"}
      </p>
      {hint && <p className="max-w-md text-xs leading-relaxed text-foreground">{hint}</p>}
      {reason && (
        <p className="max-w-md break-all text-[11px] leading-relaxed text-muted-foreground">技术原因：{reason}</p>
      )}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-1">
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}

/**
 * 筛选后为 0 条：这是 EmptyState 的高频特例，文案必须提示「是筛选导致的，可以清掉筛选」。
 * 独立成一个组件是因为 R69 审计发现多处「筛选后 0 条」被写成了「库是空的」。
 */
export function FilteredEmptyState({
  title = "当前筛选条件下没有结果",
  hint = "试着放宽筛选条件，或清空筛选看看全部内容",
  onClearFilters,
  tone = "default",
  className,
}: {
  title?: string
  hint?: string
  onClearFilters?: () => void
  tone?: Tone
  className?: string
}) {
  return (
    <EmptyState
      title={title}
      hint={hint}
      icon={<Search className={cn("text-muted-foreground", tone === "compact" ? "h-5 w-5" : "h-8 w-8")} />}
      action={
        onClearFilters ? (
          <Button size="sm" variant="outline" onClick={onClearFilters}>
            清空筛选
          </Button>
        ) : undefined
      }
      tone={tone}
      className={className}
    />
  )
}

/** 无权限 / 未登录：与「失败」区分开，因为它不该给「重试」，而该给「去登录」。 */
export function AuthRequiredState({
  title = "需要登录后才能查看",
  hint,
  onLogin,
  tone = "default",
  className,
}: {
  title?: string
  hint?: string
  onLogin?: () => void
  tone?: Tone
  className?: string
}) {
  return (
    <EmptyState
      title={title}
      hint={hint ?? "登录状态可能已失效，刷新页面重新登录后再试"}
      icon={<ShieldAlert className={cn("text-warning", tone === "compact" ? "h-5 w-5" : "h-8 w-8")} />}
      action={
        onLogin ? (
          <Button size="sm" variant="outline" onClick={onLogin}>
            去登录
          </Button>
        ) : undefined
      }
      tone={tone}
      className={className}
    />
  )
}

/** 未配置/未启用（如 AnyTXT 未装、AI 通道未配）：信息态，不是错误，用中性图标。 */
export function NotConfiguredState({
  title,
  hint,
  action,
  tone = "default",
  className,
}: {
  title: string
  hint?: string
  action?: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <EmptyState
      title={title}
      hint={hint}
      icon={<PackageOpen className={cn("text-muted-foreground", tone === "compact" ? "h-5 w-5" : "h-8 w-8")} />}
      action={action}
      tone={tone}
      className={className}
    />
  )
}
