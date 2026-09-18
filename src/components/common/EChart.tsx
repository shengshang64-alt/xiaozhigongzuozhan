import { useEffect, useRef } from "react"
import type { EChartsOption } from "echarts"
import { echarts } from "@/lib/echarts"

type EChartProps = {
  /** echarts 配置；引用变化时会 setOption（组件内用 useMemo 稳定引用以免每帧重绘） */
  option: EChartsOption
  className?: string
  /** 容器高度，默认 240px */
  height?: number | string
}

/**
 * ECharts React 封装：挂载时 init，option 变化时整图替换（notMerge），
 * ResizeObserver 自适应父容器宽度，卸载时 dispose 释放实例，避免内存泄漏。
 */
export function EChart({ option, className, height = 240 }: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = echarts.init(host)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(host)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, true)
  }, [option])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ height: typeof height === "number" ? `${height}px` : height, width: "100%" }}
    />
  )
}
