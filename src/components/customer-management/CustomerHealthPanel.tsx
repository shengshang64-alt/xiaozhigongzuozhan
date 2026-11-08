import { useMemo, useState } from "react"
import { Activity, Building2, ClipboardList, Sparkles } from "lucide-react"
import { computeMissingFields, type CustomerRow } from "@/pages/CustomerManagement/customerTypes"
import { normalizeHospitalLevel } from "@/pages/CustomerManagement/customerNormalize"

// UX-R2: 客户管理 已按 docs/ux-review-2026-11 修复 2026-11-07（未选客户时的右栏默认态：
// 客户健康度总览——30 天未跟进数 / 档案完整度分布 / 最近新增 Top5，全部由已加载客户数据派生）。

const DAY_MS = 86_400_000
const STALE_DAYS = 30

/** 完整度分桶口径：齐全 / 轻缺（1-3 项）/ 中缺（4-6 项）/ 重缺（7 项以上） */
type CompletenessBucket = "full" | "light" | "medium" | "heavy"

function completenessBucketOf(missingCount: number): CompletenessBucket {
  if (missingCount <= 0) return "full"
  if (missingCount <= 3) return "light"
  if (missingCount <= 6) return "medium"
  return "heavy"
}

const COMPLETENESS_BUCKETS: { key: CompletenessBucket; label: string; bar: string; text: string }[] = [
  { key: "full", label: "字段齐全", bar: "bg-emerald-500", text: "text-emerald-600" },
  { key: "light", label: "轻缺 1-3 项", bar: "bg-primary", text: "text-primary" },
  { key: "medium", label: "中缺 4-6 项", bar: "bg-amber-500", text: "text-amber-600" },
  { key: "heavy", label: "重缺 7 项+", bar: "bg-destructive", text: "text-destructive" },
]

type CustomerHealthPanelProps = {
  customers: CustomerRow[]
  /** 汇总是否只覆盖已加载部分（分页未拉满时如实标注，不谎称全量） */
  partial: boolean
  totalCount: number | null
  onSelectCustomer: (id: string) => void
  onNewCustomer: () => void
}

export function CustomerHealthPanel({ customers, partial, totalCount, onSelectCustomer, onNewCustomer }: CustomerHealthPanelProps) {
  // 渲染期禁止直接调 Date.now()（react-hooks/purity）——挂载时取一次即可（30 天粒度不要求实时）
  const [nowMs] = useState(() => Date.now())
  const health = useMemo(() => {
    let stale30 = 0
    const byBucket: Record<CompletenessBucket, number> = { full: 0, light: 0, medium: 0, heavy: 0 }
    for (const c of customers) {
      const followed = c.last_follow_at ? Date.parse(c.last_follow_at.replace(" ", "T")) : NaN
      if (Number.isNaN(followed) || nowMs - followed > STALE_DAYS * DAY_MS) stale30 += 1
      byBucket[completenessBucketOf(computeMissingFields(c).length)] += 1
    }
    const recent = [...customers]
      .sort((a, b) => String(b.created ?? "").localeCompare(String(a.created ?? "")))
      .slice(0, 5)
    return { stale30, byBucket, recent }
  }, [customers, nowMs])

  const total = customers.length
  if (total === 0) {
    return (
      <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center shadow-md">
        <Building2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">从左侧选一位客户查看档案与商机</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          客户详情里可以补档案、加联系人、记跟进、开商机，并用 AI 生成下一步跟进建议
        </p>
        <button
          type="button"
          onClick={onNewCustomer}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          登记第一位客户
        </button>
      </div>
    )
  }

  return (
    <section
      aria-label="客户健康度总览"
      className="flex h-full flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-md"
    >
      <header className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Activity className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">客户健康度总览</h2>
          <p className="text-xs text-muted-foreground">
            {partial
              ? `基于已加载的 ${total} 家客户（列表未拉满，数字为下限）`
              : `基于全部 ${totalCount ?? total} 家客户`}
          </p>
        </div>
      </header>

      {/* 30 天未跟进 */}
      <div
        className={`rounded-lg border p-4 ${
          health.stale30 > 0 ? "border-amber-400/50 bg-amber-500/5" : "border-border bg-background"
        }`}
      >
        <p className="text-xs text-muted-foreground">超 30 天未跟进</p>
        <p className={`mt-1 text-3xl font-bold tabular-nums ${health.stale30 > 0 ? "text-amber-600" : "text-foreground"}`}>
          {health.stale30}
          <span className="ml-1 text-sm font-medium">家</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {health.stale30 > 0 ? "售前黄金法则：每 30 天必须触达一次——点左侧客户卡片去记跟进" : "每家客户 30 天内都有跟进记录，保持节奏"}
        </p>
      </div>

      {/* 档案完整度分布条 */}
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <ClipboardList className="h-3.5 w-3.5 text-primary" />
          档案完整度分布
        </p>
        <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img"
          aria-label={COMPLETENESS_BUCKETS.map((b) => `${b.label} ${health.byBucket[b.key]} 家`).join("，")}>
          {COMPLETENESS_BUCKETS.map((b) => {
            const n = health.byBucket[b.key]
            if (n === 0) return null
            return <div key={b.key} className={b.bar} style={{ width: `${(n / total) * 100}%` }} title={`${b.label} ${n} 家`} />
          })}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {COMPLETENESS_BUCKETS.map((b) => (
            <li key={b.key} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${b.bar}`} aria-hidden="true" />
              {b.label} <span className="font-medium text-foreground tabular-nums">{health.byBucket[b.key]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          点客户卡片上的「缺 N 项」角标，可看具体缺什么并逐项去补全
        </p>
      </div>

      {/* 最近新增 Top5 */}
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          最近新增客户 Top5
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {health.recent.map((c, i) => {
            const missing = computeMissingFields(c).length
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectCustomer(c.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={c.hospital_name}>
                    {c.hospital_name}
                  </span>
                  {c.level ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{normalizeHospitalLevel(c.level)}</span>
                  ) : null}
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      missing === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                    }`}
                  >
                    {missing === 0 ? "✓ 完整" : `缺 ${missing} 项`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
