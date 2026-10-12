import { useState } from "react"
import { ChevronDown, ChevronRight, ExternalLink, FileText, Loader2, Plus, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  CLAUSE_GRANULARITY_HINT,
  CLAUSE_GRANULARITY_LABEL,
  RESPONSE_LEVEL_LABEL,
  type ClauseGranularity,
  type DeviationRow,
  type ResponseLevel,
} from "@/pages/BidWorkspace/bidTypes"
import { PARAM_KIND_LABEL } from "@/pages/BidWorkspace/techParamCoverage"

// ---------------------------------------------------------------------------
// 改造 4：技术偏离表面板——拆分维度单选 + 统计 + 按来源章节分组表格 + 独立导出
// ---------------------------------------------------------------------------

type DeviationPanelProps = Pick<
  UseBidWorkspace,
  | "clauseGranularity"
  | "setClauseGranularity"
  | "deviationClauseCount"
  | "mapLoading"
  | "generateDeviationTable"
  | "deviationTable"
  | "deviationSummary"
  | "doneChapterCount"
  | "jumpToResponseNode"
  | "exportDeviationWord"
  | "exportBusy"
  | "deviationSkills"
  | "techParamCoverage"
  | "addUncoveredTechParamsToOutline"
>

const LEVEL_BADGE: Record<Exclude<ResponseLevel, "">, string> = {
  full: "bg-primary/10 text-primary",
  partial: "bg-muted text-muted-foreground",
  deviation: "bg-destructive/10 text-destructive",
}

const DIMENSIONS: ClauseGranularity[] = ["system", "l2", "l3"]

function groupRows(rows: DeviationRow[]): { source: string; rows: DeviationRow[] }[] {
  const groups: { source: string; rows: DeviationRow[] }[] = []
  for (const r of rows) {
    const key = r.source || "招标技术要求"
    const g = groups.find((x) => x.source === key)
    if (g) g.rows.push(r)
    else groups.push({ source: key, rows: [r] })
  }
  return groups
}

