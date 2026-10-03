// 竞品分析页视图：市场总览 / 订单能力对标 / 厂商档案（数据集∪档案库按名合并）+ 新增/编辑弹窗 + 软著基线导入。
import { useCallback, useEffect, useMemo, useState } from "react"
import { Award, BarChart3, Boxes, Brain, CalendarRange, Check, ChevronDown, Copy, Crosshair, Download, ExternalLink, FileBadge, FileText, LayoutGrid, List, MessageCircle, Newspaper, Pencil, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, TrendingUp, X } from "lucide-react"
import { PageHeader } from "@/components/shell/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { copyTextToClipboard } from "@/lib/clipboard"
import { formatCount } from "@/lib/money"
import { analysisReportToText } from "./analysisReport"
import { CompetitorOverview } from "@/components/competitors/CompetitorOverview"
import { CompetitorCompare } from "@/components/competitors/CompetitorCompare"
import {
  VENDOR_ORDERS,
  VENDOR_PROFILES,
  coreVendors,
  extendedVendors,
  fmtYi,
  orderRankOf,
  vendorByName,
  type VendorOrder,
} from "./marketIntel"
import { CHART_COLORS } from "@/lib/echarts"
import { enrichProgress } from "./competitorsCore"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CompetitorPatch, CompetitorRow } from "./competitorsCore"
import type { UseCompetitors } from "./useCompetitors"
import { CopyrightDialog } from "./CopyrightDialog"
import { resolveAvailableModels, type ModelRef } from "@/lib/modelGateway"
import { useCompetitorAnalysis } from "./useCompetitorAnalysis"

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{value}</p>
    </div>
  )
}

function Group({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const items = children as React.ReactElement[]
  const arr = Array.isArray(items) ? items : [items]
  const visible = arr.filter(Boolean)
  if (visible.length === 0) return null
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-primary">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** 我方基线厂商（与图表一致：橙色区分） */
const SELF_NAME = "智业软件"
/** 前三名的名次带样式（用品牌青绿梯度，不与“橙色=我方”冲突） */
const RANK_STYLES = [
  { background: CHART_COLORS.primary, color: "#fff" },
  { background: "#3CC4AC", color: "#fff" },
  { background: "#7FB8AD", color: "#fff" },
]

function RankBadge({ rank }: { rank: number }) {
  if (!rank || rank < 1) return null
  const medal = RANK_STYLES[rank - 1]
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold tabular-nums",
        !medal && "bg-muted text-muted-foreground",
      )}
      style={medal ? { background: medal.background, color: medal.color } : undefined}
    >
      {rank}
    </span>
  )
}

/** 事实来源徽标：将 evidence_refs 按前缀分组计数，例：{cr:3 cust:2 kb:1 intel:5} */
function EvidenceBadges({ refs }: { refs?: string[] }) {
  if (!refs || refs.length === 0) {
    return (
      <span className="ml-1 inline-block rounded bg-red-50 px-1 py-0.5 text-[9px] font-semibold text-red-600" title="无事实依据（仅 AI 内部知识，请谨慎采纳）">
        无依据
      </span>
    )
  }
  const groups: Record<string, number> = {}
  for (const r of refs) {
    const k = String(r).split(":")[0] || "?"
    groups[k] = (groups[k] || 0) + 1
  }
  const label: Record<string, { name: string; cls: string }> = {
    cr: { name: "软著", cls: "bg-sky-100 text-sky-700" },
    cust: { name: "客户", cls: "bg-emerald-100 text-emerald-700" },
    kb: { name: "知识库", cls: "bg-violet-100 text-violet-700" },
    intel: { name: "情报", cls: "bg-amber-100 text-amber-700" },
    bid: { name: "招投标", cls: "bg-rose-100 text-rose-700" },
    ann: { name: "公告", cls: "bg-cyan-100 text-cyan-700" },
    crx: { name: "实时软著", cls: "bg-slate-100 text-slate-700" },
  }
  return (
    <span className="ml-1.5 inline-flex flex-wrap items-center gap-1">
      {Object.entries(groups).map(([k, n]) => {
        const l = label[k] || { name: k, cls: "bg-gray-100 text-gray-600" }
        return (
          <span key={k} className={cn("inline-block rounded px-1 py-0.5 text-[9px] font-semibold", l.cls)} title={refs.filter((r) => r.startsWith(k + ":")).join("\n")}>
            {l.name} {n}
          </span>
        )
      })}
    </span>
  )
}

