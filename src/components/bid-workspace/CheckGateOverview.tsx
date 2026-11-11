import { useMemo } from "react"
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  GATE_STATUS_LABEL,
  ISSUE_LEVEL_LABEL,
  buildCheckModel,
  type CheckModel,
  type Gate,
  type GateStatus,
  type IssueLevel,
  type IssueRow,
} from "@/pages/BidWorkspace/checkGateModel"
import type { BidProjectRecord, FormatSettings } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// ⑥ 交卷自查 · 闸门总览（UX-v2：prototype/bid/check.html 的 .grid.g2 四闸门 + 问题清单）
//
// 为什么加这一块：原第 4/5/6 步三合一后，本屏是 7 个 Tab——用户要自己点进「废标检查」
// 「合规检查」才知道能不能交卷，从没有一屏回答「卡在哪、还有几条阻断」。
// 四道闸门的数据全部来自现网既有产物（见 checkGateModel 的注释），三态显示：
//   通过 / 未通过 / **未运行**——「没跑过」绝不显示成「已通过」（本仓假绿红线）。
//
// 与 stage_gates 五闸门并存：那是流程留痕（⑦ 导出仍只认它），这是交付质量检查。
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<GateStatus, { badge: string; icon: typeof CheckCircle2; dot: string }> = {
  pass: { badge: "bg-primary/10 text-primary", icon: CheckCircle2, dot: "text-primary" },
  fail: { badge: "bg-destructive/10 text-destructive", icon: XCircle, dot: "text-destructive" },
  not_run: { badge: "bg-muted text-muted-foreground", icon: CircleDashed, dot: "text-muted-foreground" },
}

const LEVEL_STYLE: Record<IssueLevel, string> = {
  block: "bg-destructive/10 text-destructive",
  warn: "bg-warning/10 text-warning",
  info: "bg-muted text-muted-foreground",
}

function GateCard({ gate, onGo }: { gate: Gate; onGo: (step: number) => void }) {
  const style = STATUS_STYLE[gate.status]
  const Icon = style.icon
  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-sm">
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Icon className={`h-4 w-4 shrink-0 ${style.dot}`} />
        <h3 className="text-[13.5px] font-semibold text-card-foreground">{gate.label}</h3>
        <div className="flex-1" />
        <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${style.badge}`}>
          {GATE_STATUS_LABEL[gate.status]}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 py-2.5">
        <p className="text-[12px] font-medium text-card-foreground">{gate.headline}</p>
        {gate.checks.map((c) => (
          <div key={c.label} className="flex items-start gap-2 text-[11.5px]">
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                c.ok === null ? "bg-muted-foreground/40" : c.ok ? "bg-primary" : "bg-destructive"
              }`}
            />
            <span className="min-w-0 flex-1 leading-relaxed text-muted-foreground">{c.label}</span>
            <span
              className={`shrink-0 tabular-nums ${
                c.ok === null ? "text-muted-foreground/70" : c.ok ? "text-primary" : "text-destructive"
              }`}
            >
              {c.verdict}
            </span>
          </div>
        ))}
      </div>
      {gate.status === "fail" && (
        <footer className="flex items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2">
          <span className="text-[11px] text-muted-foreground">修复后重跑对应检查，闸门才会变绿</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onGo(gate.id === "void" ? 5 : 4)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
          >
            {gate.id === "void" ? "去 ⑤ 偏离表" : "去 ④ 正文"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </footer>
      )}
    </section>
  )
}

