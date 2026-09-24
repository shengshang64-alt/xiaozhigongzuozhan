import { useMemo } from "react"
import { AlertTriangle, Link2, ListChecks, Plus, ShieldAlert } from "lucide-react"
import {
  buildScoringCoverageMatrix,
  clauseMatchesTitle,
  effectiveVoidStatus,
  numberScoringItems,
  type ParseReport,
  type RequirementClause,
  type VoidItem,
} from "@/pages/BidWorkspace/bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

type ScoreMappingPanelProps = {
  report: ParseReport | null
  chapters: Chapter[]
  /** R31：投标大纲（叶节点 description 携带 [响应:Rx] 承接标注，用于覆盖矩阵） */
  outline: OutlineNode[]
  activeChapterId: string | null
  outlineClauseTotal: number
  coveredClauseCount: number
  uncoveredClauses: RequirementClause[]
  voidItems: VoidItem[]
  /** 点评分点 → 定位到响应章节（映射正向：评分点 → 正文） */
  onJumpResponse: (title: string) => void
  /** 点「已映射」徽标 → 切换编辑器到对应章（映射反向：正文 → 评分点高亮） */
  onSelectChapter: (nodeId: string) => void
  onAddClause: (clauseId: string) => void
  onGoVoidCheck: () => void
}

type MappedItem = {
  key: string
  /** R31 稳定编号：R1/B1…，与大纲 prompt 注入的编号同源 */
  id: string
  name: string
  score: number
  catLabel: string
  isSubjective: boolean
  isTech: boolean
  /** 大纲承接：叶子标题列表（来自 [响应:Rx] 标注，空=未承接） */
  coveredBy: string[]
  hitChapter: Chapter | null
}

function shortTitle(t: string): string {
  return t.length > 14 ? `${t.slice(0, 14)}…` : t
}

/**
 * 右栏「评分点清单」：编号评分项（R31）↔ 大纲承接 ↔ 投标正文章节的三方映射。
 * 配色语义（重构原型）：已映射=主色，缺失/未响应=橙，废标项=红；全部本地推导，零 AI 费用。
 */
