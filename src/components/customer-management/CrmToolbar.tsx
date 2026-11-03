import { Plus, Target } from "lucide-react"
import { ModelSelect } from "@/components/model-config/ModelSelect"
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
