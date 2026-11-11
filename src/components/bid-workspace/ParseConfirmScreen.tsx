import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  complianceProgressSnapshot,
  subscribeComplianceProgress,
  writeComplianceProgress,
  type ComplianceProgressMap,
} from "@/pages/BidWorkspace/complianceMatrix"
import {
  buildParseConfirmModel,
  type ConfirmCard,
  type ConfirmTone,
  type QualityStat,
} from "@/pages/BidWorkspace/parseConfirmModel"
import { bidOpenDateStatus } from "@/components/bid-workspace/bidOpenDate"
import { projectBudgetWan } from "@/components/bid-workspace/bidListCardModel"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// ② 解析确认（UX-v2：prototype/bid/parse.html 1:1）
//
// 原型本屏只做一件事：把「废标条款 / 评分办法 / 技术参数 / 时间节点」四类解析结果
// 摊在首屏逐条确认，确认完才放行 ③ 大纲；未确认条数常驻在按钮旁。
//
// 版式逐块对照原型：
//   .ph            页头（标题 + 描述 + meta + 右侧动作）
//   .grid.g4       四张结果卡（主数字 + 徽标 + 脚注）
//   .split--l-wide 左栏 380：评分办法分布（条形 + kv 行）、解析目录（tree-item 带 n 计数）
//                  右栏 1fr：解析质量（四栏竖分隔）、废标条款表（逐条处理方式 + 确认）
//
// 数据边界（不造假）：
//   · 所有数字来自 parseConfirmModel 的派生（解析报告 + 招标原文 + 既有本地扫描函数）。
//   · 无值的卡显示「—」，不写 0 冒充「有 0 条」。
//   · 原型页头里的「解析耗时」与「页码可回溯」现网都无落库字段 → 前者整条不渲染，
//     后者如实写「未接入」。
//   · 逐条确认状态与「条款覆盖矩阵」Tab 共用同一份 localStorage（complianceMatrix），
//     两处互改实时同步，不会互相覆盖。
//   · 解析明细（21 项）收在本屏下方，目录点条目即跳过去选中该项——不丢任何既有能力。
// ---------------------------------------------------------------------------

const CARD_TONE: Record<ConfirmTone, { badge: string; icon: string }> = {
  red: { badge: "bg-destructive/10 text-destructive", icon: "text-destructive" },
  blue: { badge: "bg-primary/10 text-primary", icon: "text-primary" },
  amber: { badge: "bg-warning/10 text-warning", icon: "text-warning" },
  purple: { badge: "bg-violet-500/10 text-violet-600", icon: "text-violet-600" },
  green: { badge: "bg-primary/10 text-primary", icon: "text-primary" },
  gray: { badge: "bg-muted text-muted-foreground", icon: "text-muted-foreground" },
}

const CARD_ICON = {
  void: ShieldAlert,
  score: BarChart3,
  param: SlidersHorizontal,
  node: CalendarClock,
} as const

/** 单张结果卡：主数字 + 角标徽标 + 脚注（原型 .card--hover .card-b.tight） */
function ResultCard({ card }: { card: ConfirmCard }) {
  const Icon = CARD_ICON[card.id]
  const tone = CARD_TONE[card.tone]
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-primary/30">
      <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium ${tone.badge}`}>
            <Icon className={`h-3 w-3 ${tone.icon}`} />
            {card.label}
          </span>
          <div className="flex-1" />
          <span className="font-mono text-base font-semibold tabular-nums text-card-foreground">
            {card.value ?? "—"}
          </span>
        </div>
        <div className="flex min-h-4 flex-wrap items-center gap-1.5">
          {card.tags.map((t) => (
            <span
              key={t.label}
              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${CARD_TONE[t.tone].badge}`}
            >
              {t.label}
            </span>
          ))}
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">{card.foot}</p>
      </div>
    </div>
  )
}

