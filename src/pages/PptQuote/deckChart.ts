import { echarts } from "@/lib/echarts"
import type { SlideChart } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// PPT 图表：把 SlideChart 归一为 ECharts option，供预览与导出（导出渲染成 PNG 内嵌 .pptx）
// 配色与导出 PPT 的商务色一致（NAVY/ACCENT 系），不受站内主题 token 约束。
// ---------------------------------------------------------------------------

const EXPORT_PALETTE = ["2E74B5", "1F3864", "5B9BD5", "8FAADC", "C5D5E8", "375623"]

function hex(c: string): string {
  return "#" + c
}

function seriesColor(i: number): string {
  return hex(EXPORT_PALETTE[i % EXPORT_PALETTE.length])
}

/** 生成 ECharts option；exportMode=true 关闭动画、加深文字，便于截图内嵌 */
export function buildDeckChartOption(chart: SlideChart, exportMode = false): Record<string, unknown> {
  const categories = chart.categories ?? []
  const seriesList = chart.series ?? []
  const nameGap = 26
  const axisCommon = {
    axisLine: { lineStyle: { color: "#9AA7B5" } },
    axisLabel: { color: "#333333", fontSize: exportMode ? 14 : 12, interval: 0, rotate: categories.length > 6 ? 30 : 0 },
  }
  const series = seriesList.map((s, i) => {
    const color = seriesColor(i)
    if (chart.type === "pie") {
      return {
        name: s.name || chart.title || "占比",
        type: "pie",
        radius: ["42%", "68%"],
        center: ["50%", "54%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { color: "#333333", fontSize: exportMode ? 14 : 12, formatter: "{b}: {d}%" },
        data: categories.map((c, ci) => ({ name: c, value: s.data[ci] ?? 0 })),
      }
    }
    if (chart.type === "line") {
      return {
        name: s.name || "系列" + (i + 1),
        type: "line",
        smooth: true,
        symbolSize: exportMode ? 8 : 6,
        lineStyle: { width: 3, color },
        itemStyle: { color },
        areaStyle: { opacity: 0.08 },
        data: s.data,
      }
    }
    return {
      name: s.name || "系列" + (i + 1),
      type: "bar",
      barMaxWidth: exportMode ? 60 : 44,
      itemStyle: { color, borderRadius: [4, 4, 0, 0] },
      label: { show: seriesList.length <= 2, position: "top", color: "#333333", fontSize: exportMode ? 13 : 11 },
      data: s.data,
    }
  })

  const option: Record<string, unknown> = {
    animation: !exportMode,
    color: EXPORT_PALETTE.map(hex),
    title: chart.title
      ? { text: chart.title, left: "center", top: 6, textStyle: { color: "#1F3864", fontSize: exportMode ? 20 : 15 } }
      : undefined,
    tooltip: exportMode ? { show: false } : { trigger: chart.type === "pie" ? "item" : "axis" },
    legend:
      chart.type === "pie" || seriesList.length > 1
        ? { bottom: 4, textStyle: { color: "#333333", fontSize: exportMode ? 14 : 12 }, data: chart.type === "pie" ? categories : seriesList.map((s, i) => s.name || "系列" + (i + 1)) }
        : undefined,
    grid: chart.type === "pie" ? undefined : { left: 56, right: 28, top: chart.title ? 56 : 28, bottom: seriesList.length > 1 ? 52 : nameGap - 6, containLabel: true },
    xAxis: chart.type === "pie" ? { show: false } : { type: "category", data: categories, ...axisCommon },
    yAxis: chart.type === "pie" ? { show: false } : { type: "value", name: chart.unit || "", nameTextStyle: { color: "#9AA7B5" }, axisLine: { show: false }, splitLine: { lineStyle: { color: "#E4EDEA" } }, axisLabel: { color: "#333333", fontSize: exportMode ? 14 : 12 } },
    series,
  }
  return option
}

/** 把图表渲染成 PNG dataURL（导出内嵌用）；离屏 canvas，同步渲染 */
export function renderDeckChartPng(chart: SlideChart, widthPx = 900, heightPx = 520): string {
  const holder = document.createElement("div")
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:${heightPx}px;`
  document.body.appendChild(holder)
  const inst = echarts.init(holder, undefined, { width: widthPx, height: heightPx })
  try {
    inst.setOption({ backgroundColor: "#FFFFFF", ...buildDeckChartOption(chart, true) })
    return inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#FFFFFF" })
  } finally {
    inst.dispose()
    holder.remove()
  }
}
