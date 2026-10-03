// AI 动态页：AIHOT 行业精选流时间线 + 分类筛选 + 一键转情报中心（R139）
// 定位与情报中心互补：情报中心盯「医疗信息化招标/政策」，本页盯「AI 行业动向」，
// 有价值条目转存回情报流走团队确认沉淀。
import { BookmarkCheck, Check, ExternalLink, Flame, Inbox, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shell/PageHeader"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import type { AiHotItem } from "@/lib/aiHotFeed"
import type { useAiHot } from "./useAiHot"

const CAT_COLORS: Record<string, string> = {
  行业动态: "bg-sky-50 text-sky-700 border-sky-200",
  "AI 模型": "bg-violet-50 text-violet-700 border-violet-200",
  "AI 产品": "bg-emerald-50 text-emerald-700 border-emerald-200",
  论文: "bg-amber-50 text-amber-700 border-amber-200",
  技巧观点: "bg-rose-50 text-rose-700 border-rose-200",
}

function CatChip({ category }: { category: string }) {
  if (!category) return null
  return (
    <span
      className={
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
        (CAT_COLORS[category] ?? "bg-muted text-muted-foreground border-border")
      }
    >
      {category}
    </span>
  )
}

function AiHotCard({
  item,
  saved,
  saving,
  onTransfer,
}: {
  item: AiHotItem
  saved: boolean
  saving: boolean
  onTransfer: (item: AiHotItem) => void
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-1.5 text-[14.5px] font-medium leading-snug text-foreground hover:text-primary"
          >
            <span className="min-w-0">{item.title}</span>
            <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-primary" />
          </a>
          {item.summary && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{item.summary}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
            <CatChip category={item.category} />
            {item.source && <span className="truncate max-w-[220px]" title={item.source}>{item.source}</span>}
            {item.publishedAt && <span>{formatDateTimeDisplay(item.publishedAt)}</span>}
          </div>
        </div>
        <div className="shrink-0">
          {saved ? (
            <span className="flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-primary">
              <Check className="h-3.5 w-3.5" /> 已转入
            </span>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => onTransfer(item)}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkCheck className="h-3.5 w-3.5" />}
              <span className="ml-1.5">转情报中心</span>
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

export function AiHotPage(p: ReturnType<typeof useAiHot>) {
  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <main className="pb-10">
        <PageHeader
          title="AI 动态"
          desc="AI 行业 168 个精选信源的每日动态（AIHOT），作为情报中心医疗信息化情报流之外的外部视角补充；有价值的一键转入情报流，走团队确认沉淀"
        />

        <section className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-md">
          <Flame className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground md:text-sm">
            仅拉取 AIHOT 公开行业资讯，零 AI 计费、不发送任何本地数据；转入的情报默认仅自己可见，打开右侧开关可公开到团队。
          </p>
          <label className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={p.publishToTeam}
              onChange={(ev) => p.setPublishToTeam(ev.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            转入情报公开到团队
          </label>
        </section>

        <section className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => p.setActiveCat("")}
            className={
              "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors " +
              (p.activeCat === ""
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/40")
            }
          >
            全部 {p.items.length}
          </button>
          {p.categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => p.setActiveCat(p.activeCat === c ? "" : c)}
              className={
                "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors " +
                (p.activeCat === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40")
              }
            >
              {c} {p.items.filter((it) => it.category === c).length}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-[11.5px] text-muted-foreground">
            {p.fetchedAt && <span>更新于 {formatDateTimeDisplay(p.fetchedAt)}</span>}
            <Button type="button" size="sm" variant="outline" disabled={p.loading} onClick={p.refresh}>
              {p.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">刷新</span>
            </Button>
          </div>
        </section>

        {p.loading && p.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <span className="text-sm">正在拉取 AI 行业动态…</span>
          </div>
        ) : p.error && p.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-16 shadow-sm">
            <Inbox className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">{p.error}</p>
            <Button type="button" size="sm" variant="outline" onClick={p.refresh}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="ml-1.5">重试</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {p.error && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{p.error}</p>
            )}
            {p.visible.map((item) => (
              <AiHotCard
                key={item.id}
                item={item}
                saved={p.savedIds.has(item.id)}
                saving={p.savingId === item.id}
                onTransfer={p.transfer}
              />
            ))}
            {p.visible.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">该分类下暂无条目</p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
