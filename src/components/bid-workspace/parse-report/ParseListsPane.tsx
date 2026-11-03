import { useState } from "react"
import { ClipboardList, Loader2, Sparkles } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { chatViaGateway, type ModelRef } from "@/lib/modelGateway"
import type { ModelRole } from "@/lib/modelRouting"
import { extractJsonCandidate, parseJsonTolerant } from "@/lib/jsonTolerant"
import type { ParseReport, ParseSection } from "@/pages/BidWorkspace/bidTypes"
import {
  judgeParam,
  PARAM_MATCH,
  PARAM_MATCH_ORDER,
  type ParamMatchType,
  type ParamRow,
} from "@/pages/BidWorkspace/paramMatchTypes"
import { ParseSectionReader, type SectionReaderActions } from "./ParseSectionReader"

const AI_PARAM_SYSTEM = [
  "你是医疗信息化售前技术评估助手，依据《医疗信息化投标全流程规范》4.1 参数匹配四类。",
  "四类：full=完全满足；partial=部分不满足（仅非关键细节差异）；alternative=替代方案（功能等效或更优）；none=完全不满足。",
  "结合【我方产品能力概述】逐条判断每个技术参数最可能的匹配类型；拿不准时给 partial 并在 reason 注明需核实，不得臆造产品能力。",
  '输出严格 JSON 数组（禁止解释与代码围栏），每元素：{"key":"原行key","type":"full|partial|alternative|none","reason":"一句话依据"}。',
].join("\n")

const LEVEL_TONE = {
  ok: "badge-success",
  caution: "badge-warning",
  danger: "badge-danger",
} as const

const LEVEL_LABEL = {
  ok: "可正常响应",
  caution: "需论证或补材料",
  danger: "★红线冲突",
} as const