/** 分析材料清单：展示本次实际拉到了多少事实，建立用户信任 */
function MaterialChecklist({ items }: { items: NonNullable<import("./useCompetitorAnalysis").AnalysisResult["materials"]> }) {
  if (!items || items.length === 0) return null
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">分析材料清单</p>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {items.map((m) => (
          <span key={m.kind} className="inline-flex items-center gap-1 rounded bg-card px-1.5 py-0.5 text-foreground shadow-sm" title={m.note}>
            <span className="text-muted-foreground">{m.label}</span>
            <span className={cn("font-semibold tabular-nums", m.count === 0 ? "text-gray-400" : "text-primary")}>{m.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** AI 深度分析 + 关联情报区块 */
function AIAnalysisSection({ row, modelRef }: { row: CompetitorRow; modelRef: ModelRef | null }) {
  const analysis = useCompetitorAnalysis({ modelRef })
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)

  // 调用方以 key={row.id} 重挂载复位内部状态；此处只做关联情报拉取（setState 在异步回调中）
  useEffect(() => {
    void analysis.loadRelatedIntel(row)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  const toggleField = (field: string) => {
    setAccepted((prev) => {
      const s = new Set(prev)
      if (s.has(field)) s.delete(field)
      else s.add(field)
      return s
    })
  }

  const handleApply = () => {
    if (!analysis.result) return
    const picked = analysis.result.updates.filter((u) => accepted.has(u.field))
    void analysis.applyUpdates(row.id, picked)
  }

  const noEvidenceCount = analysis.result?.updates.filter((u) => (u.evidence_refs?.length ?? 0) === 0).length ?? 0
  const lowCount = analysis.result?.updates.filter((u) => u.confidence === "low").length ?? 0

  return (
    <div className="border-t border-border pt-4 space-y-3">
      {/* AI 分析按钮 */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void analysis.runAnalysis(row)}
          disabled={analysis.analyzing || !modelRef}
          className="gap-1.5"
        >
          <Sparkles className={analysis.analyzing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {analysis.analyzing ? "AI 拉取事实中…" : "AI 深度分析"}
        </Button>
        {analysis.costHint && !analysis.analyzing && (
          <span className="text-[10px] text-muted-foreground">{analysis.costHint}</span>
        )}
      </div>

      {analysis.error && <p className="text-xs text-destructive">{analysis.error}</p>}

      {/* 分析结果 Diff */}
      {analysis.result && (
        <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
          <button type="button" aria-expanded={expanded} className="flex w-full items-center justify-between text-xs font-medium text-primary" onClick={() => setExpanded(!expanded)}>
            <span className="flex items-center gap-1"><Brain className="h-3.5 w-3.5" />分析建议：{analysis.result.updates.length} 项可更新 · 威胁变化：{analysis.result.threat_level_change === "up" ? "↑上升" : analysis.result.threat_level_change === "down" ? "↓下降" : "→持平"}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          </button>

          {/* 无事实依据/低置信度警告（默认可见，不依赖展开） */}
          {(noEvidenceCount > 0 || lowCount > 0) && (
            <p className="mt-1.5 text-[10px] text-amber-700">
              {noEvidenceCount > 0 && `⚠ ${noEvidenceCount} 条建议无事实依据`}
              {noEvidenceCount > 0 && lowCount > 0 && " · "}
              {lowCount > 0 && `${lowCount} 条为低置信度`}
              {"（默认不勾选，需你手动确认）"}
            </p>
          )}

          {expanded && (
            <div className="mt-2 space-y-2">
              {analysis.result.materials && analysis.result.materials.length > 0 && (
                <MaterialChecklist items={analysis.result.materials} />
              )}
              {analysis.result.updates.length === 0 && (
                <p className="rounded border border-dashed border-border bg-card/60 p-2 text-[11px] text-muted-foreground">
                  AI 未基于事实片段提出任何更新——当前档案与事实一致或证据不足。这是正常且诚实的结果。
                </p>
              )}
              {analysis.result.updates.map((u) => {
                const noRef = (u.evidence_refs?.length ?? 0) === 0
                return (
                  <label
                    key={u.field}
                    className={cn(
                      "flex items-start gap-2 rounded-md border bg-card p-2 text-xs cursor-pointer hover:bg-muted/30",
                      noRef ? "border-amber-300/70" : "border-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={accepted.has(u.field)}
                      onChange={() => toggleField(u.field)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-primary text-primary focus:ring-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-medium text-foreground">{u.field}</span>
                        <span
                          className={cn(
                            "inline-block rounded px-1 py-0.5 text-[9px] font-semibold",
                            u.confidence === "high"
                              ? "bg-green-100 text-green-700"
                              : u.confidence === "medium"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-500",
                          )}
                        >
                          {u.confidence}
                        </span>
                        <EvidenceBadges refs={u.evidence_refs} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground">{u.reason}</p>
                      {u.evidence_refs && u.evidence_refs.length > 0 && (
                        <details className="mt-1 text-[10px] text-muted-foreground">
                          <summary className="cursor-pointer select-none">展开 {u.evidence_refs.length} 条事实 id</summary>
                          <ul className="mt-1 space-y-0.5 pl-3 font-mono text-[9px] leading-relaxed">
                            {u.evidence_refs.map((r) => (
                              <li key={r} className="break-all">· {r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </label>
                )
              })}
              {analysis.result.action_items.length > 0 && (
                <div className="rounded-md bg-amber-50 p-2">
                  <p className="text-[10px] font-medium text-amber-700">行动建议</p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
                    {analysis.result.action_items.map((a, i) => <li key={i}>• {a}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex gap-1.5">
                <Button size="sm" onClick={handleApply} disabled={accepted.size === 0 || analysis.applied} className="min-w-0 flex-1 gap-1">
                  {analysis.applied ? <><Check className="h-3.5 w-3.5" />已采纳</> : <><Sparkles className="h-3.5 w-3.5" />采纳 {accepted.size} 项更新</>}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="把威胁变化/更新建议/行动建议/材料清单拼成纯文本复制"
                  onClick={() => {
                    void copyTextToClipboard(analysisReportToText(row.name, analysis.result!), {
                      successMessage: "已复制分析报告",
                      errorMessage: "复制失败，请手动选择文本",
                    })
                  }}
                  className="shrink-0 gap-1"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制报告
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 关联情报 */}
      <div>
        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Newspaper className="h-3.5 w-3.5" />关联情报
          {analysis.intelLoading && <span className="text-[10px] italic">加载中…</span>}
          {!analysis.intelLoading && analysis.relatedIntel.length > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{analysis.relatedIntel.length}</Badge>
          )}
        </div>
        {!analysis.intelLoading && analysis.relatedIntel.length === 0 && (
          <p className="text-[11px] text-muted-foreground">暂无匹配的竞品情报，可在情报中心添加该厂商官网为信息源。</p>
        )}
        <div className="space-y-1.5">
          {analysis.relatedIntel.slice(0, 5).map((it) => (
            <a key={it.itemId} href={it.url} target="_blank" rel="noreferrer noopener" className="block truncate rounded border border-border px-2 py-1.5 text-[11px] text-foreground hover:bg-muted/40 hover:border-primary/30 transition-colors">
              <span className="text-muted-foreground">[{it.publishedAt.slice(0, 10)}]</span> {it.itemType === "competitor" && <span className="mr-1 inline-block rounded bg-primary/10 px-1 text-[9px] font-medium text-primary">竞品</span>}{it.title}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 订单情报区块（marketIntel 策展数据集）：五年订单 hero + 关键评估指标 + 订单结构 + 资质标杆财报 */
function IntelSection({ intel }: { intel: VendorOrder }) {
  const profile = VENDOR_PROFILES[intel.name]
  const rank = orderRankOf(intel.name)
  const hero = [
    { label: "五年中标", value: fmtYi(intel.bid5y) },
    { label: "2025 中标", value: intel.bid25 != null ? fmtYi(intel.bid25) : "待补" },
    { label: "五年项目数", value: intel.projects5y != null ? String(intel.projects5y) : "—" },
    { label: "订单排名", value: rank ? `第 ${rank}` : "—" },
  ]
  const kf: [string, string][] = (profile
    ? [
        ["发展历程", profile.history],
        ["公司定位", profile.positioning],
        ["战略布局", profile.strategy],
        ["核心区域", profile.regions],
        ["客户覆盖", profile.coverage],
        ["核心业务", profile.business],
        ["核心产品", profile.products],
        ["技术战略", profile.techStrategy],
        ["优势赛道", profile.advantageTrack],
        ["实力佐证", profile.proof],
      ]
    : []
  ).filter(([, v]) => Boolean(v)) as [string, string][]
  const struct: [string, string][] = []
  if (intel.bigShare != null && intel.bigShare > 0) struct.push(["千万级金额占比", `${intel.bigShare}%${intel.big5y ? `（${fmtYi(intel.big5y)}）` : ""}`])
  if (intel.midShare != null && intel.midShare > 0) struct.push(["500–1000 万金额占比", `${intel.midShare}%`])
  if (intel.tertiaryShare != null) struct.push(["三甲医院金额占比", `${intel.tertiaryShare}%`])
  if (intel.hospitalMix) struct.push(["医院 / 区域 / 医共体", `${intel.hospitalMix[0]}% / ${intel.hospitalMix[1]}% / ${intel.hospitalMix[2]}%`])
  if (intel.specialtyShare != null) struct.push(["专科医院占比（五年）", `${intel.specialtyShare}%`])
  return (
    <div className="space-y-4 border-b border-border pb-4">
      <div className="grid grid-cols-4 gap-2">
        {hero.map((h) => (
          <div key={h.label} className="rounded-xl bg-gradient-to-br from-primary/[0.10] to-primary/[0.02] p-2.5 text-center ring-1 ring-primary/10">
            <p className="text-[10.5px] text-muted-foreground">{h.label}</p>
            <p className={"mt-0.5 truncate text-[15px] font-bold tabular-nums " + (h.value === "待补" || h.value === "—" ? "text-muted-foreground" : "text-foreground")}>{h.value}</p>
          </div>
        ))}
      </div>
      {profile && (
        <Group title={<><TrendingUp className="h-4 w-4" />关键评估指标（订单分析）</>}>
          {kf.map(([l, v]) => <Field key={l} label={l} value={v} />)}
        </Group>
      )}
      {struct.length > 0 && (
        <Group title={<><BarChart3 className="h-4 w-4" />订单结构分析</>}>
          {struct.map(([l, v]) => <Field key={l} label={l} value={v} />)}
        </Group>
      )}
      {profile && (profile.certifications || profile.benchmarks || profile.finance) && (
        <Group title={<><ShieldCheck className="h-4 w-4" />资质 · 标杆 · 财报</>}>
          <Field label="资质认证" value={profile.certifications ?? ""} />
          <Field label="标杆案例" value={profile.benchmarks ?? ""} />
          <Field label="财务情况" value={profile.finance ?? ""} />
        </Group>
      )}
      {profile && <p className="text-[11px] text-muted-foreground">定性内容据订单分析 PPT 整理，正式版需人工核验。</p>}
    </div>
  )
}

/** 仅数据集收录、档案库未建档的厂商：订单情报 + 软著参考 + 建档引导 */
function VendorIntelPanel({ intel, onCreateFor }: { intel: VendorOrder; onCreateFor: (name: string) => void }) {
  const isSelf = intel.name === SELF_NAME
  return (
    <Card className="sticky top-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
            style={{ background: isSelf ? "#E8973C1F" : "#0E7C9914", color: isSelf ? CHART_COLORS.warn : CHART_COLORS.primaryDeep }}
          >
            {intel.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 truncate text-lg">
              {intel.name}
              {isSelf && <Badge variant="warning" className="shrink-0">我方</Badge>}
            </CardTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{intel.legalName || "（主体待核）"}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => onCreateFor(intel.name)}>
          <Plus className="h-3.5 w-3.5" />
          建档补全
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <IntelSection intel={intel} />
        <Group title={<><FileBadge className="h-4 w-4" />参考信息（非对照主线）</>}>
          <Field label="软件著作权" value={intel.copyrights ? `${intel.copyrights} 项（最早 ${intel.crEarliest ?? "—"}，最近 ${intel.crLatest ?? "—"}）` : "未在软著汇总表"} />
        </Group>
        <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
          <FileText className="mr-1 inline h-3 w-3" />
          数据来源：剑鱼标讯订单（2021–2025）、软著汇总（截至 2026-09）；定性研判需人工核验。建档后可使用 AI 深度分析与编辑。
        </p>
      </CardContent>
    </Card>
  )
}

function DetailPanel({ row, rank, total, intel, onEdit, onRemove, onViewCopyrights, modelRef }: { row: CompetitorRow; rank: number; total: number; intel: VendorOrder | null; onEdit: () => void; onRemove: () => void; onViewCopyrights: () => void; modelRef: ModelRef | null }) {
  const prog = enrichProgress(row)
  const pct = Math.round(prog.ratio * 100)
  const isSelf = row.name === SELF_NAME
  return (
    <Card className="sticky top-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
            style={{ background: isSelf ? "#E8973C1F" : "#0E7C9914", color: isSelf ? CHART_COLORS.warn : CHART_COLORS.primaryDeep }}
          >
            {row.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 truncate text-lg">
              {row.name}
              {isSelf && <Badge variant="warning" className="shrink-0">我方</Badge>}
            </CardTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.legal_name || intel?.legalName || "（未填企业主体）"}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} title="删除该竞品">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* 订单情报（策展数据集）：有五年订单口径数据时前置展示 */}
        {intel && <IntelSection intel={intel} />}

        {/* 软著英雄数据：数量与名次，点击进入明细查询（用户反馈轮 2026-09-21：要能直接看到并查询各家软著清单） */}
        <div className="flex items-stretch gap-3">
          <button type="button" onClick={onViewCopyrights} className="group/cr flex-1 cursor-pointer rounded-xl bg-gradient-to-br from-primary/[0.12] to-primary/[0.02] p-3 text-left ring-1 ring-primary/10 transition-shadow hover:shadow-sm hover:ring-primary/25">
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              软件著作权
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-primary opacity-70 transition-opacity group-hover/cr:opacity-100">
                <FileBadge className="h-3 w-3" />查看清单
              </span>
            </p>
            <p className="text-2xl font-bold leading-tight tabular-nums" style={{ color: isSelf ? CHART_COLORS.warn : CHART_COLORS.primaryDeep }}>
              {formatCount(row.software_copyrights)}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <RankBadge rank={rank} /> 软著第 {rank} 名 / 共 {total} 家
            </p>
          </button>
          <div className="flex w-32 flex-col justify-center gap-2 rounded-xl border border-border p-2.5 text-[11px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0"><span className="block text-[10px]">最早登记</span><span className="font-medium text-foreground">{row.earliest_cr_date || "—"}</span></span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Award className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0"><span className="block text-[10px]">最近登记</span><span className="font-medium text-foreground">{row.latest_cr_date || "—"}</span></span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {row.visibility === "personal" && <Badge variant="warning">个人</Badge>}
        </div>

        {/* 档案完整度：研判字段填充进度，提示补全 */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">档案完整度</span>
            <span className="font-medium tabular-nums text-foreground">
              {prog.filled}/{prog.total} · {pct}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: pct >= 60 ? CHART_COLORS.primary : pct >= 30 ? CHART_COLORS.warn : CHART_COLORS.danger }}
            />
          </div>
          {pct < 100 && <p className="mt-1 text-[11px] text-muted-foreground">还有 {prog.total - prog.filled} 项研判信息待补全，点右上「编辑」完善。</p>}
        </div>

        {(row.website || row.wechat) && (
          <div className="flex flex-wrap gap-3">
            {row.website && (
              <a
                href={row.website.startsWith("http") ? row.website : `https://${row.website}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                官网
              </a>
            )}
            {row.wechat && (
              <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5" />
                公众号：{row.wechat}
              </span>
            )}
          </div>
        )}

        <Group title={<><Boxes className="h-4 w-4" />定位与产品</>}>
          <Field label="厂商定位" value={row.positioning} />
          <Field label="产品矩阵" value={row.products} />
        </Group>

        <Group title={<><TrendingUp className="h-4 w-4" />市场业绩（订单分析）</>}>
          <Field label="五年中标金额" value={row.bid_amount_5y} />
          <Field label="区域版图" value={row.regions} />
          <Field label="金额区间结构" value={row.amount_structure} />
          <Field label="客户画像" value={row.customer_profile} />
        </Group>

        <Group title={<><ShieldCheck className="h-4 w-4" />能力与资质</>}>
          <Field label="资质认证" value={row.certifications} />
          <Field label="AI 产品演进" value={row.ai_evolution} />
          <Field label="信创适配" value={row.xinchuang} />
        </Group>

        <Group title={<><Crosshair className="h-4 w-4" />竞争研判</>}>
          <Field label="优势" value={row.strengths} />
          <Field label="劣势" value={row.weaknesses} />
          <Field label="对我方威胁与应对" value={row.threat_notes} />
        </Group>

        {row.summary && (
          <Group title={<><LayoutGrid className="h-4 w-4" />概览</>}>
            <Field label="" value={row.summary} />
          </Group>
        )}
        
        <AIAnalysisSection key={row.id} row={row} modelRef={modelRef} />
        
        <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
          <FileText className="mr-1 inline h-3 w-3" />
          数据来源：{row.source || "未标注"}
          {row.updated && ` · 更新于 ${row.updated.slice(0, 10)}`}
        </p>
      </CardContent>
    </Card>
  )
}

type FormFieldDef = { key: keyof CompetitorPatch; label: string; long?: boolean; numeric?: boolean }
const FORM_FIELDS: { group: string; fields: FormFieldDef[] }[] = [
  {
    group: "基本信息",
    fields: [
      { key: "legal_name", label: "企业主体全称" },
      { key: "website", label: "官网" },
      { key: "wechat", label: "微信公众号" },
      { key: "software_copyrights", label: "软著总数", numeric: true },
      { key: "earliest_cr_date", label: "最早登记日期" },
      { key: "latest_cr_date", label: "最近登记日期" },
    ],
  },
  {
    group: "定位与产品",
    fields: [
      { key: "positioning", label: "厂商定位", long: true },
      { key: "products", label: "产品矩阵", long: true },
    ],
  },
  {
    group: "市场业绩",
    fields: [
      { key: "bid_amount_5y", label: "五年中标金额" },
      { key: "regions", label: "区域版图", long: true },
      { key: "amount_structure", label: "金额区间结构", long: true },
      { key: "customer_profile", label: "客户画像", long: true },
    ],
  },
  {
    group: "能力与资质",
    fields: [
      { key: "certifications", label: "资质认证", long: true },
      { key: "ai_evolution", label: "AI 产品演进", long: true },
      { key: "xinchuang", label: "信创适配", long: true },
    ],
  },
  {
    group: "竞争研判",
    fields: [
      { key: "strengths", label: "优势", long: true },
      { key: "weaknesses", label: "劣势", long: true },
      { key: "threat_notes", label: "对我方威胁与应对", long: true },
      { key: "summary", label: "概览", long: true },
      { key: "source", label: "数据来源标注" },
    ],
  },
]

function EditDialog(p: UseCompetitors) {
  const setField = (key: keyof CompetitorPatch, v: string | number) => p.setForm({ ...p.form, [key]: v })
  return (
    <Dialog open={p.editOpen} onOpenChange={(o) => (o ? undefined : p.closeEdit())}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{p.editingId ? "编辑竞品档案" : "新增竞品"}</DialogTitle>
          <DialogDescription>各维度信息取自软著汇总、订单分析与公开渠道；取不到的留空，勿臆造。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">公司名称 *</label>
            <Input value={String(p.form.name ?? "")} onChange={(e) => setField("name", e.target.value)} placeholder="如：卫宁健康" autoComplete="off" />
          </div>
          {FORM_FIELDS.map((sec) => (
            <div key={sec.group} className="space-y-2.5">
              <p className="text-[11px] font-semibold tracking-wide text-primary">{sec.group}</p>
              {sec.fields.map((f) => (
                <div key={String(f.key)}>
                  <label className="mb-1 block text-xs font-medium text-foreground">{f.label}</label>
                  {f.long ? (
                    <Textarea
                      rows={2}
                      value={String((p.form[f.key] as string) ?? "")}
                      onChange={(e) => setField(f.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      type={f.numeric ? "number" : "text"}
                      value={String((p.form[f.key] as string | number) ?? "")}
                      onChange={(e) => setField(f.key, f.numeric ? Number(e.target.value) || 0 : e.target.value)}
                      autoComplete="off"
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
          {p.formErr && <p className="text-sm text-destructive">{p.formErr}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={p.closeEdit}>
            取消
          </Button>
          <Button onClick={() => void p.submit()} disabled={p.saving}>
            {p.saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CompetitorsPage(p: UseCompetitors) {
  const [tab, setTab] = useState<string>(() => (p.deepLinked || p.selectedId ? "archive" : "overview"))
  const [modelRef, setModelRef] = useState<ModelRef | null>(null)
  useEffect(() => {
    let cancelled = false
    void resolveAvailableModels().then((av) => {
      if (!cancelled) setModelRef(av.defaultRef ?? av.models[0] ?? null)
    })
    return () => { cancelled = true }
  }, [])
  const { rankById } = useMemo(() => {
    const sorted = [...p.rows].sort((a, b) => b.software_copyrights - a.software_copyrights)
    const m = new Map<string, number>()
    sorted.forEach((r, i) => m.set(r.id, i + 1))
    return { rankById: m }
  }, [p.rows])
  // 厂商档案选中：数据集厂商未必有档案行，以名称为主键
  const [vendorName, setVendorName] = useState<string | null>(null)
  const openVendor = useCallback((name: string) => {
    setVendorName(name)
    const row = p.rows.find((r) => r.name === name)
    if (row) p.setSelectedId(row.id)
    setTab("archive")
  }, [p])
  const activeName = vendorName ?? p.selected?.name ?? SELF_NAME
  const activeRow = useMemo(() => p.rows.find((r) => r.name === activeName) ?? null, [p.rows, activeName])
  const activeIntel = vendorByName(activeName) ?? null
  // 数据集厂商一键建档：带入主体/软著基线，研判字段留空待补
  const openCreateFor = useCallback((name: string) => {
    const intel = vendorByName(name)
    p.openCreate()
    p.setForm({
      name,
      legal_name: intel?.legalName ?? "",
      software_copyrights: intel?.copyrights ?? 0,
      earliest_cr_date: intel?.crEarliest ?? "",
      latest_cr_date: intel?.crLatest ?? "",
      source: "订单分析数据集（建档带入）",
      visibility: "team",
    })
  }, [p])
  // 档案列表：核心 15 家（按订单名次）+ 扩展层（软著参考位）+ 档案库独有厂商；支持搜索/排序
  const archiveItems = useMemo(() => {
    const items = [...coreVendors(), ...extendedVendors()].map((v) => ({
      name: v.name,
      rk: orderRankOf(v.name),
      core: v.bid5y != null,
      intel: v as VendorOrder | null,
      row: p.rows.find((r) => r.name === v.name) ?? null,
    }))
    const names = new Set(VENDOR_ORDERS.map((v) => v.name))
    for (const r of p.rows) if (!names.has(r.name) && r.name) items.push({ name: r.name, rk: 0, core: false, intel: null, row: r })
    const q = p.search.trim().toLowerCase()
    const shown = q
      ? items.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            (VENDOR_PROFILES[it.name]?.positioning ?? "").toLowerCase().includes(q) ||
            (it.row?.positioning ?? "").toLowerCase().includes(q) ||
            (it.row?.products ?? "").toLowerCase().includes(q),
        )
      : items
    if (p.sortKey === "name") shown.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    else if (p.sortKey === "updated") shown.sort((a, b) => String(b.row?.updated ?? "").localeCompare(String(a.row?.updated ?? "")))
    return shown
  }, [p.rows, p.search, p.sortKey])
  // 软著明细查询：公司维度默认当前选中厂商，无选中时为全部
  const [crOpen, setCrOpen] = useState(false)
  const [crCompany, setCrCompany] = useState("all")
  const openCopyrights = useCallback((company: string) => { setCrCompany(company); setCrOpen(true) }, [])
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-foreground">
      <PageHeader
        title="竞品分析"
        desc="医疗信息化厂商竞品档案：软著布局、市场业绩、产品定位与竞争研判，多源数据整合。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => openCopyrights(p.selected?.name ?? "all")}>
              <FileBadge className="h-4 w-4" />
              软著查询
            </Button>
            <Button variant="outline" size="sm" onClick={() => void p.reload()} disabled={p.loading}>
              <RefreshCw className={p.loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              刷新
            </Button>
            {p.seedMissingCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => void p.importSeed()} disabled={p.importing}>
                <Download className="h-4 w-4" />
                {p.importing ? "导入中…" : `导入软著基线（${p.seedMissingCount}）`}
              </Button>
            )}
            <Button size="sm" onClick={p.openCreate}>
              <Plus className="h-4 w-4" />
              新增竞品
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              市场总览
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-1.5">
              <Crosshair className="h-3.5 w-3.5" />
              能力对标
            </TabsTrigger>
            <TabsTrigger value="archive" className="gap-1.5">
              <List className="h-3.5 w-3.5" />
              厂商档案
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <CompetitorOverview onOpenVendor={openVendor} />
          </TabsContent>

          <TabsContent value="compare" className="space-y-4">
            <CompetitorCompare
              rows={p.rows}
              loading={p.loading}
              modelRef={modelRef}
              onOpenArchive={openVendor}
              onAdd={p.openCreate}
            />
          </TabsContent>

          <TabsContent value="archive">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
              {/* 厂商列表：订单数据集 ∪ 档案库，按名合并 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={p.search}
                      onChange={(e) => p.setSearch(e.target.value)}
                      placeholder="搜索厂商 / 定位 / 产品"
                      className="pl-8"
                    />
                  </div>
                  <Select value={p.sortKey} onValueChange={(v) => p.setSortKey(v as never)}>
                    <SelectTrigger className="h-9 w-[104px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="copyrights">按订单</SelectItem>
                      <SelectItem value="updated">按更新</SelectItem>
                      <SelectItem value="name">按名称</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="px-1 text-xs text-muted-foreground">
                  核心 {coreVendors().length} 家按五年中标排名 · 扩展层仅作参考位 · 共 {archiveItems.length} 家
                </p>
                <div className="space-y-2">
                  {p.loading ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
                  ) : archiveItems.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">无匹配厂商</p>
                      {p.search.trim() ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => p.setSearch("")}
                          className="mt-1.5 gap-1.5 text-primary hover:bg-primary/10 hover:text-primary"
                        >
                          <X className="h-3.5 w-3.5" />
                          清空搜索
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    archiveItems.map((it) => {
                      const active = it.name === activeName
                      const isSelf = it.name === SELF_NAME
                      const accent = isSelf ? CHART_COLORS.warn : CHART_COLORS.primary
                      const sub =
                        VENDOR_PROFILES[it.name]?.positioning ||
                        it.row?.positioning ||
                        (it.core ? "研判信息待补全" : it.row ? "未纳入订单口径，档案已建" : "订单未纳入核心口径")
                      const crNum = it.row?.software_copyrights || it.intel?.copyrights || 0
                      const right = it.intel?.bid5y != null ? fmtYi(it.intel.bid5y, 1) : crNum ? `${formatCount(crNum)} 软著` : "—"
                      return (
                        <button
                          key={it.name}
                          type="button"
                          onClick={() => setVendorName(it.name)}
                          className={cn(
                            "relative w-full overflow-hidden rounded-xl border py-3 pl-4 pr-3 text-left transition-all",
                            active
                              ? "border-primary/50 bg-primary/[0.05] shadow-sm ring-1 ring-primary/20"
                              : "border-border bg-card hover:border-primary/40 hover:bg-muted/40 hover:shadow-sm",
                          )}
                        >
                          {active && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                              style={{ background: isSelf ? "#E8973C1A" : "#0E7C9912", color: isSelf ? CHART_COLORS.warn : CHART_COLORS.primaryDeep }}
                            >
                              {it.name.slice(0, 1)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  {it.rk > 0 ? (
                                    <RankBadge rank={it.rk} />
                                  ) : (
                                    <span className="inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded bg-muted px-1 text-[10px] font-bold text-muted-foreground" title={it.intel ? "扩展层：未纳入 15 家订单口径，仅作参考" : "档案库自建厂商"}>
                                      {it.intel ? "扩" : "新"}
                                    </span>
                                  )}
                                  <span className="truncate text-sm font-medium text-foreground">{it.name}</span>
                                  {isSelf && <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[10px]">我方</Badge>}
                                </span>
                                <span className="shrink-0 leading-none">
                                  <span className="text-[14px] font-bold tabular-nums" style={{ color: accent }}>{right}</span>
                                </span>
                              </div>
                              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{sub}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* 详情：有档案行走完整面板（含 AI 分析/编辑），仅数据集收录者走情报面板 */}
              <div>
                {activeRow ? (
                  <DetailPanel row={activeRow} rank={rankById.get(activeRow.id) ?? 0} total={p.rows.length} intel={activeIntel} onEdit={() => p.openEdit(activeRow)} onRemove={() => void p.remove(activeRow)} onViewCopyrights={() => openCopyrights(activeRow.name)} modelRef={modelRef} />
                ) : activeIntel ? (
                  <VendorIntelPanel intel={activeIntel} onCreateFor={openCreateFor} />
                ) : (
                  <Card>
                    <CardContent className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
                      <FileText className="h-8 w-8" />
                      <p className="text-sm">选择左侧厂商查看竞品档案</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
      </Tabs>

      <EditDialog {...p} />
      {/* key 重挂载：切换公司入口时复位筛选状态（与 AI 分析卡片同法） */}
      <CopyrightDialog key={crCompany} open={crOpen} onOpenChange={setCrOpen} initialCompany={crCompany} />
    </div>
  )
}
