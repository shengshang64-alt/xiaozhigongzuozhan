// 市场总览视图（订单口径）：数据口径 banner + 2025 大盘四卡 + 五年中标排行 / 年度趋势 / 金额区间结构。
// 数据全部来自 marketIntel 策展数据集（剑鱼标讯 2021–2025），纯前端渲染，零 AI/后端成本。
import { useMemo } from "react"
import type { EChartsOption } from "echarts"
import { BarChart3, Building2, Lightbulb, Star } from "lucide-react"
import { EChart } from "@/components/common/EChart"
import { CHART_COLORS } from "@/lib/echarts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DATA_CALIBER,
  MARKET_AMOUNT_MIX,
  MARKET_CARDS,
  MARKET_TREND,
  SELF_NAME,
  coreVendors,
} from "@/pages/Competitors/marketIntel"

const CARD_ICONS = [Building2, BarChart3, Lightbulb, Star]

export function CompetitorOverview({ onOpenVendor }: { onOpenVendor: (name: string) => void }) {
  const rankOption = useMemo<EChartsOption>(() => {
    const arr = coreVendors()
    const data = arr.map((v) => {
      const s = v.name === SELF_NAME
      return {
        name: v.name,
        value: v.bid5y,
        itemStyle: {
          color: s ? CHART_COLORS.warn : CHART_COLORS.primary,
          borderRadius: [0, 6, 6, 0] as [number, number, number, number],
          opacity: s ? 1 : 0.85,
        },
      }
    })
    return {
      grid: { left: 10, right: 64, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const name = String((p as { name?: unknown }).name ?? "")
          const val = Number((p as { value?: unknown }).value) || 0
          return `${name}${name === SELF_NAME ? "（我方）" : ""}：${(val / 10000).toFixed(2)} 亿元`
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
          formatter: (n: string) => (n === SELF_NAME ? `{self|${n}（我方）}` : n),
          rich: { self: { color: CHART_COLORS.warn, fontWeight: "bold" } },
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 15,
          cursor: "pointer",
          data,
          label: {
            show: true,
            position: "right",
            formatter: (p) => `${((Number(p.value) || 0) / 10000).toFixed(1)}亿`,
            color: CHART_COLORS.ink,
            fontSize: 11.5,
            fontWeight: "bold",
          },
        },
      ],
    }
  }, [])

  const trendOption = useMemo<EChartsOption>(() => {
    return {
      grid: { left: 8, right: 16, top: 26, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p) => {
          const item = (Array.isArray(p) ? p[0] : p) as { name?: unknown; value?: unknown }
          return `${item.name}：${item.value} 亿元`
        },
      },
      xAxis: {
        type: "category",
        data: MARKET_TREND.years,
        axisLine: { lineStyle: { color: "#CFD9DD" } },
        axisTick: { show: false },
        axisLabel: { color: CHART_COLORS.ink3 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9AA8AD", fontSize: 10.5 },
        splitLine: { lineStyle: { color: "#EEF2F4" } },
      },
      series: [
        {
          type: "bar",
          barWidth: 26,
          data: MARKET_TREND.values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: i === MARKET_TREND.highlightIndex ? CHART_COLORS.warn : CHART_COLORS.primary,
              borderRadius: [5, 5, 0, 0] as [number, number, number, number],
            },
          })),
          label: { show: true, position: "top", color: CHART_COLORS.ink3, fontSize: 10.5 },
        },
      ],
    }
  }, [])

  const mixOption = useMemo<EChartsOption>(() => {
    const cols = ["#BCD4DB", "#7FB4C2", "#3CAEC4", "#0E7C99"]
    return {
      grid: { left: 8, right: 16, top: 30, bottom: 22, containLabel: true },
      tooltip: { trigger: "item", formatter: "{a}：{c}%" },
      legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: CHART_COLORS.ink3, fontSize: 11 } },
      xAxis: { type: "value", max: 100, show: false },
      yAxis: {
        type: "category",
        data: ["金额占比"],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: CHART_COLORS.ink3, fontSize: 11.5 },
      },
      series: MARKET_AMOUNT_MIX.map((s, i) => ({
        name: s.label,
        type: "bar" as const,
        stack: "t",
        barWidth: 34,
        data: [s.value],
        itemStyle: { color: cols[i] },
        label: { show: true, formatter: `${s.value}%`, color: "#fff", fontSize: 10.5 },
      })),
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* 数据口径 banner */}
      <div className="rounded-[14px] border border-[#f0d9b8] bg-[#fdf6ea] px-4 py-3 text-[12.5px] leading-relaxed text-[#7a5a28]">
        <span className="font-bold text-[#a86a1a]">数据口径：</span>
        {DATA_CALIBER.replace(/^数据口径：/, "")}
      </div>

      {/* 2025 大盘四卡 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MARKET_CARDS.map((c, i) => {
          const Icon = CARD_ICONS[i] ?? BarChart3
          const accent = "accent" in c && c.accent
          return (
            <Card key={c.label} className={accent ? "border-[#f0d9b8] bg-[#fffaf2]" : undefined}>
              <CardContent className="px-4 py-3.5">
                <p className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Icon className={"h-3.5 w-3.5 " + (accent ? "text-[#e8973c]" : "text-primary")} />
                  {c.label}
                </p>
                <p className={"text-[26px] font-bold leading-tight tabular-nums " + (accent ? "text-[#e8973c]" : "text-foreground")}>
                  {c.value}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">{c.unit}</span>
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{c.hint}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 五年中标排行 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-primary" />
              五年中标金额排行
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">2021–2025 · 点击条形查看档案</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EChart
            option={rankOption}
            height={Math.max(360, coreVendors().length * 30 + 20)}
            onEvents={{
              click: (p) => {
                const name = String((p as { name?: unknown }).name ?? "")
                if (name) onOpenVendor(name)
              },
            }}
          />
        </CardContent>
      </Card>

      {/* 年度趋势 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>行业年度中标趋势</span>
            <span className="text-[11px] font-normal text-muted-foreground">15 家核心厂商口径 · 亿元（橙色为 2024 见底年）</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EChart option={trendOption} height={260} />
        </CardContent>
      </Card>

      {/* 金额区间结构 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>订单金额区间结构</span>
            <span className="text-[11px] font-normal text-muted-foreground">2025 · 金额占比</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EChart option={mixOption} height={140} />
        </CardContent>
      </Card>
    </div>
  )
}
