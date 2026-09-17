import { AlertTriangle, Cpu, FlaskConical, Loader2, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { GatewayConfig } from "@/lib/modelGateway"

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
  deletingConfig: GatewayConfig | null
  deleteBusy: boolean
  onCancelDelete: () => void
  onConfirmDelete: () => void
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
  deletingConfig,
  deleteBusy,
  onCancelDelete,
  onConfirmDelete,
}: PersonalConfigListProps) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">个人模型配置</h2>
        <span className="badge-neutral">
          Key 只存服务端 · 仅显示后四位
        </span>
        <Button
          size="sm"
          onClick={onAdd}
          className="ml-auto bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 hover:bg-primary/90"
        >
          <Plus className="mr-1 h-4 w-4" />
          添加模型配置
        </Button>
      </header>

      <div className="space-y-4 px-4 py-4">
        {configs.length === 0 && (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-5 py-16 text-center">
            <Cpu className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">还没有个人模型配置</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
              添加公司或个人的 OpenAI 兼容接口（如 DeepSeek、Kimi、通义等），保存后会自动拉取该地址下的全部模型，可逐个启用并设为系统默认。
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={onAdd}
              className="mt-4 border-primary/40 text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
            >
              <Plus className="mr-1 h-4 w-4" />
              添加第一个配置
            </Button>
          </div>
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
                {(cfg.models ?? []).map((m) => {
                  const isDefault = cfg.default_model === m.id
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${m.enabled ? "bg-primary" : "bg-muted-foreground/40"}`}
                        aria-hidden
                      />
                      <span className={`min-w-0 flex-1 truncate font-mono text-sm ${m.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {m.id}
                      </span>
                      {isDefault && (
                        <span className="badge-neutral">
                          系统默认
                        </span>
                      )}
                      <EnableToggle
                        enabled={m.enabled}
                        disabled={busy}
                        labelText={`启用或停用 ${m.id}`}
                        onToggle={() => onToggleModel(cfg, m.id, !m.enabled)}
                      />
                      <button
                        type="button"
                        disabled={busy || isDefault}
                        onClick={() => onSetDefault(cfg, m.id)}
                        title={isDefault ? "已是系统默认模型" : "设为默认后会自动启用该模型"}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Star className="h-3 w-3" />
                        设为默认
                      </button>
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
              </ul>
            </article>
          )
        })}
      </div>

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
