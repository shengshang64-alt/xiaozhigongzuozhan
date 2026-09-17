import { useEffect, useMemo, useState } from "react"
import { ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ParseReport } from "@/pages/BidWorkspace/bidTypes"
import {
  buildComplianceRows,
  COMPLIANCE_KIND_LABEL,
  COMPLIANCE_STATUS_LABEL,
  readComplianceProgress,
  writeComplianceProgress,
  type ComplianceProgress,
  type ComplianceProgressMap,
  type ComplianceRowStatus,
} from "@/pages/BidWorkspace/complianceMatrix"

// R005（B-1 阶段一）：实质性条款覆盖矩阵面板（挂标书工作第 2 步·解析报告下方）。
// 纯前端推导 + localStorage 进度；不动偏离表，不产生 AI 调用。

const STATUS_OPTIONS: ComplianceRowStatus[] = ["open", "covered", "na"]

function statusTone(status: ComplianceRowStatus): string {
  if (status === "covered") return "bg-primary/10 text-primary"
  if (status === "na") return "bg-muted text-muted-foreground"
  return "bg-warning/10 text-warning"
}

export function ComplianceMatrixPanel({
  projectId,
  report,
  archived,
}: {
  projectId: string
  report: ParseReport | null
  archived: boolean
}) {
  const [progress, setProgress] = useState<ComplianceProgressMap>({})

  useEffect(() => {
    setProgress(readComplianceProgress(projectId))
  }, [projectId])

  const rows = useMemo(() => buildComplianceRows(report), [report])

  const rowsWithStatus = useMemo(
    () =>
      rows.map((r) => {
        const p = progress[r.id]
        return { ...r, status: (p?.status ?? "open") as ComplianceRowStatus, ref: p?.ref ?? "", note: p?.note ?? "" }
      }),
    [rows, progress],
  )

  const uncovered = rowsWithStatus.filter((r) => r.status === "open")
  const uncoveredCritical = uncovered.filter((r) => r.kind === "void" || r.mandatory)

  const patchRow = (id: string, patch: Partial<ComplianceProgress>) => {
    const prev: ComplianceProgress = progress[id] ?? { status: "open", ref: "", note: "" }
    const next = { ...progress, [id]: { ...prev, ...patch } }
    setProgress(next)
    writeComplianceProgress(projectId, next)
  }

  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ShieldAlert className="h-4 w-4 text-warning" />
            实质性条款覆盖矩阵
          </h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            从解析报告的 ★/▲ 条款、废标项、资格要求与符合性检查本地推导（零 AI 费用），逐条标注响应章节与覆盖状态，交卷前清零「未覆盖」。进度保存在本机浏览器。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
            共 {rows.length} 条
          </Badge>
          <Badge variant="outline" className={`rounded-full ${uncovered.length ? "border-warning/40 bg-warning/10 text-warning" : "border-border text-muted-foreground"}`}>
            未覆盖 {uncovered.length}
          </Badge>
          {uncoveredCritical.length > 0 && (
            <Badge variant="outline" className="rounded-full border-destructive/40 bg-destructive/10 text-destructive">
              废标/★ 未覆盖 {uncoveredCritical.length}
            </Badge>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          解析报告中还没有 ★/▲ 条款、废标项、资格要求或符合性检查分区——先运行解析或勾选对应分区。
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="w-24 py-2 pr-2 font-medium">类型</th>
                <th className="py-2 pr-2 font-medium">条款原文（摘要）</th>
                <th className="w-24 py-2 pr-2 font-medium">状态</th>
                <th className="w-40 py-2 pr-2 font-medium">响应章节</th>
                <th className="w-44 py-2 font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithStatus.map((r) => (
                <tr key={r.id} className="border-b border-border/60 align-top hover:bg-secondary/50">
                  <td className="py-2 pr-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 ${r.kind === "void" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                      {COMPLIANCE_KIND_LABEL[r.kind]}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-foreground">
                    <span className="line-clamp-2 whitespace-pre-wrap" title={r.text}>
                      {r.text.length > 120 ? `${r.text.slice(0, 120)}…` : r.text}
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={r.status}
                      disabled={archived}
                      onChange={(e) => patchRow(r.id, { status: e.target.value as ComplianceRowStatus })}
                      className={`h-7 w-20 rounded-md border border-border bg-background px-1.5 ${statusTone(r.status)} disabled:opacity-60`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {COMPLIANCE_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={r.ref}
                      disabled={archived}
                      placeholder="如 3.2 安全设计"
                      onChange={(e) => patchRow(r.id, { ref: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-background px-2 text-foreground placeholder:text-muted-foreground/60 disabled:opacity-60"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      value={r.note}
                      disabled={archived}
                      placeholder="偏离说明 / 应对"
                      onChange={(e) => patchRow(r.id, { note: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-background px-2 text-foreground placeholder:text-muted-foreground/60 disabled:opacity-60"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
