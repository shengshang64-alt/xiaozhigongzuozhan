// 竞品对比分析工作区：顶部多选选择器 + KPI + 能力雷达/矩阵（左）+ AI 差异化话术可复制（右）。
// 数据全部来自真实竞品档案；能力分为档案启发式估算（界面注明），话术由模型网关生成。
import { useCallback, useMemo, useState } from "react"
import { BarChart3, Check, Copy, Download, MessageSquare, Plus, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type { EChartsOption } from "echarts"
import { EChart } from "@/components/common/EChart"
import { CHART_COLORS } from "@/lib/echarts"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { ModelRef } from "@/lib/modelGateway"
import type { CompetitorRow } from "@/pages/Competitors/competitorsCore"
import {
  CAPABILITY_DIMS,
  buildCompareCsv,
  compareColor,
  finalScores,
} from "@/pages/Competitors/competitorScores"
import { useCompetitorTalks, type TalkKind } from "@/pages/Competitors/useCompetitorTalks"

const SELF_NAME = "智业软件"

/** 我方=橙色（与全页「橙色=我方」约定一致），竞品按色板轮询 */
function entryColor(row: CompetitorRow, idx: number): string {
  return row.name === SELF_NAME ? CHART_COLORS.warn : compareColor(idx)
}

const TALK_TAG: Record<TalkKind, string> = {
  优势: "bg-emerald-50 text-emerald-700 border-emerald-200",
  反击: "bg-sky-50 text-sky-700 border-sky-200",
  化解: "bg-amber-50 text-amber-700 border-amber-200",
}

async function copyText(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    toast.error("复制失败，请检查浏览器剪贴板权限")
  }
}

