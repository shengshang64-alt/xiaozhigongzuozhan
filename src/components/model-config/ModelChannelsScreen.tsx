// 模型配置 · 通道与默认（UX-v2 1:1：docs/ux-v2-2026-11/prototype/model/channels.html）
//
// 结构对齐原型的六块（自上而下）：
//   A. 页头：标题 + 连通徽标 / desc / meta 四格 / 「添加通道」「刷新状态」
//   B. 平台内置折叠信息卡（原红条降级为灰色折叠）
//   C. 可用通道三卡网格（状态点 / 名称 / 状态徽标 / 默认来源 / base_url + Key / 模型数 / 最近测试 / 今日调用 / 三按钮）
//   D. 不可用通道折叠
//   E. 默认模型链卡
//   F. 右栏：当前生效模型 / 模型清单 / 配置卫生
//
// 数据边界（每个格子都要能指回真源，否则显示「—」）：
//   · 通道状态 ← last_check_status（后端从不写入 → 空串 = 未测过，不显示「已连通」）
//   · 最近测试 ← lib/modelTestLog 的真实测试台账（用户点过测试才有）
//   · 今日调用 / 成功率 ← 无真源（网关不落调用台账）→ 「—」
//   · 默认模型链 ← 只有「全局默认」一层是真的，其余功能都跟随它（不画假的三层）
// TODO:metrics —— 调用量/成功率需要后端按次台账；TODO:routing —— 按功能指定模型需后端字段。
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  Cpu,
  FlaskConical,
  Info,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { EmptyState, LoadingState } from "@/components/common/DataStates"
import { DefaultModelBanner } from "@/components/model-config/DefaultModelBanner"
import { PersonalConfigList } from "@/components/model-config/PersonalConfigList"
import { PlatformModelCard } from "@/components/model-config/PlatformModelCard"
import { formatElapsed, describeWhen, type ModelTestLogEntry } from "@/lib/modelTestLog"
import {
  buildChannelViews,
  DEFAULT_CHAIN_LEVELS,
  summarizeChannels,
  type ChannelView,
} from "@/lib/modelChannelsView"
import { cn } from "@/lib/utils"
import type { GatewayConfig } from "@/lib/modelGateway"
import type { useModelConfig } from "@/pages/ModelConfig/useModelConfig"

type Props = {
  p: ReturnType<typeof useModelConfig>
  /** 去「连通测试」子屏（通道卡的「测试」按钮与模型清单的入口都用它） */
  onOpenTest: () => void
}

function Panel({
  title,
  sub,
  right,
  children,
  footer,
}: {
  title: React.ReactNode
  sub?: string
  right?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">{title}</h3>
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
        <div className="flex-1" />
        {right}
      </header>
      {children}
      {footer ? <div className="border-t border-border bg-secondary/40 px-4 py-2 text-[11.5px] text-muted-foreground">{footer}</div> : null}
    </section>
  )
}

/** 可折叠的信息条（原型 .fold）：默认收起，展开才占版面 */
function Fold({
  title,
  badge,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string
  badge?: React.ReactNode
  hint: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-foreground">{title}</span>
        {badge}
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground">{open ? "收起" : hint}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-border px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">{children}</div> : null}
    </div>
  )
}

function statusBadge(status: ChannelView["status"], locallyUnusable: boolean) {
  if (locallyUnusable) return <Badge variant="neutral">仅线上可用</Badge>
  if (status === "ok") return <Badge variant="success">已连通</Badge>
  if (status === "error") return <Badge variant="danger">上次失败</Badge>
  // 未测过 ≠ 已连通：空串不是成功证据
  return <Badge variant="neutral">未测过</Badge>
}

function dotClass(status: ChannelView["status"], locallyUnusable: boolean): string {
  if (locallyUnusable) return "bg-muted-foreground/40"
  if (status === "ok") return "bg-primary"
  if (status === "error") return "bg-destructive"
  return "bg-muted-foreground/40"
}

