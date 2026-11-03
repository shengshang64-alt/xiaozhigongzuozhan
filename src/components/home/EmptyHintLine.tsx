import type { ReactNode } from "react"

type EmptyHintLineProps = {
  icon: ReactNode
  text: string
  hint?: string
  /** 处于文档流(非 grid 并排)时由调用方传 mb-5 等外边距 */
  className?: string
}

/**
 * home-03：首页卡片空态统一「一行提示」。
 * 无数据的卡片折叠成这一行，不再各占一张整卡；有数据时由调用方恢复渲染整卡。
 * 自身不带外边距，间距由 className 交给调用方按布局上下文决定。
 */
export function EmptyHintLine({ icon, text, hint, className }: EmptyHintLineProps) {
  return (
    <div className={`flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2.5 text-sm ${className ?? ""}`}>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="font-medium text-muted-foreground">{text}</span>
      {hint && <span className="text-xs text-muted-foreground/80">{hint}</span>}
    </div>
  )
}
