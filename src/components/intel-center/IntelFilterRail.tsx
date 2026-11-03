import { SOURCE_TYPE_LABEL, type IntelSourceType } from "@/pages/IntelCenter/useIntelCenter"

type IntelFilterRailProps = {
  typeTab: "all" | IntelSourceType
  onTypeTab: (t: "all" | IntelSourceType) => void
  statusTab: "active" | "pending" | "confirmed" | "ignored"
  onStatusTab: (s: "active" | "pending" | "confirmed" | "ignored") => void
  sinceRange: "all" | "7" | "30"
  onSinceChange: (v: "all" | "7" | "30") => void
  allTags: string[]
  activeTag: string
  onTagClick: (tag: string) => void
}

const TYPE_ITEMS: { key: "all" | IntelSourceType; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "policy", label: "政策" },
  { key: "bid", label: "招标中标" },
  { key: "competitor", label: "竞品" },
  { key: "media", label: "行业媒体" },
]

const STATUS_ITEMS: { key: "active" | "pending" | "confirmed" | "ignored"; label: string }[] = [
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "ignored", label: "已忽略" },
  { key: "active", label: "进行中" },
]

const SINCE_ITEMS: { key: "all" | "7" | "30"; label: string }[] = [
  { key: "7", label: "近 7 天" },
  { key: "30", label: "近 30 天" },
  { key: "all", label: "全部时间" },
]

function chipClass(on: boolean): string {
  return on
    ? "rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors"
    : "rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 mt-4 text-[11px] font-semibold tracking-wide text-muted-foreground first:mt-0">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  )
}

/** 左筛选栏：类型 / 处理状态 / 时间范围 / 标签（对齐重构原型三栏布局） */
export function IntelFilterRail({
  typeTab,
  onTypeTab,
  statusTab,
  onStatusTab,
  sinceRange,
  onSinceChange,
  allTags,
  activeTag,
  onTagClick,
}: IntelFilterRailProps) {
  return (
    <aside className="rounded-lg border border-border bg-card p-3 shadow-md">
      <Group label="情报类型">
        {TYPE_ITEMS.map((it) => (
          <button key={it.key} type="button" onClick={() => onTypeTab(it.key)} className={chipClass(typeTab === it.key)} title={it.key === "policy" ? SOURCE_TYPE_LABEL.policy : undefined}>
            {it.label}
          </button>
        ))}
      </Group>
      <Group label="处理状态">
        {STATUS_ITEMS.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onStatusTab(it.key)}
            className={chipClass(statusTab === it.key)}
            title="按你自己的确认状态筛选，不影响其他成员"
          >
            {it.label}
          </button>
        ))}
      </Group>
      <Group label="时间范围">
        {SINCE_ITEMS.map((it) => (
          <button key={it.key} type="button" onClick={() => onSinceChange(it.key)} className={chipClass(sinceRange === it.key)}>
            {it.label}
          </button>
        ))}
      </Group>
      {allTags.length > 0 && (
        <Group label="标签">
          {allTags.slice(0, 16).map((tag) => (
            <button key={tag} type="button" onClick={() => onTagClick(tag)} className={chipClass(activeTag === tag)}>
              {tag}
            </button>
          ))}
        </Group>
      )}
    </aside>
  )
}
