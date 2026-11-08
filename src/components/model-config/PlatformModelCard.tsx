import { AlertTriangle, FlaskConical, Loader2, Star } from "lucide-react"
import type { GatewayConfig } from "@/lib/modelGateway"
import { detectModelModality, isTextGenerationModel, modalityBadgeClass, modalityLabel } from "@/lib/modelModality"
import { PLATFORM_LOCAL_UNAVAILABLE_REASON } from "@/lib/platformModelAvailability"

type PlatformModelCardProps = {
  config: GatewayConfig | null
  busy: boolean
  onToggleModel: (cfg: GatewayConfig, modelId: string, enabled: boolean) => void
  onSetDefault: (cfg: GatewayConfig, modelId: string) => void
  onTest: (cfg: GatewayConfig, modelId: string) => void
  /**
   * R3 · D4「平台内置本地不可用需标明」：本机/内网部署下该通道**确定调不通**
   * （拿不到 RunningHub 登录态，恒 412）。为真时：
   *   · 卡片头换成红字说明真因（不是「登录后即可使用」这种假承诺）；
   *   · 「设为默认」禁用——不能把它变成默认成功路径；
   *   · 每个模型行打「本地不可用」徽标。
   * 判定与下拉（ModelSelect）共用 lib/platformModelAvailability，避免两处各判一套。
   */
  locallyUnusable?: boolean
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

export function PlatformModelCard({
  config,
  busy,
  onToggleModel,
  onSetDefault,
  onTest,
  locallyUnusable = false,
}: PlatformModelCardProps) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">公共模型</h2>
        <span className="badge-neutral">
          平台内置 · 按 token 用量计费
        </span>
        {locallyUnusable ? (
          // UX-R2（docs/ux-review-2026-11）：红色警告条改为默认收起的灰色折叠卡
          // （R3 的原因说明保留在展开区；R3 的假承诺文案不复现）
          <details className="ml-auto w-full">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              平台内置模型（仅线上部署可用）▸
            </summary>
            <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>本地不可用：{PLATFORM_LOCAL_UNAVAILABLE_REASON}</span>
            </p>
          </details>
        ) : (
          <p className="ml-auto text-xs text-muted-foreground">无需配置密钥，登录 RunningHub 账户后即可使用</p>
        )}
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
              const modality = detectModelModality(m.id)
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{m.id}</span>
                      {modality !== "text" && (
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${modalityBadgeClass(modality)}`}>
                          {modalityLabel(modality)}
                        </span>
                      )}
                      {locallyUnusable && (
                        <span className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] leading-none text-destructive">
                          本地不可用
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {locallyUnusable
                        ? "本机运行时无法拿到登录态，调用必然失败——请改用下方个人模型"
                        : modality === "text"
                          ? "长文本生成稳定，适合方案、标书与 PPT 内容"
                          : `非文本模态（${modalityLabel(modality)}），不参与方案/标书正文生成`}
                    </p>
                  </div>
                  {isDefault && (
                    <span className={locallyUnusable ? "rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive" : "badge-neutral"}>
                      {locallyUnusable ? "系统默认（不可用）" : "系统默认"}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <EnableToggle
                      enabled={m.enabled}
                      disabled={busy}
                      labelText={`启用或停用 ${m.id}`}
                      onToggle={() => onToggleModel(config, m.id, !m.enabled)}
                    />
                    {(isTextGenerationModel(m.id) || isDefault) && (
                      <button
                        type="button"
                        // R3：本地不可用时不给出「设为默认」这条路——它是 D4 点名
                        // 要消灭的「默认成功路径」。按钮仍在（不改变 DOM 结构），
                        // 但禁用并在 title 里说清真因。
                        disabled={busy || isDefault || !m.enabled || !isTextGenerationModel(m.id) || locallyUnusable}
                        onClick={() => onSetDefault(config, m.id)}
                        title={
                          locallyUnusable
                            ? PLATFORM_LOCAL_UNAVAILABLE_REASON
                            : !isTextGenerationModel(m.id)
                              ? "非文本模型不能作为系统默认生成模型"
                              : isDefault
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
                    )}
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