export function ScoreMappingPanel({
  report,
  chapters,
  outline,
  activeChapterId,
  outlineClauseTotal,
  coveredClauseCount,
  uncoveredClauses,
  voidItems,
  onJumpResponse,
  onSelectChapter,
  onAddClause,
  onGoVoidCheck,
}: ScoreMappingPanelProps) {
  // R31：编号评分项与大纲 prompt 同源（numberScoringItems），保证 [响应:Rx] 标注可直接对账
  const techItems = useMemo<MappedItem[]>(() => {
    const items = numberScoringItems(report)
    const matrix = buildScoringCoverageMatrix(outline, items)
    const coveredById = new Map(matrix.map((e) => [e.item.id, e.coveredBy]))
    return items.map((it, i) => {
      const hit =
        chapters.find((c) => clauseMatchesTitle(it.item, c.title ?? "")) ??
        chapters.find((c) => (c.sections ?? []).some((s) => clauseMatchesTitle(it.item, s))) ??
        chapters.find((c) => clauseMatchesTitle(c.content ?? "", it.item)) ??
        null
      return {
        key: `${it.category}-${i}-${it.id}`,
        id: it.id,
        name: it.item,
        score: it.score,
        catLabel: it.category === "tech" ? "技术" : "商务",
        isSubjective: it.isSubjective,
        isTech: it.category === "tech",
        coveredBy: coveredById.get(it.id) ?? [],
        hitChapter: hit,
      }
    })
  }, [report, chapters, outline])

  const mappedCount = techItems.filter((x) => x.hitChapter).length
  const techOnly = techItems.filter((x) => x.isTech)
  const pickedCount = techOnly.filter((x) => x.coveredBy.length).length
  const riskyVoid = voidItems.filter((it) => effectiveVoidStatus(it) !== "compliant")
  const criticalVoid = riskyVoid.filter((it) => it.severity === "critical" && it.review_status === "pending")
  const activeMapped = techItems.filter((x) => x.hitChapter && x.hitChapter.node_id === activeChapterId)

  return (
    <nav className="rounded-lg border border-border bg-card p-3 shadow-md">
      <header className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
        <ListChecks className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs font-semibold text-foreground">评分点清单</p>
        {techItems.length > 0 && (
          <span
            className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title="大纲承接：技术评分项中被叶子节点 [响应:Rx] 标注覆盖的个数；正文映射：评分项能定位到正文章节的个数"
          >
            承接 {pickedCount}/{techOnly.length} · 映射 {mappedCount}/{techItems.length}
          </span>
        )}
      </header>

      {criticalVoid.length > 0 && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] font-medium text-destructive">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          {criticalVoid.length} 项废标风险待核销
        </p>
      )}

      {activeMapped.length > 0 && (
        <section className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5">
          <p className="text-[11px] font-semibold text-primary">本章响应的评分点</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {activeMapped.map((x) => (
              <span key={`act-${x.key}`} className="rounded-full bg-card px-1.5 py-0.5 text-[11px] text-primary shadow-sm ring-1 ring-primary/30">
                <Link2 className="mr-0.5 inline h-2.5 w-2.5" />
                {x.id} {shortTitle(x.name)} · {x.score}分
              </span>
            ))}
          </div>
        </section>
      )}

      {techItems.length === 0 && riskyVoid.length === 0 && uncoveredClauses.length === 0 ? (
        <p className="px-1 py-3 text-xs leading-relaxed text-muted-foreground">
          暂无评分点数据——完成「AI 解析评分点」环节后，这里会列出评分项与正文的双向映射；缺失显示橙色，废标项显示红色。
        </p>
      ) : (
        <ul className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-0.5">
          {techItems.map((x) => {
            const on = !!x.hitChapter
            const picked = x.coveredBy.length > 0
            return (
              <li key={x.key}>
                <button
                  type="button"
                  onClick={() => (x.hitChapter ? onSelectChapter(x.hitChapter.node_id) : onJumpResponse(x.name))}
                  title={
                    x.isTech && !picked
                      ? "大纲叶子未标注承接该评分编号（[响应:" + x.id + "]），建议补充承接章节"
                      : x.hitChapter
                        ? `已映射：「${x.hitChapter.title}」，点击切到该章`
                        : "正文未找到对应章节，点击按评分项名尝试定位"
                  }
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    on
                      ? x.hitChapter?.node_id === activeChapterId
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:border-primary/40"
                      : "border-warning/40 bg-warning/10 text-foreground hover:border-warning/60"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold tabular-nums text-secondary-foreground">
                      {x.id}
                    </span>
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${on ? "bg-primary/10 text-primary" : "bg-warning/15 text-warning"}`}>
                      {x.catLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className={`shrink-0 font-semibold tabular-nums ${on ? "text-primary" : "text-warning"}`}>{x.score}分</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground" title={x.isSubjective ? "得分依赖评委主观评判，建议方案质量强化响应" : "得分依赖可核验硬指标，按标准逐项备齐即可"}>
                      {x.isSubjective ? "主观" : "客观"}
                    </span>
                    {x.isTech && (
                      picked ? (
                        <span className="min-w-0 flex-1 truncate text-primary" title={`承接叶子：${x.coveredBy.join("、")}`}>
                          <Link2 className="mr-0.5 inline h-3 w-3" />
                          承接：{x.coveredBy.map(shortTitle).join("、")}
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-medium text-warning">
                          <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                          未承接：大纲无 [响应:{x.id}] 标注
                        </span>
                      )
                    )}
                  </span>
                  <span className={`mt-0.5 flex items-center gap-1 text-[11px] ${on ? "text-muted-foreground" : "font-medium text-warning"}`}>
                    {on ? (
                      <>
                        <Link2 className="h-3 w-3" />
                        已映射：{shortTitle(x.hitChapter!.title)}
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3 w-3" />
                        缺失：正文未覆盖该评分点
                      </>
                    )}
                  </span>
                </button>
              </li>
            )
          })}

          {riskyVoid.length > 0 && (
            <li className="pt-1.5">
              <p className="px-1 pb-1 text-[11px] font-semibold text-destructive">废标项检查（{riskyVoid.length}）</p>
              <ul className="space-y-1">
                {riskyVoid.slice(0, 6).map((it) => {
                  const critical = it.severity === "critical"
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => (it.response_location ? onJumpResponse(it.response_location) : onGoVoidCheck())}
                        title={it.suggestion || it.reason || (critical ? "重大废标风险，点击定位处理" : "点击处理")}
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive ${
                          critical && it.review_status === "pending"
                            ? "border-destructive/50 bg-destructive/10"
                            : "border-warning/40 bg-warning/10"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <ShieldAlert className={`h-3.5 w-3.5 shrink-0 ${critical && it.review_status === "pending" ? "text-destructive" : "text-warning"}`} />
                          <span className="min-w-0 flex-1 truncate text-foreground">{it.clause}</span>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${critical && it.review_status === "pending" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>
                            {critical ? "废标项" : "风险"}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {riskyVoid.length > 6 && (
                  <li>
                    <button type="button" onClick={onGoVoidCheck} className="w-full rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      查看全部 {riskyVoid.length} 项 → 废标项检查环节
                    </button>
                  </li>
                )}
              </ul>
            </li>
          )}

          {uncoveredClauses.length > 0 && (
            <li className="pt-1.5">
              <p className="px-1 pb-1 text-[11px] font-semibold text-warning">
                未响应条款（{uncoveredClauses.length}/{outlineClauseTotal}，已覆盖 {coveredClauseCount}）
              </p>
              <ul className="space-y-1">
                {uncoveredClauses.slice(0, 8).map((cl) => (
                  <li key={cl.id} className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5">
                    <span className="min-w-0 flex-1 text-xs leading-snug text-foreground">{cl.text}</span>
                    <button
                      type="button"
                      onClick={() => onAddClause(cl.id)}
                      title="按相似度补入大纲最相关章节"
                      className="flex shrink-0 items-center gap-0.5 rounded border border-warning/50 bg-card px-1.5 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                    >
                      <Plus className="h-3 w-3" />
                      补入
                    </button>
                  </li>
                ))}
                {uncoveredClauses.length > 8 && (
                  <li className="px-1 text-[11px] text-muted-foreground">另有 {uncoveredClauses.length - 8} 条，见「条款覆盖」</li>
                )}
              </ul>
            </li>
          )}
        </ul>
      )}

      <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
        承接=大纲叶子 [响应:Rx] 标注对账；映射=本地相似度推导，供人工核对
      </p>
    </nav>
  )
}
