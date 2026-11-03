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
  // 延迟初始化期间的最新 option 快照：ResizeObserver 拿到非零尺寸后 init 时用
  const optionRef = useRef(option)
  useEffect(() => {
    eventsRef.current = onEvents
  }, [onEvents])
  useEffect(() => {
    optionRef.current = option
    // 图表可能还没 init（在等容器尺寸），此时先记快照，init 后统一应用
    chartRef.current?.setOption(option, true)
  }, [option])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // 延迟初始化：父容器可能尚未完成布局（首帧/标签页切换/弹层动画），
    // 此时 clientWidth/clientHeight 为 0，echarts.init 会刷「Can't get DOM width or height」
    // 且图表永远停留在 0 尺寸。改为在 ResizeObserver 首次拿到非零尺寸后再 init。
    let chart: echarts.ECharts | null = null
    let disposed = false
    const bindEvents = (inst: echarts.ECharts) => {
      for (const name of Object.keys(eventsRef.current ?? {})) {
        inst.on(name, (params) => eventsRef.current?.[name]?.(params))
      }
    }
    const ro = new ResizeObserver(() => {
      if (disposed) return
      if (!chart) {
        const w = host.clientWidth
        const h = host.clientHeight
        if (w <= 0 || h <= 0) return // 等下一轮回调
        chart = echarts.init(host)
        chartRef.current = chart
        bindEvents(chart)
        if (optionRef.current) chart.setOption(optionRef.current, true)
      }
      chart.resize()
    })
    ro.observe(host)
    return () => {
      disposed = true
      ro.disconnect()
      chart?.dispose()
      chartRef.current = null
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ height: typeof height === "number" ? `${height}px` : height, width: "100%" }}
    />
  )
}
