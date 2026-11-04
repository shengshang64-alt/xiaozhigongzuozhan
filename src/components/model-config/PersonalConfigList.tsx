import { useState } from "react"
import { AlertTriangle, Cpu, FlaskConical, Loader2, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react"
import { detectModelModality, isTextGenerationModel, modalityBadgeClass, modalityLabel } from "@/lib/modelModality"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/common/DataStates"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { healthNotice, healthShortLabel, type ModelHealthEntry } from "@/lib/modelHealth"
import type { GatewayConfig } from "@/lib/modelGateway"
import { Coins } from "lucide-react"
import { resolveModelProfile, resolveQuotaHint, type ProfileSource } from "@/lib/modelProfiles"
import { ModelMetaDialog } from "./ModelMetaDialog"
import type { ModelMetaEntry, ModelQuota } from "@/lib/modelMetaLocal"

type PersonalConfigListProps = {
  configs: GatewayConfig[]
  busyConfigId: string | null
  onAdd: () => void
  onEdit: (cfg: GatewayConfig) => void
  onRefresh: (cfg: GatewayConfig) => void
  onAskDelete: (cfg: GatewayConfig) => void
  onToggleModel: (cfg: GatewayConfig, modelId: string, enabled: boolean) => void
  onSetDefault: (cfg: GatewayConfig, modelId: string) => void
  onTest: (cfg: GatewayConfig, modelId: string) => void
  /** R296：「实测不可用」挂账，key = personal:配置id:模型id。只标注不禁用（沿袭冷却徽标裁定） */
  modelHealth?: Record<string, ModelHealthEntry>
  deletingConfig: GatewayConfig | null
  deleteBusy: boolean
  onCancelDelete: () => void
  onConfirmDelete: () => void
  /** R-038：模型元数据（擅长/额度），key = personal:<cfgId>:<modelId> */
  modelMeta?: Record<string, ModelMetaEntry>
  /** R-038：保存模型元数据（用户在弹窗点保存时调用） */
  onSaveModelMeta?: (cfg: GatewayConfig, modelId: string, patch: { specialty: string; tags: string[]; quota: ModelQuota | null }) => void
}

function EnableToggle({
  enabled,
  disabled,
  onToggle,
  labelText,
}: {
  enabled: boolean
  disabled: boolean
  onToggle: () => void
  labelText: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={labelText}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-1"
        }`}
      />
    </button>
  )
}

function maskUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}/***`
  } catch {
    return raw.slice(0, 24) + "/***"
  }
}

