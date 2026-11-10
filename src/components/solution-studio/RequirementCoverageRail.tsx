import { useMemo } from "react"
import { Copy, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  REQUIREMENT_COVERAGE_LABEL,
  REQUIREMENT_COVERAGE_ORDER,
  auditRequirementCoverage,
  buildRequirementPendingText,
  type RequirementCoverageLevel,
} from "@/pages/SolutionStudio/requirementCoverage"
import type { Chapter, ChecklistSnapshot } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// 需求覆盖 · 编辑器右栏紧凑卡（UX-v2：prototype/solution/editor.html 右栏第 1 卡）。
// 与「交付检查」屏里的 RequirementCoverageCard（全明细）共用同一套本地逐字命中审计
// （auditRequirementCoverage，零 AI 零费用，随正文自动保存实时重算）：
//   · 右栏看「进度与缺口」：环图 + 四态计数 + 未落实/部分 清单（点击跳章）；
//   · 交付检查屏看「逐条明细」：筛选、缺失要点、多落点章。
// 未关联建设清单时保留卡骨架 + 诚实空态（原型该卡同样要有位置，不整卡消失）。
// 无真数据不出演示值：覆盖率环图永远画本地真审计结果。
// ---------------------------------------------------------------------------

type RequirementCoverageRailProps = {
  snapshot: ChecklistSnapshot | undefined
  chapters: Chapter[]
  onSelectChapter: (nodeId: string) => void
}

const LEVEL_DOT: Record<RequirementCoverageLevel, string> = {
  full: "bg-primary",
  partial: "bg-warning",
  outline: "bg-muted-foreground/50",
  missing: "bg-destructive",
}

const LEVEL_TONE: Record<RequirementCoverageLevel, string> = {
  full: "bg-primary/10 text-primary",
  partial: "bg-warning/10 text-warning",
  outline: "bg-muted text-muted-foreground",
  missing: "bg-destructive/10 text-destructive",
}

/** 未落实/部分落实/仅大纲：右栏只列「还差什么」，已落实不占行 */
const PENDING_LEVELS: RequirementCoverageLevel[] = ["missing", "partial", "outline"]

/** 一行最多显示 3 个命中章，其余折叠为「+N」，防 300px 右栏被撑爆 */
const MAX_HIT_CHIPS = 3

/** 正文尚未生成时不吓玩家：「未落实」降格为中性色（等正文出来再复核） */
function toneOf(level: RequirementCoverageLevel, noBody: boolean): string {
  if (noBody && level === "missing") return "bg-muted text-muted-foreground"
  return LEVEL_TONE[level]
}

export function RequirementCoverageRail({ snapshot, chapters, onSelectChapter }: RequirementCoverageRailProps) {
  const requirementLines = snapshot?.customer_requirements
  const result = useMemo(() => auditRequirementCoverage(requirementLines, chapters), [requirementLines, chapters])
  const noSnapshot = !requirementLines?.length || result.total === 0
  const pct = noSnapshot ? 0 : Math.round((result.counts.full / result.total) * 100)
  const noBody = result.generatedChapters === 0
  const pendingRows = noSnapshot ? [] : result.rows.filter((r) => PENDING_LEVELS.includes(r.level))
  const listName = (snapshot?.checklist_name ?? "").trim()

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-md">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          需求覆盖
        </h3>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {noSnapshot ? "未关联" : `共 ${result.total} 条`}
        </span>
      </div>

      {noSnapshot ? (
        <div className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
          还没关联建设清单，没有客户需求条目可核对。
          <br />
          在「建设清单」屏选定清单生成方案，或新建方案时选清单，这里就会逐条核对落位。
        </div>
      ) : (
        <>
          <div className="mt-3 flex justify-center">
            <div
              className="relative h-[104px] w-[104px] shrink-0 rounded-full"
              style={{
                background: `conic-gradient(hsl(var(--primary)) 0 ${pct}%, hsl(var(--muted)) ${pct}% 100%)`,
              }}
              role="img"
              aria-label={`需求覆盖率 ${pct}%：已落实 ${result.counts.full} / 共 ${result.total} 条`}
            >
              <div className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-card">
                <b className="text-base tabular-nums text-card-foreground">{pct}%</b>
                <span className="text-[10px] leading-tight text-muted-foreground">覆盖率</span>
              </div>
            </div>
          </div>

          <div className="mt-2.5 flex flex-col gap-1">
            {REQUIREMENT_COVERAGE_ORDER.map((level) => (
              <div key={level} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[level]}`} />
                <span className="min-w-0 flex-1">{REQUIREMENT_COVERAGE_LABEL[level]}</span>
                <b className="tabular-nums text-card-foreground">{result.counts[level]}</b>
              </div>
            ))}
          </div>

          <p className="mt-2.5 border-t border-border pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {noBody
              ? `关联「${listName || "建设清单"}」；正文尚未生成（0/${result.chapterCount} 章），当前为大纲级预判，逐章生成后自动复核。`
              : `本地逐字核对（零费用），正文已生成 ${result.generatedChapters}/${result.chapterCount} 章；「未落实」可能是换了说法，点开确认再补写。`}
          </p>

          {pendingRows.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-card-foreground">
                  待补 {pendingRows.length} 条
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 shrink-0 border-primary/40 px-2 text-[11px] text-primary hover:bg-primary/10"
                  onClick={() => {
                    void copyTextToClipboard(buildRequirementPendingText(result), {
                      successMessage: "已复制待补清单，可作为补写要求粘贴使用",
                      errorMessage: "复制失败，请手动选择文本复制",
                    })
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  复制清单
                </Button>
              </div>
              <ul className="mt-1.5 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
                {pendingRows.map((row) => {
                  const hits = row.bodyChapters.length ? row.bodyChapters : row.outlineChapters
                  return (
                    <li key={row.index} className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${toneOf(row.level, noBody)}`}>
                          {REQUIREMENT_COVERAGE_LABEL[row.level]}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-card-foreground" title={row.item}>
                          {row.item}
                        </span>
                      </div>
                      {!!hits.length && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {hits.slice(0, MAX_HIT_CHIPS).map((h) => (
                            <button
                              key={`${row.index}-${h.nodeId}`}
                              type="button"
                              onClick={() => onSelectChapter(h.nodeId)}
                              title="跳到该章核对正文"
                              className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              {h.title}
                            </button>
                          ))}
                          {hits.length > MAX_HIT_CHIPS && (
                            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              +{hits.length - MAX_HIT_CHIPS} 章
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
