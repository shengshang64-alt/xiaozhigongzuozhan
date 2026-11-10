// 模型配置 · 健康看板（UX-v2 1:1：docs/ux-v2-2026-11/prototype/model/health.html）
//
// ⚠️ 数据边界（本轮验收口径，别越线）：
//   原型那 5 个指标（1,284 次 / 98.7% / P95 4.2s / ¥186.4 / 缓存 31%）与「按模型」表里的
//   调用数、P50/P95、费用、趋势柱、功能分布，全部来自**按次调用台账**——现网网关没有：
//   pb_hooks 只在单次调用时回报 usage 与 elapsed_ms，不落库、不聚合。
//   所以本轮是「UI 壳 + 空态/—」，一个演示数字都不许写进默认值（抄原型数字直接打回）。
//
// 能接的真数据只有两路：
//   ① lib/modelHealth 的「实测不可用」档案（404 已下线 / 上游停用 / Key 失效 / 额度耗尽）
//      → 右侧「失败告警」人话列表；
//   ② 配置本身（通道、模型、启用态、通道默认）
//      → 「按模型」表的模型/通道两列 + 失败原因列。
// TODO:metrics —— 待后端提供 /api/model/stats（按模型聚合调用数/成功率/P50/P95/费用/按功能）
// 后，把 stat-row 的真值、趋势柱、功能分布接上；此文件里所有 "—" 即为接入点。
import { useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Clock3,
  Percent,
  Wallet,
  Zap,
} from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

type IntervalKey = "24h" | "7d" | "30d"

const INTERVALS: { key: IntervalKey; label: string; range: string }[] = [
  { key: "24h", label: "24 小时", range: "近 24 小时" },
  { key: "7d", label: "7 天", range: "近 7 天" },
  { key: "30d", label: "30 天", range: "近 30 天" },
]

/** 表里的一行 = 配置里的一个模型（真数据），指标列全部待接入（—） */
type ModelRow = {
  key: string
  configId: string
  configName: string
  isPlatform: boolean
  enabled: boolean
  /** 是本通道声明的默认模型（不是全站唯一默认，故写「通道默认」） */
  isChannelDefault: boolean
  health: ModelHealthEntry | null
}

