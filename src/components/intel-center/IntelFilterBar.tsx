import { Search, X } from "lucide-react"
import { SOURCE_TYPE_LABEL, type IntelListSortKey, type IntelSourceType } from "@/pages/IntelCenter/useIntelCenter"

type IntelFilterBarProps = {
  typeTab: "all" | IntelSourceType
  onTypeTab: (t: "all" | IntelSourceType) => void
  statusTab: "active" | "pending" | "confirmed" | "ignored"
  onStatusTab: (s: "active" | "pending" | "confirmed" | "ignored") => void
  searchInput: string
  onSearchInput: (v: string) => void
  onSubmitSearch: () => void
  onClearFilters: () => void
  allTags: string[]
  activeTag: string
  onTagClick: (tag: string) => void
  sinceRange: "all" | "7" | "30"
  onSinceChange: (v: "all" | "7" | "30") => void
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

const TYPE_TABS: { key: "all" | IntelSourceType; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "policy", label: SOURCE_TYPE_LABEL.policy },
  { key: "competitor", label: SOURCE_TYPE_LABEL.competitor },
  { key: "bid", label: SOURCE_TYPE_LABEL.bid },
  { key: "media", label: SOURCE_TYPE_LABEL.media },
]

const STATUS_TABS: { key: "active" | "pending" | "confirmed" | "ignored"; label: string }[] = [
  { key: "active", label: "进行中" },
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "ignored", label: "已忽略" },
]

export function IntelFilterBar({
  typeTab,
  onTypeTab,
  statusTab,
  onStatusTab,
  searchInput,
  onSearchInput,
  onSubmitSearch,
  onClearFilters,
  allTags,
  activeTag,
  onTagClick,
  sinceRange,
  onSinceChange,
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
        <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTypeTab(tab.key)}
              className={
                typeTab === tab.key
                  ? "rounded-full bg-card px-3.5 py-1.5 text-sm font-medium text-primary shadow-sm transition-colors"
                  : "rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-0.5" title="按你自己的确认状态筛选，不影响其他成员">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onStatusTab(tab.key)}
              className={
                statusTab === tab.key
                  ? "rounded-full bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm transition-colors"
                  : "rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
          value={sinceRange}
          onChange={(ev) => onSinceChange(ev.target.value as "all" | "7" | "30")}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="all">全部时间</option>
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
        </select>
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

      {allTags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick(tag)}
              className={
                activeTag === tag
                  ? "rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors"
                  : "rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              }
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
