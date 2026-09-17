import { Sparkles } from "lucide-react"

type DefaultModelBannerProps = {
  defaultLabel: string
  defaultSource: string
}

export function DefaultModelBanner({ defaultLabel, defaultSource }: DefaultModelBannerProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" />
      </span>
      <p className="text-sm text-foreground">
        当前系统默认模型：
        <strong className="font-semibold text-primary">{defaultLabel}</strong>
        <span className="ml-1 text-muted-foreground">（来源：{defaultSource}）</span>
      </p>
      <p className="text-xs text-muted-foreground">
        方案编制 / 标书工作 / PPT 与报价的 AI 生成会自动使用它，生成时也可临时切换
      </p>
    </div>
  )
}
