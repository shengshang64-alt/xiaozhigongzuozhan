import { useMemo } from "react"
import { FileSearch } from "lucide-react"
import { buildParseConfirmModel, type ConfirmTone } from "@/pages/BidWorkspace/parseConfirmModel"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// ① 导入招标 · 左栏「本次解析会抽取这四类」（UX-v2：prototype/bid/import.html 左栏第 4 块）
//
// 原型：四宫格列出 废标项 / 评分办法 / 技术参数 / 时间节点，每格右上给「预计 N 条」。
// 现网口径：**不做「预计」——没有解析报告时任何条数都是编的**。
//   · 已解析 → 直接复用 ② 解析确认的同一个派生模型（parseConfirmModel），数值与 ② 屏完全一致；
//   · 未解析 → 只列四类的含义与去向，数值位写「解析后统计」。
// 这样这张卡在两个阶段都不会撒谎，也顺手把「解析会产出什么、去 ② 确认」讲清楚。
// ---------------------------------------------------------------------------

const TONE: Record<ConfirmTone, string> = {
  red: "bg-destructive/10 text-destructive",
  blue: "bg-primary/10 text-primary",
  amber: "bg-warning/10 text-warning",
  purple: "bg-violet-500/10 text-violet-600",
  green: "bg-primary/10 text-primary",
  gray: "bg-muted text-muted-foreground",
}

const HINT: Record<string, string> = {
  void: "废标 / 资格性 / 符合性 / ★▲ 四条红线，逐条标出处，未响应即出局",
  score: "拆成评分点，作为 ③ 大纲覆盖与 ⑤ 偏离表的依据",
  param: "★ 条款逐条应答；带 ★/▲ 标注的参数行本地扫描得出",
  node: "报名 / 答疑 / 保证金 / 递交 / 开标，进项目时间节点",
}

export function ParseScopeCards({ project }: { project: BidProjectRecord }) {
  const model = useMemo(
    () =>
      buildParseConfirmModel({
        report: project.parse_report,
        tenderText: project.tender_text ?? "",
        tenderTables: project.tender_tables ?? null,
        progress: {},
      }),
    [project.parse_report, project.tender_text, project.tender_tables],
  )
  const parsed = Boolean(project.parse_report)

  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <FileSearch className="h-4 w-4 shrink-0 text-primary" />
        <h3 className="text-[13.5px] font-semibold text-card-foreground">本次解析会抽取这四类</h3>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted-foreground">解析结果在 ② 逐类确认</span>
      </header>
      <div className="grid grid-cols-1 gap-2 px-3.5 py-3 sm:grid-cols-2">
        {model.cards.map((card) => (
          <div key={card.id} className="rounded-md border border-border/70 bg-background px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${TONE[card.tone]}`}>{card.label}</span>
              <div className="flex-1" />
              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {parsed ? (card.value != null ? `${card.value} 项` : "—") : "解析后统计"}
              </span>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">{HINT[card.id]}</p>
          </div>
        ))}
      </div>
      <footer className="border-t border-border bg-secondary/30 px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        解析是<b className="text-card-foreground">只读</b>动作：只生成条款、评分点与参数清单，不写任何正文。
      </footer>
    </section>
  )
}
