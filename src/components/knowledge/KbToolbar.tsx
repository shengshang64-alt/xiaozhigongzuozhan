// 知识库工具条：库切换页签（带文档数徽标）+ 全文搜索框。
import { Library, NotebookPen, Search, X } from "lucide-react"
import type { LibTab } from "@/pages/Knowledge/useKnowledge"

type KbToolbarProps = {
  libTab: LibTab
  setLibTab: (tab: LibTab) => void
  teamCount: number
  personalCount: number
  searchQuery: string
  setSearchQuery: (q: string) => void
}

export function KbToolbar({ libTab, setLibTab, teamCount, personalCount, searchQuery, setSearchQuery }: KbToolbarProps) {
  const tabs: { key: LibTab; label: string; count: number; Icon: typeof Library }[] = [
    { key: "team", label: "团队知识库", count: teamCount, Icon: Library },
    { key: "personal", label: "我的笔记", count: personalCount, Icon: NotebookPen },
  ]
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
        {tabs.map((tab) => {
          const active = libTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setLibTab(tab.key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active
                  ? "bg-card font-medium text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.Icon className="h-3.5 w-3.5" />
              {tab.label}
              <span
                className={`rounded-full px-1.5 text-xs ${
                  active ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground"
                }`}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>
      <div className="relative min-w-52 flex-1 sm:max-w-80">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索标题与正文关键词…"
          aria-label="搜索知识库文档"
          className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-8 text-sm text-card-foreground shadow-sm transition-shadow placeholder:text-muted-foreground hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="清空搜索"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
