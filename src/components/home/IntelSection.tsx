import { Link, useNavigate } from "react-router-dom"
import { ArrowRight, Loader2, Newspaper, Radar } from "lucide-react"
import type { IntelItem } from "@/pages/Home/useHome"

type IntelSectionProps = {
  intelItems: IntelItem[]
  intelLoading: boolean
}

function tagClass(tag: string): string {
  // 徽标语义四档（全站设计规范 v1）：政策=主色档，招标=关注档，其余=中性档
  if (tag === "政策") return "badge-success"
  if (tag === "招标" || tag === "中标") return "badge-warning"
  return "badge-neutral"
}

export function IntelSection({ intelItems, intelLoading }: IntelSectionProps) {
  const navigate = useNavigate()
  return (
    <section className="mb-5">
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Newspaper className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">情报摘要</h2>
          <p className="truncate text-xs text-muted-foreground">来自情报中心的最新政策与竞品中标动态，点击进入情报中心处理</p>
        </div>
        <Link
          to="/intel-center"
          className="ml-auto flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Radar className="h-4 w-4 text-primary" />
          进入情报中心
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div className="mt-4 flex flex-col gap-3">
        {intelLoading && intelItems.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-10 text-sm text-muted-foreground shadow-md">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在加载最新情报…
          </div>
        ) : intelItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card py-10 text-center shadow-md">
            <Newspaper className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">暂无情报</p>
            <Link
              to="/intel-center"
              className="mt-1 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              去情报中心添加信息源
            </Link>
          </div>
        ) : (
          intelItems.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-border bg-card shadow-md transition-shadow hover:shadow-lg"
            >
              <button
                type="button"
                onClick={() => navigate(`/intel-center?item=${item.id}`)}
                className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className={`shrink-0 ${tagClass(item.tag)}`}>
                  {item.tag}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.summary}</span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {item.source} · {item.publishedAt}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
