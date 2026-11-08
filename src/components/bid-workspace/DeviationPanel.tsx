import { useState } from "react"
import { ChevronDown, ChevronRight, ExternalLink, FileText, Loader2, Plus, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  CLAUSE_GRANULARITY_HINT,
  CLAUSE_GRANULARITY_LABEL,
  deviationResponseText,
  RESPONSE_LEVEL_LABEL,
  type ClauseGranularity,
  type DeviationRow,
  type ResponseLevel,
} from "@/pages/BidWorkspace/bidTypes"
import { deviationVerbatimReport } from "@/pages/BidWorkspace/deviationVerbatim"
import { PARAM_KIND_LABEL } from "@/pages/BidWorkspace/techParamCoverage"

// ---------------------------------------------------------------------------
// 改造 4：技术偏离表面板——拆分维度单选 + 统计 + 按来源章节分组表格 + 独立导出
// ---------------------------------------------------------------------------

/**
 * R81（2026-11-08）：单页渲染行数。
 *
 * 实测依据（jsdom，真实语料 `test_results/审查正文-三明.txt` + 真实引擎 `resolveDeviationClauses`）：
 * 面板靠 `limit: 200` 截断（调用侧 useBidWorkspace:8200 附近），200 行时已挂
 * **200 个 tbody row / 4224 个 DOM 节点 / 338 个 button / 首屏 225ms**；
 * 而同一份语料在不限 limit 时能抽出 **949 条**条款——说明 200 不是数据上限，只是调用侧截断，
 * 换更大的 limit（或条款更密的招标文件）时这棵树会继续线性膨胀。
 *
 * 取 100：与 R80 技术参数响应表同一口径（200 行 → 2 页），单页 ≈ 2100 节点（降 50%）。
 * ⚠️ 只切渲染切片：统计卡、待核对提示、Word 导出全部仍用全量 rows。
 */
const PAGE_SIZE = 100

