// 竞品分析图形化总览：KPI 摘要 + 软著布局排行（条形，点击跳转）+ 软著规模占比（环形）。
// 数据全部来自已录入竞品档案（软著数为可核对事实），不臆造任何指标；纯前端聚合，零 AI/后端成本。
import { useMemo } from "react"
import type { EChartsOption } from "echarts"
import { Building2, FileBadge, Gauge, ListChecks, TrendingUp } from "lucide-react"
import { EChart } from "@/components/common/EChart"
import { CHART_COLORS } from "@/lib/echarts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { enrichProgress, type CompetitorRow } from "@/pages/Competitors/competitorsCore"

/** 我方基线厂商（图中以强调色区分） */
const SELF_NAME = "智业软件"
/** 排行条形图最多展示条数（超出折叠，保持可读） */
const TOP_BAR_LIMIT = 16

const PIE_COLORS = ["#0E7C99", "#3CAEC4", "#0A5D76", "#7FBAC8", "#9CC9D4", "#E8973C", "#4A6169", "#C6DCE3"]
const OTHERS_COLOR = "#E2ECEE"

function KpiItem({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-md " + (accent ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground")}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-base font-semibold leading-tight text-foreground tabular-nums">
          {value}
          {hint && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{hint}</span>}
        </p>
      </div>
    </div>
  )
}

export function CompetitorCharts({ rows, loading, selectedId, onSelect }: { rows: CompetitorRow[]; loading: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + (r.software_copyrights || 0), 0)
    const count = rows.length
    const avg = count ? Math.round(total / count) : 0
    const desc = [...rows].sort((a, b) => b.software_copyrights - a.software_copyrights)
    const selfIdx = desc.findIndex((r) => r.name === SELF_NAME)
    const needFill = rows.filter((r) => enrichProgress(r).filled < 4).length
    return { total, count, avg, selfRank: selfIdx >= 0 ? selfIdx + 1 : 0, selfTotal: count, needFill }
  }, [rows])

  const barOption = useMemo<EChartsOption>(() => {
    const desc = [...rows].sort((a, b) => b.software_copyrights - a.software_copyrights)
    const shown = desc.slice(0, TOP_BAR_LIMIT)
    const data = shown.map((r) => {
      const isSelf = r.name === SELF_NAME
      const isActive = r.id === selectedId
      return {
        name: r.name,
        value: r.software_copyrights,
        id: r.id,
        itemStyle: {
          color: isSelf ? CHART_COLORS.warn : isActive ? CHART_COLORS.primaryDeep : CHART_COLORS.primary,
          borderRadius: [0, 6, 6, 0] as [number, number, number, number],
          opacity: isActive || isSelf ? 1 : 0.82,
        },
      }
    })
    return {
      grid: { left: 8, right: 56, top: 6, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const name = String((p as { name?: unknown }).name ?? "")
          const val = Number((p as { value?: unknown }).value) || 0
          return `${name}${name === SELF_NAME ? "（我方）" : ""}：${val.toLocaleString()} 项软著`
        },
      },
      xAxis: { type: "value", show: false },
      yAxis: {
        type: "category",
        inverse: true,
        data: data.map((d) => d.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: CHART_COLORS.ink3,
          fontSize: 12,
          formatter: (name: string, index: number) => {
            const label = `${index + 1}. ${name}`
            return name === SELF_NAME ? `{self|${label}}` : label
          },
          rich: { self: { color: CHART_COLORS.warn, fontWeight: "bold" } },
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 16,
          cursor: "pointer",
          data,
          label: { show: true, position: "right", formatter: (p) => (Number(p.value) || 0).toLocaleString(), color: CHART_COLORS.ink, fontSize: 12, fontWeight: "bold" },
        },
      ],
    }
  }, [rows, selectedId])

  const donutOption = useMemo<EChartsOption>(() => {
    const desc = [...rows].sort((a, b) => b.software_copyrights - a.software_copyrights)
    const top = desc.slice(0, 7)
    const restCount = desc.length - top.length
    const restSum = desc.slice(7).reduce((s, r) => s + (r.software_copyrights || 0), 0)
    const data = top.map((r, i) => ({ name: r.name, value: r.software_copyrights, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } }))
    if (restCount > 0 && restSum > 0) data.push({ name: `其他 ${restCount} 家`, value: restSum, itemStyle: { color: OTHERS_COLOR } })
    return {
      tooltip: { trigger: "item", formatter: "{b}：{c} 项（{d}%）" },
      legend: { type: "scroll", orient: "vertical", right: 0, top: "middle", itemWidth: 10, itemHeight: 10, textStyle: { color: CHART_COLORS.ink3, fontSize: 11 } },
      series: [
        {
          type: "pie",
          radius: ["48%", "74%"],
          center: ["34%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data,
        },
      ],
      graphic: {
        type: "text",
        left: "34%",
        top: "middle",
        style: { text: `${stats.total.toLocaleString()}\n软著合计`, textAlign: "center", fill: CHART_COLORS.ink, fontSize: 13, fontWeight: "bold", lineHeight: 18 },
      },
    }
  }, [rows, stats.total])

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">图表数据加载中…</p>
  }
  if (rows.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">没有匹配的竞品，试试调整搜索关键词。</p>
  }

  const barHeight = Math.max(280, Math.min(rows.length, TOP_BAR_LIMIT) * 30 + 30)

  return (
    <div className="space-y-4">
      {/* KPI 摘要 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <KpiItem icon={<Building2 className="h-4 w-4" />} label="竞品厂商" value={`${stats.count}`} hint="家" />
        <KpiItem icon={<FileBadge className="h-4 w-4" />} label="软著合计" value={stats.total.toLocaleString()} hint="项" accent />
        <KpiItem icon={<Gauge className="h-4 w-4" />} label="平均软著" value={stats.avg.toLocaleString()} hint="项/家" />
        <KpiItem
          icon={<TrendingUp className="h-4 w-4" />}
          label={`我方排位（${SELF_NAME}）`}
          value={stats.selfRank ? `第 ${stats.selfRank}` : "—"}
          hint={stats.selfRank ? `/ ${stats.selfTotal}` : "未入库"}
          accent
        />
        <KpiItem icon={<ListChecks className="h-4 w-4" />} label="档案待完善" value={`${stats.needFill}`} hint="家" />
      </div>

      {/* 排行 + 占比 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>软著布局排行</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: CHART_COLORS.warn }} />
                橙色为 · {SELF_NAME}（点击条形查看档案）
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EChart
              option={barOption}
              height={barHeight}
              onEvents={{ click: (p) => { const id = (p as { data?: { id?: string } }).data?.id; if (id) onSelect(id) } }}
            />
            {stats.count > TOP_BAR_LIMIT && (
              <p className="mt-1 text-center text-[11px] text-muted-foreground">仅展示软著数前 {TOP_BAR_LIMIT} 家，共 {stats.count} 家</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">软著规模占比</CardTitle>
          </CardHeader>
          <CardContent>
            <EChart option={donutOption} height={barHeight} />
            <p className="mt-1 text-center text-[11px] text-muted-foreground">前 7 家 + 其他，反映各厂商知识产权布局的相对体量</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