/** 通道卡（原型 .card 三列网格里的单元） */
function ChannelCard({
  view,
  locallyUnusable,
  busy,
  onTest,
  onEdit,
  onRefresh,
  onAskDelete,
}: {
  view: ChannelView
  locallyUnusable: boolean
  busy: boolean
  onTest: () => void
  onEdit: () => void
  onRefresh: () => void
  onAskDelete: () => void
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-3.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(view.status, locallyUnusable))} aria-hidden />
        <span className="text-[13px] font-semibold text-foreground">{view.name}</span>
        {statusBadge(view.status, locallyUnusable)}
        {view.isPlatform ? <Badge variant="neutral">平台内置</Badge> : null}
        <div className="flex-1" />
        {view.isDefaultSource ? <Badge variant="success">默认来源</Badge> : null}
      </div>

      <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground" title={`${view.baseUrl} · ${view.apiKeyMasked}`}>
        {view.baseUrl || "—"} · {view.apiKeyMasked}
      </p>

      <dl className="mt-2 space-y-1 text-[12px]">
        <div className="flex items-center gap-2">
          <dt className="shrink-0 text-muted-foreground">模型</dt>
          <dd className="min-w-0 text-foreground">
            {view.noModels ? (
              <span className="text-muted-foreground">还未拉取</span>
            ) : (
              <>
                <b className="font-semibold">{view.modelTotal}</b> 个 · {view.modelEnabled} 个已启用
              </>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="shrink-0 text-muted-foreground">最近测试</dt>
          <dd className="min-w-0 font-mono text-foreground">
            {view.lastTest ? (
              <>
                {describeWhen(view.lastTest.at)} ·{" "}
                {view.lastTest.ok ? (
                  <span>{formatElapsed(view.lastTest.elapsedMs)}</span>
                ) : (
                  <span className="text-destructive">失败</span>
                )}
              </>
            ) : (
              // 从没测过就如实说「还没测过」，不要拿创建时间冒充测试时间
              <span className="text-muted-foreground">还没测过</span>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="shrink-0 text-muted-foreground">今日调用</dt>
          <dd className="min-w-0 font-mono text-muted-foreground" title="网关不落按次调用台账，拿不到真实调用量">
            —
          </dd>
        </div>
        {view.status === "error" && view.lastCheckError ? (
          <div className="flex items-start gap-2">
            <dt className="shrink-0 text-muted-foreground">失败原因</dt>
            <dd className="min-w-0 break-words text-destructive">{view.lastCheckError}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onTest} disabled={busy || view.noModels}>
          <FlaskConical className="h-3.5 w-3.5" />
          测试
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onRefresh}
          disabled={busy}
          title="重新拉取该通道的模型列表（会清掉它名下的「实测不可用」挂账）"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新模型
        </Button>
        {!view.isPlatform ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onAskDelete}
            title="删除这条通道及其模型"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function ModelChannelsScreen({ p, onOpenTest }: Props) {
  const configs = useMemo(
    () => [...(p.platformConfig ? [p.platformConfig] : []), ...p.personalConfigs],
    [p.platformConfig, p.personalConfigs],
  )

  // 默认来源 = 显式声明了 default_model 的那条配置（与 useModelConfig 的 available.defaultRef 同口径）
  const defaultSourceConfigId = useMemo(() => {
    const hit = configs.find(
      (c) => !!c.default_model && (c.models ?? []).some((m) => m.enabled && m.id === c.default_model),
    )
    return hit?.id ?? null
  }, [configs])

  const views = useMemo(
    () => buildChannelViews(configs, p.testLog, defaultSourceConfigId),
    [configs, p.testLog, defaultSourceConfigId],
  )
  const stats = useMemo(() => summarizeChannels(views), [views])

  const personalViews = views.filter((v) => !v.isPlatform)
  const platformView = views.find((v) => v.isPlatform) ?? null
  // 「可用通道」= 个人通道且拉到了模型。
  // 注意：platformLocallyUnusable 只针对**平台内置**（本机拿不到平台登录态），
  // 绝不能拿它过滤个人通道——个人通道用自己的 Key，本机照样能通。
  const activeViews = personalViews.filter((v) => !v.noModels)
  // 「不可用通道」= 有模型但拉取过 / 明确报错 / 平台内置本机不可用
  const brokenViews = [
    ...personalViews.filter((v) => v.status === "error"),
    ...(platformView && p.platformLocallyUnusable ? [platformView] : []),
  ]

  const [pendingDefault, setPendingDefault] = useState<{ cfg: GatewayConfig; modelId: string; prev: string } | null>(null)

  const { defaultLabel, defaultSource } = p

  const ready = !p.listLoading || configs.length > 0

  return (
    <div>
      <PageHeader
        title="通道与默认"
        titleExtra={
          stats.total === 0 ? (
            <Badge variant="neutral">还没有通道</Badge>
          ) : stats.connected > 0 ? (
            <Badge variant="success">{stats.connected} 个通道已连通</Badge>
          ) : (
            // 从没测通过就别说「已连通」——空串不是成功证据
            <Badge variant="neutral">
              {stats.untested > 0 ? `${stats.untested} 个通道未测过` : `${stats.errored} 个通道异常`}
            </Badge>
          )
        }
        desc={
          <>
            这屏只回答两件事：
            <b className="font-semibold text-foreground">模型从哪条通道来</b>、
            <b className="font-semibold text-foreground">默认用哪个</b>
            。不常用的平台内置模型收进一张折叠信息卡，不再用红条挂着吓人；改默认必须看影响范围再确认。
          </>
        }
        meta={
          <>
            <span>
              通道{" "}
              <b className="font-mono font-semibold text-foreground">
                {stats.connected} 可用 / {stats.errored + stats.untested} 未确认
              </b>
            </span>
            <span>
              已启用模型 <b className="font-mono font-semibold text-foreground">{stats.usableModels}</b> 个
            </span>
            <span>
              当前默认 <b className="font-mono font-semibold text-foreground">{defaultLabel}</b>
            </span>
            <span>
              最近测试{" "}
              <b className="font-mono font-semibold text-foreground">
                {p.testLog.length ? describeWhen(p.testLog[0].at) : "—"}
              </b>
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={p.openCreateForm}>
              <Plus className="h-4 w-4" /> 添加通道
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void p.loadConfigs()}
              disabled={p.listLoading}
              title="重新读取全部通道与模型列表"
            >
              <RefreshCw className={cn("h-4 w-4", p.listLoading && "animate-spin")} /> 刷新状态
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {!ready ? (
            <LoadingState text="正在加载通道…" hint="平台通道 + 个人通道" />
          ) : configs.length === 0 ? (
            // 原型 fold 里的空态，直接作为唯一内容（没通道时不该还摆三张空卡）
            <EmptyState
              title="还没有配置任何模型通道"
              hint="添加一条 OpenAI 兼容通道（填 Base URL 与 Key），系统会自动拉取模型列表；也可先用平台内置模型在线上环境跑。"
              action={
                <Button size="sm" onClick={p.openCreateForm}>
                  <Plus className="h-4 w-4" /> 添加通道
                </Button>
              }
            />
          ) : (
            <>
              {/* B. 平台内置折叠信息卡 */}
              {platformView ? (
                <Fold
                  title="平台内置模型（线上部署时可用）"
                  badge={
                    <Badge variant="neutral">
                      {platformView.modelTotal} 个 · {p.platformLocallyUnusable ? "本地不可用" : "线上可用"}
                    </Badge>
                  }
                  hint="为什么本地用不了 / 怎么替代"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">平台内置 · 按 token 用量计费</Badge>
                    <span className="text-[11px] text-muted-foreground">需平台登录态</span>
                  </div>
                  <p>
                    平台内置模型只在<b className="text-foreground">线上部署环境</b>可用：它依赖平台侧的登录凭证，
                    本地 / 内网部署拿不到，所以调用必然失败——这是环境事实，不是配置错误，也不是网络问题。
                  </p>
                  <p className="mt-2">
                    本地想用同类能力，请改用你自己配置的个人通道。
                    {defaultSourceConfigId && defaultLabel !== "未配置可用模型"
                      ? `当前默认是 ${defaultLabel}（来源 ${defaultSource}）。`
                      : "目前还没有可用默认，去下方个人模型里挑一个设为默认。"}
                  </p>
                </Fold>
              ) : null}

              {/* C. 可用通道 */}
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">可用通道（{activeViews.length}）</h3>
                  <div className="flex-1" />
                  <span className="text-[11px] text-muted-foreground">点「测试」跳到连通测试，发一条固定消息看通不通</span>
                </div>
                {activeViews.length === 0 ? (
                  <EmptyState
                    tone="compact"
                    title="没有可用的个人通道"
                    hint="下面「不可用通道」里有失败的通道，或直接添加一条新的 OpenAI 兼容通道。"
                    action={
                      <Button size="sm" onClick={p.openCreateForm}>
                        <Plus className="h-4 w-4" /> 添加通道
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {activeViews.map((v) => {
                      const cfg = configs.find((c) => c.id === v.id)
                      if (!cfg) return null
                      return (
                        <ChannelCard
                          key={v.id}
                          view={v}
                          locallyUnusable={false}
                          busy={p.busyConfigId === v.id}
                          onTest={onOpenTest}
                          onEdit={() => p.openEditForm(cfg)}
                          onRefresh={() => void p.refreshModels(cfg)}
                          onAskDelete={() => p.askDelete(cfg)}
                        />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* D. 不可用通道折叠 */}
              {brokenViews.length > 0 ? (
                <Fold
                  title={`不可用通道（${brokenViews.length}）`}
                  badge={<Badge variant="neutral">需要处理</Badge>}
                  hint="展开看原因"
                >
                  <ul className="space-y-2">
                    {brokenViews.map((v) => {
                      const cfg = configs.find((c) => c.id === v.id)
                      return (
                        <li key={v.id} className="flex flex-wrap items-center gap-2">
                          <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(v.status, v.isPlatform && p.platformLocallyUnusable))} aria-hidden />
                          <b className="text-foreground">{v.name}</b>
                          <span className="text-[11.5px]">
                            {v.isPlatform && p.platformLocallyUnusable
                              ? "· 平台内置：本机 / 内网部署拿不到平台登录态，确定不可用"
                              : v.lastCheckError
                                ? `· ${v.lastCheckError}`
                                : "· 上次检查失败，原因未记录"}
                          </span>
                          {cfg && !v.isPlatform ? (
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => p.openEditForm(cfg)}>
                              改配置
                            </Button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </Fold>
              ) : null}

              {/* E. 默认模型链：现网只有「全局默认」一层是真的 */}              <Panel
                title={
                  <>
                    <Layers className="h-4 w-4 text-primary" />
                    默认模型链
                  </>
                }
                sub="没单独指定的功能会落到「全局默认」"
                right={
                  <Badge variant={defaultSourceConfigId ? "success" : "neutral"}>
                    {defaultSourceConfigId ? "已显式声明" : "未显式声明"}
                  </Badge>
                }
                footer={
                  <>
                    现网所有 AI 功能（方案生成 / 标书正文 / 助手对话 / 情报摘要 / 客户跟进建议 / 记忆提取）都读同一个全局默认，
                    <b className="text-foreground">暂不支持按功能分别指定模型</b>
                    （需要后端新增路由字段）。因此在下面把某一层设为默认，实际改的是全站默认。
                  </>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-secondary/60 text-[11.5px] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">层级</th>
                        <th className="px-3 py-2 text-left font-semibold">影响什么</th>
                        <th className="px-3 py-2 text-left font-semibold">当前模型</th>
                        <th className="px-3 py-2 text-right font-semibold">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DEFAULT_CHAIN_LEVELS.map((lv) => (
                        <tr key={lv.key} className="border-t border-border/60">
                          <td className="px-3 py-2.5">
                            <span className="font-semibold text-foreground">{lv.label}</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">{lv.scope}</span>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">{lv.affects}</td>
                          <td className="px-3 py-2.5">
                            <span className="font-mono text-[12px] font-semibold text-foreground">{defaultLabel}</span>
                            {defaultSource !== "无" ? (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">来源：{defaultSource}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={p.openCreateForm}>
                              去添加/选择模型
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* G. 模型级管理：启用开关 / 设为默认 / 元数据 / 删除。
                  原型把这一层收进了通道卡；拆分屏时不能把它丢掉——它是唯一能改「单个模型」
                  的地方（设为默认、停用某个模型、标注擅长与额度）。这里保留原组件原样，
                  不做样式重写，避免把可用的配置能力在 1:1 过程中弄丢。 */}
              <section className="mb-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">模型级管理</h3>
                  <span className="text-[11px] text-muted-foreground">
                    启用 / 停用单个模型、设为默认、标注擅长与额度、删除配置
                  </span>
                </div>
                <div className="space-y-4">
                  <DefaultModelBanner
                    defaultLabel={p.defaultLabel}
                    defaultSource={p.defaultSource}
                    declaredDefault={p.declaredDefault}
                    missingDefaultCount={p.missingDefaultCount}
                    unusableCount={p.unusableCount}
                  />
                  <PlatformModelCard
                    config={p.platformConfig}
                    busy={p.busyConfigId === p.platformConfig?.id || (p.listLoading && !p.platformConfig)}
                    onToggleModel={p.toggleModel}
                    onSetDefault={p.setDefaultModel}
                    onTest={() => onOpenTest()}
                    locallyUnusable={p.platformLocallyUnusable}
                  />
                  <PersonalConfigList
                    configs={p.personalConfigs}
                    busyConfigId={p.busyConfigId}
                    onAdd={p.openCreateForm}
                    onEdit={p.openEditForm}
                    onRefresh={p.refreshModels}
                    onAskDelete={p.askDelete}
                    onToggleModel={p.toggleModel}
                    onSetDefault={p.setDefaultModel}
                    onTest={() => onOpenTest()}
                    modelHealth={p.modelHealth}
                    deletingConfig={p.deletingConfig}
                    deleteBusy={p.deleteBusy}
                    onCancelDelete={p.cancelDelete}
                    onConfirmDelete={p.confirmDelete}
                    modelMeta={p.modelMeta}
                    onSaveModelMeta={p.updateModelMeta}
                  />
                </div>
              </section>
            </>
          )}
        </div>

        {/* F. 右栏 */}
        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
          <Panel
            title="当前生效模型"
            right={
              defaultSourceConfigId ? (
                <Badge variant="success">已声明</Badge>
              ) : (
                <Badge variant="neutral">兜底</Badge>
              )
            }
          >
            <div className="space-y-2.5 px-4 py-3">
              <div>
                <p className="font-mono text-[15px] font-semibold text-foreground">{defaultLabel}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">来源：{defaultSource}</p>
              </div>
              <div className="h-px bg-border" />
              <div className="space-y-1.5 text-[12px]">
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">生效范围</span>
                  <span className="min-w-0 text-foreground">全部 AI 功能（未支持按功能分别指定）</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">今日调用</span>
                  <span className="font-mono text-muted-foreground" title="网关不落按次调用台账">
                    —
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">P95 延迟</span>
                  <span className="font-mono text-muted-foreground" title="需按次耗时采集">
                    —
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">今日费用</span>
                  <span className="font-mono text-muted-foreground" title="无计价模块">
                    —
                  </span>
                </div>
              </div>
              {p.declaredDefault ? null : (
                <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-[11.5px] leading-relaxed text-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  还没有配置显式声明默认模型，当前默认只是兜底——模型列表顺序一变，默认就会静默改变。
                </p>
              )}
            </div>
          </Panel>

          <Panel title="模型清单" sub={`${p.availableModels.length} 个已启用`}>
            <div className="px-4 py-3">
              {p.availableModels.length === 0 ? (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  还没有已启用的模型。到上方通道卡里启用几个，它们才会出现在这里和各个生成页的模型下拉里。
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {p.availableModels.slice(0, 8).map((m) => {
                    const unhealthy = !!p.modelHealth[`${m.source}:${m.configId}:${m.modelId}`]
                    const isDefaultModel = defaultLabel.includes(m.modelId)
                    return (
                      <li key={`${m.source}:${m.configId}:${m.modelId}`} className="flex items-center gap-1.5 text-[12px]">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            unhealthy ? "bg-destructive" : m.source === "platform" ? "bg-muted-foreground/40" : "bg-primary",
                          )}
                          aria-hidden
                        />
                        <span className={cn("min-w-0 flex-1 truncate font-mono", unhealthy ? "text-muted-foreground" : "text-foreground")}>
                          {m.modelId}
                        </span>
                        {isDefaultModel ? (
                          <Badge variant="success" className="shrink-0 text-[10px]">
                            默认
                          </Badge>
                        ) : m.source === "platform" ? (
                          <Badge variant="neutral" className="shrink-0 text-[10px]">
                            平台内置
                          </Badge>
                        ) : (
                          // 设为默认走二次确认：原型要求「改默认必须看影响范围再确认」，
                          // 而这里改的是全站默认（现网没有按功能分层），影响面必须说清。
                          <button
                            type="button"
                            onClick={() => {
                              const cfg = configs.find((c) => c.id === m.configId)
                              if (cfg) setPendingDefault({ cfg, modelId: m.modelId, prev: defaultLabel })
                            }}
                            title={`把全站默认改为 ${m.modelId}（会先弹确认）`}
                            className="shrink-0 rounded px-1 text-[10.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
                          >
                            设为默认
                          </button>
                        )}
                      </li>
                    )
                  })}
                  {p.availableModels.length > 8 ? (
                    <li className="pt-1 text-[11px] text-muted-foreground">
                      还有 {p.availableModels.length - 8} 个，见「健康看板」按模型表
                    </li>
                  ) : null}
                </ul>
              )}
              <button
                type="button"
                onClick={onOpenTest}
                className="mt-2 text-[11.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                去连通测试逐个验证 →
              </button>
            </div>
          </Panel>

          <Panel title="配置卫生">
            <div className="space-y-1.5 px-4 py-3 text-[12px]">
              <HygieneRow
                ok={!!defaultSourceConfigId}
                text={defaultSourceConfigId ? "默认模型已显式声明" : "默认模型未显式声明（靠兜底）"}
                note={defaultSourceConfigId ? "正常" : "待处理"}
              />
              <HygieneRow
                ok={p.missingDefaultCount === 0}
                text={
                  p.missingDefaultCount === 0
                    ? "每条配置都指定了默认模型"
                    : `${p.missingDefaultCount} 个配置未指定默认（靠启用列表第一个兜底）`
                }
                note={p.missingDefaultCount === 0 ? "正常" : "待处理"}
              />
              <HygieneRow
                ok={p.unusableCount === 0}
                text={
                  p.unusableCount === 0
                    ? "没有已启用但实测失效的模型"
                    : `${p.unusableCount} 个模型已启用但实测失效`
                }
                note={p.unusableCount === 0 ? "正常" : "待处理"}
              />
              <HygieneRow ok text="Key 只存服务端，仅显示后四位" note="正常" />
              {p.unusableCount > 0 || p.missingDefaultCount > 0 ? (
                <Button size="sm" variant="outline" className="mt-1 h-7 px-2 text-xs" onClick={p.openCreateForm}>
                  <Cpu className="h-3.5 w-3.5" />
                  去处理
                </Button>
              ) : null}
            </div>
          </Panel>

          <Panel
            title={
              <>
                <Server className="h-3.5 w-3.5 text-primary" />
                通道概览
              </>
            }
          >
            <div className="space-y-1.5 px-4 py-3 text-[12px]">
              {views.map((v) => (
                <div key={v.id} className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(v.status, v.isPlatform && p.platformLocallyUnusable))} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-foreground">{v.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                    {v.lastTest ? (v.lastTest.ok ? formatElapsed(v.lastTest.elapsedMs) : "失败") : "—"}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={pendingDefault !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDefault(null)
        }}
        title="切换全站默认模型？"
        description={
          pendingDefault
            ? `将把全站 AI 生成切换到「${pendingDefault.modelId}」，原默认${pendingDefault.prev ? `「${pendingDefault.prev}」` : "（无）"}退为备用。`
            : ""
        }
        confirmText="确认切换"
        onConfirm={() => {
          const cfg = pendingDefault?.cfg
          if (cfg && pendingDefault) p.setDefaultModel(cfg, pendingDefault.modelId)
          setPendingDefault(null)
        }}
      />
    </div>
  )
}

function HygieneRow({ ok, text, note }: { ok: boolean; text: string; note: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span
        className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-primary" : "bg-warning")}
        aria-hidden
      />
      <span className="min-w-0 flex-1 text-foreground">{text}</span>
      <span className="shrink-0 text-[10.5px] text-muted-foreground">{note}</span>
    </div>
  )
}

/** 类型导出供测试引用（保持「一个组件文件只导出组件」的 lint 规则，这里用型别导出即可） */
export type { ModelTestLogEntry }