/** 评分分布条形（原型 .cbar：左标签 + 条形 + 右数值） */
function ScoreBar({ label, value, pct }: { label: string; value: number; pct: number }) {
  return (
    <div className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)_56px] items-center gap-2.5 text-[11.8px]">
      <span className="truncate text-muted-foreground" title={label}>
        {label}
      </span>
      <span className="flex h-4 items-stretch overflow-hidden rounded bg-secondary">
        <i className="block h-full rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      <span className="text-right font-mono tabular-nums text-muted-foreground">{value}</span>
    </div>
  )
}

function QualityCell({ stat }: { stat: QualityStat }) {
  const tone =
    stat.tone === "ok" ? "text-primary" : stat.tone === "warn" ? "text-warning" : "text-muted-foreground"
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <p className="text-[11.5px] text-muted-foreground">{stat.label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>{stat.value}</span>
        {stat.unit && <span className="text-[11px] text-muted-foreground">{stat.unit}</span>}
      </p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground/90">{stat.note}</p>
    </div>
  )
}

type ParseConfirmScreenProps = {
  project: BidProjectRecord
  /** 重新解析（走既有 startParse，费用确认在调用方） */
  onReparse: () => void
  parseLoading: boolean
  parseProgress?: { current: number; total: number } | null
  /** 确认解析结果 → ③ 大纲编制 */
  onContinue: () => void
  /** 目录点条目 → 下方解析明细选中该项 */
  onFocusItem: (key: string) => void
  archived: boolean
}

/** 单屏最多直接铺多少条废标条款；超出部分折叠（原型有分页器，现网不造页码，用「展开全部」） */
const COLLAPSED_ROWS = 10

