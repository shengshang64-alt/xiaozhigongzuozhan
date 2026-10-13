import { useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Info, ListChecks, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RequirementClause } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// 改造 3：大纲「需求响应覆盖」核验条 + 未响应条款折叠列表（本地计算，零 AI 调用）
// R292：追加「大纲 ↔ 章节清单」漂移提示与一键同步。覆盖核验按大纲叶子统计，而正文生成与导出的真源
// 是章节清单（bid_chapters）——大纲里有、清单里没有的顶层章会让覆盖率转绿、交付物却依旧缺响应。
// ---------------------------------------------------------------------------

type OutlineCoverageProps = {
  outlineClauseTotal: number
  coveredClauseCount: number
  uncoveredClauses: RequirementClause[]
  addClauseToOutline: (clauseId: string) => void
  addAllClausesToOutline: () => void
  /**
   * 只读诊断三态（R292 + R295）：
   * - missingTitles = 清单缺章（正文与导出必无），可一键同步补入；
   * - relinkTitles = 大纲重生成后的 id 漂移（标题已有章，同步不会重复建章）；
   * - fragmentTitles = 条款碎片顶层节点（历史脏数据，不是章节），同步时自动跳过，只提示人工清理。
   */
  outlineChapterDrift: { missingTitles: string[]; relinkTitles: string[]; fragmentTitles: string[] }
  /** R292 一键同步：把大纲里有、清单里缺的章与小节补进章节清单（只增不删，不动任何已有正文） */
  syncOutlineChapters: () => void
}

export function OutlineCoverage({
  outlineClauseTotal,
  coveredClauseCount,
  uncoveredClauses,
  addClauseToOutline,
  addAllClausesToOutline,
  outlineChapterDrift,
  syncOutlineChapters,
}: OutlineCoverageProps) {
  const [listOpen, setListOpen] = useState(false)
  const driftMissing = outlineChapterDrift.missingTitles
  const driftRelink = outlineChapterDrift.relinkTitles
  // R295：碎片提示条独立渲染，故渲染条件也要把它算进来（否则碎片永远不可见）
  const driftFragments = outlineChapterDrift.fragmentTitles ?? []
  if (!outlineClauseTotal && !driftMissing.length && !driftFragments.length) return null
  const allCovered = uncoveredClauses.length === 0
  return (
    <div className="mb-4 rounded-lg border border-border bg-card shadow-md">
      {!!outlineClauseTotal && (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              需求响应覆盖{" "}
              <span className={`text-sm font-bold ${allCovered ? "text-primary" : "text-destructive"}`}>
                {coveredClauseCount}/{outlineClauseTotal}
              </span>
              <span className="ml-2">条招标要求条款已在大纲叶子节点有落点</span>
            </p>
          </div>
          {!allCovered && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                onClick={addAllClausesToOutline}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                全部补入（{uncoveredClauses.length}）
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setListOpen((v) => !v)}
                className="border-border text-muted-foreground shadow-sm hover:text-foreground"
              >
                {listOpen ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
                未响应条款
              </Button>
            </div>
          )}
          {allCovered && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">条款全覆盖</span>
          )}
        </div>
      )}
      {driftFragments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
          <p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              大纲里另有 {driftFragments.length} 个顶层节点其实是招标条款原文（{driftFragments.slice(0, 3).join("、")}
              {driftFragments.length > 3 ? " 等" : ""}），不是章节名。它们是早期补入留下的脏数据，
              同步章节清单会**自动跳过**它们（不会生成「交付地点」这类无意义章节）；确认无用后请在大纲里手动删除。
            </span>
          </p>
        </div>
      )}
      {driftMissing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-warning/10 px-4 py-2.5">
          <p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              章节清单缺 {driftMissing.length} 个大纲顶层技术章（{driftMissing.slice(0, 3).join("、")}
              {driftMissing.length > 3 ? " 等" : ""}）：它们不会进入正文生成与导出，覆盖转绿也不代表交付物已响应。
              {driftRelink.length > 0
                ? `另有 ${driftRelink.length} 章属大纲重生成后的 id 漂移（标题已有章，同步不会重复建章）。`
                : ""}
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={syncOutlineChapters}
            className="shrink-0 border-warning/50 text-warning hover:bg-warning/10"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            同步章节清单
          </Button>
        </div>
      )}
      {!!outlineClauseTotal && !allCovered && listOpen && (
        <ul className="max-h-72 overflow-y-auto border-t border-border px-4 py-2">
          {uncoveredClauses.map((cl) => (
            <li key={cl.id} className="flex items-start justify-between gap-3 border-b border-border/60 py-2 last:border-0">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">
                <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{cl.id}</span>
                <span className="mr-1.5 text-muted-foreground">[{cl.source}]</span>
                {cl.text}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addClauseToOutline(cl.id)}
                className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                补入大纲
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
