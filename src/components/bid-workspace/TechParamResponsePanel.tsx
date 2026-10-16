import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, FileCheck2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { sectionText, type ParseReport } from "@/pages/BidWorkspace/bidTypes"
import { PARAM_KIND_LABEL, type ParamKind } from "@/pages/BidWorkspace/techParamCoverage"
import {
  DEVIATION_MIN_SECTION_CHARS,
  buildParamResponseRows,
  checkParamResponseCoverage,
  resolveDeviationClauses,
  resolveTechParamSource,
  summarizeParamResponse,
} from "@/pages/BidWorkspace/techParamResponse"

/**
 * 技术参数响应表（用户 2026-10-15 三条口径的界面落地，纯本地零 AI）：
 *  ① 参数来源不固定（采购需求 / 技术规格 / 附件），**使用者可以自己描述**——「章节描述」填了即按描述重新定位、清空回到自动；
 *  ② ★/▲【评审项】重点条款先扫出来、列在表格上方（「有的话，需要先在开头标注出来」），且按招标文件原文响应；
 *  ③ 其余参数按招标文件原文逐条响应，只把要求类字眼改成陈述式（paramRewrite 引擎），原文其余部分一字不动。
 *
 * 为什么在面板内部自算、不走 useBidWorkspace：所需输入只有 tender_text 与 parse_report，
 * 二者都在 activeProject 上；自算可免动那个 364 键、46 组件依赖的 hook 返回面（动它一处即全站重渲染风险）。
 * 来源口径与偏离表严格同调（同 resolveTechParamSource、同正文下限；覆盖核对条款同 resolveDeviationClauses），
 * 否则两张面板对「条款从哪来」的说法会打架。
 */

/** 逐条响应的行数上限（引擎默认 400；真实标书参数清单在百条量级，超出时在表下如实标注） */
const ROW_CAP = 400
/** 覆盖点名最多列出的条数，其余用「另有 N 条」收口（避免长清单淹没面板） */
const MISSING_SHOW = 10

const KIND_BADGE: Record<ParamKind, string> = {
  review: "bg-primary/10 text-primary",
  star: "bg-warning/10 text-warning",
  general: "bg-muted text-muted-foreground",
}

type TechParamResponsePanelProps = {
  tenderText: string | null | undefined
  report: ParseReport | null | undefined
}

