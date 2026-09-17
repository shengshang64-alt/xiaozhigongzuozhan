import { useMemo } from "react"
import { ListChecks } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ParseReport } from "@/pages/BidWorkspace/bidTypes"
import {
  crossCheckScores,
} from "@/pages/BidWorkspace/scoreItemsScan"

// R008（B-2 阶段一）：评分项本地交叉核对面板（挂标书工作第 2 步）。
// 本地扫描招标原文 vs AI 解析报告的 tech_score/biz_score，零 AI 费用。

const CAT_LABEL: Record<string, string> = { tech: "技术", biz: "商务", price: "价格", other: "未归类" }

export function ScoreCrossCheckPanel({
  tenderText,
  report,
}: {
  tenderText: string
  report: ParseReport | null
}) {
  const cc = useMemo(() => crossCheckScores(tenderText ?? "", report), [tenderText, report])

  if (!tenderText?.trim()) {
    return (
      <section className="rounded-xl border border-border bg-card px-6 py-5 shadow-md">
        <Header />
        <p className="mt-4 rounded-lg border border-dashed border-border bg-background px-4 py-4 text-sm text-muted-foreground">
          先在第 1 步上传/粘贴招标文件原文，即可本地扫描评分项并与解析报告交叉核对（零 AI 费用）。
        </p>
      </section>
    )
  }

  const sums = cc.categorySums
  const sumsText = `技术 ${sums.tech} · 商务 ${sums.biz} · 价格 ${sums.price} · 未归类 ${sums.other}`
  const totalText = cc.total.value !== null ? `${cc.total.value}` : "未识别"

  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5 shadow-md">
      <Header />
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
          本地扫描 {cc.scanned.length} 项
        </Badge>
        <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
          解析报告 {cc.parsed.length} 项
        </Badge>
        {cc.missingInReport.length > 0 && (
          <Badge variant="outline" className="rounded-full border-destructive/40 bg-destructive/10 text-destructive">
            报告漏抽 {cc.missingInReport.length}
          </Badge>
        )}
        {cc.scoreMismatch.length > 0 && (
          <Badge variant="outline" className="rounded-full border-warning/40 bg-warning/10 text-warning">
            分值不符 {cc.scoreMismatch.length}
          </Badge>
        )}
        <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
          分类合计：{sumsText}
        </Badge>
        <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
          原文总分：{totalText}
        </Badge>
      </div>

      {cc.totalSumWarn && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {cc.totalSumWarn}——评分项分项之和必须等于总分（常见废标级口径错误），请核对解析报告。
        </p>
      )}

      {cc.missingInReport.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-foreground">本地扫描到、但解析报告没有的评分项</h4>
          <ul className="mt-2 space-y-1">
            {cc.missingInReport.map((m) => (
              <li key={`${m.name}:${m.score}`} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                <span className={`rounded-full px-2 py-0.5 ${m.cat === "other" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                  {CAT_LABEL[m.cat]}
                </span>
                <span className="text-foreground">{m.name}</span>
                <span>{m.score} 分</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cc.scoreMismatch.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-foreground">分值与原文不一致的项</h4>
          <ul className="mt-2 space-y-1">
            {cc.scoreMismatch.map(({ scanned, parsed }) => (
              <li key={parsed.name} className="text-xs text-muted-foreground">
                <span className="text-foreground">{parsed.name}</span>：解析为{" "}
                <span className="font-medium text-warning">{parsed.score} 分</span>，原文为{" "}
                <span className="font-medium text-primary">{scanned.score} 分</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        扫描为逐行启发式（「名称 N 分」模式），PDF 表格抽取可能丢行——本面板用于交叉复核，评分项真值以招标文件原文为准。
      </p>
    </section>
  )
}

function Header() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ListChecks className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold text-foreground">评分项交叉核对</h3>
      <span className="text-xs text-muted-foreground">本地扫描招标原文 vs 解析报告（零 AI 费用）</span>
    </div>
  )
}
