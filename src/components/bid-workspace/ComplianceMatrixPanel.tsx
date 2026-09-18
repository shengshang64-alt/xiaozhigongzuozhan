import { useEffect, useMemo, useState } from "react"
import { Loader2, ShieldAlert, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { llmGenerate } from "@/pages/SolutionStudio/studioLlm"
import type { ParseReport, ParseSection } from "@/pages/BidWorkspace/bidTypes"
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

// R005/R009（B-1）：实质性条款覆盖矩阵面板（挂标书工作第 2 步·解析报告下方）。
// 阶段一：从解析报告分节本地推导（零 AI）；阶段二（R016）：AI 补扫——
// 一次 LLM 调用从招标原文归纳四类条款并写回解析报告分节（走费用确认门禁）。

const STATUS_OPTIONS: ComplianceRowStatus[] = ["open", "covered", "na"]

const AI_SCAN_SECTIONS = ["star_clauses", "void_items", "qualification", "compliance"] as const

function statusTone(status: ComplianceRowStatus): string {
  if (status === "covered") return "bg-primary/10 text-primary"
  if (status === "na") return "bg-muted text-muted-foreground"
  return "bg-warning/10 text-warning"
}

function tolerantJson(text: string): Record<string, unknown> | null {
  const t = (text ?? "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const start = t.indexOf("{")
  const end = t.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function ComplianceMatrixPanel({
  projectId,
  report,
  archived,
  tenderText,
  onImportSections,
  runWithCostConfirm,
}: {
  projectId: string
  report: ParseReport | null
  archived: boolean
  tenderText: string
  /** R016（B-1 阶段二）：AI 补扫写回解析报告分节的回调（= hook 的 updateParseReport） */
  onImportSections: (patch: { sections: ParseSection[] }) => void
  runWithCostConfirm: (fn: () => void, message: string) => void
}) {
  const [progress, setProgress] = useState<ComplianceProgressMap>({})
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState("")

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

  /** R016（B-1 阶段二）：AI 补扫——从招标原文归纳四类条款写回解析报告（单次调用，走费用门禁） */
  const runAiScan = () => {
    if (scanning || archived || !tenderText?.trim()) return
    setScanError("")
    runWithCostConfirm(() => {
      void (async () => {
        setScanning(true)
        try {
          const excerpt = tenderText.slice(0, 12000)
          const text = await llmGenerate(
            [
              {
                role: "system",
                content: [
                  "你是招标文件审查助手。从招标文件原文中提取四类条款，输出严格 JSON（禁止解释文字与代码围栏）：",
                  '{"star_clauses":["★/▲实质性响应条款原文，每条一行文本"],"void_items":["废标/无效投标条款，每条一条"],"qualification":["资格要求，强制项以「[强制]」开头"],"compliance":["符合性检查要点"]}',
                  "只摘录原文表述，不要改写与扩写；某类没有内容就给空数组。",
                ].join("\n"),
              },
              { role: "user", content: `【招标文件原文（可能截断）】\n${excerpt}\n\n请提取四类条款 JSON。` },
            ],
            4096,
            "bid-parse",
          )
          const json = tolerantJson(text)
          if (!json) throw new Error("AI 返回格式解析失败，请重试")
          const asLines = (v: unknown): string =>
            Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n") : ""
          const imported: ParseSection[] = []
          const existing = new Map((report?.sections ?? []).map((s) => [s.key, s]))
          for (const key of AI_SCAN_SECTIONS) {
            const content = asLines(json[key])
            if (!content) continue
            imported.push({
              key,
              title: existing.get(key)?.title ?? ({ star_clauses: "★/▲ 重点条款", void_items: "无效标与废标项", qualification: "资格性审查", compliance: "符合性检查" } as Record<string, string>)[key] ?? key,
              content,
              status: "ok",
            })
          }
          if (!imported.length) throw new Error("AI 未归纳出可写入的条款，请人工核对原文")
          onImportSections({ sections: [...(report?.sections ?? []), ...imported] })
        } catch (e) {
          setScanError(e instanceof Error ? e.message : "补扫失败，请重试")
        } finally {
          setScanning(false)
        }
      })()
    }, "将调用 AI 从招标原文补扫实质性条款并写入解析报告，按 token 用量计费")
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
            从解析报告的 ★/▲ 条款、废标项、资格要求与符合性检查推导，逐条标注响应章节与覆盖状态，交卷前清零「未覆盖」。标注进度保存在本机浏览器。
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
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
          {tenderText?.trim() && (
            <button
              type="button"
              onClick={runAiScan}
              disabled={scanning || archived}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-background px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
            >
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {scanning ? "AI 补扫中…" : "AI 补扫四类条款"}
            </button>
          )}
        </div>
      </div>

      {scanError && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{scanError}</p>
      )}

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          解析报告中还没有 ★/▲ 条款、废标项、资格要求或符合性检查分区——可运行解析、或点右上「AI 补扫四类条款」（产生一次 AI 调用费用）。
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
