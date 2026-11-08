// UX-R2: 客户管理 已按 docs/ux-review-2026-11 修复 2026-11-07（右栏默认健康度总览 / 缺 N 项可点击补全 / 模型提示收敛小黄点 / 批量补全先确认）
import { Link } from "react-router-dom"
import { Plus, Target } from "lucide-react"
import { ModelSelect, NO_MODEL_CONFIGURED_HINT } from "@/components/model-config/ModelSelect"
import type { ModelRef } from "@/lib/modelGateway"

type CrmToolbarProps = {
  modelOptions: ModelRef[]
  selectedModelKey: string
  handleSelectModel: (key: string) => void
  onNewCustomer: () => void
  onNewOpportunity: () => void
}

export function CrmToolbar({
  modelOptions,
  selectedModelKey,
  handleSelectModel,
  onNewCustomer,
  onNewOpportunity,
}: CrmToolbarProps) {
  return (
    <div className="sticky top-14 z-30 -mx-4 -mt-4 mb-5 flex flex-wrap items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur lg:-mx-6 lg:-mt-6 lg:px-6">
      <p className="text-sm text-muted-foreground">医院档案 · 商机推进 · 跟进时间线</p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* UX-R2（docs/ux-review-2026-11 §二）：未配置模型时的常驻打扰收敛为右上角小黄点——
            hover 出说明，点击直达模型配置；ModelSelect 的禁用态提示保持原样（如实不撒谎） */}
        {modelOptions.length === 0 ? (
          <Link
            to="/model-config"
            aria-label="未配置任何可用模型——去模型配置"
            title={NO_MODEL_CONFIGURED_HINT}
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          </Link>
        ) : null}
        <ModelSelect models={modelOptions} valueKey={selectedModelKey} onChange={handleSelectModel} />
        <button
          type="button"
          onClick={onNewOpportunity}
          className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:inline-flex"
        >
          <Target className="h-4 w-4 text-primary" />
          新建商机
        </button>
        <button
          type="button"
          onClick={onNewCustomer}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-4 w-4" />
          新建客户
        </button>
      </div>
    </div>
  )
}
