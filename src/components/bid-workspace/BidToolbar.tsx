import { ArrowLeft, LayoutGrid, Wrench } from "lucide-react"
import { ModelSelect } from "@/components/model-config/ModelSelect"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type BidToolbarProps = Pick<
  UseBidWorkspace,
  | "mainView"
  | "setMainView"
  | "mode"
  | "backToList"
  | "modelOptions"
  | "selectedModelKey"
  | "handleSelectModel"
>

export function BidToolbar({
  mainView,
  setMainView,
  mode,
  backToList,
  modelOptions,
  selectedModelKey,
  handleSelectModel,
}: BidToolbarProps) {
  return (
    // 2026-11-11：粘性 top 由硬编码 top-14(56px) 改为「顶栏 60px + 标签栏实际高度」。
    // 实测：顶栏实际 60px（sticky top-0 h-[60px]），而 top-14 只有 56px —— 工具条会向上
    // 压进顶栏下沿 4px；且多标签时标签栏占 38px，工具条 sticky 到 56px 会被标签栏整条盖住。
    <div className="sticky top-[calc(60px+var(--xz-tabs-h,0px))] z-30 -mx-4 -mt-4 mb-5 flex items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur lg:-mx-6 lg:-mt-6 lg:px-6">
      {mode === "detail" && (
        <button
          type="button"
          onClick={backToList}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          投标项目
        </button>
      )}
      {mode === "list" && (
        <nav className="flex items-center gap-1 rounded-full bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setMainView("projects")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              mainView === "projects"
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            投标项目
          </button>
          <button
            type="button"
            onClick={() => setMainView("tools")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              mainView === "tools"
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            快捷工具
          </button>
        </nav>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* 一个模型跑完整本标书：这里只列具体模型，不做按环节自动选型（用户裁定 2026-10-15）。
            通道不可访问时的自动改道由 modelFailover 负责，下拉右侧会显示「冷却中」提示。 */}
        <ModelSelect
          models={modelOptions}
          valueKey={selectedModelKey}
          onChange={handleSelectModel}
        />
      </div>
    </div>
  )
}
