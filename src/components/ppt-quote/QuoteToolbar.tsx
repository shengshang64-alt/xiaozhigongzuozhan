import { ArrowLeft } from "lucide-react"
import { ModelSelect } from "@/components/model-config/ModelSelect"
import type { ModelRef } from "@/lib/modelGateway"

type QuoteToolbarProps = {
  activeView: "deck" | "quote"
  onSwitchView: (view: "deck" | "quote") => void
  inDetail: boolean
  detailLabel: string
  onBackToList: () => void
  modelOptions: ModelRef[]
  selectedModelKey: string
  onSelectModel: (key: string) => void
}

const VIEW_TABS: { key: "deck" | "quote"; label: string }[] = [
  { key: "deck", label: "汇报 PPT" },
  { key: "quote", label: "报价清单" },
]

export function QuoteToolbar({
  activeView,
  onSwitchView,
  inDetail,
  detailLabel,
  onBackToList,
  modelOptions,
  selectedModelKey,
  onSelectModel,
}: QuoteToolbarProps) {
  return (
    // 2026-11-11：粘性 top 改按「顶栏 60px + 标签栏实际高度」，修掉 56px 硬编码压顶栏 / 被标签栏盖住
    <div className="sticky top-[calc(60px+var(--xz-tabs-h,0px))] z-30 -mx-4 -mt-4 mb-5 flex flex-wrap items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur lg:-mx-6 lg:-mt-6 lg:px-6">
      {inDetail && (
        <button
          type="button"
          onClick={onBackToList}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {detailLabel}
        </button>
      )}
      <nav className="flex items-center gap-1 rounded-full bg-muted p-0.5">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSwitchView(tab.key)}
            className={
              tab.key === activeView
                ? "rounded-full bg-card px-4 py-1 text-sm font-medium text-primary shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                : "rounded-full px-4 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            }
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="ml-auto">
        <ModelSelect models={modelOptions} valueKey={selectedModelKey} onChange={onSelectModel} />
      </div>
    </div>
  )
}
