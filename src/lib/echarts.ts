// ECharts 公共封装：统一按需注册图表/组件 + 与工作台主题一致的默认配色。
// 只注册首页与后续工作页用到的图表类型（bar/pie/funnel），避免全量引入撑大打包体积。
import * as echarts from "echarts/core"
import { BarChart, PieChart, FunnelChart, LineChart, RadarChart } from "echarts/charts"
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
  TitleComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"

echarts.use([
  BarChart,
  PieChart,
  FunnelChart,
  LineChart,
  RadarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
  TitleComponent,
  CanvasRenderer,
])

// 与 index.css 主题令牌对应的十六进制色板（echarts 不读 CSS 变量，需显式给出）。
export const CHART_COLORS = {
  primary: "#0E7C99",
  primaryDeep: "#0A5D76",
  ink: "#122A31",
  ink3: "#4A6169",
  danger: "#D9534F",
  dangerSoft: "#F3D9D7",
  warn: "#E8973C",
  track: "#E2ECEE",
} as const

// 商机漏斗（阶段分布）配色：由浅青灰渐变到品牌青蓝，阶段越靠后越深。
export const FUNNEL_STAGE_COLORS = [
  "#C6DCE3",
  "#9CC9D4",
  "#7FBAC8",
  "#3CAEC4",
  "#0E7C99",
] as const

export { echarts }