export function PersonalConfigList({
  configs,
  busyConfigId,
  onAdd,
  onEdit,
  onRefresh,
  onAskDelete,
  onToggleModel,
  onSetDefault,
  onTest,
  modelHealth = {},
  deletingConfig,
  deleteBusy,
  onCancelDelete,
  onConfirmDelete,
  modelMeta = {},
  onSaveModelMeta,
}: PersonalConfigListProps) {
  // R-038：当前打开的元数据编辑弹窗目标（null = 关闭）
  const [editingMeta, setEditingMeta] = useState<{ cfg: GatewayConfig; modelId: string } | null>(null)

  // R-041：只看可用开关（默认开启——无额度/挂账的模型隐藏；取消勾选可看全部）
  const [onlyUsable, setOnlyUsable] = useState(true)
  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">个人模型配置</h2>
        <span className="badge-neutral">
          Key 只存服务端 · 仅显示后四位
        </span>
        {/* R-039 只看可用筛选：隐藏 unhealthy 挂账 + 未标注额度的模型 */}
        <label className="ml-auto inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyUsable}
            onChange={(e) => setOnlyUsable(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#0e9f8a]"
          />
          只看可用（隐藏挂账与无额度）
        </label>
        <Button
          size="sm"
          onClick={onAdd}
          className={onlyUsable ? "" : "ml-2"}
        >
          <Plus className="mr-1 h-4 w-4" />
          添加模型配置
        </Button>
      </header>

      <div className="space-y-4 px-4 py-4">
        {configs.length === 0 && (
          <EmptyState
            title="还没有个人模型配置"
            hint="添加公司或个人的 OpenAI 兼容接口（如 DeepSeek、Kimi、通义等），保存后会自动拉取该地址下的全部模型，可逐个启用并设为系统默认。"
            icon={<Cpu className="h-8 w-8 text-muted-foreground" />}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={onAdd}
                className="border-primary/40 text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="mr-1 h-4 w-4" />
                添加第一个配置
              </Button>
            }
          />
        )}

        {configs.map((cfg) => {
          const busy = busyConfigId === cfg.id
          const enabledCount = (cfg.models ?? []).filter((m) => m.enabled).length
          return (
            <article key={cfg.id} className="rounded-lg border border-border bg-background shadow-sm transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{cfg.config_name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {maskUrl(cfg.base_url)} · Key {cfg.api_key_masked || "未设置"} · {enabledCount}/{(cfg.models ?? []).length} 个模型已启用
                  </p>
                </div>
                {cfg.last_check_status === "error" && cfg.last_check_error && (
                  <span className="badge-danger inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {cfg.last_check_error}
                  </span>
                )}
                {!cfg.default_model && enabledCount > 0 && (
                  <span
                    className="badge-warning inline-flex items-center gap-1"
                    title="该配置没有显式声明默认模型，网关会按「启用列表第一个」兜底——配置里模型顺序一变，默认模型就静默改变。请点下方任一文本模型的「设为默认」把它固定下来。"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    未设默认模型
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRefresh(cfg)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    刷新模型
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onEdit(cfg)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAskDelete(cfg)}
                    aria-label={`删除配置 ${cfg.config_name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-card px-2.5 py-1.5 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
              </div>

              <ul className="divide-y divide-border">
                {(onlyUsable
                  ? (cfg.models ?? []).filter((m) => {
                      const unhealthy = modelHealth[`personal:${cfg.id}:${m.id}`]
                      if (unhealthy) return false
                      const meta = modelMeta[`personal:${cfg.id}:${m.id}`]
                      // R-041：用户标注额度 或 内置参考命中 → 视为可用
                      if (meta?.quota) return true
                      if (resolveQuotaHint(m.id)) return true
                      return false
                    })
                  : (cfg.models ?? [])
                ).map((m) => {
                  const isDefault = cfg.default_model === m.id
                  const modality = detectModelModality(m.id)
                  // R296：这一路是否已被实测挂账（404 已下线 / 上游停用 / Key 失效）
                  const unhealthy = modelHealth[`personal:${cfg.id}:${m.id}`] ?? null
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${m.enabled ? "bg-primary" : "bg-muted-foreground/40"}`}
                        aria-hidden
                      />
                      <span className={`min-w-0 flex-1 truncate font-mono text-sm ${m.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {m.id}
                      </span>
                      {modality !== "text" && (
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${modalityBadgeClass(modality)}`}>
                          {modalityLabel(modality)}
                        </span>
                      )}
                      {isDefault && (
                        <span className="badge-neutral">
                          系统默认
                        </span>
                      )}
                      {unhealthy && (
                        <span
                          className="badge-danger inline-flex items-center gap-1"
                          title={healthNotice(unhealthy)}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {healthShortLabel(unhealthy.cls)}
                        </span>
                      )}
                      {(() => {
                        // R-038：擅长/额度徽标（三层：用户标注 > 内置 > 名称推断）
                        const meta = modelMeta[`personal:${cfg.id}:${m.id}`] ?? null
                        const resolved = resolveModelProfile(m.id, meta?.specialty, meta?.tags)
                        const sourceLabel: Record<ProfileSource, string> = {
                          user: "用户标注",
                          known: "内置知识表",
                          inferred: "名称推断",
                          none: "未标注",
                        }
                        const tip = resolved.profile
                          ? `${resolved.profile.specialty}（来源：${sourceLabel[resolved.source]}${resolved.profile.tags.length ? " · " + resolved.profile.tags.join("、") : ""}）`
                          : "未标注擅长，点右侧铅笔按钮补充"
                        return (
                          <>
                            <span
                              className={`min-w-0 max-w-[240px] shrink truncate text-xs ${
                                resolved.source === "user"
                                  ? "text-foreground"
                                  : resolved.source === "none"
                                    ? "italic text-muted-foreground/60"
                                    : "text-muted-foreground"
                              }`}
                              title={tip}
                            >
                              {resolved.profile ? resolved.profile.specialty : "（未标注）"}
                            </span>
                            {(() => {
                              const q = meta?.quota
                              if (!q) return null
                              const text =
                                q.tier === "unlimited" ? "∞ 免费" :
                                q.tier === "custom" ? (q.customText ?? "自定义") :
                                q.tier === "go_plus" ? `Go+ ${((q.requests5h ?? 0) / 1000).toFixed(1)}k/5h · $${q.monthlyUsd ?? 0}` :
                                `Go ${((q.requests5h ?? 0) / 1000).toFixed(1)}k/5h · $${q.monthlyUsd ?? 0}`
                              return (
                                <span
                                  className="shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] leading-none text-primary"
                                  title={`额度：${text}${meta?.quotaUpdatedAt ? ` · 更新于 ${new Date(meta.quotaUpdatedAt).toLocaleDateString("zh-CN")}` : ""}`}
                                >
                                  <Coins className="h-2.5 w-2.5" />
                                  {text}
                                </span>
                              )
                            })()}
                            {onSaveModelMeta && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setEditingMeta({ cfg, modelId: m.id })}
                                title="编辑擅长与额度"
                                aria-label={`编辑 ${m.id} 的标注`}
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </>
                        )
                      })()}
                      <EnableToggle
                        enabled={m.enabled}
                        disabled={busy}
                        labelText={`启用或停用 ${m.id}`}
                        onToggle={() => onToggleModel(cfg, m.id, !m.enabled)}
                      />
                      {(isTextGenerationModel(m.id) || isDefault) && (
                        <button
                          type="button"
                          disabled={busy || isDefault || !isTextGenerationModel(m.id)}
                          onClick={() => onSetDefault(cfg, m.id)}
                          title={
                            !isTextGenerationModel(m.id)
                              ? "非文本模型不能作为系统默认生成模型"
                              : isDefault
                                ? "已是系统默认模型"
                                : "设为默认后会自动启用该模型"
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Star className="h-3 w-3" />
                          设为默认
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onTest(cfg, m.id)}
                        title="发送一条测试消息，验证模型可用"
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FlaskConical className="h-3 w-3" />
                        测试
                      </button>
                    </li>
                  )
                })}
                {(cfg.models ?? []).length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground">
                    暂无模型，点「刷新模型」重新拉取，或编辑配置检查接口地址与 Key。
                  </li>
                )}
                {onlyUsable && (cfg.models ?? []).length > 0 && (cfg.models ?? []).filter((m) => {
                  const unhealthy = modelHealth[`personal:${cfg.id}:${m.id}`]
                  if (unhealthy) return false
                  const meta = modelMeta[`personal:${cfg.id}:${m.id}`]
                  if (meta?.quota) return true
                  if (resolveQuotaHint(m.id)) return true
                  return false
                }).length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground">
                    「只看可用」已开启，本配置下 {cfg.models?.length ?? 0} 个模型全部被隐藏（未标注额度或已挂账）。取消勾选可查看全部。
                  </li>
                )}
                {onlyUsable && (() => {
                  const total = (cfg.models ?? []).length
                  const visible = (cfg.models ?? []).filter((m) => {
                    const unhealthy = modelHealth[`personal:${cfg.id}:${m.id}`]
                    if (unhealthy) return false
                    const meta = modelMeta[`personal:${cfg.id}:${m.id}`]
                    if (meta?.quota) return true
                    if (resolveQuotaHint(m.id)) return true
                    return false
                  }).length
                  const hidden = total - visible
                  return hidden > 0 && visible > 0 ? (
                    <li className="px-3 py-2 text-xs italic text-muted-foreground/80">
                      已隐藏 {hidden} 个模型（未标注额度或已挂账）
                    </li>
                  ) : null
                })()}
              </ul>
            </article>
          )
        })}
      </div>

      {onSaveModelMeta && (
        <ModelMetaDialog
          open={!!editingMeta}
          modelId={editingMeta?.modelId ?? ""}
          configName={editingMeta?.cfg.config_name ?? ""}
          initial={editingMeta ? modelMeta[`personal:${editingMeta.cfg.id}:${editingMeta.modelId}`] ?? null : null}
          busy={false}
          onClose={() => setEditingMeta(null)}
          onSubmit={(patch) => {
            if (!editingMeta) return
            onSaveModelMeta(editingMeta.cfg, editingMeta.modelId, patch)
            setEditingMeta(null)
          }}
        />
      )}

      <Dialog open={!!deletingConfig} onOpenChange={(v) => !v && !deleteBusy && onCancelDelete()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除配置</DialogTitle>
            <DialogDescription>
              确定删除「{deletingConfig?.config_name}」吗？该配置下的 {(deletingConfig?.models ?? []).length} 个模型将不再可用，删除后无法恢复。
              {deletingConfig?.default_model ? "它当前是系统默认模型，删除后会自动回退平台内置 gpt-5.5。" : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCancelDelete} disabled={deleteBusy}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={deleteBusy}
              className="focus-visible:ring-2 focus-visible:ring-primary"
            >
              {deleteBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