/** 指标格：无真源时 value 显示「—」，语义色不着色（不拿颜色暗示不存在的结论） */
function Stat({
  icon,
  label,
  value,
  unit,
  foot,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  foot: React.ReactNode
}) {
  const empty = value === "—"
  return (
    <div className="rounded-lg border border-border border-l-[3px] border-l-primary/25 bg-card px-3.5 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span className="text-primary/70">{icon}</span>
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-[23px] font-semibold leading-tight tracking-tight",
          empty ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
        {unit ? <span className="ml-1 font-sans text-[11.5px] font-medium text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{foot}</div>
    </div>
  )
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
  const [intervalKey, setIntervalKey] = useState<IntervalKey>("7d")
  // 通道筛选「先改本地 state，无数据时下方走空态」——与提示词一致，不假装能查
  const [channelId, setChannelId] = useState<string>("all")
  // 「按失败原因看」= 只显示有实测失效档案的模型并按类别排序（真数据能支撑的最小语义）
  const [byReason, setByReason] = useState(false)
  const [page, setPage] = useState(1)

  // 换筛选条件要从第 1 页看起，否则会停在一个空页上
  const selectChannel = (id: string) => {
    setChannelId(id)
    setPage(1)
  }
  const toggleByReason = () => {
    setByReason((v) => !v)
    setPage(1)
  }

  const interval = INTERVALS.find((i) => i.key === intervalKey) ?? INTERVALS[1]

  const configs = useMemo(() => {
    const list = [...(p.platformConfig ? [p.platformConfig] : []), ...p.personalConfigs]
    return list
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
          health: p.modelHealth[key] ?? null,
        })
      }
    }
    return out
  }, [configs, p.modelHealth])

  /** 告警目标表：让档案 key 能说回「哪条通道的哪个模型」 */
  const targets = useMemo(() => {
    const map: Record<string, HealthAlertTarget> = {}
    for (const r of rows) map[r.key] = { configName: r.configName, modelId: r.key.split(":")[2], enabled: r.enabled }
    return map
  }, [rows])

  const alerts = useMemo(() => buildHealthAlerts(p.modelHealth, targets), [p.modelHealth, targets])
  const alertStats = useMemo(() => summarizeHealthAlerts(alerts), [alerts])

  const channelOptions = useMemo(
    () => configs.map((c) => ({ id: c.id, name: c.config_name || (c.is_platform ? "平台内置" : "未命名通道"), isPlatform: c.is_platform })),
    [configs],
  )
  const selectedChannel = channelId === "all" ? null : channelOptions.find((c) => c.id === channelId) ?? null
  const channelLabel = selectedChannel?.name ?? "全部通道"

  const visibleRows = useMemo(() => {
    const scoped = channelId === "all" ? rows : rows.filter((r) => r.configId === channelId)
    if (byReason) {
      const order = ["model_missing", "model_disabled", "auth", "quota_exhausted"]
      return scoped
        .filter((r) => r.health)
        .sort((a, b) => order.indexOf(a.health!.cls) - order.indexOf(b.health!.cls))
    }
    // 默认顺序按「可操作性」排：实测失效 → 启用 → 停用。
    // 实测本机 95 个模型里大半是停用的，按配置原序排会把要紧的埋在第 60 行之后。
    const rank = (r: ModelRow) => (r.health ? 0 : r.enabled ? 1 : 2)
    return [...scoped].sort((a, b) => rank(a) - rank(b))
  }, [rows, channelId, byReason])

  // 分页：原型有 pager，且本机 95 个模型平铺会让页面长到没法用（原来 1,284px 的老毛病）
  const PAGE_SIZE = 10
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const scopedAlerts = useMemo(() => {
    if (channelId === "all") return alerts
    const ids = new Set(rows.filter((r) => r.configId === channelId).map((r) => r.key))
    return alerts.filter((a) => ids.has(a.key))
  }, [alerts, rows, channelId])

  return (
    <div>
      <PageHeader
        title="健康看板"
        titleExtra={<Badge variant="neutral">暂无统计</Badge>}
        desc={
          <>
            这一屏只回答：
            <b className="font-semibold text-foreground">模型现在跑得好不好、慢在哪、花在哪</b>
            。按模型和功能两个维度拆开看，失败原因直接给出 Top1 与处置入口；要比对单条通道就回「通道与默认」。
          </>
        }
        meta={
          <>
            <span>
              统计区间 <b className="font-mono font-semibold text-foreground">{interval.range}</b>
            </span>
            <span>
              采样 <b className="font-mono font-semibold text-foreground">—</b> 次
            </span>
            <span>
              数据更新 <b className="font-mono font-semibold text-foreground">—</b>
            </span>
          </>
        }
        actions={
          <>
            <div role="group" aria-label="统计时段" className="inline-flex items-center gap-0.5 rounded-md bg-secondary p-0.5">
              {INTERVALS.map((i) => (
                <button
                  key={i.key}
                  type="button"
                  aria-pressed={i.key === intervalKey}
                  onClick={() => setIntervalKey(i.key)}
                  className={cn(
                    "h-[26px] rounded px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    i.key === intervalKey
                      ? "bg-card font-semibold text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {i.label}
                </button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                  {channelLabel}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">按通道</div>
                <DropdownMenuItem onSelect={() => selectChannel("all")} className="text-xs">
                  全部通道
                  {channelId === "all" ? <span className="ml-auto text-primary">✓</span> : null}
                </DropdownMenuItem>
                {channelOptions.map((c) => (
                  <DropdownMenuItem key={c.id} onSelect={() => selectChannel(c.id)} className="text-xs">
                    {c.name}
                    {c.isPlatform ? <span className="text-[10px] text-muted-foreground">平台</span> : null}
                    {channelId === c.id ? <span className="ml-auto text-primary">✓</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* 数据口径条：不是原型的设计说明条，而是告诉用户「为什么这里是 —」 */}
      <div className="mb-3.5 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          <b className="font-semibold text-foreground">口径：</b>
          网关只在单次调用时回报用量与耗时，
          <b className="font-semibold text-foreground">不落按次台账</b>
          。所以调用数、成功率、P50/P95、费用、缓存命中目前显示「—」——它们需要后端统计接口，不是本页算得出来的。
          本页能给实的是「哪些模型实测失效、因为什么」，见右侧失败告警。
        </span>
      </div>

      {/* 五格指标（原型 .stat-row.c5）：无真源一律 —，不填演示值 */}
      <div className="mb-3.5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<BarChart3 className="h-3.5 w-3.5" />} label="本期调用" value="—" unit="次" foot="暂无调用台账" />
        <Stat icon={<Percent className="h-3.5 w-3.5" />} label="成功率" value="—" unit="%" foot="暂无调用台账" />
        <Stat icon={<Clock3 className="h-3.5 w-3.5" />} label="P95 延迟" value="—" unit="s" foot="暂无耗时采集" />
        <Stat icon={<Wallet className="h-3.5 w-3.5" />} label="本期费用" value="—" foot="暂无费用采集" />
        <Stat icon={<Zap className="h-3.5 w-3.5" />} label="缓存命中" value="—" unit="%" foot="暂无缓存遥测" />
      </div>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* 按模型：模型/通道/失败原因 = 真数据；指标列 = —（禁止原型演示行） */}
          <Panel
            title="按模型"
            sub={`${visibleRows.length} 个模型 · 失败档案 ${scopedAlerts.length} 条`}
            right={
              <>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">暂无明细可导出</span>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled title="暂无调用明细，导出不可用">
                  导出明细
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-pressed={byReason}
                  onClick={toggleByReason}
                  title={byReason ? "回到按模型看" : "只显示实测失效的模型，并按失效类别排序"}
                >
                  {byReason ? "按模型看" : "按失败原因看"}
                </Button>
              </>
            }
          >
            {p.listLoading && rows.length === 0 ? (
              // 首屏在飞时不能走空态：那会让「还没拉到」看起来像「一个模型都没配」
              <div className="px-3 py-6">
                <LoadingState text="正在加载模型清单…" hint="平台通道 + 个人通道" tone="compact" />
              </div>
            ) : visibleRows.length === 0 ? (
              selectedChannel ? (
                // 原型 fold 内空态的同款结构：标题 / 说明 / 两个 CTA
                <div className="px-4 py-7">
                  <EmptyState
                    title={`「${selectedChannel.name}」当前没有可统计的模型`}
                    hint="该通道已保存，但模型列表为空或没有启用中的模型，因此不会有任何环节调用到它。想让它跑起来，去「通道与默认」启用模型并设为某层默认。"
                    action={
                      <>
                        <Button size="sm" onClick={onGoChannels}>
                          去设默认模型
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => selectChannel("all")}>
                          换全部通道
                        </Button>
                      </>
                    }
                  />
                </div>
              ) : (
                <div className="px-4 py-7">
                  <EmptyState
                    title={byReason ? "暂无实测失效记录" : "还没有配置任何模型"}
                    hint={
                      byReason
                        ? "档案只记录确定性失效（已下线 / 已停用 / Key 失效 / 额度耗尽）；限流与超时归会话冷却，不进这里。"
                        : "先在「通道与默认」添加一条通道并拉取模型列表，这里才有按模型的行。"
                    }
                    action={
                      <Button size="sm" onClick={onGoChannels}>
                        去通道与默认
                      </Button>
                    }
                  />
                </div>
              )
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-secondary/60 text-[11.5px] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">模型</th>
                        <th className="px-3 py-2 text-left font-semibold">通道</th>
                        <th className="px-3 py-2 text-right font-semibold">调用数</th>
                        <th className="px-3 py-2 text-right font-semibold">成功率</th>
                        <th className="px-3 py-2 text-right font-semibold">P50</th>
                        <th className="px-3 py-2 text-right font-semibold">P95</th>
                        <th className="px-3 py-2 text-left font-semibold">失败原因 Top1</th>
                        <th className="px-3 py-2 text-right font-semibold">费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r) => (
                        <tr key={r.key} className="border-t border-border/60 hover:bg-secondary/30">
                          <td className="px-3 py-2">
                            <span className="font-semibold text-foreground">{r.key.split(":")[2]}</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {r.isChannelDefault ? "通道默认" : r.enabled ? "已启用" : "已停用"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              {r.configName}
                              {r.isPlatform ? <Badge variant="neutral" className="text-[10px]">平台</Badge> : null}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                          <td className="px-3 py-2">
                            {r.health ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="text-[11.5px] text-foreground">{healthShortLabel(r.health.cls)}</span>
                                <Badge variant={r.health.cls === "quota_exhausted" ? "warning" : "danger"} className="text-[10px]">
                                  实测失效
                                </Badge>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/40 px-3 py-2 text-[11.5px] text-muted-foreground">
                  <span>
                    {visibleRows.length} 个模型 · 实测失效 {visibleRows.filter((r) => r.health).length} 个
                  </span>
                  <span className="hidden h-3 w-px bg-border sm:block" />
                  <span className="min-w-0 flex-1">
                    成功率 = 成功调用 / 总调用（需台账）；失败原因来自本机「实测不可用」档案，7 天有效、成功即清。
                  </span>
                  {pageCount > 1 ? (
                    <div className="flex items-center gap-0.5" role="group" aria-label="模型分页">
                      <button
                        type="button"
                        disabled={safePage <= 1}
                        onClick={() => setPage(safePage - 1)}
                        className="h-6 min-w-6 rounded border border-border bg-card px-1.5 font-mono text-[11.5px] text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        ‹
                      </button>
                      <span className="px-1.5 font-mono text-[11px] text-muted-foreground">
                        {safePage} / {pageCount}
                      </span>
                      <button
                        type="button"
                        disabled={safePage >= pageCount}
                        onClick={() => setPage(safePage + 1)}
                        className="h-6 min-w-6 rounded border border-border bg-card px-1.5 font-mono text-[11.5px] text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </Panel>

          {/* 两图：无序列数据就是空态，不画假柱充数 */}
          <div className="grid gap-3.5 lg:grid-cols-2">
            <Panel title="调用量趋势" sub={interval.range} right={<span className="text-[11px] text-muted-foreground">按日聚合</span>}>
              <div className="px-3 py-3">
                <EmptyState
                  tone="compact"
                  title="暂无调用量数据"
                  hint="趋势需要按日聚合的调用台账；网关目前只在单次调用时回报用量，不落库，画不出真实柱形。"
                />
              </div>
            </Panel>
            <Panel title="按功能维度" sub="哪些功能在烧 token">
              <div className="px-3 py-3">
                <EmptyState
                  tone="compact"
                  title="暂无功能维度数据"
                  hint="每次调用都要带功能标签并入库，才能按「方案生成 / 标书正文 / 助手对话」拆开统计；现在没有这个埋点。"
                />
              </div>
            </Panel>
          </div>
        </div>

        {/* 右栏：失败告警（真数据）+ 两张「暂无采集」 */}
        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
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
            {scopedAlerts.length === 0 ? (
              <div className="px-3 py-3">
                <EmptyState
                  tone="compact"
                  title="暂无实测失效"
                  hint="档案只记确定性失效（已下线 / 已停用 / Key 失效 / 额度耗尽）。限流、超时归会话冷却，分钟级自动恢复，不在这里刷屏。"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-4 py-3.5">
                {scopedAlerts.map((a) => {
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

          <Panel title="关键耗时" right={<span className="text-[11px] text-muted-foreground">P95</span>}>
            <div className="px-3 py-3">
              <EmptyState
                tone="compact"
                title="暂无耗时采集"
                hint="P50/P95 需网关按次记录延迟分位。「连通测试」那一次的耗时只是那一次，不能当 P95。"
              />
            </div>
          </Panel>

          <Panel title="费用结构">
            <div className="px-3 py-3">
              <EmptyState
                tone="compact"
                title="暂无费用采集"
                hint="各通道价目不一，网关也还没按 token 归集费用与月度预算，因此不写死金额。"
              />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
