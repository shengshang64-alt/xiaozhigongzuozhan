import type { ParseGroupId } from "./parseReportLayout"

export type ParseGroupTab = {
  id: ParseGroupId
  label: string
  badge?: string
  alert?: boolean
}

/** 解析报告的四个分组。选中态用卡片底，不和首屏主按钮抢青色。 */
export function ParseGroupNav({
  value,
  onChange,
  tabs,
}: {
  value: ParseGroupId
  onChange: (id: ParseGroupId) => void
  tabs: ParseGroupTab[]
}) {
  return (
    <div role="tablist" aria-label="解析报告分组" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => {
        const selected = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`parse-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`parse-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.badge && (
              <span className={tab.alert ? "badge-danger" : "badge-neutral"}>{tab.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
