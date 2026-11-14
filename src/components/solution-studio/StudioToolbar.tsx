import { ArrowLeft } from "lucide-react"
import { ModelSelect } from "@/components/model-config/ModelSelect"
import type { ModelRef } from "@/lib/modelGateway"

type StudioToolbarProps = {
  inEditor: boolean
  onBackToList: () => void
  modelOptions: ModelRef[]
  selectedModelKey: string
  onSelectModel: (key: string) => void
}

export function StudioToolbar({
  inEditor,
  onBackToList,
  modelOptions,
  selectedModelKey,
  onSelectModel,
}: StudioToolbarProps) {
  return (
    // 2026-11-11：粘性 top 改按「顶栏 60px + 标签栏实际高度」，修掉 56px 硬编码压顶栏 / 被标签栏盖住
    <div className="sticky top-[calc(60px+var(--xz-tabs-h,0px))] z-30 -mx-4 -mt-4 mb-5 flex items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur lg:-mx-6 lg:-mt-6 lg:px-6">
      {inEditor && (
        <button
          type="button"
          onClick={onBackToList}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          方案列表
        </button>
      )}
      <div className="ml-auto">
        <ModelSelect models={modelOptions} valueKey={selectedModelKey} onChange={onSelectModel} />
      </div>
    </div>
  )
}
