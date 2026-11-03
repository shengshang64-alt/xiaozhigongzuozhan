import { useState } from "react"
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { REVIEW_DIMS, VERDICT_LABEL, type ChapterSelfCheck, type ChapterReviewVerdict } from "@/pages/SolutionStudio/solutionTypes"
import { formatShortDateTime } from "@/lib/dateDisplay"

// ---------------------------------------------------------------------------
// 章节自检评分卡（轮次 E-4）：总分 + verdict 徽标 + 五维条形 + issues 列表，
// 默认收起为一行总分徽标，点开展开全卡。
// ---------------------------------------------------------------------------

type ChapterScoreCardProps = {
  selfCheck: ChapterSelfCheck
  busy?: boolean
  /** 按建议优化（拼 issues 走既有改写链路）；不传则不渲染按钮 */
  onOptimize?: () => void
  /** 重新自检；不传则不渲染按钮 */
  onRecheck?: () => void
}

const VERDICT_BADGE: Record<ChapterReviewVerdict, string> = {
  direct: "badge-success",
  review: "badge-warning",
  blocked: "badge-danger",
}

/** 五维条形颜色按档位 token：≥17 主色 / 12-16 关注 / <12 风险 */
function scoreTone(score: number): string {
  if (score >= 17) return "bg-primary"
  if (score >= 12) return "bg-warning"
  return "bg-destructive"
}

function scoreTextTone(score: number): string {
  if (score >= 17) return "text-primary"
  if (score >= 12) return "text-warning"
  return "text-destructive"
}

/** 总分（0-100）按 verdict 同档阈值取色 */
function totalTextTone(total: number): string {
  if (total >= 85) return "text-primary"
  if (total >= 70) return "text-warning"
  return "text-destructive"
}

export function ChapterScoreCard({ selfCheck, busy, onOptimize, onRecheck }: ChapterScoreCardProps) {
  const [expanded, setExpanded] = useState(false)
  const checkedLabel = formatShortDateTime(selfCheck.checked_at)

  return (
    <div className="shrink-0 rounded-lg border border-border bg-secondary/40 shadow-sm">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
      >
        <span className="text-xs font-medium text-foreground">章节自检</span>
        <span className={`text-base font-bold tabular-nums ${totalTextTone(selfCheck.total)}`}>
          {selfCheck.total}
          <span className="text-xs font-normal text-muted-foreground"> / 100</span>
        </span>
        <span className={VERDICT_BADGE[selfCheck.verdict]}>{VERDICT_LABEL[selfCheck.verdict]}</span>
        {selfCheck.issues.length > 0 && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {selfCheck.issues.length} 项建议
          </span>
        )}
        {checkedLabel && <span className="ml-auto text-xs text-muted-foreground">{checkedLabel}</span>}
        {expanded ? (
          <ChevronUp className={`h-4 w-4 text-muted-foreground ${checkedLabel ? "" : "ml-auto"}`} />
        ) : (
          <ChevronDown className={`h-4 w-4 text-muted-foreground ${checkedLabel ? "" : "ml-auto"}`} />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div className="space-y-2">
            {REVIEW_DIMS.map((dim) => {
              const score = selfCheck.scores[dim.key] ?? 0
              const pct = Math.round((score / 20) * 100)
              return (
                <div key={dim.key} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{dim.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-all duration-500 ${scoreTone(score)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`w-10 shrink-0 text-right text-xs font-medium tabular-nums ${scoreTextTone(score)}`}>{score}/20</span>
                </div>
              )
            })}
          </div>

          {selfCheck.issues.length > 0 ? (
            <ul className="space-y-2">
              {selfCheck.issues.map((issue, i) => (
                <li key={`${issue.dim}-${i}`} className="rounded-md border border-border bg-card p-2.5">
                  <p className="flex items-center gap-1.5 text-xs">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{issue.dim}</span>
                    <span className="font-medium text-foreground">{issue.problem}</span>
                  </p>
                  {issue.suggestion && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">建议：{issue.suggestion}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">本次自检没有发现明显问题。</p>
          )}

          {(onOptimize || onRecheck) && (
            <div className="flex flex-wrap items-center gap-2">
              {onOptimize && (
                <Button size="sm" variant="outline" disabled={busy} onClick={onOptimize} className="border-primary/40 text-primary hover:bg-primary/10 hover:text-primary">
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
                  按建议优化
                </Button>
              )}
              {onRecheck && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={onRecheck} className="text-muted-foreground hover:text-foreground">
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  重新自检
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
