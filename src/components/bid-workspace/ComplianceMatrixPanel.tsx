import { useEffect, useMemo, useState } from "react"
import { Copy, Loader2, ShieldAlert, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { chatViaGateway, type ModelRef } from "@/lib/modelGateway"
import type { ModelRole } from "@/lib/modelRouting"
import type { ParseReport, ParseSection } from "@/pages/BidWorkspace/bidTypes"
import {
  buildComplianceRows,
  COMPLIANCE_KIND_LABEL,
  COMPLIANCE_STATUS_LABEL,
  readComplianceProgress,
  summarizeCompliance,
  writeComplianceProgress,
  type ComplianceKind,
  type ComplianceProgress,
  type ComplianceProgressMap,
  countMarkerLossRows,
  type ComplianceRowStatus,
} from "@/pages/BidWorkspace/complianceMatrix"
import { lineHasMarkerLoss } from "@/pages/BidWorkspace/materialIntegrity"
import {
  auditComplianceCoverage,
  buildCompliancePendingText,
  COMPLIANCE_COVERAGE_LABEL,
  type ComplianceCoverageLevel,
} from "@/pages/BidWorkspace/complianceCoverage"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import { copyTextToClipboard } from "@/lib/clipboard"

// R005/R009（B-1）：实质性条款覆盖矩阵面板（挂标书工作第 2 步·解析报告下方）。
// 阶段一：从解析报告分节本地推导（零 AI）；阶段二（R016）：AI 补扫——
// 一次 LLM 调用从招标原文归纳四类条款并写回解析报告分节（走费用确认门禁）。

const STATUS_OPTIONS: ComplianceRowStatus[] = ["open", "covered", "na"]

// R195：正文自动核对提示色（仅提示，不覆盖左侧人工标注的状态下拉）
const COVERAGE_TONE: Record<ComplianceCoverageLevel, string> = {
  full: "bg-primary/10 text-primary",
  partial: "bg-warning/10 text-warning",
  outline: "bg-muted text-muted-foreground",
  missing: "bg-destructive/10 text-destructive",
}

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

function FilterChip({
  active,
  onClick,
  label,
  alert = 0,
}: {
  active: boolean
  onClick: () => void
  label: string
  alert?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-secondary/60"
      }`}
    >
      {label}
      {alert > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/20 px-1 text-[10px] font-semibold text-warning">
          {alert}
        </span>
      )}
    </button>
  )
}

export function ComplianceMatrixPanel({
  projectId,
  report,
  archived,
  tenderText,
  chapters,
  onImportSections,
  runWithCostConfirm,
  modelRefForRole,
}: {
  projectId: string
  report: ParseReport | null
  archived: boolean
  tenderText: string
  /** R195：已生成的投标正文章节，用于「正文自动核对」（缺省=正文未生成，降级为预判） */
  chapters?: Chapter[]
  /** R016（B-1 阶段二）：AI 补扫写回解析报告分节的回调（= hook 的 updateParseReport） */
  onImportSections: (patch: { sections: ParseSection[] }) => void
  runWithCostConfirm: (fn: () => void, message: string) => void
  /** R47（B19）：按环节取模型（自动档=该环节选型；手选档=用户选的模型）；不传则维持平台内置口径 */
  modelRefForRole?: (role: ModelRole) => ModelRef | null
}) {
  const [progress, setProgress] = useState<ComplianceProgressMap>({})
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState("")
  const [kindFilter, setKindFilter] = useState<ComplianceKind | "all">("all")
  const [onlyUncovered, setOnlyUncovered] = useState(false)

  useEffect(() => {
    setProgress(readComplianceProgress(projectId))
  }, [projectId])

  const rows = useMemo(() => buildComplianceRows(report), [report])

  // R195：★ 技术条款「正文自动核对」——对已生成正文逐字命中判定（零 AI、零费用，口径同 R162 落位核验）
  const coverage = useMemo(() => auditComplianceCoverage(rows, chapters), [rows, chapters])

  const rowsWithStatus = useMemo(
    () =>
      rows.map((r) => {
        const p = progress[r.id]
        return { ...r, status: (p?.status ?? "open") as ComplianceRowStatus, ref: p?.ref ?? "", note: p?.note ?? "" }
      }),
    [rows, progress],
  )

  const summary = useMemo(() => summarizeCompliance(rows, progress), [rows, progress])

  const visibleRows = useMemo(
    () =>
      rowsWithStatus.filter(
        (r) => (kindFilter === "all" || r.kind === kindFilter) && (!onlyUncovered || r.status === "open"),
      ),
    [rowsWithStatus, kindFilter, onlyUncovered],
  )

  // R163：当前筛选视图内命中符号丢失签名的条款数（零 AI；徽标随筛选收敛，不放大成长期噪音）
  const markerLossRows = useMemo(() => countMarkerLossRows(visibleRows), [visibleRows])

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
          // R016 修正：走 modelGateway 网关，不依赖方案页的 studioModelRef
          // R47（B19）：四类条款补扫 = 结构化抽取，走抽取档（此前硬编码 null = 平台内置，本地部署下必失败）
          const res = await chatViaGateway({
            modelRef: modelRefForRole?.("extract") ?? null,
            messages: [
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
            page: "bid-workspace",
            max_tokens: 4096,
          })
          if (!res.ok || !res.text) throw new Error(res.error || "AI 生成失败，请重试")
          const json = tolerantJson(res.text)
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
            <Badge variant="outline" className={`rounded-full ${summary.uncovered ? "border-warning/40 bg-warning/10 text-warning" : "border-border text-muted-foreground"}`}>
              未覆盖 {summary.uncovered}
            </Badge>
            {coverage.total > 0 && coverage.generatedChapters > 0 && (
              <Badge
                variant="outline"
                title={`对已生成的 ${coverage.generatedChapters}/${coverage.chapterCount} 章正文逐字核对 ★ 技术条款（零费用）：${coverage.responded} 条要点已全部出现，${coverage.pending} 条待人工确认（未命中可能只是换了表述，以人工标注为准）`}
                className={`rounded-full ${coverage.pending ? "border-border text-muted-foreground" : "border-primary/40 bg-primary/10 text-primary"}`}
              >
                正文核对 已回应 {coverage.responded}/{coverage.total}
              </Badge>
            )}
            {coverage.total > 0 && coverage.generatedChapters > 0 && coverage.pending > 0 && (
              <button
                type="button"
                onClick={() =>
                  void copyTextToClipboard(buildCompliancePendingText(coverage, rows), {
                    successMessage: "已复制待核对清单，可作为补写要求粘贴使用",
                    errorMessage: "复制失败，请手动选择文本复制",
                  })
                }
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Copy className="h-3 w-3" />
                复制待核对清单
              </button>
            )}
            {summary.uncoveredCritical > 0 && (
              <Badge variant="outline" className="rounded-full border-destructive/40 bg-destructive/10 text-destructive">
                废标/★ 未覆盖 {summary.uncoveredCritical}
              </Badge>
            )}
            {markerLossRows > 0 && (
              <Badge
                variant="outline"
                title={`当前视图内 ${markerLossRows} 条条款文本命中符号丢失签名（空引号对/私用区字符），属原招标文件转换损坏而非本页漏列，请对照招标原件核实`}
                className="cursor-help rounded-full border-amber-500/40 bg-amber-500/10 text-amber-700"
              >
                <ShieldAlert className="mr-1 h-3 w-3" />
                疑符号丢失 {markerLossRows} 条
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

      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip
            active={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
            label={`全部 ${summary.total}`}
          />
          {(Object.keys(COMPLIANCE_KIND_LABEL) as ComplianceKind[]).map((k) => (
            <FilterChip
              key={k}
              active={kindFilter === k}
              onClick={() => setKindFilter(kindFilter === k ? "all" : k)}
              label={`${COMPLIANCE_KIND_LABEL[k]} ${summary.kinds[k].total}`}
              alert={summary.kinds[k].uncovered}
            />
          ))}
          <button
            type="button"
            onClick={() => setOnlyUncovered((v) => !v)}
            className={`ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              onlyUncovered
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border text-muted-foreground hover:bg-secondary/60"
            }`}
          >
            只看未覆盖{summary.uncovered ? ` (${summary.uncovered})` : ""}
          </button>
        </div>
      )}

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
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    当前筛选下没有条款——试试「全部」，或关闭「只看未覆盖」（未覆盖项已全部清零）。
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => {
                // R163：原文命中符号丢失签名时行尾挂徽标（悬停看口径），判定与表头汇总同一真源
                const markerLoss = lineHasMarkerLoss(r.text)
                return (
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
                    {markerLoss && (
                      <span
                        title={`该行疑似丢失 ★/▲ 等标注符号（原招标文件制作/转换时符号已损坏，文本仅留空引号对）\n摘录：${r.text.trim().slice(0, 60)}\n★/▲ 重点条款扫描可能不全，请对照招标原件核实。`}
                        className="ml-1.5 inline-flex shrink-0 cursor-help items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 align-middle text-[11px] font-medium text-amber-700"
                      >
                        <ShieldAlert className="h-3 w-3" />
                        疑符号丢失
                      </span>
                    )}
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
                    {(() => {
                      const cov = coverage.byRow[r.id]
                      if (!cov || coverage.generatedChapters === 0) return null
                      const verbatimTip = cov.originalHit
                        ? "原文逐字命中"
                        : `未见原文逐字响应（命中率 ${Math.round(cov.verbatimRatio * 100)}%，疑改写或概括）`
                      return (
                        <div
                          title={`本地逐字自动核对（零费用，仅供提示，以左侧人工标注为准）：${cov.missingKeys.length ? "正文未见要点 " + cov.missingKeys.join("、") : verbatimTip}`}
                          className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${COVERAGE_TONE[cov.level]}`}
                        >
                          {COMPLIANCE_COVERAGE_LABEL[cov.level]}
                          {cov.level === "full" && !cov.originalHit ? "·疑改写" : ""}
                        </div>
                      )
                    })()}
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
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
