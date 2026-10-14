import { useMemo, useState } from "react"
import { ArrowRight, Calculator, CircleCheck, Table2, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  effectiveGlobalFactsLines,
  pickLatestQuoteTotals,
  scoringItemsFromReport,
} from "@/pages/BidWorkspace/bidTypes"
import {
  buildPriceScoreView,
  fmtPriceText,
  fmtScore,
  type PriceScoreView,
} from "@/pages/BidWorkspace/priceScoreBrief"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

// R38（B12）价格分测算接 UI：挂在第 6 步「模拟评标」之下。
// R35 交付算法层、R36 修对临界价闭式解，但此前全仓 0 个用户入口——本卡片把它接成人能用的东西：
// 口径从解析报告的评分办法里识别，我方报价取自关联商机的报价单总额（单源复用，不新造数据），
// 对手报价只接受手输（竞对情报存的是中标金额，不是投标报价，冒用会把基准价算歪）。
// 本地确定性复算：零 AI、零新 collection、输入只活在会话内，不写任何字段。
// 换项目由调用方以 key 重挂载来重置输入（不在 effect 里同步 setState，避免级联渲染）。

type PriceScorePanelProps = Pick<UseBidWorkspace, "activeProject" | "quoteRefs" | "goParseStep">

/** 填入输入框的写法：整万按「万」，其余按元（parseMoneyInput 两种都认，不制造单位歧义） */
function toFillText(yuan: number): string {
  const wan = yuan / 1e4
  return Number.isInteger(wan) ? `${wan}万` : String(yuan)
}

