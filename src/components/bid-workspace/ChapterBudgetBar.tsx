import { Loader2 } from "lucide-react"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// 改造 1：章节篇幅进度条——「本章 X 字 / 预算 Y 字 · 约 Z 页」+ 自动补足进行中徽标
// ---------------------------------------------------------------------------

type ChapterBudgetBarProps = {
  activeChapter: Chapter | null
  charCount: number
  budget: number
  supplementState: { nodeId: string; round: number } | null
}

export function ChapterBudgetBar({ activeChapter, charCount, budget, supplementState }: ChapterBudgetBarProps) {
  if (!activeChapter || budget <= 0) return null
  const pages = Math.max(1, Math.round(charCount / 500))
  const pct = Math.min(100, Math.round((charCount / budget) * 100))
  const reached = charCount >= budget * 0.9
  const supplementing = supplementState?.nodeId === activeChapter.node_id
  return (
    <div className="mb-3 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          本章 <span className="text-sm font-bold text-foreground">{charCount}</span> 字 / 预算{" "}
          <span className="text-sm font-bold text-foreground">{budget}</span> 字 · 约{" "}
          <span className="text-sm font-bold text-foreground">{pages}</span> 页
          {!reached && !supplementing && <span className="ml-2">未达预算 90% 时生成后将自动续写补足（最多 6 轮）</span>}
        </p>
        {supplementing ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            补足中 第 {supplementState?.round} 轮
          </span>
        ) : reached ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">篇幅达标</span>
        ) : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${reached ? "bg-primary" : "bg-primary/60"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