export function CompetitorCompare({
  rows,
  loading,
  modelRef,
  onOpenArchive,
  onAdd,
}: {
  rows: CompetitorRow[]
  loading: boolean
  modelRef: ModelRef | null
  onOpenArchive: (id: string) => void
  onAdd: () => void
}) {
  // 勾选集合：未手动改动前恒等于默认（我方 + 软著数最高的 3 家竞品），纯派生、无 effect
  const [picked, setPicked] = useState<Set<string> | null>(null)

  const selected = useMemo(() => {
    if (picked && [...picked].every((id) => rows.some((r) => r.id === id))) return picked
    const self = rows.filter((r) => r.name === SELF_NAME)
    const top = rows
      .filter((r) => r.name !== SELF_NAME)
      .sort((a, b) => b.software_copyrights - a.software_copyrights)
      .slice(0, 3)
    return new Set([...self, ...top].map((r) => r.id))
  }, [picked, rows])

  const toggle = (id: string) => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setPicked(s)
  }

  const entries = useMemo(() => {
    const picked = rows.filter((r) => selected.has(r.id))
    // 我方永远排首位（与雷达图例、矩阵列序一致）
    picked.sort((a, b) => Number(b.name === SELF_NAME) - Number(a.name === SELF_NAME))
    return picked.map((row, i) => ({
      row,
      color: entryColor(row, i),
      scores: finalScores(row, rows),
    }))
  }, [rows, selected])

  const selfEntry = entries.find((e) => e.row.name === SELF_NAME) ?? null
  const competitors = entries.filter((e) => e.row.name !== SELF_NAME)

  // 我方排名（全库软著序）
  const rank = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.software_copyrights - a.software_copyrights)
    return selfEntry ? sorted.findIndex((r) => r.id === selfEntry.row.id) + 1 : 0
  }, [rows, selfEntry])

  // 每维度领先者与「我方领先维度数」
  const dimBest = useMemo(
    () =>
      CAPABILITY_DIMS.map((_, d) => {
        const mx = Math.max(...entries.map((e) => e.scores[d] ?? 0))
        const leaders = entries.filter((e) => (e.scores[d] ?? 0) === mx)
        return { mx, leaders }
      }),
    [entries],
  )
  const selfLead = selfEntry ? dimBest.filter((b) => b.leaders.some((l) => l.row.id === selfEntry.row.id)).length : 0
  const threatPending = competitors.filter((e) => !e.row.threat_notes?.trim()).length

  // ------------------------------ 雷达图 ------------------------------
  const radarOption = useMemo<EChartsOption>(() => {
    if (entries.length === 0) return {}
    return {
      tooltip: { trigger: "item" },
      legend: { data: entries.map((e) => e.row.name), bottom: 0, textStyle: { fontSize: 11, color: CHART_COLORS.ink3 } },
      radar: {
        indicator: CAPABILITY_DIMS.map((name) => ({ name, max: 5 })),
        radius: "62%",
        splitNumber: 5,
        axisName: { color: CHART_COLORS.ink3, fontSize: 12 },
        splitArea: { areaStyle: { color: ["#fff", "rgba(14,124,153,.03)"] } },
        axisLine: { lineStyle: { color: CHART_COLORS.track } },
        splitLine: { lineStyle: { color: CHART_COLORS.track } },
      },
      series: [
        {
          type: "radar",
          symbolSize: 4,
          data: entries.map((e) => ({
            value: e.scores,
            name: e.row.name,
            itemStyle: { color: e.color },
            lineStyle: { width: e.row.name === SELF_NAME ? 2.5 : 1.5 },
            areaStyle: { color: `${e.color}26` },
          })),
        },
      ],
    }
  }, [entries])

  // ------------------------------ 话术 ------------------------------
  const talks = useCompetitorTalks(modelRef)

  const handleExport = useCallback(() => {
    if (entries.length === 0) return
    const csv = buildCompareCsv(entries.map((e) => ({ name: e.row.name, scores: e.scores })))
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `竞品能力对比_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("对比矩阵已导出")
  }, [entries])

  const allTalksText = talks.talks.map((t) => `【${t.kind}】${t.title}\n${t.content}`).join("\n\n")

  if (loading) return <p className="py-16 text-center text-sm text-muted-foreground">竞品数据加载中…</p>
  if (rows.length === 0) return null

  return (
    <div className="space-y-4">
      {/* 顶部：对比选择器 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="mr-1 text-sm font-semibold text-foreground">对标对象</span>
          {rows.slice(0, 24).map((r, i) => {
            const on = selected.has(r.id)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                className={cn(
                  "flex items-center gap-2 rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition-colors",
                  on
                    ? "border-primary bg-primary/5 font-semibold text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: entryColor(r, i) }} />
                {r.name}
                <span
                  className={cn(
                    "flex h-[15px] w-[15px] items-center justify-center rounded-full border",
                    on ? "border-primary bg-primary text-white" : "border-border",
                  )}
                >
                  {on && <Check className="h-2.5 w-2.5" />}
                </span>
              </button>
            )
          })}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={entries.length === 0}>
              <Download className="h-3.5 w-3.5" />
              导出对比
            </Button>
            <Button size="sm" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" />
              添加竞品
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "当前对标", value: `${entries.length} 家`, hint: `含 ${competitors.length} 家竞品` },
          { label: "我方软著排名", value: rank ? `第 ${rank}` : "—", hint: rank ? `/ 共 ${rows.length} 家` : "我方未入库" },
          { label: "我方领先维度", value: `${selfLead} 项`, hint: `共 ${CAPABILITY_DIMS.length} 维`, accent: selfLead > 0 },
          { label: "威胁研判待补", value: `${threatPending} 家`, hint: "勾选竞品缺「威胁与应对」", warn: threatPending > 0 },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="py-3.5">
              <p className="text-[11px] text-muted-foreground">{k.label}</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold leading-none tabular-nums",
                  k.warn && "text-amber-600",
                )}
                style={k.accent ? { color: CHART_COLORS.primaryDeep } : undefined}
              >
                {k.value}
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* 左：雷达 + 矩阵 */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  能力雷达对比
                </span>
                <span className="text-[11px] font-normal text-muted-foreground">六维能力模型 · 5 分制（档案估算）</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <p className="py-20 text-center text-sm text-muted-foreground">请在上方勾选至少一个对标对象</p>
              ) : (
                <EChart option={radarOption} height={320} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">竞品能力矩阵</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="border-b-2 border-border px-2 py-2 text-left text-xs font-semibold text-muted-foreground">能力维度</th>
                    {entries.map((e) => (
                      <th key={e.row.id} className="border-b-2 border-border px-2 py-2 text-center text-xs font-semibold" style={{ color: e.color }}>
                        {e.row.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITY_DIMS.map((dim, d) => (
                    <tr key={dim}>
                      <td
                        className={cn(
                          "border-b border-border/60 px-2 py-2 font-medium",
                          selfEntry && dimBest[d].leaders.some((l) => l.row.id === selfEntry.row.id) && "text-primary",
                        )}
                      >
                        {dim}
                      </td>
                      {entries.map((e) => {
                        const v = e.scores[d] ?? 0
                        const win = v === dimBest[d].mx && v >= 4
                        return (
                          <td
                            key={e.row.id}
                            className="border-b border-border/60 px-2 py-2 text-center tabular-nums"
                            style={{ color: win ? e.color : CHART_COLORS.ink3, fontWeight: win ? 700 : 400 }}
                          >
                            {"★".repeat(v)}
                            <span className="text-border">{"★".repeat(Math.max(0, 5 - v))}</span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                彩色加粗为该维度领先者（≥4 分）；评分由档案关键词与软著规模自动估算，供对标参考，请以实际研判为准。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 右：AI 差异化话术 */}
        <Card className="flex min-h-[420px] flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                AI 差异化竞争话术
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-[11px]"
                disabled={talks.loading || !modelRef || competitors.length === 0}
                onClick={() => void talks.runTalks(selfEntry?.row ?? null, competitors.map((e) => e.row))}
              >
                <RefreshCw className={cn("h-3 w-3", talks.loading && "animate-spin")} />
                {talks.talks.length > 0 ? "重新生成" : "生成话术"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-3">
            {talks.costHint && <p className="text-[10px] text-muted-foreground">{talks.costHint}</p>}
            {talks.error && <p className="text-xs text-destructive">{talks.error}</p>}
            {talks.loading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
                ))}
              </div>
            )}
            {!talks.loading && talks.talks.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">
                  {competitors.length === 0 ? "请勾选至少一个竞品" : "生成对抗话术"}
                </p>
                <p className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
                  基于勾选竞品档案与六维能力对比，AI 生成可直接粘贴至方案/标书的差异化话术。
                </p>
              </div>
            )}
            {talks.talks.map((t) => (
              <div key={t.title} className="rounded-lg border border-border p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", TALK_TAG[t.kind])}>{t.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">{t.title}</span>
                  <button
                    type="button"
                    onClick={() => void copyText(t.content, "话术已复制到剪贴板")}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-white"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                </div>
                <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[12.5px] leading-relaxed text-muted-foreground">{t.content}</p>
                {selfEntry && (
                  <button type="button" className="mt-1.5 text-[11px] text-primary hover:underline" onClick={() => onOpenArchive(selfEntry.row.id)}>
                    查看我方档案
                  </button>
                )}
              </div>
            ))}
            {talks.talks.length > 0 && (
              <Button size="sm" className="w-full gap-1.5" onClick={() => void copyText(allTalksText, `已复制全部 ${talks.talks.length} 条话术`)}>
                <Copy className="h-3.5 w-3.5" />
                全部复制到剪贴板
              </Button>
            )}
            {entries.length > 0 && (
              <div className="text-center text-[11px] text-muted-foreground">
                当前对比 <Badge variant="secondary" className="mx-1 px-1.5 py-0 text-[10px]">{entries.length}</Badge> 家：
                {entries.map((e) => e.row.name).join(" / ")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