/** 口径卡：把识别结果摊开给用户逐字核对（口径错了后面所有分都错） */
function FormulaCard({ view }: { view: PriceScoreView }) {
  const f = view.formula
  if (!f) return null
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="success" className="rounded-full">{f.kindLabel}</Badge>
        <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
          满分 {fmtScore(f.fullScore)} 分
        </Badge>
        <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
          基准价：{f.basisLabel}
          {f.floatPct > 0 ? ` · 下浮 ${fmtScore(f.floatPct)}%` : " · 无下浮"}
        </Badge>
        {f.deductText && (
          <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
            {f.deductText}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-foreground">{f.plainNote}</p>
      <p className="mt-2 border-l-2 border-primary/40 pl-2 text-xs leading-relaxed text-muted-foreground">
        评分项「{f.name}」原文：{f.raw}
      </p>
    </div>
  )
}

/** 结果卡：得分 / 分差 / 偏差率 / 拿满分临界价 + 敏感性阶梯 */
function ResultBlock({ view }: { view: PriceScoreView }) {
  const r = view.result
  if (!r) return null
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
          <p className="text-lg font-bold text-foreground">{fmtPriceText(r.baseline)}</p>
          <p className="mt-1 text-xs text-muted-foreground">评标基准价</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
          <p className="text-2xl font-bold text-primary">{fmtScore(r.score)}</p>
          <p className="mt-1 text-xs text-muted-foreground">价格分测算得分</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
          <p className={`text-2xl font-bold ${r.gap > 0 ? "text-destructive" : "text-foreground"}`}>{fmtScore(r.gap)}</p>
          <p className="mt-1 text-xs text-muted-foreground">距满分差</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
          <p className="text-2xl font-bold text-foreground">{r.deviationPct === null ? "—" : `${fmtScore(r.deviationPct)}%`}</p>
          <p className="mt-1 text-xs text-muted-foreground">报价偏差率（比值法不适用）</p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{r.baselineNote}</p>

      {view.target ? (
        <div className={`rounded-lg border px-4 py-3 text-sm ${view.target.invalidReason ? "border-destructive/40 bg-destructive/10" : "border-primary/30 bg-primary/5"}`}>
          <p className="font-medium text-foreground">{view.target.text}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{view.target.note}</p>
          {view.target.invalidReason && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              但该价{view.target.invalidReason}——不能为拿价格分把标做废
            </p>
          )}
        </div>
      ) : (
        view.formula?.basis === "trimmed_average" && (
          <p className="rounded-md border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            去极值平均口径下，我方报价自身可能就是被剔掉的那个极值，「报多少拿满分」没有闭式解——请以下方阶梯试算为准。
          </p>
        )
      )}

      {view.steps.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
          <p className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Table2 className="h-3.5 w-3.5 text-primary" />
            报价敏感性阶梯（每档都重算基准价：均价类口径下挪报价会拖动基准价）
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">试算报价</th>
                  <th className="px-3 py-2 font-medium">价格分</th>
                  <th className="px-3 py-2 font-medium">较现价得分</th>
                  <th className="px-3 py-2 font-medium">有效性</th>
                </tr>
              </thead>
              <tbody>
                {view.steps.map((s) => (
                  <tr key={s.price} className={`border-b border-border/60 last:border-0 ${s.isAnchor ? "bg-primary/5" : ""}`}>
                    <td className="px-3 py-2 font-medium text-foreground">
                      {fmtPriceText(s.price)}
                      {s.isAnchor && (
                        <Badge variant="success" className="ml-1.5 rounded-full">现价</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-foreground">{fmtScore(s.score)}</td>
                    <td className={`px-3 py-2 ${s.delta > 0 ? "text-primary" : s.delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {s.delta > 0 ? `+${fmtScore(s.delta)}` : fmtScore(s.delta)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.invalidReason ? (
                        <span className="font-medium text-destructive">{s.invalidReason}</span>
                      ) : (
                        <span className="text-muted-foreground">有效</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function PriceScorePanel({ activeProject, quoteRefs, goParseStep }: PriceScorePanelProps) {
  // 我方报价：null = 没动过，就取关联商机报价单总额（单源）；一旦手输，以输入框为准
  const [ourPriceOverride, setOurPriceOverride] = useState<string | null>(null)
  const [competitorText, setCompetitorText] = useState("")
  const [ceilingText, setCeilingText] = useState("")
  const [ratioText, setRatioText] = useState("")

  const quoteOpts = useMemo(() => {
    const opp = (activeProject?.opportunity_id ?? "").trim()
    return opp ? pickLatestQuoteTotals(quoteRefs, opp) : []
  }, [activeProject?.opportunity_id, quoteRefs])
  const topQuote = quoteOpts[0] ?? null
  const ourPriceText = ourPriceOverride ?? (topQuote ? toFillText(topQuote.totalYuan) : "")

  const view = useMemo(
    () =>
      buildPriceScoreView({
        items: scoringItemsFromReport(activeProject?.parse_report ?? null),
        factLines: effectiveGlobalFactsLines(activeProject ?? null),
        ourPriceText,
        competitorText,
        ceilingText,
        minValidRatioText: ratioText,
      }),
    [activeProject, ourPriceText, competitorText, ceilingText, ratioText],
  )

  const showResult = view.phase === "computed"

  return (
    <section className="mt-5 rounded-xl border border-border bg-card px-6 py-5 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">价格分测算</h3>
        <span className="text-xs text-muted-foreground">按招标评分办法里的价格分公式本地复算（零 AI 费用）</span>
        <Badge variant="neutral" className="rounded-full">投标前自查，评标以现场开标为准</Badge>
      </div>

      {(view.phase === "no-scoring" || view.phase === "no-price-item") && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border bg-background px-3 py-3">
          <p className="text-xs text-muted-foreground">{view.note}</p>
          {view.phase === "no-scoring" && (
            <Button size="sm" variant="outline" onClick={goParseStep} className="border-border text-card-foreground hover:bg-secondary">
              <ArrowRight className="mr-1 h-3.5 w-3.5" />
              前往解析环节
            </Button>
          )}
        </div>
      )}

      {view.formula && <div className="mt-4"><FormulaCard view={view} /></div>}

      {view.phase === "unrecognized" && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {view.candidates.map((c) => (
            <li key={`${c.name}:${c.score}`} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <span className="font-medium text-foreground">{c.name}</span>
              <span className="ml-1.5 text-muted-foreground">{c.score} 分</span>
              <p className="mt-1 text-muted-foreground">{c.reason}</p>
            </li>
          ))}
        </ul>
      )}

      {view.formula && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="ps-our-price" className="text-xs font-medium text-foreground">我方投标报价（元）</label>
            <Input
              id="ps-our-price"
              value={ourPriceText}
              onChange={(e) => setOurPriceOverride(e.target.value)}
              placeholder="如 2450万 / 24500000"
              className="mt-1 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
            />
            {topQuote && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {ourPriceOverride === null
                  ? `当前取自关联商机报价单「${topQuote.name.slice(0, 16)}」，可直接改成拟报金额；同一商机还有其它版本：`
                  : "已按你输入的金额计算；想回到报价单取值点下面任一项："}
                {quoteOpts.map((q) => (
                  <button
                    key={q.name}
                    type="button"
                    onClick={() => setOurPriceOverride(toFillText(q.totalYuan))}
                    className="rounded-full border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {q.name.slice(0, 12)} {fmtPriceText(q.totalYuan)}
                  </button>
                ))}
              </p>
            )}
            {!topQuote && activeProject && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                该项目未关联商机或商机下没有报价单，报价请手工填写（不影响对手报价的手输要求）。
              </p>
            )}
            {view.ourPriceError && <p className="mt-1 text-xs text-destructive">{view.ourPriceError}</p>}
          </div>

          <div>
            <label htmlFor="ps-rival-prices" className="text-xs font-medium text-foreground">对手有效报价（每行一个，必手填）</label>
            <Textarea
              id="ps-rival-prices"
              value={competitorText}
              onChange={(e) => setCompetitorText(e.target.value)}
              placeholder={"2480万\n2510万"}
              rows={3}
              className="mt-1 resize-none border-border bg-background text-xs focus-visible:shadow-[var(--focus-ring)]"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              竞对情报里存的是历史中标金额，不等于本次投标报价，故不自动带入；至少要 1 个有效报价，否则没有参照系。
            </p>
            {view.competitorRejected.length > 0 && (
              <p className="mt-1 text-xs text-warning">
                以下 {view.competitorRejected.length} 条没认成金额，未进测算：{view.competitorRejected.slice(0, 3).join("、")}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ps-ceiling" className="text-xs font-medium text-foreground">
              最高限价 / 预算（元，留空取事实表）
            </label>
            <Input
              id="ps-ceiling"
              value={ceilingText}
              onChange={(e) => setCeilingText(e.target.value)}
              placeholder={view.ceiling ? toFillText(view.ceiling.value) : "如 2500万"}
              className="mt-1 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
            />
            {view.ceiling && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <CircleCheck className="h-3.5 w-3.5 text-primary" />
                当前生效：{fmtPriceText(view.ceiling.value)}（来源：{view.ceiling.src}）
              </p>
            )}
            {view.ceilingError && <p className="mt-1 text-xs text-destructive">{view.ceilingError}</p>}
          </div>

          <div>
            <label htmlFor="ps-min-ratio" className="text-xs font-medium text-foreground">
              低于限价该比例按无效标（%，招标文件写了才填）
            </label>
            <Input
              id="ps-min-ratio"
              value={ratioText}
              onChange={(e) => setRatioText(e.target.value)}
              placeholder="如 45"
              className="mt-1 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
            />
            {view.minValidRatioError && <p className="mt-1 text-xs text-destructive">{view.minValidRatioError}</p>}
          </div>
        </div>
      )}

      {view.unitHint && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          {view.unitHint}
        </p>
      )}

      {!showResult && view.formula && view.note && (
        <p className="mt-3 rounded-md border border-dashed border-border bg-background px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {view.note}
        </p>
      )}

      {showResult && <ResultBlock view={view} />}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        本面板只做「公式级」复算：基准价由你填入的对手报价样本推定，真实开标还会有有效标认定、
        下浮率现场抽取等变数；识别不了或样本不足时一律不出数，请按招标文件人工计算。
      </p>
    </section>
  )
}