export function ParseConfirmScreen({
  project,
  onReparse,
  parseLoading,
  parseProgress,
  onContinue,
  onFocusItem,
  archived,
}: ParseConfirmScreenProps) {
  // 与「条款覆盖矩阵」共用同一份进度：本屏写入后矩阵立即刷新，反之亦然。
  // 用 useSyncExternalStore 而不是 effect+setState——外部存储（localStorage + 进程内广播）
  // 正是它的适用场景，也不会有「同步 setState 的 effect」级联渲染问题。
  const subscribe = useCallback(
    (onChange: () => void) => subscribeComplianceProgress((id) => {
      if (id === project.id) onChange()
    }),
    [project.id],
  )
  const getSnapshot = useCallback(() => complianceProgressSnapshot(project.id), [project.id])
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const model = useMemo(
    () =>
      buildParseConfirmModel({
        report: project.parse_report,
        tenderText: project.tender_text ?? "",
        tenderTables: project.tender_tables ?? null,
        progress,
      }),
    [project.parse_report, project.tender_text, project.tender_tables, progress],
  )

  const [expandAll, setExpandAll] = useState(false)
  const shownRows = expandAll ? model.rows : model.rows.slice(0, COLLAPSED_ROWS)

  const write = (next: ComplianceProgressMap) => writeComplianceProgress(project.id, next)

  const patchRow = (id: string, status: "covered" | "na" | "open") => {
    if (archived) return
    const prev = progress[id] ?? { status: "open" as const, ref: "", note: "" }
    write({ ...progress, [id]: { ...prev, status } })
  }

  const markAllCovered = () => {
    if (archived || model.rows.length === 0) return
    const next: ComplianceProgressMap = { ...progress }
    for (const r of model.rows) {
      const prev = next[r.id] ?? { status: "open" as const, ref: "", note: "" }
      next[r.id] = { ...prev, status: "covered" }
    }
    write(next)
  }

  // ---- 页头 meta（全部真值；没有的字段整条不渲染） ----
  const openStatus = bidOpenDateStatus(project.bid_open_date)
  const budgetWan = projectBudgetWan(project)
  const fileNames = (project.tender_files ?? []).map((f) => f.name).filter(Boolean)
  const descBits = [
    project.hospital,
    project.tender_no ? `编号 ${project.tender_no}` : "",
    openStatus.daysLeft != null && openStatus.daysLeft >= 0 ? openStatus.label : "",
    budgetWan != null ? `预算 ${budgetWan.toFixed(1)} 万` : "",
  ].filter(Boolean)

  const scoreTotal = model.score.techSum + model.score.bizSum + (model.score.priceSum ?? 0)
  const barPct = (v: number) => (scoreTotal > 0 ? (v / scoreTotal) * 100 : 0)
  const canContinue = model.pendingCount === 0

  return (
    <div className="flex flex-col gap-3">
      {/* 页头（原型 .ph） */}
      <header className="flex flex-wrap items-start gap-4 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            ② 解析确认
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
              四类结果逐条确认
            </span>
          </h1>
          {descBits.length > 0 && (
            <p className="mt-1 max-w-[960px] text-[12.5px] leading-relaxed text-muted-foreground">
              {descBits.join(" · ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
            {fileNames.length > 0 && (
              <span>
                来源{" "}
                <b className="font-mono text-[12px] font-semibold text-card-foreground">
                  {fileNames.slice(0, 3).join(" / ")}
                  {fileNames.length > 3 ? ` 等 ${fileNames.length} 份` : ""}
                </b>
              </span>
            )}
            <span>
              待确认{" "}
              <b className={`font-mono text-[12px] font-semibold ${model.pendingCount > 0 ? "text-destructive" : "text-primary"}`}>
                {model.pendingCount}
              </b>{" "}
              条
            </span>
            <span>
              解析项 <b className="font-mono text-[12px] font-semibold text-card-foreground">{project.parse_report?.sections?.length ?? 0}</b> 项
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-1">
          {model.pendingCount > 0 && (
            <span className="text-[11.5px] text-destructive">还有 {model.pendingCount} 条废标条款待确认</span>
          )}
          <Button
            variant="outline"
            onClick={onReparse}
            disabled={parseLoading || archived}
            className="border-border text-card-foreground hover:bg-secondary"
          >
            {parseLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-1.5 h-4 w-4" />}
            {parseLoading
              ? parseProgress
                ? `正在解析第 ${parseProgress.current}/${parseProgress.total} 项…`
                : "解析中…"
              : project.parse_report
                ? "重新解析"
                : "运行 AI 解析"}
          </Button>
          <Button
            onClick={onContinue}
            disabled={!canContinue || archived}
            title={
              canContinue
                ? "四类结果已全部确认，进入 ③ 大纲编制"
                : `还有 ${model.pendingCount} 条废标条款未确认——逐条勾选，或点废标表右上「全部标为已响应」`
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            确认解析结果，进入大纲编制
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 四类结果卡（原型 .grid.g4） */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {model.cards.map((c) => (
          <ResultCard key={c.id} card={c} />
        ))}
      </div>

      {/* 左 380 / 右自适应（原型 .split--l-wide） */}
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {/* 评分办法分布 */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="text-[13.5px] font-semibold text-card-foreground">评分办法分布</h3>
              <div className="flex-1" />
              <span className="text-[11.5px] text-muted-foreground">
                {model.score.hasScoring ? `合计 ${scoreTotal} 分` : "未解析到评分办法"}
              </span>
            </header>
            <div className="px-3.5 py-3">
              {model.score.hasScoring ? (
                <>
                  <div className="flex flex-col gap-2">
                    <ScoreBar label="技术分" value={model.score.techSum} pct={barPct(model.score.techSum)} />
                    <ScoreBar label="商务分" value={model.score.bizSum} pct={barPct(model.score.bizSum)} />
                    {model.score.priceSum != null && (
                      <ScoreBar label="价格分" value={model.score.priceSum} pct={barPct(model.score.priceSum)} />
                    )}
                  </div>
                  <div className="my-3 h-px bg-border" />
                  <dl className="flex flex-col gap-1.5 text-[12.3px]">
                    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                      <dt className="text-muted-foreground/80">评分点</dt>
                      <dd className="text-card-foreground">
                        <b className="font-semibold">{model.score.itemCount}</b> 个 · 技术 {model.score.techCount} / 商务{" "}
                        {model.score.bizCount}
                        {model.score.priceCount > 0 ? ` / 价格 ${model.score.priceCount}` : ""}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                      <dt className="text-muted-foreground/80">主观分</dt>
                      <dd className="text-card-foreground">
                        {model.score.subjectiveCount > 0 ? (
                          <>
                            {model.score.subjectiveCount} 个评分点需评委主观打分，占{" "}
                            <b className="font-semibold">{model.score.subjectiveScore}</b> 分
                          </>
                        ) : (
                          "未识别到主观评分点"
                        )}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                      <dt className="shrink-0 text-muted-foreground/80">价格公式</dt>
                      <dd className="min-w-0 break-words text-card-foreground">
                        {model.score.priceFormula ? (
                          <span title={model.score.priceFormula}>{model.score.priceFormula}</span>
                        ) : (
                          <span className="text-muted-foreground">{model.score.priceFormulaNote}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  还没有评分办法——先运行解析，或对「技术评分要求 / 商务评分要求」单项重解析
                </p>
              )}
            </div>
          </section>

          {/* 解析目录（原型 .tree） */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <h3 className="text-[13.5px] font-semibold text-card-foreground">解析目录</h3>
              <div className="flex-1" />
              <span className="text-[11.5px] text-muted-foreground">
                {project.parse_report?.sections?.length ?? 0} 项
              </span>
            </header>
            <div className="py-1.5">
              {model.directory.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onFocusItem(node.focusKey ?? "")}
                  className={`flex w-full items-center gap-1.5 px-3.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-secondary ${
                    node.indent ? "pl-7 text-muted-foreground" : "font-medium text-card-foreground"
                  }`}
                >
                  <span className="min-w-0 truncate">{node.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                    {node.count}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3">
          {/* 解析质量（原型四栏竖分隔） */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="text-[13.5px] font-semibold text-card-foreground">解析质量</h3>
              <div className="flex-1" />
              <span className="text-[11.5px] text-muted-foreground">本地度量，零 AI 费用</span>
            </header>
            <div className="grid grid-cols-2 divide-x divide-border px-3.5 py-3 xl:grid-cols-4">
              {model.quality.map((q) => (
                <QualityCell key={q.id} stat={q} />
              ))}
            </div>
          </section>

          {/* 废标条款逐条确认 */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
              <h3 className="text-[13.5px] font-semibold text-card-foreground">
                废标条款
                {model.pendingCount > 0 && (
                  <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10.5px] font-medium text-destructive">
                    {model.pendingCount} 条待确认
                  </span>
                )}
              </h3>
              <span className="text-[11.5px] text-muted-foreground">逐条确认处理方式，未确认不可进 ③</span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                onClick={markAllCovered}
                disabled={archived || model.rows.length === 0 || model.pendingCount === 0}
                className="h-7 border-border px-2 text-[11.5px] text-card-foreground hover:bg-secondary"
              >
                <Check className="mr-1 h-3 w-3" />
                全部标为「已响应」
              </Button>
            </header>

            {model.rows.length === 0 ? (
              <p className="px-3.5 py-10 text-center text-xs text-muted-foreground">
                解析报告里还没有废标/资格/符合性/★▲ 条款——可先运行解析，或对上列分区单项重解析
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40 text-[11.5px] text-muted-foreground">
                        <th className="px-3.5 py-2 font-medium">条款原文</th>
                        <th className="w-32 px-2 py-2 font-medium">原文出处</th>
                        <th className="w-20 px-2 py-2 font-medium">级别</th>
                        <th className="w-40 px-2 py-2 font-medium">处理方式</th>
                        <th className="w-28 px-3.5 py-2 text-right font-medium">确认</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r) => {
                        const st = progress[r.id]?.status ?? "open"
                        const confirmed = st === "covered" || st === "na"
                        return (
                          <tr
                            key={r.id}
                            className={`border-b border-border/40 align-top last:border-b-0 ${
                              confirmed ? "" : "bg-warning/[0.03]"
                            }`}
                          >
                            <td className="px-3.5 py-2 text-card-foreground">
                              <span className="line-clamp-2" title={r.text}>
                                {r.text}
                              </span>
                            </td>
                            <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">{r.citation}</td>
                            <td className="px-2 py-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                                  r.level === "阻断"
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-warning/10 text-warning"
                                }`}
                              >
                                {r.level}
                              </span>
                            </td>
                            <td className="px-2 py-2">
                              <input
                                value={progress[r.id]?.note ?? ""}
                                disabled={archived}
                                placeholder="如 资质响应 / 逐条应答"
                                onChange={(e) => {
                                  const prev = progress[r.id] ?? { status: "open" as const, ref: "", note: "" }
                                  write({ ...progress, [r.id]: { ...prev, note: e.target.value } })
                                }}
                                className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11.5px] text-card-foreground placeholder:text-muted-foreground/60 disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3.5 py-2 text-right">
                              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={st === "covered"}
                                  disabled={archived}
                                  onChange={(e) => patchRow(r.id, e.target.checked ? "covered" : "open")}
                                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                                />
                                {st === "na" ? (
                                  <button
                                    type="button"
                                    onClick={() => patchRow(r.id, "open")}
                                    className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
                                    title="不适用也算已确认；点一下恢复为待确认"
                                  >
                                    不适用
                                  </button>
                                ) : confirmed ? (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary">
                                    已确认
                                    <Check size={10} strokeWidth={3} />
                                  </span>
                                ) : (
                                  <span>待确认</span>
                                )}
                              </label>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
                  <span>
                    已确认 <b className="tabular-nums text-card-foreground">{model.confirmedCount}</b> / 共{" "}
                    <b className="tabular-nums text-card-foreground">{model.totalRows}</b> 条
                  </span>
                  <span className="text-muted-foreground/70">
                    · 本屏显示 {shownRows.length} 条（未确认在前）
                  </span>
                  <div className="flex-1" />
                  {model.totalRows > COLLAPSED_ROWS && (
                    <button
                      type="button"
                      onClick={() => setExpandAll((v) => !v)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-primary hover:bg-primary/10"
                    >
                      {expandAll ? "收起" : `展开全部 ${model.totalRows} 条`}
                      <ChevronDown className={`h-3 w-3 transition-transform ${expandAll ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </footer>
              </>
            )}
          </section>

          {model.pendingCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-card-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>
                还有 <b>{model.pendingCount}</b> 条废标条款未确认。漏一条废标项就直接废标——确认完（或点「全部标为已响应」留痕）才能进入
                ③ 大纲编制。确认状态也与下方「条款覆盖矩阵」共用，不需要两边各点一遍。
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** ② 屏的空态（还没有解析报告时）：保留骨架，不摆假数字 */
export function ParseConfirmEmpty({ onReparse, parseLoading }: { onReparse: () => void; parseLoading: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start gap-4 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            ② 解析确认
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
              四类结果逐条确认
            </span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            解析完成后，本屏把废标条款 / 评分办法 / 技术参数 / 时间节点四类结果摊开逐条确认
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <Button onClick={onReparse} disabled={parseLoading} className="bg-primary text-primary-foreground">
            {parseLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {parseLoading ? "解析中…" : "运行 AI 解析"}
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["废标项", "资格性 / 符合性 / ★▲ 条款逐条确认"],
          ["评分办法", "技术 / 商务 / 价格三栏分布"],
          ["技术参数", "★/▲ 参数行与表格识别"],
          ["时间节点", "报名 / 答疑 / 保证金 / 递交 / 开标"],
        ].map(([label, hint]) => (
          <div key={label} className="flex h-full flex-col rounded-lg border border-dashed border-border bg-card px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground">{label}</span>
              <div className="flex-1" />
              <span className="font-mono text-base font-semibold text-muted-foreground">—</span>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">还没有解析报告</p>
        <p className="mt-1 text-xs text-muted-foreground">先运行 AI 解析，四类结果与逐条确认表就会出现在这里</p>
      </div>
    </div>
  )
}
