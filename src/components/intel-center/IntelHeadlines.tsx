import { ChevronRight } from "lucide-react"
import { primaryTopicBadge, type HeadlineColumnKey } from "@/pages/IntelCenter/intelTopics"
import type { IntelItemRow } from "@/pages/IntelCenter/useIntelCenter"

export const HEADLINE_COLUMNS: { key: HeadlineColumnKey; title: string; hint: string }[] = [
  { key: "policy", title: "政策与评级", hint: "政策、评级测评与医保信息化" },
  { key: "bid", title: "招标中标", hint: "软件与信息化类，纯硬件已隐藏" },
  { key: "competitor", title: "竞品与产品", hint: "厂商与产品动态" },
  { key: "media", title: "行业观点", hint: "智慧医院、核心系统、等保与信创，不含纯 AI 泛资讯" },
]

type Props = {
  columns: Record<HeadlineColumnKey, IntelItemRow[]>
  onOpenDetail: (item: IntelItemRow) => void
  onViewAll: (key: HeadlineColumnKey) => void
}

export function IntelHeadlines({ columns, onOpenDetail, onViewAll }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-md" aria-label="医疗信息化要闻">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">医疗信息化要闻</h2>
        <p className="text-xs text-muted-foreground">近 30 天政策、招标、竞品与行业观点，每栏最多 5 条</p>
      </header>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {HEADLINE_COLUMNS.map((col) => {
          const items = columns[col.key] ?? []
          return (
            <div key={col.key} className="min-w-0 rounded-lg border border-border/80 bg-background/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{col.title}</h3>
                  <p className="truncate text-[11px] text-muted-foreground">{col.hint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onViewAll(col.key)}
                  className="shrink-0 text-[11px] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  查看全部
                </button>
              </div>
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-4 text-[11px] leading-relaxed text-muted-foreground">
                  近 30 天暂无符合本栏口径的条目
                </p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item) => {
                    const badge = primaryTopicBadge(item.title)
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => onOpenDetail(item)}
                          className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors hover:text-primary">
                            {item.title}
                          </span>
                          {badge ? (
                            <span className="mt-1 inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                              {badge}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
