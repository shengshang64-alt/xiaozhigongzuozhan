import { useEffect, useRef } from "react"
import type { EChartsOption } from "echarts"
import { echarts } from "@/lib/echarts"

type EChartProps = {
  /** echarts 配置；引用变化时会 setOption（组件内用 useMemo 稳定引用以免每帧重绘） */
  option: EChartsOption
  className?: string
  /** 容器高度，默认 240px */
  height?: number | string
  /** echarts 事件回调（如 click）；挂载时按 key 绑定，回调用最新引用，事件名需保持稳定 */
  onEvents?: Record<string, (params: unknown) => void>
}

/**
 * ECharts React 封装：挂载时 init，option 变化时整图替换（notMerge），
 * ResizeObserver 自适应父容器宽度，卸载时 dispose 释放实例，避免内存泄漏。
 */
export function EChart({ option, className, height = 240, onEvents }: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const eventsRef = useRef(onEvents)
  useEffect(() => {
    eventsRef.current = onEvents
  }, [onEvents])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = echarts.init(host)
    chartRef.current = chart
    for (const name of Object.keys(eventsRef.current ?? {})) {
      chart.on(name, (params) => eventsRef.current?.[name]?.(params))
    }
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