export function CheckGateOverview({
  project,
  format,
  deviationUncovered,
  deviationTotal,
  onGo,
  onRunSubmissionCheck,
  submissionLoading,
  isArchivedLocked,
}: {
  project: BidProjectRecord
  format: FormatSettings
  deviationUncovered: number
  deviationTotal: number
  onGo: (step: number) => void
  /** 跑交卷体检（格式闸门的唯一数据来源；未跑过则闸门显示「未运行」） */
  onRunSubmissionCheck: () => void
  submissionLoading: boolean
  isArchivedLocked: boolean
}) {
  const model: CheckModel = useMemo(
    () => buildCheckModel({ project, format, deviationUncovered, deviationTotal }),
    [project, format, deviationUncovered, deviationTotal],
  )
  const shownIssues = model.issues.slice(0, 8)

  return (
    <div className="flex flex-col gap-3">
      {/* 阻断横幅（原型 .alert--red 同位）：有阻断就无法导出 */}
      {model.blockCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">
            <b className="text-destructive">当前不可导出</b>：有 {model.blockCount} 项阻断问题未修复——
            下方问题清单按「阻断 → 警告 → 提示」排序，阻断项清零才解锁 ⑦ 组卷导出。
          </span>
        </div>
      )}

      {/* 四道闸门（原型 .grid.g2） */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {model.gates.map((g) => (
          <GateCard key={g.id} gate={g} onGo={onGo} />
        ))}
      </div>

      {/* 问题清单（原型表格：级别 / 类别 / 问题 / 位置 / 操作） */}
      <section className="rounded-lg border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
          <h3 className="text-[13.5px] font-semibold text-card-foreground">问题清单</h3>
          <span className="text-[11.5px] text-muted-foreground">按 阻断 → 警告 → 提示 排序，阻断项清零才解锁导出</span>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">全部 {model.issues.length}</span>
            {model.blockCount > 0 && (
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                阻断 {model.blockCount}
              </span>
            )}
            {model.warnCount > 0 && (
              <span className="rounded bg-warning/10 px-1.5 py-0.5 font-medium text-warning">警告 {model.warnCount}</span>
            )}
            {model.infoCount > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">提示 {model.infoCount}</span>
            )}
          </div>
        </header>

        {model.issues.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">
            {model.hasNotRun
              ? "四道闸门还没有全部运行过——跑完交卷体检后，命中问题会逐条列在这里"
              : "四道闸门全部通过，没有待处理问题"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-[11.5px] text-muted-foreground">
                  <th className="w-16 px-3.5 py-2 font-medium">级别</th>
                  <th className="w-20 px-2 py-2 font-medium">类别</th>
                  <th className="px-2 py-2 font-medium">问题</th>
                  <th className="w-40 px-2 py-2 font-medium">位置</th>
                  <th className="w-20 px-3.5 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {shownIssues.map((row: IssueRow) => (
                  <tr key={row.id} className="border-b border-border/40 align-top last:border-b-0">
                    <td className="px-3.5 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${LEVEL_STYLE[row.level]}`}>
                        {ISSUE_LEVEL_LABEL[row.level]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{row.category}</td>
                    <td className="px-2 py-2 text-card-foreground">
                      <span className="line-clamp-2" title={row.title}>
                        {row.title}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground" title={row.location}>
                      <span className="line-clamp-1">{row.location}</span>
                    </td>
                    <td className="px-3.5 py-2 text-right">
                      {row.step != null && (
                        <button
                          type="button"
                          onClick={() => onGo(row.step!)}
                          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-card-foreground hover:bg-secondary"
                        >
                          定位
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
          {model.issues.length > 0 ? (
            <span>
              共 {model.issues.length} 条 · 阻断 {model.blockCount} / 警告 {model.warnCount} / 提示 {model.infoCount}
              {model.issues.length > shownIssues.length ? `（显示前 ${shownIssues.length} 条）` : ""}
            </span>
          ) : (
            <span>{model.hasNotRun ? "还有闸门未运行" : "无待处理问题"}</span>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={onRunSubmissionCheck}
            disabled={submissionLoading || isArchivedLocked}
            title="跑交卷体检（格式 / 引文 / 占位 / 报价等本地规则，零 AI 费用）——格式闸门的数据来源"
            className="h-7 border-border px-2 text-[11.5px] text-card-foreground hover:bg-secondary"
          >
            {submissionLoading ? "体检中…" : "重新检查"}
          </Button>
        </footer>
      </section>
    </div>
  )
}