function MissingList({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
      <ClipboardList className="mx-auto h-7 w-7 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  )
}

/**
 * 「清单与参数」：采购清单、编制依据、技术参数四类研判。
 * 参数选择仍写回 report.param_match_choices，研判规则未改。
 */
export function ParseListsPane({
  sections,
  purchase,
  basis,
  actions,
  tenderText,
  paramRows,
  paramSummary,
  choices,
  onChange,
  runWithCostConfirm,
  archived,
  modelRefForRole,
}: {
  sections: ParseSection[]
  purchase: ParseSection | null
  basis: ParseSection | null
  actions: SectionReaderActions
  tenderText: string
  paramRows: ParamRow[]
  paramSummary: {
    total: number
    typed: number
    overall: "bid" | "caution" | "reject" | "pending"
    message: string
    byType: Record<ParamMatchType, number>
  }
  choices: Record<string, string>
  onChange: (patch: Partial<ParseReport>) => void
  runWithCostConfirm?: (fn: () => void, message: string) => void
  archived?: boolean
  modelRefForRole?: (role: ModelRole) => ModelRef | null
}) {
  const [paramBrief, setParamBrief] = useState("")
  const [paramBusy, setParamBusy] = useState(false)
  const [paramError, setParamError] = useState("")

  const setParamChoice = (key: string, t: ParamMatchType) => {
    onChange({ param_match_choices: { ...choices, [key]: t } })
  }

  const runAiParamAssist = () => {
    if (!runWithCostConfirm || paramBusy || archived || !paramRows.length) return
    setParamError("")
    const pending = paramRows.filter((r) => !r.matchType)
    if (!pending.length) {
      setParamError("所有参数行均已研判，无需 AI 兜底")
      return
    }
    const brief = paramBrief.trim() || "（未提供产品能力概述，请仅依据条款常识谨慎给出建议并标注需核实）"
    runWithCostConfirm(() => {
      void (async () => {
        setParamBusy(true)
        try {
          const list = pending.map((r) => `${r.key}\t${r.substantive ? "★" : r.keyMark ? "▲" : ""}${r.param}`).join("\n")
          const res = await chatViaGateway({
            modelRef: modelRefForRole?.("extract") ?? null,
            messages: [
              { role: "system", content: AI_PARAM_SYSTEM },
              { role: "user", content: `【我方产品能力概述】\n${brief}\n\n【待研判参数（每行：key\t原文）】\n${list}\n\n请逐行输出 JSON 数组。` },
            ],
            page: "bid-workspace",
            max_tokens: 2048,
          })
          if (!res.ok || !res.text) throw new Error(res.error || "AI 研判失败，请重试")
          const candidate = extractJsonCandidate(res.text)
          if (!candidate) throw new Error("AI 未返回可解析结果，请重试")
          const parsed = parseJsonTolerant(candidate)
          const arr = Array.isArray(parsed) ? (parsed as Array<{ key?: string; type?: string }>) : []
          const patchMap: Record<string, string> = { ...choices }
          let n = 0
          for (const it of arr) {
            if (!it?.key || !it.type) continue
            if (PARAM_MATCH_ORDER.indexOf(it.type as ParamMatchType) < 0) continue
            const target = paramRows.find((rr) => rr.key === it.key)
            if (!target || target.matchType) continue
            patchMap[it.key] = it.type
            n++
          }
          if (!n) throw new Error("AI 未给出可用研判建议")
          onChange({ param_match_choices: patchMap })
        } catch (e) {
          setParamError(e instanceof Error ? e.message : "AI 研判失败，请重试")
        } finally {
          setParamBusy(false)
        }
      })()
    }, "将调用 AI 依据产品能力概述对未研判参数给出匹配类型建议（结果须人工确认），按 token 用量计费")
  }

  const decisionTone =
    paramSummary.overall === "reject"
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : paramSummary.overall === "caution"
        ? "border-warning/40 bg-warning/10 text-foreground"
        : "border-border bg-background text-muted-foreground"

  return (
    <div className="flex flex-col gap-4">
      {purchase ? (
        <ParseSectionReader section={purchase} sections={sections} actions={actions} />
      ) : (
        <MissingList
          title="这次解析里没有采购清单"
          hint="若招标文件有货物或服务清单，回到解析配置勾选「采购清单」后重新解析。有文档原表时，这里会按原表展示并可以导出 Word。"
        />
      )}
      {basis ? (
        <ParseSectionReader section={basis} sections={sections} actions={actions} />
      ) : (
        <MissingList
          title="这次解析里没有编制依据"
          hint="勾选「编制依据与规范」后重新解析。也可以在该项里从规范库补选，补选结果会跟解析提取合并。"
        />
      )}
      {tenderText.trim() && paramRows.length > 0 && (
        <section className="rounded-lg border border-border bg-card shadow-md">
          <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">技术参数匹配</h3>
              {paramSummary.overall === "reject" ? (
                <span className="badge-danger">建议放弃投标</span>
              ) : paramSummary.overall === "caution" ? (
                <span className="badge-warning">谨慎投标</span>
              ) : paramSummary.overall === "pending" ? (
                <span className="badge-neutral">待研判</span>
              ) : (
                <span className="badge-success">可正常投标</span>
              )}
              <span className="text-xs text-muted-foreground">
                已研判 {paramSummary.typed}/{paramSummary.total}
              </span>
            </div>
            {runWithCostConfirm && (
              <button
                type="button"
                onClick={runAiParamAssist}
                disabled={paramBusy || archived}
                title="按产品能力概述，给还没研判的参数一个建议（只填空，须人工确认，产生一次费用）"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                {paramBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {paramBusy ? "AI 研判中…" : "AI 兜底研判"}
              </button>
            )}
          </header>
          <div className="p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              对每条带 ★/▲ 的技术参数选择「完全满足 / 部分不满足 / 替代方案 / 完全不满足」。★ 完全不满足会提示放弃；部分不满足或替代需要重点论证。
            </p>
            <div className={`mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed ${decisionTone}`}>{paramSummary.message}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {PARAM_MATCH_ORDER.map((t) => (
                <span key={t} className="badge-neutral">
                  {PARAM_MATCH[t].code} {PARAM_MATCH[t].label} {paramSummary.byType[t]}
                </span>
              ))}
            </div>
            {runWithCostConfirm && (
              <Textarea
                value={paramBrief}
                onChange={(e) => setParamBrief(e.target.value)}
                placeholder="选填：简述我方产品能力，供 AI 兜底研判参考。留空则只按条款常识给建议，并标明需核实。"
                className="mt-3 min-h-14"
              />
            )}
            {paramError && (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{paramError}</p>
            )}
            <ul className="mt-3 grid gap-2">
              {paramRows.map((r) => {
                const v = judgeParam(r)
                return (
                  <li key={r.key} className="rounded-md border border-border bg-background px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(r.substantive || r.keyMark) && (
                        <span className="shrink-0 font-semibold text-primary" title={r.substantive ? "★ 实质性条款" : "▲ 重点条款"}>
                          {r.substantive ? "★" : "▲"}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">{r.param}</span>
                      <span className={`shrink-0 ${LEVEL_TONE[v.level]}`}>{LEVEL_LABEL[v.level]}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {PARAM_MATCH_ORDER.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setParamChoice(r.key, t)}
                          title={PARAM_MATCH[t].definition}
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            r.matchType === t
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-secondary"
                          }`}
                        >
                          {PARAM_MATCH[t].code} {PARAM_MATCH[t].label}
                        </button>
                      ))}
                    </div>
                    {r.matchType && (
                      <ul className="mt-2 grid gap-0.5">
                        {v.guidance.map((g, i) => (
                          <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                            · {g}
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.conflict && (
                      <p
                        className={`mt-1.5 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed ${
                          v.level === "danger"
                            ? "border-destructive/30 bg-destructive/5 text-destructive"
                            : "border-warning/40 bg-warning/10 text-foreground"
                        }`}
                      >
                        {v.level === "danger" ? "★红线：" : "提示："}
                        {v.conflict}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
