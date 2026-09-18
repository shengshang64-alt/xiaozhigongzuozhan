import { useMemo } from "react"
import { Loader2, BarChart3 } from "lucide-react"
import type { EChartsOption } from "echarts"
import { EChart } from "@/components/common/EChart"
import { CHART_COLORS, FUNNEL_STAGE_COLORS } from "@/lib/echarts"
import type { FunnelDatum } from "@/pages/Home/useHome"

type FunnelCardProps = {
  /** 各在跟阶段的商机数（顺序即展示顺序：线索 → 投标） */
  data: FunnelDatum[]
  /** 全部商机条数（含终态），用于「共 N 条商机」标签 */
  total: number
  loading: boolean
}

/**
 * 商机阶段分布（漏斗）——echarts 横向条形，绑定 useHome 真实商机 stage 计数。
 * 数据全为 0（新用户 / 未建商机）时展示空状态，不画空图。
 */
export function FunnelCard({ data, total, loading }: FunnelCardProps) {
  const option = useMemo<EChartsOption>(() => {
    const list = data.map((d, i) => ({
      name: d.name,
      value: d.value,
      itemStyle: { color: FUNNEL_STAGE_COLORS[i % FUNNEL_STAGE_COLORS.length] },
    }))
    return {
      grid: { left: 8, right: 40, top: 6, bottom: 4, containLabel: true },
      tooltip: { trigger: "item", formatter: "{b}: {c} 条" },
      xAxis: { type: "value", show: false },
      yAxis: {
        type: "category",
        inverse: true,
        data: list.map((d) => d.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: CHART_COLORS.ink3, fontSize: 12 },
      },
      series: [
        {
          type: "bar",
          barWidth: 18,
          data: list,
          label: {
            show: true,
            position: "right",
            formatter: (p) => `${p.value} 条`,
            color: CHART_COLORS.ink3,
            fontSize: 11.5,
          },
          itemStyle: { borderRadius: [0, 9, 9, 0] },
        },
      ],
    }
  }, [data])

  const hasData = data.some((d) => d.value > 0)

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <BarChart3 className="h-4 w-4 text-primary" />
          商机阶段分布
        </h2>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          共 {total} 条商机
        </span>
      </header>

      <div className="mt-2 flex-1">
        {loading ? (
          <div className="flex h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            商机分布加载中…
          </div>
        ) : !hasData ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">还没有在跟商机</p>
            <p className="text-xs text-muted-foreground">去客户管理创建商机，阶段分布会自动汇总到这里</p>
          </div>
        ) : (
          <EChart option={option} height={240} />
        )}
      </div>
    </section>
  )
}
