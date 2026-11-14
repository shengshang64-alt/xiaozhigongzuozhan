// 知识库六屏共用的版式基元（对齐原型 design.css 的 .card / .card-h / .card-b / .card-f）。
//
// ## 为什么要有这一层
//
// 原型的每一张卡片都是同款四段结构（头 / 体 / 底），而项目里的 `ui/card.tsx`
// 是 Radix 风格的 CardHeader + CardContent（默认 padding p-6，无「底栏」概念）。
// 直接用 ui/card 会导致：
//   ① 头与体的间距与原型不一致（原型是 12px 上下、14px 左右，比 p-6 紧）；
//   ② 原型里大量「卡片底部一行小结 + 右侧按钮」的用法没法表达（CardFooter 有 p-6 pt-0）。
//
// 所以这里按原型的类名语义封装一套薄封装，**不引入任何新依赖**，
// 颜色全部走 token（不写行内色值）。

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** 卡片外框（原型 .card） */
export function KbCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-lg border border-border bg-card shadow-sm", className)}>{children}</div>
}

/** 卡片头（原型 .card-h）：左标题（可带图标）+ 副标题 + 右侧动作区 */
export function KbCardHead({
  title,
  sub,
  icon,
  actions,
  className,
}: {
  title: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2 border-b border-border px-4 py-3", className)}>
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">{title}</h3>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      <div className="grow" />
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** 卡片体（原型 .card-b）；flush = 去掉内边距（表格/列表贴边），tight = 收紧内边距 */
export function KbCardBody({
  className,
  children,
  flush,
  tight,
}: {
  className?: string
  children: ReactNode
  flush?: boolean
  tight?: boolean
}) {
  return (
    <div className={cn(flush ? "" : tight ? "px-3 py-3" : "px-4 py-3", className)}>{children}</div>
  )
}

/** 卡片底（原型 .card-f）：一行小结 + 右侧动作 */
export function KbCardFoot({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground", className)}>
      {children}
    </div>
  )
}

/** 数据条（原型 .databar）：一行带分隔线的关键指标，不是三张统计卡 */
export function KbStatBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center overflow-hidden rounded-lg border border-border bg-card shadow-sm", className)}>
      {children}
    </div>
  )
}

/** 数据条里的一项（原型 .databar .item）；tone 决定数字的颜色语义 */
export function KbStatItem({
  label,
  value,
  tone = "default",
  className,
}: {
  label: ReactNode
  value: ReactNode
  tone?: "default" | "primary" | "success" | "warning" | "danger"
  className?: string
}) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-primary",
    warning: "text-warning",
    danger: "text-destructive",
  }[tone]
  return (
    <div className={cn("flex items-center gap-2 border-r border-border px-3.5 py-1.5 text-xs text-muted-foreground", className)}>
      <span>{label}</span>
      <span className={cn("font-mono text-[15px] font-semibold", toneClass)}>{value}</span>
    </div>
  )
}

/** 标签（原型 .tag）：文档卡上的轻量关键词 */
export function KbTag({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground", className)}>
      {children}
    </span>
  )
}

/** 比例条（原型 .bar）：左标签 + 条 + 右数值 */
export function KbBarRow({
  label,
  value,
  pct,
  tone = "primary",
  className,
}: {
  label: ReactNode
  value: ReactNode
  /** 0-100 */
  pct: number
  tone?: "primary" | "success" | "warning" | "danger"
  className?: string
}) {
  const barTone = {
    primary: "bg-primary",
    success: "bg-primary",
    warning: "bg-warning",
    danger: "bg-destructive",
  }[tone]
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="w-[104px] shrink-0 truncate text-xs text-muted-foreground">{label}</span>
      <div className="h-1.5 grow overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barTone)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  )
}

/** 筛选胶囊（原型 .chip）；可点，带计数 */
export function KbChip({
  active,
  count,
  className,
  onClick,
  children,
}: {
  active?: boolean
  count?: number
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
        active
          ? "border-primary/40 bg-primary/10 font-semibold text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary",
        className,
      )}
    >
      {children}
      {typeof count === "number" ? <span className="font-mono text-[10.5px] text-muted-foreground">{count}</span> : null}
    </button>
  )
}

/** 分段控件（原型 .seg） */
export function KbSeg<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-md bg-muted p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-[26px] rounded px-2.5 text-xs transition-colors",
            o.value === value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 提示条（原型 .alert）；tone 决定语义色 */
export function KbAlert({
  tone = "info",
  icon,
  children,
  actions,
  className,
}: {
  tone?: "info" | "warning" | "danger"
  icon?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const toneClass = {
    info: "border-primary/30 bg-primary/5 text-foreground",
    warning: "border-warning/40 bg-warning/10 text-foreground",
    danger: "border-destructive/40 bg-destructive/5 text-foreground",
  }[tone]
  const iconClass = {
    info: "text-primary",
    warning: "text-warning",
    danger: "text-destructive",
  }[tone]
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", toneClass, className)}>
      {icon ? <span className={cn("mt-0.5 shrink-0", iconClass)}>{icon}</span> : null}
      <div className="grow">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
