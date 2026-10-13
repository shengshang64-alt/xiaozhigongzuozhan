import { AlertTriangle, Sparkles } from "lucide-react"

type DefaultModelBannerProps = {
  defaultLabel: string
  defaultSource: string
  /** R296 配置卫生：是否真有配置显式声明了默认模型；false = 当前默认只是兜底，随时可能漂移 */
  declaredDefault?: boolean
  /** 未显式声明默认模型的个人配置数（靠「启用列表第一个」兜底 → 顺序一变默认就静默改变） */
  missingDefaultCount?: number
  /** 实测不可用（404 已下线 / 上游停用 / Key 失效）却仍处于启用态的模型数 */
  unusableCount?: number
}

export function DefaultModelBanner({
  defaultLabel,
  defaultSource,
  declaredDefault = true,
  missingDefaultCount = 0,
  unusableCount = 0,
}: DefaultModelBannerProps) {
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
      {(!declaredDefault || missingDefaultCount > 0 || unusableCount > 0) && (
        <ul className="w-full space-y-1 text-xs">
          {!declaredDefault && (
            <li className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              还没有任何配置显式声明默认模型，当前默认只是「{defaultSource}」兜底——请在下方点「设为默认」把它固定下来
            </li>
          )}
          {missingDefaultCount > 0 && (
            <li className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {missingDefaultCount} 个配置未设默认模型：它们靠「启用列表第一个」兜底，配置内模型顺序一变，默认模型就会静默改变
            </li>
          )}
          {unusableCount > 0 && (
            <li className="flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {unusableCount} 个已启用模型实测不可用（接口已下线 / 被停用 / Key 失效）：下方已逐个标注，请点「测试」复核后停用或修正
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
