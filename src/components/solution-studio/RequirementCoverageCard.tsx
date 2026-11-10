import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Copy, ListChecks } from "lucide-react"
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
// R162 需求条目落位核验卡：关联清单的客户建设需求条目 vs 大纲标题/成稿正文，
// 本地逐字命中判定（零 AI、零费用），四态汇总 + 按态筛选 + 逐章跳转 + 复制待补清单。
// 未关联建设清单（无条目）时整卡不渲染，不给纯手工方案添噪音；正文随编辑自动保存，
// 卡片跟着重算，补写后无需手动「重新核验」。
// ---------------------------------------------------------------------------

type RequirementCoverageCardProps = {
  snapshot: ChecklistSnapshot | undefined
  chapters: Chapter[]
  onSelectChapter: (nodeId: string) => void
  /** 根节点样式；缺省自带 mt-4（流式布局用），交付检查屏以网格列传入时用无顶距版本 */
  className?: string
}

const LEVEL_TONE: Record<RequirementCoverageLevel, string> = {
  full: "bg-primary/10 text-primary",
  partial: "bg-warning/10 text-warning",
  outline: "bg-muted text-muted-foreground",
  missing: "bg-destructive/10 text-destructive",
}

const FILTERS: Array<"all" | RequirementCoverageLevel> = ["all", ...REQUIREMENT_COVERAGE_ORDER]

/** 一行最多显示 5 个命中章，其余折叠为「+N」，防长清单把卡片撑爆 */
const MAX_HIT_CHIPS = 5

/** 正文尚未生成时不吓玩家：「未落实」降格为中性色（等正文出来再复核） */
function toneOf(level: RequirementCoverageLevel, noBody: boolean): string {
  if (noBody && level === "missing") return "bg-muted text-muted-foreground"
  return LEVEL_TONE[level]
}

export function RequirementCoverageCard({ snapshot, chapters, onSelectChapter, className }: RequirementCoverageCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<"all" | RequirementCoverageLevel>("all")
  // 依赖直接取快照里的数组本体（不在渲染期用 ?? [] 造新数组，否则 useMemo 每轮失稳）
  const requirementLines = snapshot?.customer_requirements
  const result = useMemo(() => auditRequirementCoverage(requirementLines, chapters), [requirementLines, chapters])
  if (!requirementLines?.length || result.total === 0) return null

  const noBody = result.generatedChapters === 0
  const rows = filter === "all" ? result.rows : result.rows.filter((r) => r.level === filter)
  const pendingText = buildRequirementPendingText(result)
  const listName = (snapshot?.checklist_name ?? "").trim()

  return (
    <section className={className ?? "mt-4 rounded-lg border border-border bg-card px-4 py-3 shadow-md"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ListChecks className="h-4 w-4 text-primary" />
          需求条目落位核验
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          共 {result.total} 条
        </span>
        {REQUIREMENT_COVERAGE_ORDER.map((level) => (
          <span key={level} className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneOf(level, noBody)}`}>
            {REQUIREMENT_COVERAGE_LABEL[level]} {result.counts[level]}
          </span>
        ))}
        {result.pending > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void copyTextToClipboard(pendingText, {
                successMessage: "已复制待补清单，可作为补写要求粘贴使用",
                errorMessage: "复制失败，请手动选择文本复制",
              })
            }}
            className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制待补清单
          </Button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {expanded ? "收起明细" : "展开明细"}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {listName ? `关联清单「${listName}」` : "关联建设清单"}共 {result.total} 条客户建设需求条目；
        {noBody
          ? `正文尚未生成（0/${result.chapterCount} 章），当前仅为大纲级预判，逐章生成后本卡自动复核。`
          : `本地逐字核对（零费用），正文已生成 ${result.generatedChapters}/${result.chapterCount} 章；「未落实 / 部分落实」只表示条目要点没在正文逐字出现，可能是换了说法，点开确认后再决定是否补写。`}
        {!!result.boilerplateKeys.length && (
          <span className="ml-1">
            各条共用的模板词（{result.boilerplateKeys.slice(0, 3).join("、")}
            {result.boilerplateKeys.length > 3 ? ` 等 ${result.boilerplateKeys.length} 项` : ""}
            ）不计入逐字核对，避免一句套话造成大面积假命中。
          </span>
        )}
      </p>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => {
              const active = filter === f
              const label = f === "all" ? "全部" : REQUIREMENT_COVERAGE_LABEL[f]
              const count = f === "all" ? result.total : result.counts[f]
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label} {count}
                </button>
              )
            })}
          </div>

          {rows.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              当前筛选条件下没有条目，换个筛选看看
            </p>
          ) : (
            <ul className="mt-3 flex max-h-[340px] flex-col gap-1.5 overflow-y-auto">
              {rows.map((row) => {
                const hits = row.bodyChapters.length ? row.bodyChapters : row.outlineChapters
                const hitLabel = row.bodyChapters.length ? "正文落点" : "大纲落点"
                return (
                  <li key={row.index} className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${toneOf(row.level, noBody)}`}>
                        {REQUIREMENT_COVERAGE_LABEL[row.level]}
                      </span>
                      <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">
                        {row.index + 1}) {row.item}
                      </span>
                    </div>
                    {!!row.missingKeys.length && (
                      <p className="mt-1 leading-relaxed text-muted-foreground">
                        正文未见要点：{row.missingKeys.slice(0, 4).join("、")}
                        {row.missingKeys.length > 4 ? ` 等 ${row.missingKeys.length} 项` : ""}
                      </p>
                    )}
                    {!!hits.length && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="shrink-0 text-muted-foreground">{hitLabel}：</span>
                        {hits.slice(0, MAX_HIT_CHIPS).map((h) => (
                          <button
                            key={`${row.index}-${h.nodeId}`}
                            type="button"
                            onClick={() => onSelectChapter(h.nodeId)}
                            title="跳到该章核对正文"
                            className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {h.title}
                          </button>
                        ))}
                        {hits.length > MAX_HIT_CHIPS && (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                            +{hits.length - MAX_HIT_CHIPS} 章
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
