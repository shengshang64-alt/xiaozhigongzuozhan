import { useState } from "react"
import { ChevronDown, ChevronRight, ListChecks, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RequirementClause } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// 改造 3：大纲「需求响应覆盖」核验条 + 未响应条款折叠列表（本地计算，零 AI 调用）
// ---------------------------------------------------------------------------

type OutlineCoverageProps = {
  outlineClauseTotal: number
  coveredClauseCount: number
  uncoveredClauses: RequirementClause[]
  addClauseToOutline: (clauseId: string) => void
  addAllClausesToOutline: () => void
}

export function OutlineCoverage({
  outlineClauseTotal,
  coveredClauseCount,
  uncoveredClauses,
  addClauseToOutline,
  addAllClausesToOutline,
}: OutlineCoverageProps) {
  const [listOpen, setListOpen] = useState(false)
  if (!outlineClauseTotal) return null
  const allCovered = uncoveredClauses.length === 0
  return (
    <div className="mb-4 rounded-lg border border-border bg-card shadow-md">
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
      {!allCovered && listOpen && (
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
