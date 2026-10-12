import { useState } from "react"
import { ChevronDown, ChevronUp, Copy, Loader2, Sparkles, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyTextToClipboard } from "@/lib/clipboard"
import { buildSelfCheckBriefText, type SelfCheckOverview } from "@/pages/SolutionStudio/solSelfCheckOverview"
import { VERDICT_LABEL } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// R276 方案整本五维自检总览卡：把各章散落的 AI 自检评分汇成一份整本体检——
// 覆盖率、均分、结论分布、各维度均分与短板、待重写清单（点击跳章）、高频问题。
// 「一键批量自检」对全部已生成正文的章节逐章跑五维自检（有限并发 2，可中断），
// 复用单章同一套 prompt 与解析链路（零提示词改动）。评分明细属 AI 建议，
// 与交付前本地体检互补：那张卡管确定性硬伤，这张卡管内容质量强弱项。只报不拦。
// ---------------------------------------------------------------------------

type Props = {
  overview: SelfCheckOverview
  busy: boolean
  progress: { current: number; total: number }
  onStart: () => void
  onCancel: () => void
  onSelectChapter: (nodeId: string) => void
}

const VERDICT_TONE: Record<"direct" | "review" | "blocked", string> = {
  direct: "bg-primary/10 text-primary",
  review: "bg-warning/10 text-warning",
  blocked: "bg-destructive/10 text-destructive",
}

export function SolutionSelfCheckOverviewCard({ overview, busy, progress, onStart, onCancel, onSelectChapter }: Props) {
  const [expanded, setExpanded] = useState(false)
  // 无正文可自检时不占版面（自检候选池为空即隐藏）
  if (overview.bodyChapters === 0) return null

  const hasReviewed = overview.reviewedCount > 0
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0
  const brief = buildSelfCheckBriefText(overview)

  return (
    <section className="mt-4 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          整本 AI 自检总览
        </h2>
        {hasReviewed ? (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-card-foreground">
            均分 {overview.avgTotal} · 已检 {overview.reviewedCount}/{overview.bodyChapters}（{overview.reviewedRatio}%）
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {overview.bodyChapters} 章已成正文，尚未自检
          </span>
        )}
        {hasReviewed &&
          (["direct", "review", "blocked"] as const)
            .filter((v) => overview.verdictDist[v] > 0)
            .map((v) => (
              <span key={v} className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_TONE[v]}`}>
                {VERDICT_LABEL[v]} {overview.verdictDist[v]}
              </span>
            ))}
        {hasReviewed && overview.rewriteList.length > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_TONE.blocked}`}>
            待重写 {overview.rewriteList.length}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {busy ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                自检中 {progress.current}/{progress.total}
              </span>
              <Button size="sm" variant="outline" onClick={onCancel} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                <Square className="mr-1.5 h-3.5 w-3.5" />
                停止
              </Button>
            </>
          ) : (
            <>
              {hasReviewed && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void copyTextToClipboard(brief, {
                      successMessage: "已复制自检总览，可转入整改笔记",
                      errorMessage: "复制失败，请手动选择文本复制",
                    })
                  }}
                  className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  复制总览
                </Button>
              )}
              <Button size="sm" onClick={onStart} className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {hasReviewed ? "重新批量自检" : "一键批量自检"}
                <span className="ml-1 opacity-90">（{overview.bodyChapters} 章）</span>
              </Button>
            </>
          )}
          {hasReviewed && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {expanded ? "收起明细" : "展开明细"}
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {busy && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}

      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {hasReviewed
          ? `已汇总 ${overview.reviewedCount} 章五维评分${overview.pendingCount ? `；另有 ${overview.pendingCount} 章已成正文未纳入本轮` : ""}。评分为 AI 建议，供定位强弱项与优先整改，不拦导出。`
          : "对已生成正文的章节逐章做 coverage/logic/evidence/feasibility/writing 五维评分（章间并发 2，可中断），完成后此处汇总整本强弱项。"}
      </p>

      {expanded && hasReviewed && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium text-card-foreground">各维度均分（满分 20）</h3>
              <ul className="mt-1.5 flex flex-col gap-1">
                {overview.dimStats.map((d) => (
                  <li key={d.key} className="flex items-center gap-2 text-xs">
                    <span className={`w-24 shrink-0 ${overview.weakestDim?.key === d.key ? "font-medium text-warning" : "text-muted-foreground"}`}>
                      {d.label}
                      {overview.weakestDim?.key === d.key ? " ·短板" : ""}
                    </span>
                    <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-primary/70" style={{ width: `${Math.min(100, (d.avg / 20) * 100)}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-card-foreground">{d.avg}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-medium text-card-foreground">高频问题</h3>
              {overview.topIssues.length ? (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {overview.topIssues.slice(0, 8).map((g) => (
                    <li key={g.dim} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {g.dim} ×{g.count}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">未记录明显问题。</p>
              )}
            </div>
          </div>

          {overview.rewriteList.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-medium text-card-foreground">建议重写章节（点击跳章）</h3>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {overview.rewriteList.map((r) => (
                  <li key={r.nodeId}>
                    <button
                      type="button"
                      onClick={() => onSelectChapter(r.nodeId)}
                      title="跳到该章按建议重写"
                      className="rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-0.5 text-xs text-card-foreground transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {r.title} · {r.total}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
