// 模型配置 · 健康看板
//
// 能接的真数据只有两路：
//   ① lib/modelHealth 的「实测不可用」档案 → 「失败告警」
//   ② 配置本身（通道、模型、启用态）→ 模型清单里的通道 / 失败原因
// 调用量、延迟、费用、缓存、趋势需要按次调用台账，现网网关不落库，本屏不再摆
// 「—」指标壳和空趋势图（看起来能筛选、其实查不到）。
// TODO:metrics —— 待后端提供 /api/model/stats 后再把统计接回来。
import { useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState } from "@/components/common/DataStates"
import { formatDateTime } from "@/lib/dateDisplay"
import { healthShortLabel, type ModelHealthEntry } from "@/lib/modelHealth"
import { buildHealthAlerts, summarizeHealthAlerts, type HealthAlertTarget } from "@/lib/modelHealthAlerts"
import { cn } from "@/lib/utils"
import type { useModelConfig } from "@/pages/ModelConfig/useModelConfig"

type Props = {
  p: ReturnType<typeof useModelConfig>
  /** 回「通道与默认」子屏（空态 CTA 与告警处置都用它） */
  onGoChannels: () => void
}

type ModelRow = {
  key: string
  configId: string
  configName: string
  isPlatform: boolean
  enabled: boolean
  isChannelDefault: boolean
  modelId: string
  health: ModelHealthEntry | null
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
        <div className="flex-1" />
        {right}
      </header>
      {children}
    </section>
  )
}

export function HealthBoard({ p, onGoChannels }: Props) {
  const [byReason, setByReason] = useState(false)
  const [page, setPage] = useState(1)

  const toggleByReason = () => {
    setByReason((v) => !v)
    setPage(1)
  }

  const configs = useMemo(() => {
    return [...(p.platformConfig ? [p.platformConfig] : []), ...p.personalConfigs]
  }, [p.platformConfig, p.personalConfigs])

  const rows = useMemo<ModelRow[]>(() => {
    const out: ModelRow[] = []
    for (const cfg of configs) {
      for (const m of cfg.models ?? []) {
        const key = `${cfg.is_platform ? "platform" : "personal"}:${cfg.id}:${m.id}`
        out.push({
          key,
          configId: cfg.id,
          configName: cfg.config_name || (cfg.is_platform ? "平台内置" : "未命名通道"),
          isPlatform: cfg.is_platform,
          enabled: m.enabled,
          isChannelDefault: cfg.default_model === m.id,
          modelId: m.id,
          health: p.modelHealth[key] ?? null,
        })
      }
    }
    return out
  }, [configs, p.modelHealth])

  const targets = useMemo(() => {
    const map: Record<string, HealthAlertTarget> = {}
    for (const r of rows) map[r.key] = { configName: r.configName, modelId: r.modelId, enabled: r.enabled }
    return map
  }, [rows])

  const alerts = useMemo(() => buildHealthAlerts(p.modelHealth, targets), [p.modelHealth, targets])
  const alertStats = useMemo(() => summarizeHealthAlerts(alerts), [alerts])

  const visibleRows = useMemo(() => {
    if (byReason) {
      const order = ["model_missing", "model_disabled", "auth", "quota_exhausted"]
      return rows
        .filter((r) => r.health)
        .sort((a, b) => order.indexOf(a.health!.cls) - order.indexOf(b.health!.cls))
    }
    const rank = (r: ModelRow) => (r.health ? 0 : r.enabled ? 1 : 2)
    return [...rows].sort((a, b) => rank(a) - rank(b))
  }, [rows, byReason])

  const PAGE_SIZE = 10
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  if (p.listLoading) {
    return <LoadingState text="正在读取模型配置…" />
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="健康看板"
        titleExtra={<Badge variant="neutral">只看告警</Badge>}
        desc="本屏只列出实测失效的模型。调用量、延迟和费用要等网关落下按次台账后才能统计，这里不再摆查不到的数字。"
      />

      <Panel
        title="失败告警"
        right={
          alertStats.pending > 0 ? (
            <Badge variant="danger">{alertStats.pending} 条待处理</Badge>
          ) : alertStats.warning > 0 ? (
            <Badge variant="warning">{alertStats.warning} 条提示</Badge>
          ) : (
            <Badge variant="neutral">暂无告警</Badge>
          )
        }
      >
        {alerts.length === 0 ? (
          <div className="px-3 py-3">
            <EmptyState
              tone="compact"
              title="暂无实测失效"
              hint="档案只记确定性失效（已下线 / 已停用 / Key 失效 / 额度耗尽）。限流、超时归会话冷却，分钟级自动恢复，不在这里刷屏。"
            />
            <div className="px-1 pb-3">
              <Button size="sm" variant="outline" onClick={onGoChannels}>
                回通道与默认
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 py-3.5">
            {alerts.map((a) => {
              const danger = a.tone === "danger"
              return (
                <div
                  key={a.key}
                  role="alert"
                  className={cn(
                    "flex gap-2 rounded-md border px-3 py-2.5",
                    danger ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5",
                  )}
                >
                  <AlertTriangle
                    className={cn("mt-0.5 h-4 w-4 shrink-0", danger ? "text-destructive" : "text-warning")}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-[12.5px] font-semibold",
                        danger ? "text-destructive" : "text-warning",
                      )}
                    >
                      {a.title}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{a.detail}</p>
                    <p className="mt-1 text-[10.5px] text-muted-foreground/80">挂账于 {formatDateTime(new Date(a.at))}</p>
                    <div className="mt-2">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onGoChannels}>
                        {a.actionLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="已配置模型"
        sub={byReason ? "只看失效" : "失效优先"}
        right={
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={toggleByReason}>
            {byReason ? "按模型看" : "按失败原因看"}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <div className="px-3 py-3">
            <EmptyState
              tone="compact"
              title="还没有模型"
              hint="先在「通道与默认」添加一条通道并拉取模型列表，这里才会出现行。"
            />
            <div className="px-1 pb-3">
              <Button size="sm" onClick={onGoChannels}>
                去通道与默认
              </Button>
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-3 py-3">
            <EmptyState tone="compact" title="当前筛选下没有失效模型" hint="切回「按模型看」可浏览全部已配置模型。" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-[11.5px] text-muted-foreground">
                    <th className="px-3.5 py-2 font-medium">模型</th>
                    <th className="px-2 py-2 font-medium">通道</th>
                    <th className="px-2 py-2 font-medium">状态</th>
                    <th className="px-3.5 py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.key} className="border-b border-border/40 last:border-b-0">
                      <td className="px-3.5 py-2 font-mono text-[12px] text-card-foreground">
                        {r.modelId}
                        {r.isChannelDefault ? (
                          <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 font-sans text-[10px] text-primary">
                            默认
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{r.configName}</td>
                      <td className="px-2 py-2">
                        {r.health ? (
                          <span className="text-destructive">{healthShortLabel(r.health.cls)}</span>
                        ) : r.enabled ? (
                          <span className="text-muted-foreground">启用</span>
                        ) : (
                          <span className="text-muted-foreground">停用</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 text-[11.5px] text-muted-foreground">
                        {r.health ? r.health.reason || "实测不可用，去通道处理" : "无失效档案"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 ? (
              <footer className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2 text-[11.5px] text-muted-foreground">
                <span>
                  第 {safePage}/{pageCount} 页 · 共 {visibleRows.length} 个
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={safePage <= 1}
                    onClick={() => setPage((n) => Math.max(1, n - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage((n) => Math.min(pageCount, n + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </footer>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  )
}