export function TechParamResponsePanel({ tenderText, report }: TechParamResponsePanelProps) {
  // 用户对参数所在章节的描述（本地 UI 状态，不落库）：这就是「这种情况我可以自己描述」的入口
  const [customHint, setCustomHint] = useState("")
  // 展开的表格行（本地 UI 状态），与偏离表同款：默认折叠两行，点开看全文
  const [expandedKey, setExpandedKey] = useState<number | null>(null)

  // 覆盖核对用的条款：与偏离表生成/条数预告同调 resolveDeviationClauses（limit/granularity 同参数），
  // 保证「偏离表里有的条款」就是这里点名的分母；label 里含回退说明，直接用作实际来源展示。
  const clauseResolution = useMemo(
    () => resolveDeviationClauses(tenderText, report, { customHint, limit: 200, granularity: "l3" }),
    [tenderText, report, customHint],
  )
  // 响应行的正文来源：与偏离表同口径定位（含正文下限，避免把目录行/正文引用句当参数章节）
  const source = useMemo(
    () => resolveTechParamSource(tenderText, report, customHint, { minBodyChars: DEVIATION_MIN_SECTION_CHARS }),
    [tenderText, report, customHint],
  )
  // 条款在原文里抽不到合格条款而回退了解析报告分区时，行也必须跟着回退——
  // 否则覆盖点名会拿报告条款去比招标原文行，整片假缺口（resolveDeviationClauses 的 how 已如实反映回退）。
  const sourceText =
    clauseResolution.how === "parse" && source.how !== "parse"
      ? sectionText(report ?? null, "delivery_req")
      : source.text
  const rows = useMemo(() => buildParamResponseRows(sourceText, { cap: ROW_CAP }), [sourceText])
  const summary = useMemo(() => summarizeParamResponse(rows), [rows])
  const coverage = useMemo(
    () => checkParamResponseCoverage(clauseResolution.clauses.map((c) => c.text), rows),
    [clauseResolution, rows],
  )
  const capped = rows.length >= ROW_CAP

  return (
    <section className="mt-6 rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileCheck2 className="h-4 w-4 text-primary" />
            技术参数响应表
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            把招标文件的参数条款逐条搬成响应式表述（本地字眼转换、零 AI 改写），★/▲ 重点条款先汇总在表头
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">共 {summary.total} 条</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">【评审项】{summary.review}</span>
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">▲实质性{summary.star}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">一般项{summary.general}</span>
            {summary.rewritten > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">已转换字眼 {summary.rewritten}</span>
            )}
            {summary.needs_review > 0 && (
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                待人工确认 {summary.needs_review}
              </span>
            )}
          </div>
        )}
      </header>

      {/* 来源区：显示**实际**用了哪一处（含「你的描述没找到」这类回退说明），并提供自己描述的入口 */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          参数来源：<span className="text-foreground">{clauseResolution.label}</span>；条款与「技术偏离表」同一来源口径，逐条对照不重不漏。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="tech-param-source-hint" className="text-xs font-medium text-muted-foreground">
            章节描述
          </label>
          <Input
            id="tech-param-source-hint"
            value={customHint}
            onChange={(e) => setCustomHint(e.target.value)}
            placeholder="自己描述参数所在章节，如「第五章 采购需求」「附件三 技术规格书」；留空按标题关键词自动定位"
            className="h-7 max-w-md text-xs"
          />
          {customHint.trim() && (
            <button
              type="button"
              onClick={() => setCustomHint("")}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              清除，回到自动定位
            </button>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          本表按招标文件原文逐条响应：只把「要求 / 需 / 应 / 须」这类要求类字眼改为「支持 / 提供」这类陈述式，
          原文其余部分一字不动（长句默认折叠两行，点开看全文）。
        </p>
      </div>

      {/* 表头汇总：重点条款先列出来，且按原文逐字（含 ★/▲ 标记），便于对照响应 */}
      {summary.starClauses.length > 0 && (
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            ★ / ▲【评审项】重点条款 {summary.starClauses.length} 条 —— 按招标文件原文响应，逐条对照不得漏项
          </p>
          <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
            {summary.starClauses.map((c, i) => (
              <li key={`${c.no}-${i}`} className="flex items-start gap-1.5 border-b border-warning/10 py-1 text-xs last:border-0">
                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{c.no || `#${i + 1}`}</span>
                <span className="min-w-0 flex-1 text-foreground">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="p-4">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            {source.how === "none"
              ? "没有定位到技术参数来源——可在上方「章节描述」里写明参数所在章节（如「第五章 采购需求」「附件三 技术规格书」），或先在解析环节完成采购需求解析"
              : "已定位到来源章节，但里面没有可逐条响应的参数行"}
          </p>
        ) : (
          <>
            {coverage.missing.length > 0 ? (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs font-medium text-destructive">
                  覆盖点名：抽到条款 {coverage.clause_count} 条 ↔ 本表 {coverage.row_count} 行，{coverage.missing.length} 条未对上
                </p>
                <ul className="mt-1.5 max-h-40 overflow-y-auto">
                  {coverage.missing.slice(0, MISSING_SHOW).map((t, i) => (
                    <li key={`${i}-${t.slice(0, 12)}`} className="border-b border-destructive/10 py-1 text-xs text-foreground last:border-0">
                      {t}
                    </li>
                  ))}
                  {coverage.missing.length > MISSING_SHOW && (
                    <li className="py-1 text-xs text-muted-foreground">…另有 {coverage.missing.length - MISSING_SHOW} 条</li>
                  )}
                </ul>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  这些条款与偏离表同源（{clauseResolution.label}）：请逐条核对是漏建响应行，还是「注：以★标示…」这类标记说明文本。
                </p>
              </div>
            ) : coverage.clause_count > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  覆盖核对：抽到条款 {coverage.clause_count} 条 ↔ 本表 {coverage.row_count} 行 · 全部对上
                </span>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">条款序号</th>
                    <th className="px-2 py-2 font-medium">招标要求（原文）</th>
                    <th className="px-2 py-2 font-medium">响应表述</th>
                    <th className="px-2 py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const expanded = expandedKey === r.index
                    const toggle = () => setExpandedKey(expanded ? null : r.index)
                    return (
                      <tr
                        key={r.index}
                        className={`border-b border-border/60 align-top last:border-0 ${r.needs_review ? "bg-warning/5" : ""}`}
                      >
                        <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{r.no || r.index}</td>
                        <td className="max-w-md px-2 py-2">
                          <button
                            type="button"
                            onClick={toggle}
                            className="flex w-full items-start gap-1.5 text-left text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {expanded ? (
                              <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className={expanded ? "" : "line-clamp-2"}>{r.original}</span>
                          </button>
                        </td>
                        <td className="max-w-md px-2 py-2">
                          <button
                            type="button"
                            onClick={toggle}
                            className="w-full text-left text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <span className={expanded ? "" : "line-clamp-2"}>{r.response}</span>
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[r.kind]}`}>
                              {PARAM_KIND_LABEL[r.kind]}
                            </span>
                            {r.rewritten && (
                              <span
                                title={r.changes.map((c) => c.note).join("；")}
                                className="whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                              >
                                已转换字眼
                              </span>
                            )}
                            {r.needs_review && (
                              <span
                                title={r.reason}
                                className="whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                              >
                                待人工确认
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {capped && (
              <p className="mt-2 text-xs text-muted-foreground">本表只列前 {ROW_CAP} 条参数行（超出部分未列出），请按章节描述收窄来源后再核对。</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