export function DeviationPanel(p: DeviationPanelProps) {
  // 展开的条款行 key（本地 UI 状态）
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const rows = p.deviationTable?.rows ?? []
  const groups = groupRows(rows)
  const st = p.deviationSummary
  const exportBusyNow = p.exportBusy === "deviation"
  return (
    <section className="mt-6 rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Table2 className="h-4 w-4 text-primary" />
            技术偏离表
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            按所选维度拆分招标技术条款，AI 逐条判定响应程度并定位响应位置，供评标专家按图索骥
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SkillPickerFor scope="bid-deviation" source={p.deviationSkills} align="right" />
          {rows.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void p.exportDeviationWord()}
              disabled={exportBusyNow}
              className="border-border text-card-foreground shadow-sm hover:bg-secondary"
            >
              {exportBusyNow ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
              导出偏离表
            </Button>
          )}
          <Button
            size="sm"
            onClick={p.generateDeviationTable}
            disabled={p.mapLoading || p.doneChapterCount === 0 || p.deviationClauseCount === 0}
            title={
              p.mapLoading
                ? "条款映射进行中，完成后可生成偏离表"
                : p.doneChapterCount === 0
                  ? "还没有已完成正文的章节，先生成正文再生成偏离表"
                  : p.deviationClauseCount === 0
                    ? "暂无偏离条款，完成条款映射后可生成偏离表"
                    : undefined
            }
            className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
          >
            {p.mapLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Table2 className="mr-1.5 h-3.5 w-3.5" />}
            {rows.length ? "重新生成偏离表" : "生成偏离表"}
          </Button>
        </div>
      </header>

      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">
          拆分维度
          {p.deviationClauseCount > 0 && <span className="ml-2 text-foreground">当前维度约拆出 {p.deviationClauseCount} 条条款</span>}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DIMENSIONS.map((dim) => {
            const active = p.clauseGranularity === dim
            return (
              <button
                key={dim}
                type="button"
                onClick={() => p.setClauseGranularity(dim)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:text-card-foreground"
                }`}
              >
                {CLAUSE_GRANULARITY_LABEL[dim]}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{CLAUSE_GRANULARITY_HINT[p.clauseGranularity]}</p>
      </div>

      {p.techParamCoverage.hasParams && (
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">技术参数落点（R-022）</span>
            <span className={`text-sm font-bold ${p.techParamCoverage.uncovered > 0 ? "text-destructive" : "text-primary"}`}>
              已覆盖 {p.techParamCoverage.covered}/{p.techParamCoverage.total}
            </span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">【评审项】{p.techParamCoverage.reviewCount}</span>
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">▲实质性{p.techParamCoverage.starCount}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">一般项{p.techParamCoverage.generalCount}</span>
            {p.techParamCoverage.negativeCount > 0 && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                负偏离 {p.techParamCoverage.negativeCount} 项 · 预计扣 {p.techParamCoverage.deviationPenalty} 分
              </span>
            )}
            {p.techParamCoverage.uncovered > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={p.addUncoveredTechParamsToOutline}
                className="ml-auto border-primary/40 text-primary hover:bg-primary/10"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                补入未覆盖（{p.techParamCoverage.uncovered}）
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            第五章全部技术和服务要求参数逐条核对：进技术偏离表或建大纲节点记为已覆盖；未覆盖 {p.techParamCoverage.uncovered} 项待补入，负偏离每项扣 {p.techParamCoverage.perItemPenalty} 分。
          </p>
          {p.techParamCoverage.uncovered > 0 && (
            <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {p.techParamCoverage.uncoveredRows.slice(0, 20).map((r) => (
                <li key={r.id} className="flex items-start gap-1.5 border-b border-destructive/10 py-1 text-xs last:border-0">
                  <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{r.id}</span>
                  <span className="shrink-0 font-medium text-warning">{PARAM_KIND_LABEL[r.kind]}</span>
                  <span className="min-w-0 flex-1 text-foreground">{r.text}</span>
                </li>
              ))}
              {p.techParamCoverage.uncovered > 20 && (
                <li className="py-1 text-xs text-muted-foreground">…另有 {p.techParamCoverage.uncovered - 20} 条未覆盖参数</li>
              )}
            </ul>
          )}
        </div>
      )}
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            还没有偏离表：章节正文成稿后选好拆分维度，点右上角「生成偏离表」
          </p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { label: "总条款", value: st.total, cls: "text-foreground" },
                { label: "完全响应", value: st.full, cls: "text-primary" },
                { label: "部分响应", value: st.partial, cls: "text-muted-foreground" },
                { label: "偏离", value: st.deviation, cls: "text-destructive" },
              ].map((card) => (
                <div key={card.label} className="rounded-md border border-border bg-background px-3 py-2.5 text-center shadow-sm">
                  <p className={`text-xl font-bold ${card.cls}`}>{card.value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{card.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.source}>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{g.rows.length} 条</span>
                    {g.source}
                  </h3>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                          <th className="px-2 py-2 font-medium">条款序号</th>
                          <th className="px-2 py-2 font-medium">招标要求</th>
                          <th className="px-2 py-2 font-medium">响应程度</th>
                          <th className="px-2 py-2 font-medium">响应内容摘要</th>
                          <th className="px-2 py-2 font-medium">响应位置</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, ri) => {
                          const rowKey = `${g.source}-${r.clause_id || ri}`
                          const expanded = expandedKey === rowKey
                          const jumpable = !!r.response_node && r.response_node !== "未找到响应"
                          return (
                            <tr key={rowKey} className="border-b border-border/60 align-top last:border-0">
                              <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{r.clause_id || ri + 1}</td>
                              <td className="max-w-md px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => setExpandedKey(expanded ? null : rowKey)}
                                  className="flex w-full items-start gap-1.5 text-left text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  {expanded ? (
                                    <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className={expanded ? "" : "line-clamp-2"}>{r.clause_text}</span>
                                </button>
                              </td>
                              <td className="px-2 py-2">
                                {r.response_level ? (
                                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE[r.response_level]}`}>
                                    {RESPONSE_LEVEL_LABEL[r.response_level]}
                                  </span>
                                ) : (
                                  <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">待人工判定</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">{r.response_summary || "—"}</td>
                              <td className="px-2 py-2">
                                {jumpable ? (
                                  <button
                                    type="button"
                                    onClick={() => p.jumpToResponseNode(r.response_node)}
                                    className="flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                  >
                                    {r.bid_ref ? `${r.bid_ref} ` : ""}
                                    {r.response_node}
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                  </button>
                                ) : (
                                  <span className="text-xs font-medium text-destructive">{r.response_node || "未找到响应"}</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
