import { useMemo } from "react"
import { Check, Package } from "lucide-react"
import { parseLotsLineInfo, type BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// ① 导入招标 · 左栏「包件」卡（UX-v2：prototype/bid/import.html 左栏第 3 块）
//
// 原型：本项目拆 N 个包件，逐条勾选本次投哪包（可只投一包），底部「本次投标范围 + 金额 + 占预算比」。
//
// 现网真值来源：
//   · 包清单 = parseLotsLineInfo(tender_text) 本地扫描（与解析报告 lots_scope 快照同一函数）；
//     少于 2 个包不渲染这张卡（单包项目没有「选包」这回事，硬渲染等于编一个包）。
//   · 选择写回 parse_report.lots_scope.selected（既有字段，②解析与③大纲的 lots 过滤一直读它），
//     所以在这里勾选和之前在解析报告里勾选是**同一份数据**，不是两套。
//   · 金额：包预算只有原文就近扫到的才显示，取不到就「—」（不按比例编）。
// ---------------------------------------------------------------------------

type LotsCardProps = {
  project: BidProjectRecord
  /** 写回 lots_scope（= hook 的 updateParseReport） */
  onChangeLots: (patch: { lots_scope: { selected: number[]; all: { no: number; title: string; lines: number }[] } }) => void
  locked: boolean
}

export function TenderLotsCard({ project, onChangeLots, locked }: LotsCardProps) {
  const lots = useMemo(() => {
    const text = project.tender_text ?? ""
    if (!text.trim()) return []
    return parseLotsLineInfo(text.split(/\r?\n/))
  }, [project.tender_text])

  if (lots.length < 2) return null

  const selected = project.parse_report?.lots_scope?.selected ?? []
  const all = lots.map((l) => ({ no: l.no, title: l.title, lines: l.lines }))
  const isOn = (no: number) => selected.includes(no)

  const toggle = (no: number) => {
    if (locked) return
    const next = isOn(no) ? selected.filter((n) => n !== no) : [...selected, no].sort((a, b) => a - b)
    onChangeLots({ lots_scope: { selected: next, all } })
  }

  const scopeLabel =
    selected.length === 0
      ? `全部 ${lots.length} 个包件`
      : selected.length === 1
        ? `包 ${selected[0]}`
        : `包 ${selected.join(" / ")}`

  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Package className="h-4 w-4 shrink-0 text-primary" />
        <h3 className="text-[13.5px] font-semibold text-card-foreground">包件</h3>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted-foreground">
          本招标拆 {lots.length} 个包件，本次可只投其中一包
        </span>
      </header>
      <div className="divide-y divide-border/50">
        {lots.map((l) => {
          const on = isOn(l.no) || selected.length === 0
          return (
            <label
              key={l.no}
              className={`flex cursor-pointer items-start gap-2 px-3.5 py-2 transition-colors hover:bg-secondary/50 ${
                on ? "" : "opacity-70"
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={locked}
                onChange={() => toggle(l.no)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-card-foreground" title={l.title}>
                  包 {l.no} · {l.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  原文第 {l.lines + 1} 行{l.budget ? ` · 预算 ${l.budget}` : ""}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
        <Check size={11} strokeWidth={3} className="shrink-0 text-primary" />
        <span>
          本次投标范围 <b className="text-card-foreground">{scopeLabel}</b>
        </span>
        <div className="flex-1" />
        <span className="text-muted-foreground/70">
          {selected.length === 0 ? "未勾选 = 全部包件" : `已选 ${selected.length} / ${lots.length}`}
        </span>
      </footer>
    </section>
  )
}
