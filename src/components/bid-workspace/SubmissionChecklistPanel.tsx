import { useMemo, useState } from "react"
import { CheckSquare, CircleSlash, ClipboardCheck, ShieldAlert, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  buildChecklistRows,
  CHECKLIST_KIND_LABEL,
  readChecklistProgress,
  summarizeChecklist,
  writeChecklistProgress,
  type ChecklistKind,
  type ChecklistProgressMap,
  type ChecklistState,
} from "@/pages/BidWorkspace/submissionChecklist"
import type { ParseReport } from "@/pages/BidWorkspace/bidTypes"

// R25（A3 / bid-checklist-01）：交卷前逐项目合规清单面板（挂交卷体检步，始终可见）。
// 从解析报告「响应文件要求」+「资格性审查」本地推导，逐项人工确认是否备齐；进度存本机 localStorage。
// 与交卷体检互补：本清单查「形式要件是否备齐」，format_report 查「排版」、覆盖审计查「内容」，三合一就绪度。
// 用 key={projectId} 重挂载 + useState 惰性初始化读本地进度，规避 react-hooks/set-state-in-effect。

const GROUPS: ChecklistKind[] = ["format", "qual"]

const GROUP_HINT: Record<ChecklistKind, string> = {
  format: "格式 · 签字盖章 · 装订 · 份数 · 递交",
  qual: "资格性审查须提交的资质文件",
}

export function SubmissionChecklistPanel({
  projectId,
  report,
  locked = false,
}: {
  projectId: string
  report: ParseReport | null
  locked?: boolean
}) {
  const rows = useMemo(() => buildChecklistRows(report), [report])
  const [progress, setProgress] = useState<ChecklistProgressMap>(() => readChecklistProgress(projectId))
  const summary = useMemo(() => summarizeChecklist(rows, progress), [rows, progress])

  const patch = (id: string, next: ChecklistState | "pending") => {
    const copy: ChecklistProgressMap = { ...progress }
    if (next === "pending") delete copy[id]
    else copy[id] = next
    setProgress(copy)
    writeChecklistProgress(projectId, copy)
  }

  const ready = summary.total > 0 && summary.pending === 0

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            交卷前合规清单
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            依据解析报告「响应文件要求」与「资格性审查」本地生成，交卷前逐项确认形式要件与资质文件是否备齐——与「格式规则检查（排版）」「覆盖审计（内容）」互补，形成排版+内容+形式三合一就绪度。确认进度保存在本机浏览器。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
            共 {summary.total} 项
          </Badge>
          {summary.mandatoryPending > 0 ? (
            <Badge variant="danger" className="flex items-center gap-1 rounded-full">
              <ShieldAlert className="h-3.5 w-3.5" />
              强制待确认 {summary.mandatoryPending}
            </Badge>
          ) : summary.pending > 0 ? (
            <Badge variant="warning" className="rounded-full">
              待确认 {summary.pending}
            </Badge>
          ) : summary.total > 0 ? (
            <Badge variant="success" className="rounded-full">
              全部已确认
            </Badge>
          ) : null}
          {(summary.done > 0 || summary.na > 0) && (
            <Badge variant="neutral" className="rounded-full">
              已备齐 {summary.done} · 不适用 {summary.na}
            </Badge>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          解析报告里还没有「响应文件要求」或「资格性审查」分区——请先在解析环节勾选并解析这两项（或在解析报告中手动补充），清单会自动生成。
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {GROUPS.map((kind) => {
            const groupRows = rows.filter((r) => r.kind === kind)
            if (!groupRows.length) return null
            const groupPending = groupRows.filter((r) => !progress[r.id]).length
            return (
              <div key={kind} className="rounded-lg border border-border/70 bg-background/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-foreground">{CHECKLIST_KIND_LABEL[kind]}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${groupPending ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"}`}>
                    {groupPending ? `待确认 ${groupPending}` : "已确认"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{GROUP_HINT[kind]}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {groupRows.map((r) => {
                    const state = progress[r.id]
                    const done = state === "done"
                    const na = state === "na"
                    return (
                      <li
                        key={r.id}
                        className={`rounded-md border px-2.5 py-2 text-xs ${
                          na
                            ? "border-border/60 bg-muted/20"
                            : done
                              ? "border-primary/30 bg-primary/5"
                              : r.mandatory
                                ? "border-destructive/30 bg-destructive/5"
                                : "border-border/60 bg-background"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => patch(r.id, done ? "pending" : "done")}
                            aria-pressed={done}
                            title={locked ? "已归档项目为只读" : done ? "取消确认" : "标记已备齐"}
                            className="mt-0.5 shrink-0 rounded text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {done ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                          </button>
                          <span className={`min-w-0 flex-1 leading-relaxed ${na ? "text-muted-foreground line-through" : "text-card-foreground"}`}>
                            {r.mandatory && !done && (
                              <span className="mr-1.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">必备</span>
                            )}
                            {r.text}
                          </span>
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => patch(r.id, na ? "pending" : "na")}
                            title={locked ? "已归档项目为只读" : na ? "取消不适用" : "标记本项目不适用"}
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                              na
                                ? "border-border bg-muted text-muted-foreground"
                                : "border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                            }`}
                          >
                            {na ? (
                              <span className="inline-flex items-center gap-1">
                                <CircleSlash className="h-3 w-3" />
                                不适用
                              </span>
                            ) : (
                              "不适用"
                            )}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {rows.length > 0 && (
        <p
          className={`mt-3 rounded-md px-3 py-2 text-xs leading-relaxed ${
            ready
              ? "border border-primary/30 bg-primary/5 font-medium text-primary"
              : summary.mandatoryPending > 0
                ? "border border-destructive/30 bg-destructive/10 text-foreground"
                : "border border-dashed border-border bg-background text-muted-foreground"
          }`}
        >
          {ready
            ? "形式要件与资格文件均已确认备齐，可放心归档递交。"
            : summary.mandatoryPending > 0
              ? `还有 ${summary.mandatoryPending} 项强制形式/资格要求未确认（份数 / 密封 / 签章 / 资质文件漏一项即可能废标），交卷前务必逐项备齐。`
              : `还有 ${summary.pending} 项未确认，请逐项核对是否备齐。`}
        </p>
      )}
    </div>
  )
}