type DeviationPanelProps = Pick<
  UseBidWorkspace,
  | "clauseGranularity"
  | "setClauseGranularity"
  | "deviationClauseCount"
  | "deviationSourceLabel"
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
  // R81：当前页（0 起）。只切渲染切片，全量 rows 仍用于统计/导出。
  const [page, setPage] = useState(0)
  const rows = p.deviationTable?.rows ?? []
  // R81：先按全局行序切片，再对切片重新分组——跨页时同一来源会在相邻两页各出现一次，
  // 组头如实标注「本页 X 条 / 全部 Y 条」，不假装整组都在这一页。
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const groups = groupRows(pageRows)
  const totalBySource = (() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = r.source || "招标技术要求"
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  })()
  // 翻页收起点开的行（否则展开态会按 key 里的行号漂到新页另一条条款上）
  const gotoPage = (next: number) => {
    setPage(next)
    setExpandedKey(null)
  }
  const st = p.deviationSummary
  const exportBusyNow = p.exportBusy === "deviation"
  // R52：一一对应（招标条款↔响应材料）与原文响应核对结论，均取自生成时写入的结论 / 纯本地复核
  const alignment = p.deviationTable?.alignment ?? null
  const verbatim = deviationVerbatimReport(rows)
  return (
    <section className="mt-6 rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Table2 className="h-4 w-4 text-primary" />
            技术偏离表
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            按所选维度拆分招标技术要求，逐条摘录投标文件原文作为响应、并定位响应位置，供评标专家按图索骥
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
        <p className="mt-1 text-xs text-muted-foreground">
          条款来源：{p.deviationSourceLabel || "招标文件「采购需求 / 技术规格」章节原文"}；评分办法与响应文件格式要求不进本表。
        </p>
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
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              {alignment && (
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    alignment.missing.length || alignment.duplicated.length
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  招标要求 {alignment.clause_count} 条 ↔ 响应 {alignment.row_count} 行
                  {alignment.missing.length || alignment.duplicated.length
                    ? ` · 未对上：缺 ${alignment.missing.length} 行 / 重复 ${alignment.duplicated.length} 行`
                    : " · 一一对应"}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  verbatim.not_verbatim > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                }`}
                title="响应内容一律摘录投标文件正文原文；这里逐行在正文里检索，检索不到即疑似改写或概括"
              >
                原文响应 {verbatim.verbatim}/{verbatim.checked}
                {verbatim.not_verbatim > 0 ? ` · 非原文 ${verbatim.not_verbatim} 条待改` : ""}
                {verbatim.missing_text > 0 ? ` · 缺响应内容 ${verbatim.missing_text} 条` : ""}
              </span>
            </div>
            {verbatim.not_verbatim > 0 && (
              <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-foreground">
                <span className="font-medium text-warning">非原文响应 {verbatim.not_verbatim} 条</span>
                ：这些行的响应内容在投标文件正文里检索不到（疑似改写或概括）。偏离表要求原文响应——
                请把响应内容改回正文原句（可用「……」省略中间），或补齐正文后重新生成。
              </p>
            )}
            {st.needs_review > 0 && (
              <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-foreground">
                <span className="font-medium text-warning">待人工核对 {st.needs_review} 条</span>
                ：这些条款在本次分析的正文范围里找不到可定位的响应证据（长文分段后未命中，或 AI 未定位到对应正文），
                系统按「部分响应」兜底保留、未判为负偏离。导出前请人工确认正文相应部分确实已响应，再决定是否调整响应程度。
              </p>
            )}
            <div className={`mb-4 grid grid-cols-2 gap-2 ${st.needs_review > 0 ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
              {[
                { label: "总条款", value: st.total, cls: "text-foreground" },
                { label: "完全响应", value: st.full, cls: "text-primary" },
                { label: "部分响应", value: st.partial, cls: "text-muted-foreground" },
                { label: "偏离", value: st.deviation, cls: "text-destructive" },
                ...(st.needs_review > 0 ? [{ label: "待人工核对", value: st.needs_review, cls: "text-warning" }] : []),
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
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      {/* R81：分组被分页切开时，如实写「本页 X 条 / 全部 Y 条」——
                          只写「X 条」会让用户以为这一组只有这么多，翻页才发现还有。 */}
                      {(() => {
                        const totalForSource = totalBySource.get(g.source) ?? g.rows.length
                        return totalForSource === g.rows.length
                          ? `${g.rows.length} 条`
                          : `本页 ${g.rows.length} 条 / 全部 ${totalForSource} 条`
                      })()}
                    </span>
                    {g.rows.some((r) => r.needs_review) && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                        待核对 {g.rows.filter((r) => r.needs_review).length} 条
                      </span>
                    )}
                    {g.source}
                  </h3>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                          <th className="px-2 py-2 font-medium">条款序号</th>
                          <th className="px-2 py-2 font-medium">招标要求（原文）</th>
                          <th className="px-2 py-2 font-medium">响应程度</th>
                          <th className="px-2 py-2 font-medium">响应内容（投标文件原文）</th>
                          <th className="px-2 py-2 font-medium">响应位置</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, ri) => {
                          // 带行号兜底：新表已保证条款不重复，但存量表可能仍有同 clause_id 的行，
                          // 只用 clause_id 做 key 会让 React 复用到错误的行
                          const rowKey = `${g.source}-${r.clause_id || ri}-${ri}`
                          const expanded = expandedKey === rowKey
                          const jumpable = !!r.response_node && r.response_node !== "未找到响应"
                          return (
                            <tr
                              key={rowKey}
                              className={`border-b border-border/60 align-top last:border-0 ${r.needs_review ? "bg-warning/5" : ""}`}
                            >
                              <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                                {r.clause_no ? (
                                  <span className="flex flex-col gap-0.5">
                                    <span className="text-foreground">{r.clause_no}</span>
                                    <span className="text-[10px]">{r.clause_id || ri + 1}</span>
                                  </span>
                                ) : (
                                  r.clause_id || ri + 1
                                )}
                              </td>
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
                                <div className="flex flex-wrap items-center gap-1">
                                  {r.response_level ? (
                                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE[r.response_level]}`}>
                                      {RESPONSE_LEVEL_LABEL[r.response_level]}
                                    </span>
                                  ) : (
                                    <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">待人工判定</span>
                                  )}
                                  {r.needs_review && (
                                    <span
                                      title="本次分析的正文范围内没有可定位的响应证据，已按部分响应兜底；导出前请人工核对正文未覆盖部分"
                                      className="whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                                    >
                                      待人工核对
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-xs leading-relaxed">
                                {(() => {
                                  const text = deviationResponseText(r)
                                  if (!text) {
                                    return <span className="text-muted-foreground">—（未摘录到正文原文）</span>
                                  }
                                  return (
                                    <div className="space-y-1">
                                      <p className="text-foreground">{text}</p>
                                      {r.not_verbatim && (
                                        <span
                                          title="响应内容在投标文件正文里检索不到，疑似改写或概括；偏离表要求原文响应，请改回正文原句"
                                          className="inline-block rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
                                        >
                                          非原文
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                              </td>
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
                                {r.evidence_ref && (
                                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">原文出处：{r.evidence_ref}</p>
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
            {/* R81：分页条——仅超过一页时出现（≤100 条时零视觉变化，行为与改动前一致） */}
            {pageCount > 1 && (
              <nav
                aria-label="技术偏离表分页"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5"
              >
                <span className="text-xs text-muted-foreground">
                  第 {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, rows.length)} 条
                  <span className="mx-1 opacity-50">/</span>共 {rows.length} 条（每页 {PAGE_SIZE} 条）
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => gotoPage(0)}
                    aria-label="首页"
                    className="rounded border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => gotoPage(safePage - 1)}
                    className="rounded border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="px-1 text-xs font-medium tabular-nums text-foreground">
                    {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => gotoPage(safePage + 1)}
                    className="rounded border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  >
                    下一页
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => gotoPage(pageCount - 1)}
                    aria-label="末页"
                    className="rounded border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  >
                    »
                  </button>
                </span>
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  )
}
