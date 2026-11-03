import { ArrowRight, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ParseNotice } from "./parseReportLayout"

export type LotsChipModel = {
  nos: number[]
  selected: number[]
  limited: boolean
  onSelectAll: () => void
  onToggle: (no: number) => void
}

/**
 * 解析页首屏：只回答「这份招标文件解析好了没、下一步处理什么」。
 * 指标常驻，主操作只有一个；其余提示收进一条可展开的说明。
 */
export function ParseHealthBar({
  title,
  detail,
  requiredOk,
  requiredFailureCount,
  pendingCount,
  starCount,
  riskTotal,
  riskRed,
  primary,
  notices,
  lots,
}: {
  title: string
  detail: string
  requiredOk: boolean
  requiredFailureCount: number
  pendingCount: number
  starCount: number
  riskTotal: number
  riskRed: number
  primary: { label: string; onClick: () => void } | null
  notices: ParseNotice[]
  lots: LotsChipModel | null
}) {
  const dangerNotices = notices.filter((n) => n.tone === "danger")
  const foldedNotices = notices.filter((n) => n.tone !== "danger")
  const metrics = [
    {
      label: "必选项",
      value: requiredOk ? "已通过" : `未通过 ${requiredFailureCount}`,
      tone: requiredOk ? "text-primary" : "text-destructive",
    },
    {
      label: "失败或待核实",
      value: pendingCount > 0 ? `${pendingCount} 项` : "没有",
      tone: pendingCount > 0 ? "text-warning" : "text-foreground",
    },
    {
      label: "★/▲ 条款",
      value: `${starCount} 条`,
      tone: "text-foreground",
    },
    {
      label: "合规风险",
      value: riskRed > 0 ? `${riskTotal} 条 · 红 ${riskRed}` : `${riskTotal} 条`,
      tone: riskRed > 0 ? "text-destructive" : "text-foreground",
    },
  ]

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        {primary && (
          <Button type="button" onClick={primary.onClick} className="shrink-0">
            {requiredOk ? <ArrowRight className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            {primary.label}
          </Button>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-md bg-secondary px-3 py-2">
            <dt className="text-xs text-muted-foreground">{m.label}</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums leading-tight ${m.tone}`}>{m.value}</dd>
          </div>
        ))}
      </dl>
      {lots && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">本次投标包件</span>
            <button
              type="button"
              onClick={lots.onSelectAll}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                !lots.limited ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              全部（{lots.nos.length} 包）
            </button>
            {lots.nos.map((n) => {
              const on = lots.selected.includes(n)
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => lots.onToggle(n)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  第{n}包
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {lots.limited
              ? `已限定第 ${lots.selected.join("、")} 包：后续大纲和正文只响应所选包件，其他包件专属条款不响应（公共条款照常）。`
              : "未限定包件：按整份文件响应。选定具体包件后，大纲和正文会带上包件范围（本地处理，不产生模型费用）。"}
          </p>
        </div>
      )}
      {dangerNotices.map((n) => (
        <div key={n.id} className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-semibold text-destructive">{n.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.detail}</p>
        </div>
      ))}
      {foldedNotices.length > 0 && (
        <details className="mt-3 rounded-md border border-border bg-background px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            解析提示 {foldedNotices.length} 条，不阻断进入下一步
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {foldedNotices.map((n) => (
              <li key={n.id} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="text-xs font-semibold text-foreground">{n.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.detail}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
