import { useState } from "react"
import { CheckSquare, ChevronDown, ChevronUp, Eraser, FileSpreadsheet, Plus, Settings2, SlidersHorizontal, Sparkles } from "lucide-react"
import { ModelSelect } from "@/components/model-config/ModelSelect"
import type { ModelRef } from "@/lib/modelGateway"

type IntelToolbarProps = {
  modelOptions: ModelRef[]
  selectedModelKey: string
  onSelectModel: (key: string) => void
  onOpenSources: () => void
  onOpenEntry: () => void
  onOpenCleanup: () => void
  onOpenPrefs: () => void
  cleanupBusy: boolean
  /** 循环7 C3：导出当前已加载的情报清单 */
  onExport: () => void
  exportCount: number
  // 循环 10 小改 2：批量管理开关
  batchMode: boolean
  batchBusy: boolean
  onToggleBatch: () => void
  // 重构轮：AI 情报周报
  onWeeklyReport: () => void
  reportLoading: boolean
}

export function IntelToolbar({
  modelOptions,
  selectedModelKey,
  onSelectModel,
  onOpenSources,
  onOpenEntry,
  onOpenCleanup,
  onOpenPrefs,
  cleanupBusy,
  onExport,
  exportCount,
  batchMode,
  batchBusy,
  onToggleBatch,
  onWeeklyReport,
  reportLoading,
}: IntelToolbarProps) {
  // intel-01 降噪：低频维护动作默认收进“更多”内联展开行(非浮层，避开点击失效坑)，主操作行只留 3 个高频动作 + 唯一 filled 主 CTA
  const [moreOpen, setMoreOpen] = useState(false)
  const secondaryBtn =
    "flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  return (
    <div className="sticky top-14 z-30 -mx-4 -mt-4 mb-5 flex flex-wrap items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur lg:-mx-6 lg:-mt-6 lg:px-6">
      <button
        type="button"
        onClick={onOpenEntry}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Plus className="h-4 w-4" />
        手动录入
      </button>
      <button
        type="button"
        onClick={onToggleBatch}
        disabled={batchBusy}
        title={batchMode ? "退出批量管理" : "多选情报后批量确认、忽略或收藏"}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
          batchMode
            ? "border-primary/60 bg-primary/10 font-medium text-primary"
            : "border-border bg-card text-card-foreground hover:bg-secondary"
        }`}
      >
        <CheckSquare className="h-4 w-4 text-primary" />
        {batchMode ? "退出批量" : "批量管理"}
      </button>
      <button
        type="button"
        onClick={onWeeklyReport}
        disabled={reportLoading}
        title="调用 AI 汇总近 7 天情报生成售前周报（会计费）"
        className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3 py-1.5 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Sparkles className={`h-4 w-4 text-primary${reportLoading ? " animate-spin" : ""}`} />
        {reportLoading ? "周报生成中…" : "AI 情报周报"}
      </button>
      <button
        type="button"
        onClick={onOpenCleanup}
        disabled={cleanupBusy}
        title="按医疗信息化建设口径筛查并清理存量不相关采集条目（手动录入不受影响）"
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Eraser className={`h-4 w-4 text-primary${cleanupBusy ? " animate-pulse" : ""}`} />
        {cleanupBusy ? "清理中…" : "清理不相关"}
      </button>
      <button
        type="button"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((v) => !v)}
        title="展开/收起信息源、偏好、导出等维护动作"
        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        更多操作
        {moreOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      <div className="ml-auto flex items-center gap-2">
        {modelOptions.length > 1 && (
          <ModelSelect models={modelOptions} valueKey={selectedModelKey} onChange={onSelectModel} />
        )}
      </div>
      {moreOpen && (
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2 animate-in fade-in duration-200">
          <button type="button" onClick={onOpenSources} className={secondaryBtn}>
            <Settings2 className="h-4 w-4 text-primary" />
            信息源
          </button>
          <button
            type="button"
            onClick={onOpenPrefs}
            title="设置我的关注区域、重点网站与内容偏好"
            className={secondaryBtn}
          >
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            我的偏好
          </button>
          <button
            type="button"
            onClick={onExport}
            title={`把当前已加载的 ${exportCount} 条情报导出为 Excel 清单`}
            className={secondaryBtn}
          >
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            导出清单{exportCount > 0 ? `（${exportCount}）` : ""}
          </button>
        </div>
      )}
    </div>
  )
}
