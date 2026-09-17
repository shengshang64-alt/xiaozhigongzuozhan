import { FlaskConical, Loader2, Star } from "lucide-react"
import type { GatewayConfig } from "@/lib/modelGateway"

type PlatformModelCardProps = {
  config: GatewayConfig | null
  busy: boolean
  onToggleModel: (cfg: GatewayConfig, modelId: string, enabled: boolean) => void
  onSetDefault: (cfg: GatewayConfig, modelId: string) => void
  onTest: (cfg: GatewayConfig, modelId: string) => void
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

export function PlatformModelCard({ config, busy, onToggleModel, onSetDefault, onTest }: PlatformModelCardProps) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">公共模型</h2>
        <span className="badge-neutral">
          平台内置 · 按 token 用量计费
        </span>
        <p className="ml-auto text-xs text-muted-foreground">无需配置密钥，登录 RunningHub 账户后即可使用</p>
      </header>
      <div className="p-4 lg:p-5">
        {!config ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            正在加载平台模型…
          </div>
        ) : (
          <ul className="space-y-2">
            {(config.models ?? []).map((m) => {
              const isDefault = config.default_model === m.id
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{m.id}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      长文本生成稳定，适合方案、标书与 PPT 内容
                    </p>
                  </div>
                  {isDefault && (
                    <span className="badge-neutral">
                      系统默认
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <EnableToggle
                      enabled={m.enabled}
                      disabled={busy}
                      labelText={`启用或停用 ${m.id}`}
                      onToggle={() => onToggleModel(config, m.id, !m.enabled)}
                    />
                    <button
                      type="button"
                      disabled={busy || isDefault || !m.enabled}
                      onClick={() => onSetDefault(config, m.id)}
                      title={
                        isDefault
                          ? "已是系统默认模型"
                          : !m.enabled
                            ? "模型已停用，先启用后才能设为默认"
                            : "设为默认后会自动启用该模型"
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Star className="h-3.5 w-3.5" />
                      设为默认
                    </button>
                    <button
                      type="button"
                      disabled={busy || !m.enabled}
                      onClick={() => onTest(config, m.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      测试
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
