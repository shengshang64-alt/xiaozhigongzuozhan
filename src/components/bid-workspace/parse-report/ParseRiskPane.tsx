import { useMemo, useState } from "react"
import { Loader2, ShieldAlert, Sparkles } from "lucide-react"
import { chatViaGateway, type ModelRef } from "@/lib/modelGateway"
import type { ModelRole } from "@/lib/modelRouting"
import { extractJsonCandidate, parseJsonTolerant } from "@/lib/jsonTolerant"
import {
  mergeRiskFindings,
  parseAiRiskFindings,
  RISK_CATEGORY_LABEL,
  RISK_LEVEL_LABEL,
  type RiskCategory,
  type RiskFinding,
} from "@/pages/BidWorkspace/tenderComplianceRisk"
import type { ParseReport } from "@/pages/BidWorkspace/bidTypes"

const AI_RISK_SYSTEM = [
  "你是招标文件合规审查助手，依据《医疗信息化投标全流程规范》：八大禁止情形（差别待遇/歧视）、六类隐形陷阱、七条招标红线。",
  "请从招标文件原文中找出规则难以命中的语义级风险：隐性倾向特定供应商的参数、前后矛盾的条款、变相排斥潜在投标人、权利义务明显失衡等。",
  "输出严格 JSON 数组（禁止解释文字与代码围栏），每个元素形如：",
  '{"ruleId":"短标识","category":"discrimination|trap|redline","level":"red|yellow","title":"风险简称","excerpt":"原文摘录（尽量短）","reason":"为何构成风险","legalBasis":"法规/规范依据","suggestion":"质疑或处置建议"}',
  "category 取值只能是 discrimination（差别待遇/歧视）、trap（隐形陷阱）、redline（招标红线）之一；没有可报的风险就给空数组 []。",
].join("\n")

const RISK_CAT_ORDER: RiskCategory[] = ["discrimination", "trap", "redline"]

function riskLevelTone(level: RiskFinding["level"]): string {
  return level === "red" ? "border-destructive/30 bg-destructive/5" : "border-warning/40 bg-warning/10"
}

/**
 * 「风险与合规」：规则引擎本地扫描 + 可选的 AI 深度体检。
 * 扫描结果不落库；AI 结果仍写入 report.risk_ai_findings，口径与改版前一致。
 */
export function ParseRiskPane({
  tenderText,
  findings,
  summary,
  reportFindings,
  onChange,
  runWithCostConfirm,
  archived,
  modelRefForRole,
}: {
  tenderText: string
  findings: RiskFinding[]
  summary: {
    total: number
    red: number
    yellow: number
    aiCount: number
    hasRisk: boolean
    byCategory: Record<RiskCategory, number>
  }
  reportFindings: RiskFinding[]
  onChange: (patch: Partial<ParseReport>) => void
  runWithCostConfirm?: (fn: () => void, message: string) => void
  archived?: boolean
  modelRefForRole?: (role: ModelRole) => ModelRef | null
}) {
  const [riskScanning, setRiskScanning] = useState(false)
  const [riskError, setRiskError] = useState("")
  const [riskFilter, setRiskFilter] = useState<RiskCategory | "all">("all")
  const visible = useMemo(
    () => (riskFilter === "all" ? findings : findings.filter((f) => f.category === riskFilter)),
    [findings, riskFilter],
  )

  const runAiRiskCheck = () => {
    if (!runWithCostConfirm || riskScanning || archived || !tenderText.trim()) return
    setRiskError("")
    runWithCostConfirm(() => {
      void (async () => {
        setRiskScanning(true)
        try {
          const excerpt = tenderText.slice(0, 12000)
          const res = await chatViaGateway({
            modelRef: modelRefForRole?.("judge") ?? null,
            messages: [
              { role: "system", content: AI_RISK_SYSTEM },
              { role: "user", content: `【招标文件原文（可能截断）】\n${excerpt}\n\n请输出风险条款 JSON 数组。` },
            ],
            page: "bid-workspace",
            max_tokens: 4096,
          })
          if (!res.ok || !res.text) throw new Error(res.error || "AI 体检失败，请重试")
          const candidate = extractJsonCandidate(res.text)
          if (!candidate) throw new Error("AI 未返回可解析结果，请重试")
          const ai = parseAiRiskFindings(parseJsonTolerant(candidate))
          if (!ai.length) throw new Error("AI 未发现规则之外的语义级风险条款")
          onChange({ risk_ai_findings: mergeRiskFindings(reportFindings, ai) })
        } catch (e) {
          setRiskError(e instanceof Error ? e.message : "AI 体检失败，请重试")
        } finally {
          setRiskScanning(false)
        }
      })()
    }, "将调用 AI 对招标文件做语义级合规风险复核（规则扫描之外的倾向性/前后矛盾判定，结果标注为 AI 提示、须人工确认），按 token 用量计费")
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          <h3 className="text-sm font-semibold text-foreground">合规风险与红线</h3>
          {summary.red > 0 && <span className="badge-danger">红 {summary.red}</span>}
          {summary.yellow > 0 && <span className="badge-warning">黄 {summary.yellow}</span>}
          {summary.aiCount > 0 && <span className="badge-success">AI 提示 {summary.aiCount}</span>}
          {summary.total === 0 && <span className="badge-neutral">未发现确定性风险</span>}
        </div>
        {runWithCostConfirm && (
          <button
            type="button"
            onClick={runAiRiskCheck}
            disabled={riskScanning || archived}
            title="调用模型复核规则难以命中的倾向性与前后矛盾（产生一次费用，结果须人工确认）"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {riskScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {riskScanning ? "AI 体检中…" : "AI 深度体检"}
          </button>
        )}
      </header>
      <div className="p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          规则在本地扫描原文，不产生费用。「AI 深度体检」只补充规则抓不到的语义风险，结果标成待人工确认。
        </p>
        {riskError && (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{riskError}</p>
        )}
        {summary.total > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRiskFilter("all")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                riskFilter === "all" ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              全部 {summary.total}
            </button>
            {RISK_CAT_ORDER.map((c) =>
              summary.byCategory[c] > 0 ? (
                <button
                  key={c}
                  type="button"
                  onClick={() => setRiskFilter(riskFilter === c ? "all" : c)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    riskFilter === c ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {RISK_CATEGORY_LABEL[c]} {summary.byCategory[c]}
                </button>
              ) : null,
            )}
          </div>
        )}
        {visible.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground">
            {summary.hasRisk ? "当前筛选下没有条目。点「全部」查看。" : "规则扫描未发现确定性风险。需要时再点「AI 深度体检」。"}
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {visible.map((f, i) => (
              <li key={`${f.ruleId}-${f.line}-${i}`} className={`rounded-md border px-3 py-2.5 ${riskLevelTone(f.level)}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      f.level === "red" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"
                    }`}
                  >
                    {RISK_LEVEL_LABEL[f.level]}
                  </span>
                  <span className="badge-neutral shrink-0">{RISK_CATEGORY_LABEL[f.category]}</span>
                  {f.origin === "ai" && <span className="badge-success shrink-0">AI · 待人工确认</span>}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={f.title}>
                    {f.title}
                  </span>
                  {f.line > 0 && <span className="shrink-0 text-xs text-muted-foreground">L{f.line}</span>}
                </div>
                {f.excerpt && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground" title={f.excerpt}>
                    原文：「{f.excerpt}」
                  </p>
                )}
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.reason}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">依据：</span>
                  {f.legalBasis}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">建议：</span>
                  {f.suggestion}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
