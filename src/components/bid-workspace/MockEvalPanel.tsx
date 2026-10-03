import { useState } from "react"
import { Gauge, Loader2, NotebookPen, RefreshCw, Scale, TriangleAlert, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import {
  filterEvalRowIndexes,
  isGapBidItem,
  isLowScoreBidItem,
  type EvalRowFilter,
} from "@/components/bid-workspace/evalItemFilter"
import type { EvalPath, UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { EVAL_PATH_LABEL } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  SEVERITY_LABEL,
  scoringItemsFromReport,
  type AiReview,
  type FormatIssue,
  type ManualReview,
  type SeverityLevel,
} from "@/pages/BidWorkspace/bidTypes"

type MockEvalPanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "evalLoading"
  | "startAiReview"
  | "initManualReview"
  | "setManualScore"
  | "setManualComment"
  | "evalMissingTitles"
  | "goParseStep"
  | "evalPathBusy"
  | "evalPathFailed"
  | "startEvalPathRerun"
  | "isArchivedLocked"
>

/** 第九轮改造 3：格式规范路 severity → 语义四档 badge variant */
const SEVERITY_VARIANT: Record<SeverityLevel, "danger" | "warning" | "neutral"> = {
  critical: "danger",
  major: "warning",
  minor: "neutral",
}

const EVAL_TABS: EvalPath[] = ["tech", "format", "commercial"]

export function EvalResultView({
  aiReview,
  manualReview,
  onManualScore,
  onManualComment,
  locked = false,
}: {
  aiReview: AiReview | null
  manualReview?: ManualReview | null
  onManualScore?: (idx: number, score: number) => void
  onManualComment?: (idx: number, comment: string) => void
  /** 循环 6 A1：归档只读——人工打分输入禁用（仍展示既有分数），QuickToolsPanel 只读复用不传 */
  locked?: boolean
}) {
  const [filter, setFilter] = useState<EvalRowFilter>("none")
  if (!aiReview) return null
  const aiTotal = aiReview.total_score
  const manualTotal = manualReview?.total_score ?? 0
  const maxTotal = aiReview.items.reduce((sum, i) => sum + (i.max_score || 0), 0)
  const editable = !!onManualScore && !!manualReview
  const lowCount = aiReview.items.filter((it) => isLowScoreBidItem(it)).length
  const gapCount = editable ? aiReview.items.filter((it, i) => isGapBidItem(it, manualReview?.items[i])).length : 0
  const activeFilter: EvalRowFilter = lowCount || gapCount ? filter : "none"
  const visibleIdx = filterEvalRowIndexes(aiReview.items, manualReview?.items, activeFilter)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
          <p className="text-2xl font-bold text-primary">{aiTotal}</p>
          <p className="mt-1 text-xs text-muted-foreground">AI 预估总分{maxTotal ? ` / ${maxTotal}` : ""}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
          <p className="text-2xl font-bold text-foreground">{editable ? manualTotal : "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">人工打分总分</p>
        </div>
        <button
          type="button"
          onClick={() => setFilter((f) => (f === "gap" ? "none" : "gap"))}
          disabled={!editable || !gapCount}
          aria-pressed={activeFilter === "gap"}
          title={editable && gapCount ? "点击只看 AI 与人工分差≥2 分的项" : undefined}
          className={`rounded-lg border p-4 text-center shadow-md transition-colors ${
            activeFilter === "gap" ? "border-destructive/50 bg-destructive/10" : "border-border bg-card"
          } ${editable && gapCount ? "hover:bg-secondary" : "disabled:cursor-default"}`}
        >
          <p className={`text-2xl font-bold ${activeFilter === "gap" || (editable && Math.abs(aiTotal - manualTotal) >= 5) ? "text-destructive" : "text-foreground"}`}>
            {editable ? Math.round((aiTotal - manualTotal) * 10) / 10 : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">AI 与人工分差{editable && gapCount ? ` · ${gapCount} 项≥2` : ""}</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter((f) => (f === "low" ? "none" : "low"))}
          disabled={!lowCount}
          aria-pressed={activeFilter === "low"}
          title={lowCount ? "点击只看低得分率（得分率<60%）的项" : undefined}
          className={`rounded-lg border p-4 text-center shadow-md transition-colors ${
            activeFilter === "low" ? "border-destructive/50 bg-destructive/10" : "border-border bg-card"
          } ${lowCount ? "hover:bg-secondary" : "disabled:cursor-default"}`}
        >
          <p className={`text-2xl font-bold ${activeFilter === "low" ? "text-destructive" : "text-foreground"}`}>{lowCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">低得分率评分项{lowCount ? " · 点击筛选" : ""}</p>
        </button>
      </div>

      {activeFilter !== "none" && (
        <p className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
          <span>
            {activeFilter === "low"
              ? `只看低得分率项（${visibleIdx.length}/${aiReview.items.length}）`
              : `只看 AI 与人工分差≥2 分的项（${visibleIdx.length}/${aiReview.items.length}）`}
          </span>
          <button type="button" onClick={() => setFilter("none")} className="font-medium text-primary hover:underline">
            显示全部
          </button>
        </p>
      )}

      {aiReview.summary && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-md">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <TrendingUp className="h-4 w-4" />
            总体评价与改进方向
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{aiReview.summary}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">评分项</th>
                <th className="px-3 py-2.5 font-medium">分值</th>
                <th className="px-3 py-2.5 font-medium">AI 得分</th>
                <th className="px-3 py-2.5 font-medium">扣分理由 / 改进建议</th>
                {editable && <th className="px-3 py-2.5 font-medium">人工打分</th>}
              </tr>
            </thead>
            <tbody>
              {visibleIdx.map((i) => {
                const item = aiReview.items[i]
                const manualItem = manualReview?.items[i]
                const lowRate = isLowScoreBidItem(item)
                const gap = editable && manualItem && manualItem.manual_score > 0 ? Math.abs(item.ai_score - manualItem.manual_score) : 0
                return (
                  <tr key={i} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      {item.scoring_item}
                      {gap >= 2 && (
                        <span className="ml-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-normal text-destructive">分差 {Math.round(gap * 10) / 10}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{item.max_score}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${lowRate ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                        {item.ai_score}
                      </span>
                    </td>
                    <td className="max-w-md px-3 py-2.5">
                      <p className="text-xs leading-relaxed text-foreground">{item.reason || "—"}</p>
                      {item.suggestion && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">建议：{item.suggestion}</p>}
                    </td>
                    {editable && manualItem && (
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            max={manualItem.max_score || undefined}
                            step={0.5}
                            value={manualItem.manual_score}
                            onChange={(e) => onManualScore?.(i, Number(e.target.value))}
                            disabled={locked}
                            className="w-20 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
                          />
                          <Textarea
                            value={manualItem.comment}
                            onChange={(e) => onManualComment?.(i, e.target.value)}
                            placeholder="评语"
                            rows={2}
                            disabled={locked}
                            className="w-44 resize-none border-border bg-background text-xs focus-visible:shadow-[var(--focus-ring)]"
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
              {visibleIdx.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-xs text-muted-foreground" colSpan={editable ? 6 : 5}>
                    无符合条件的评分项
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** 第九轮改造 3：格式规范路结果列表 */
function FormatIssuesView({ issues }: { issues: FormatIssue[] }) {
  if (!issues.length) {
    return (
      <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-8 text-center text-sm font-medium text-primary">
        未发现格式规范问题，章节结构与排版惯例检查通过
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {issues.map((issue, i) => (
        <li key={i} className="rounded-lg border border-border bg-card p-4 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
              <span className="mr-1.5 font-mono text-xs text-primary">{i + 1}</span>
              {issue.issue}
            </p>
            <Badge variant={SEVERITY_VARIANT[issue.severity]}>{SEVERITY_LABEL[issue.severity]}</Badge>
          </div>
          {issue.location && <p className="mt-1.5 text-xs text-muted-foreground">位置：{issue.location}</p>}
          {issue.suggestion && (
            <p className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
              整改建议：{issue.suggestion}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

/** 第九轮改造 3：商务要素路核对表（招标值 ↔ 投标值 一致性） */
function CommercialChecksView({ checks }: { checks: AiReview["commercial_checks"] }) {
  if (!checks.length) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-md">
        未从解析报告中提取到需核对的关键商务值（如工期、质保期、保证金金额等）
      </p>
    )
  }
  const inconsistent = checks.filter((c) => !c.consistent).length
  return (
    <div className="flex flex-col gap-3">
      <p className={`text-xs font-medium ${inconsistent ? "text-destructive" : "text-primary"}`}>
        {inconsistent ? `发现 ${inconsistent} 处招标要求与投标文件不一致，务必逐项核实修正` : `共核对 ${checks.length} 项关键商务值，全部一致`}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">商务要素</th>
                <th className="px-3 py-2.5 font-medium">招标要求</th>
                <th className="px-3 py-2.5 font-medium">投标文件</th>
                <th className="px-3 py-2.5 font-medium">一致性</th>
                <th className="px-3 py-2.5 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c, i) => (
                <tr key={i} className="border-b border-border/60 align-top last:border-0">
                  <td className="px-3 py-2.5 font-medium text-foreground">{c.key}</td>
                  <td className="px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{c.tender_value || "—"}</td>
                  <td className="px-3 py-2.5 text-xs leading-relaxed text-foreground">{c.bid_value || "未找到"}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={c.consistent ? "success" : "danger"}>{c.consistent ? "一致" : "不一致"}</Badge>
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{c.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function MockEvalPanel({
  activeProject,
  evalLoading,
  startAiReview,
  initManualReview,
  setManualScore,
  setManualComment,
  evalMissingTitles,
  goParseStep,
  evalPathBusy,
  evalPathFailed,
  startEvalPathRerun,
  isArchivedLocked,
}: MockEvalPanelProps) {
  // 第九轮改造 3：三路页签（纯 UI 状态）
  const [evalTab, setEvalTab] = useState<EvalPath>("tech")
  const scoringCount = scoringItemsFromReport(activeProject?.parse_report ?? null).length
  const chaptersReady = (activeProject?.bid_chapters ?? []).some((c) => (c.content ?? "").trim())
  const aiReview = activeProject?.ai_review ?? null
  const manualReview = activeProject?.manual_review ?? null
  const anyBusy = evalLoading || evalPathBusy !== ""
  const pathFailed = aiReview ? evalPathFailed[evalTab] : false
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground">模拟评标</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              三路并行评标：技术评分路按评分办法逐项打分给出扣分理由与改进建议；格式规范路检查章节结构、编号与排版惯例；商务要素路把工期、质保、保证金等关键值与招标要求逐项核对。单路失败可在对应页签内独立重跑，你也可以用人工打分表与技术路并排对比。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={initManualReview}
              disabled={!scoringCount || !!manualReview || isArchivedLocked}
              title={isArchivedLocked ? "已归档项目为只读，解除归档后可操作" : undefined}
              className="border-border text-card-foreground shadow-sm hover:bg-secondary"
            >
              <NotebookPen className="mr-1.5 h-4 w-4" />
              {manualReview ? "人工打分表已建" : "生成人工打分表"}
            </Button>
            <Button
              onClick={startAiReview}
              disabled={anyBusy || !scoringCount || !chaptersReady || isArchivedLocked}
              title={isArchivedLocked ? "已归档项目为只读，解除归档后可重新评标" : undefined}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              {evalLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Scale className="mr-1.5 h-4 w-4" />}
              {evalLoading ? "三路评标中，约需 1-2 分钟…" : aiReview ? "重新三路评标" : "运行三路模拟评标"}
            </Button>
          </div>
        </div>
        {!scoringCount && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <p className="text-xs text-foreground">
              {evalMissingTitles.length
                ? `该检查依赖「${evalMissingTitles.join("、")}」解析项，请先回到解析环节勾选并解析`
                : "还没有评分办法，请先完成「AI 解析报告」环节"}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={goParseStep}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              前往解析环节
            </Button>
          </div>
        )}
        {scoringCount > 0 && !chaptersReady && (
          <p className="mt-3 rounded-md border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
            投标文件还没有正文，请先完成「投标文件编制」环节
          </p>
        )}
      </header>

      <div className="mt-5">
        {evalLoading ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-card py-16 text-center shadow-md">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">评标委员会（AI）正在三路并行审阅投标文件…</p>
            <p className="text-xs text-muted-foreground">技术符合性 / 格式规范 / 商务要素，单路失败不影响其余两路</p>
          </div>
        ) : aiReview ? (
          <>
            <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5 text-primary" />
              评标时间：{formatDateTimeDisplay(aiReview.reviewed_at)}
              {manualReview ? " · 人工打分即时保存，可直接在表格中填写" : " · 点「生成人工打分表」开始独立评分"}
            </p>

            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-md">
              <span className="flex flex-wrap items-center gap-1.5">
                {EVAL_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setEvalTab(tab)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      evalTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-card-foreground"
                    }`}
                  >
                    {EVAL_PATH_LABEL[tab]}
                    {evalPathFailed[tab] && <span className="ml-1 text-destructive">·失败</span>}
                  </button>
                ))}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => startEvalPathRerun(evalTab)}
                disabled={anyBusy || isArchivedLocked}
                className="ml-auto border-primary/40 text-primary hover:bg-primary/10"
              >
                {evalPathBusy === evalTab ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                )}
                {evalPathBusy === evalTab ? "重跑中…" : `重跑本路（${EVAL_PATH_LABEL[evalTab]}）`}
              </Button>
            </div>

            {pathFailed && (
              <p className="mb-3 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-card-foreground">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
                「{EVAL_PATH_LABEL[evalTab]}」路最近一次执行失败，下方展示的可能是更早的结果或空内容，可点「重跑本路」单独补跑
              </p>
            )}

            {evalTab === "tech" && (
              <EvalResultView
                aiReview={aiReview}
                manualReview={manualReview}
                onManualScore={manualReview ? setManualScore : undefined}
                onManualComment={manualReview ? setManualComment : undefined}
                locked={isArchivedLocked}
              />
            )}
            {evalTab === "format" && <FormatIssuesView issues={aiReview.format_issues} />}
            {evalTab === "commercial" && <CommercialChecksView checks={aiReview.commercial_checks} />}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-md">
            <Scale className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">尚未执行模拟评标</p>
            <p className="mt-1 text-xs text-muted-foreground">投标前跑一轮三路评标：技术分、格式规范、商务一致性一次查清</p>
          </div>
        )}
      </div>
    </section>
  )
}
