import { useNavigate } from "react-router-dom"
import { CalendarClock, ChevronRight, Radar, ShieldAlert, type LucideIcon } from "lucide-react"
import type { KeyMetricSpec } from "@/pages/Home/homeLayout"

// Phase 1 改版：三张关键指标卡（资质预警 / 情报待确认 / 最近投标截止）。
// 数据与文案全部来自 homeLayout.keyMetricsOf（真实计数 + 说清口径），本组件只做展示与跳转：
// qual → 资质台账，intel → 情报中心，deadline → 打开项目详情弹框（由 HomePage 注入回调）。

const METRIC_ICONS: Record<KeyMetricSpec["key"], LucideIcon> = {
  qual: ShieldAlert,
  intel: Radar,
  deadline: CalendarClock,
}

const TONE_STYLES: Record<KeyMetricSpec["severity"], { bar: string; chip: string; text: string }> = {
  danger: { bar: "bg-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive" },
  warning: { bar: "bg-warning", chip: "bg-warning/10 text-warning", text: "text-warning" },
  info: { bar: "bg-primary", chip: "bg-primary/10 text-primary", text: "text-primary" },
}

type NewKeyMetricsProps = {
  metrics: KeyMetricSpec[]
  loading?: boolean
  /** 「最近投标截止」卡点击时打开对应项目详情（其余两卡走站内路由） */
  onOpenDeadlineProject: () => void
}

export function NewKeyMetrics({ metrics, loading = false, onOpenDeadlineProject }: NewKeyMetricsProps) {
  const navigate = useNavigate()
  return (
    <section aria-label="今日关键指标" className="mb-4 grid gap-4 md:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = METRIC_ICONS[metric.key]
        const tone = TONE_STYLES[metric.severity]
        const open = () => {
          if (metric.key === "deadline") onOpenDeadlineProject()
          else if (metric.key === "qual") navigate("/qual-certs")
          else navigate("/intel-center")
        }
        return (
          <button
            key={metric.key}
            type="button"
            onClick={open}
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 text-left shadow-md transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:p-5"
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} aria-hidden="true" />
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {metric.title}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              {loading ? (
                <span className="h-8 w-14 animate-pulse rounded bg-muted" aria-hidden="true" />
              ) : (
                <span
                  className={`text-3xl font-bold leading-none tabular-nums ${
                    metric.severity === "danger" ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {metric.value ?? "—"}
                </span>
              )}
              {metric.unit ? <span className="text-sm text-muted-foreground">{metric.unit}</span> : null}
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground" title={metric.detail}>
              {metric.detail}
            </p>
            <span
              className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${tone.text} opacity-90 transition-opacity group-hover:opacity-100`}
            >
              {metric.actionLabel}
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </button>
        )
      })}
    </section>
  )
}
