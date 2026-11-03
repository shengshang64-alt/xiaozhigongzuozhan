import { Search, X } from "lucide-react"
import { type IntelListSortKey } from "@/pages/IntelCenter/useIntelCenter"

type IntelFilterBarProps = {
  // 重构轮：类型/状态/时间/标签已迁入左筛选栏 IntelFilterRail，此处仅保留搜索与次要维度
  searchInput: string
  onSearchInput: (v: string) => void
  onSubmitSearch: () => void
  onClearFilters: () => void
  regionFilter: string
  onRegionFilter: (v: string) => void
  regionOptions: { value: string; label: string }[]
  sourceFilter: string
  onSourceFilter: (v: string) => void
  sourceOptions: { value: string; label: string }[]
  // 循环 10 小改 1：列表排序口径
  sortKey: IntelListSortKey
  onSortChange: (k: IntelListSortKey) => void
}

export function IntelFilterBar({
  searchInput,
  onSearchInput,
  onSubmitSearch,
  onClearFilters,
  regionFilter,
  onRegionFilter,
  regionOptions,
  sourceFilter,
  onSourceFilter,
  sourceOptions,
  sortKey,
  onSortChange,
}: IntelFilterBarProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(ev) => onSearchInput(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") onSubmitSearch()
            }}
            placeholder="搜索标题、摘要或正文关键词…"
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <button
          type="button"
          onClick={onSubmitSearch}
          className="h-9 rounded-md border border-primary/40 bg-card px-4 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          搜索
        </button>
        <select
          value={regionFilter}
          onChange={(ev) => onRegionFilter(ev.target.value)}
          title="按情报涉及的区域筛选"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {regionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(ev) => onSourceFilter(ev.target.value)}
          title="按信息源筛选"
          className="h-9 max-w-52 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {sourceOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(ev) => onSortChange(ev.target.value as IntelListSortKey)}
          title="列表排序口径（关注项始终置顶）"
          className="h-9 max-w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="published">按发布时刻</option>
          <option value="added">按加入时刻</option>
          <option value="title">按标题</option>
        </select>
        <button
          type="button"
          onClick={onClearFilters}
          className="flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-3.5 w-3.5" />
          清空筛选
        </button>
      </div>
    </section>
  )
}
