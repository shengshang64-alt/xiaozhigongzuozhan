// 订单能力对标视图：厂商勾选（数据集 23 家 + 档案库新增厂商）+ 对比重点 + 订单六维雷达
// + 关键评估指标对照表 + CSV 导出（左）；AI 差异化话术（右，沿用档案库数据）。
// 六维分数来自 marketIntel 真实订单归一化（非估算）；定性对照表为 PPT 整理，界面注明需人工核验。
import { useCallback, useMemo, useState } from "react"
import { BarChart3, Check, Copy, Crosshair, Download, MessageSquare, Plus, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { copyTextToClipboard } from "@/lib/clipboard"
import type { EChartsOption } from "echarts"
import { EChart } from "@/components/common/EChart"
import { CHART_COLORS } from "@/lib/echarts"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { triggerBlobDownload } from "@/lib/download"
import { localDateStamp } from "@/lib/dateStamp"
import type { ModelRef } from "@/lib/modelGateway"
import type { CompetitorRow } from "@/pages/Competitors/competitorsCore"
import { useCompetitorTalks, type TalkKind } from "@/pages/Competitors/useCompetitorTalks"
import {
  ORDER_DIMS,
  SELF_NAME,
  VENDOR_ORDERS,
  VENDOR_PROFILES,
  buildOrderCompareCsv,
  buildOrderTakeaways,
  defaultBenchmarkPicks,
  orderScores,
  type VendorOrder,
  type VendorProfile,
} from "@/pages/Competitors/marketIntel"

/** 竞品色板（我方固定橙色，与全页「橙色=我方」约定一致） */
const RC = ["#0E7C99", "#2E6FB0", "#3CAEC4", "#7B4FB0", "#1F9D63", "#5A6672", "#D9534F"]
const MAX_PICKS = 8

const TALK_TAG: Record<TalkKind, string> = {
  优势: "bg-emerald-50 text-emerald-700 border-emerald-200",
  反击: "bg-sky-50 text-sky-700 border-sky-200",
  化解: "bg-amber-50 text-amber-700 border-amber-200",
}

/** 对照表行定义（对齐重构稿：评估指标 × 厂商） */
const PROFILE_ROWS: { label: string; key: keyof VendorProfile; dbFallback?: keyof CompetitorRow }[] = [
  { label: "公司定位", key: "positioning", dbFallback: "positioning" },
  { label: "核心区域", key: "regions", dbFallback: "regions" },
  { label: "核心业务", key: "business" },
  { label: "核心产品", key: "products", dbFallback: "products" },
  { label: "技术战略", key: "techStrategy" },
  { label: "优势赛道", key: "advantageTrack" },
  { label: "实力佐证", key: "proof" },
]

async function copyText(text: string, msg: string) {
  await copyTextToClipboard(text, {
    successMessage: msg,
    errorMessage: "复制失败，请检查浏览器剪贴板权限",
  })
}

/** 档案库中未纳入订单数据集的厂商 → 补参考位 stub（仅软著，其余维度无口径数据） */
function stubFromRow(row: CompetitorRow): VendorOrder {
  return {
    name: row.name,
    legalName: row.legal_name || "",
    bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null,
    bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null,
    hospitalMix: null, specialtyShare: null,
    copyrights: row.software_copyrights || null, crEarliest: null, crLatest: null,
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
  onOpenArchive: (name: string) => void
  onAdd: () => void
}) {
  // 对标全集：订单数据集 23 家在前，档案库独有厂商以参考位追加
  const universe = useMemo<VendorOrder[]>(() => {
    const names = new Set(VENDOR_ORDERS.map((v) => v.name))
    const extra = rows.filter((r) => !names.has(r.name) && r.name).map(stubFromRow)
    return [...VENDOR_ORDERS, ...extra]
  }, [rows])

  const defaultPicks = useMemo(() => {
    const names = new Set(universe.map((v) => v.name))
    return defaultBenchmarkPicks().filter((n) => names.has(n))
  }, [universe])

  // 勾选集合（厂商名）：未手动改动前恒等于默认，纯派生、无 effect
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const selected = useMemo(() => {
    if (picked && [...picked].every((n) => universe.some((v) => v.name === n))) return picked
    return new Set(defaultPicks)
  }, [picked, universe, defaultPicks])

  const toggle = (name: string) => {
    const s = new Set(selected)
    if (s.has(name)) {
      if (s.size <= 1) {
        toast("至少保留一个对标对象")
        return
      }
      s.delete(name)
    } else {
      if (s.size >= MAX_PICKS) {
        toast(`最多对比 ${MAX_PICKS} 家`)
        return
      }
      s.add(name)
    }
    setPicked(s)
  }

  const entries = useMemo(() => {
    const arr = universe.filter((v) => selected.has(v.name))
    // 我方永远排首位（与雷达图例、对照表列序一致）
    arr.sort((a, b) => Number(b.name === SELF_NAME) - Number(a.name === SELF_NAME))
    return arr.map((v) => ({
      v,
      color: v.name === SELF_NAME ? CHART_COLORS.warn : RC[universe.indexOf(v) % RC.length],
      scores: orderScores(v),
      row: rows.find((r) => r.name === v.name) ?? null,
    }))
  }, [universe, selected, rows])

  const selfEntry = entries.find((e) => e.v.name === SELF_NAME) ?? null
  const competitors = entries.filter((e) => e.v.name !== SELF_NAME)

  const takeaways = useMemo(() => buildOrderTakeaways(entries.map((e) => e.v)), [entries])

  // 对照表取值：策展档案优先，缺项回退档案库（用户已编辑字段），再缺显示「待补全」
  const profileCell = (e: (typeof entries)[number], r: (typeof PROFILE_ROWS)[number]): string => {
    const pr = VENDOR_PROFILES[e.v.name]
    return (pr?.[r.key] || (r.dbFallback ? String(e.row?.[r.dbFallback] ?? "") : "")) || ""
  }

  // ------------------------------ 订单能力雷达 ------------------------------
  const radarOption = useMemo<EChartsOption>(() => {
    if (entries.length === 0) return {}
    return {
      tooltip: { trigger: "item" },
      legend: {
        data: entries.map((e) => e.v.name),
        bottom: 0,
        textStyle: { fontSize: 10.5, color: CHART_COLORS.ink3 },
        itemWidth: 11,
        itemHeight: 8,
      },
      radar: {
        indicator: ORDER_DIMS.map((name) => ({ name, max: 5 })),
        radius: "58%",
        center: ["50%", "47%"],
        splitNumber: 5,
        axisName: { color: CHART_COLORS.ink3, fontSize: 11 },
        splitArea: { areaStyle: { color: ["#fff", "rgba(14,124,153,.04)"] } },
        axisLine: { lineStyle: { color: CHART_COLORS.track } },
        splitLine: { lineStyle: { color: CHART_COLORS.track } },
      },
      series: [
        {
          type: "radar",
          symbolSize: 4,
          data: entries.map((e) => ({
            value: e.scores,
            name: e.v.name,
            itemStyle: { color: e.color },
            lineStyle: { width: e.v.name === SELF_NAME ? 2.4 : 1.5 },
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
    const csv = buildOrderCompareCsv(entries.map((e) => ({ name: e.v.name, scores: e.scores })))
    triggerBlobDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `竞品订单能力对比_${localDateStamp()}.csv`)
    toast.success("对比矩阵已导出")
  }, [entries])

  const allTalksText = talks.talks.map((t) => `【${t.kind}】${t.title}\n${t.content}`).join("\n\n")

  if (loading) return <p className="py-16 text-center text-sm text-muted-foreground">竞品数据加载中…</p>

  return (
    <div className="space-y-4">
      {/* 顶部：对标对象勾选 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="mr-1 text-sm font-semibold text-foreground">对标对象</span>
          {universe.map((v, i) => {
            const on = selected.has(v.name)
            const color = v.name === SELF_NAME ? CHART_COLORS.warn : RC[i % RC.length]
            return (
              <button
                key={v.name}
                type="button"
                onClick={() => toggle(v.name)}
                className={cn(
                  "flex items-center gap-2 rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition-colors",
                  on
                    ? "border-primary bg-primary/5 font-semibold text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {v.name}
                {v.bid5y == null && <span className="text-[10px] text-muted-foreground">参考</span>}
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

      {/* 对比重点（订单口径，自动提炼，零 AI） */}
      {takeaways.length > 0 ? (
        <Card className="border-primary/30 bg-primary/[0.04]">
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary">
              <Crosshair className="h-3.5 w-3.5" />
              对比重点（订单口径 · 售前 2 分钟看清机会、差距、防谁）
            </p>
            <ul className="space-y-1.5 text-sm leading-relaxed text-foreground">
              {takeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      t.kind === "opportunity" ? "bg-green-500" : t.kind === "gap" ? "bg-destructive" : "bg-amber-500",
                    )}
                  />
                  <span>
                    {t.kind === "opportunity" ? (
                      <strong className="font-semibold text-green-700">机会·</strong>
                    ) : t.kind === "gap" ? (
                      <strong className="font-semibold text-destructive">差距·</strong>
                    ) : (
                      <strong className="font-semibold text-amber-700">防·</strong>
                    )}
                    {t.text}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-3 text-[12.5px] text-muted-foreground">
            在上方勾选我方（{SELF_NAME}）可自动提炼「机会 / 差距 / 防」对比重点。
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* 左：雷达 + 关键评估指标对照表 */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  订单能力雷达
                </span>
                <span className="text-[11px] font-normal text-muted-foreground">真实订单归一化 · 5 分制（最多 {MAX_PICKS} 家）</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <p className="py-20 text-center text-sm text-muted-foreground">请在上方勾选至少一个对标对象</p>
              ) : (
                <EChart option={radarOption} height={340} />
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                无订单口径数据的厂商以软著规模做参考位（封顶 2 分），不代表真实订单能力。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">关键评估指标对照</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="min-w-[80px] border-b-2 border-border px-2 py-2 text-left text-xs font-semibold text-muted-foreground">
                      评估指标
                    </th>
                    {entries.map((e) => (
                      <th
                        key={e.v.name}
                        className="min-w-[150px] border-b-2 border-border px-2 py-2 text-left text-xs font-semibold"
                        style={{ color: e.color }}
                      >
                        {e.v.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PROFILE_ROWS.map((r) => (
                    <tr key={r.label}>
                      <td className="border-b border-border/60 px-2 py-2 font-medium text-foreground">{r.label}</td>
                      {entries.map((e) => {
                        const val = profileCell(e, r)
                        return (
                          <td
                            key={e.v.name}
                            className="border-b border-border/60 px-2 py-2 align-top text-[11.5px] leading-relaxed text-muted-foreground"
                          >
                            {val || <span className="text-muted-foreground/60">待补全</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                定性内容据订单分析 PPT 关键评估指标整理，正式版需人工核验；空白处可在厂商档案中编辑补全。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 右：AI 差异化话术（沿用档案库数据） */}
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
                disabled={talks.loading || !modelRef || !selfEntry?.row || competitors.every((e) => !e.row)}
                onClick={() =>
                  void talks.runTalks(
                    selfEntry?.row ?? null,
                    competitors.map((e) => e.row).filter((r): r is CompetitorRow => r !== null),
                  )
                }
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
                  {competitors.every((e) => !e.row) ? "勾选的竞品尚无档案数据" : "生成对抗话术"}
                </p>
                <p className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
                  基于勾选竞品档案与订单能力对比，AI 生成可直接粘贴至方案/标书的差异化话术。
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
                  <button
                    type="button"
                    className="mt-1.5 text-[11px] text-primary hover:underline"
                    onClick={() => onOpenArchive(SELF_NAME)}
                  >
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
                {entries.map((e) => e.v.name).join(" / ")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
