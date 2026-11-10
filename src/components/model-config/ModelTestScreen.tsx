// 模型配置 · 连通测试（UX-v2 1:1：docs/ux-v2-2026-11/prototype/model/test.html）
//
// 结构对齐原型：
//   A. 页头：标题 + 连通徽标 / desc / meta 三格 / 「回通道与默认」
//   B. 左：测试表单（通道 + 模型选择 / 提示词 / 开始测试 / 重置）
//   C. 左：失败时怎么读（四色徽标 + 一句人话）
//   D. 左：最近 5 次测试（来自 modelTestLog 真实台账）
//   E. 右：测试结果（首字延迟 / 总耗时 / token 用量 / 返回内容）
//   F. 右：通道速查
//
// 数据边界：
//   · 提示词可编辑——但网关的测试入口 testGatewayModel 走固定 TEST_PROMPT，
//     自定义 prompt / 温度 / max_tokens 都要改网关签名，属新能力（TODO:test-params），
//     因此这几个控件如实置灰并说明，不做「看着能调、其实没生效」的假控件。
//   · 首字延迟：网关一次性返回整段文本，没有流式时间戳 → 「—」（不拿总耗时冒充首字）。
//   · token 用量：测试接口不回 usage → 「—」。
// 已落地的真能力：通道/模型选择、真实测试、结果回显、总耗时、测试台账（最近 5 次）。
import { useMemo, useState } from "react"
import { ChevronDown, FlaskConical, History, Play, RotateCcw, Server } from "lucide-react"

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
import { TEST_PROMPT, type ModelRef } from "@/lib/modelGateway"
import { describeWhen, formatElapsed, summarizeTestLog } from "@/lib/modelTestLog"
import { cn } from "@/lib/utils"
import type { useModelConfig } from "@/pages/ModelConfig/useModelConfig"

type Props = {
  p: ReturnType<typeof useModelConfig>
  onGoChannels: () => void
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
      {footer ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/40 px-4 py-2 text-[11.5px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </section>
  )
}

/** 失败分类人话（原型「失败时怎么读」四档 + 现网真实类别对齐） */
const FAILURE_CHEATSHEET = [
  { badge: "danger" as const, label: "本地不可用", text: "平台内置模型，只在线上部署可用。换个人通道即可。" },
  { badge: "danger" as const, label: "Key 失效", text: "通道凭证被上游停用或填错，需重新填 Key。" },
  { badge: "warning" as const, label: "未配置模型", text: "该功能没指定模型、全局默认也为空。去「通道与默认」补。" },
  { badge: "neutral" as const, label: "超时 / 限流", text: "上游繁忙或长文本超过时限，属波动，可稍后重试。" },
]

export function ModelTestScreen({ p, onGoChannels }: Props) {
  // 选中的通道（null = 未选，用默认来源）；选中的模型 key
  const [channelId, setChannelId] = useState<string>("")
  const [modelId, setModelId] = useState<string>("")
  const [showDisabled, setShowDisabled] = useState(false)

  const configs = useMemo(
    () => [...(p.platformConfig ? [p.platformConfig] : []), ...p.personalConfigs],
    [p.platformConfig, p.personalConfigs],
  )

  // 当前通道：显式选择 > 有已启用模型的第一个个人通道 > 平台内置
  const activeChannel = useMemo(() => {
    if (channelId) return configs.find((c) => c.id === channelId) ?? null
    const withEnabled = p.personalConfigs.find((c) => (c.models ?? []).some((m) => m.enabled))
    return withEnabled ?? p.platformConfig ?? configs[0] ?? null
  }, [channelId, configs, p.personalConfigs, p.platformConfig])

  const channelModels = activeChannel ? (activeChannel.models ?? []) : []
  const visibleModels = showDisabled ? channelModels : channelModels.filter((m) => m.enabled)
  const activeModelId =
    modelId && channelModels.some((m) => m.id === modelId)
      ? modelId
      : (channelModels.find((m) => m.enabled)?.id ?? channelModels[0]?.id ?? "")

  const logSummary = useMemo(() => summarizeTestLog(p.testLog), [p.testLog])
  const recent = p.testLog.slice(0, 5)

  const runCurrent = () => {
    if (!activeChannel || !activeModelId) return
    void p.runTest(activeChannel, activeModelId)
  }

  const running = p.testRunning
  const result = p.testResult
  const resultOk = result?.ok === true
  // 「通了但没内容」：接口 200、通道确实可达，但 reply 为空。实测常见于推理型模型把
  // max_tokens=200 全花在思考上。这种不能只打「成功」了事——用户会以为一切正常。
  const emptyReply = resultOk && !(result?.reply ?? "").trim()

  return (
    <div>
      <PageHeader
        title="连通测试"
        titleExtra={
          result ? (
            emptyReply ? (
              <Badge variant="warning">连通但无内容</Badge>
            ) : resultOk ? (
              <Badge variant="success">{p.testTargetLabel || "本次测试"} 连通</Badge>
            ) : (
              <Badge variant="danger">本次测试失败</Badge>
            )
          ) : (
            <Badge variant="neutral">尚未测试</Badge>
          )
        }
        desc={
          <>
            这一屏只做一件事：
            <b className="font-semibold text-foreground">发一条固定消息，看这条通道到底通不通、快不快</b>
            。失败时说人话——是环境限制、Key 失效、还是模型未配置，一眼分清。测试结果会留在本机台账里，方便对比换 Key 前后的差异。
          </>
        }
        meta={
          <>
            <span>
              已启用模型{" "}
              <b className="font-mono font-semibold text-foreground">
                {p.availableModels.length}
              </b>{" "}
              个
            </span>
            <span>
              最近测试{" "}
              <b className="font-mono font-semibold text-foreground">
                {logSummary.latestAt ? describeWhen(logSummary.latestAt) : "—"}
              </b>
            </span>
            <span>
              今日已测 <b className="font-mono font-semibold text-foreground">{logSummary.today}</b> 次
            </span>
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={onGoChannels}>
            回通道与默认
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* 左栏 */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* B. 测试表单 */}
          <Panel
            title={
              <>
                <FlaskConical className="h-4 w-4 text-primary" />
                测试表单
              </>
            }
            sub="固定消息，不消耗业务数据"
            right={<Badge variant="neutral">按实际 token 计费</Badge>}
          >
            <div className="space-y-3 px-4 py-3.5">
              {p.listLoading && configs.length === 0 ? (
                // 首屏在飞时不能走空态：那会让「还没拉到」看起来像「一条通道都没配」
                <LoadingState text="正在加载通道…" tone="compact" />
              ) : !activeChannel ? (
                <EmptyState
                  tone="compact"
                  title="还没有可测的通道"
                  hint="先在「通道与默认」添加一条 OpenAI 兼容通道并拉取模型列表。"
                  action={
                    <Button size="sm" onClick={onGoChannels}>
                      去配置通道
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <span className="mb-1 block text-[11.5px] font-medium text-foreground">通道</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-full justify-between px-2.5 text-xs">
                            <span className="truncate">{activeChannel.config_name || "未命名通道"}</span>
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
                          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">选择通道</div>
                          {configs.map((c) => (
                            <DropdownMenuItem
                              key={c.id}
                              onSelect={() => {
                                setChannelId(c.id)
                                setModelId("")
                              }}
                              className="text-xs"
                            >
                              <span className="truncate">{c.config_name || "未命名通道"}</span>
                              {c.is_platform ? (
                                <span className="text-[10px] text-muted-foreground">
                                  {p.platformLocallyUnusable ? "本地不可用" : "平台"}
                                </span>
                              ) : null}
                              {activeChannel.id === c.id ? <span className="ml-auto text-primary">✓</span> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[11.5px] font-medium text-foreground">模型</span>
                        {channelModels.length > visibleModels.length ? (
                          <button
                            type="button"
                            onClick={() => setShowDisabled((v) => !v)}
                            className="text-[10.5px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {showDisabled ? "只看已启用" : `含已停用（${channelModels.length}）`}
                          </button>
                        ) : null}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={visibleModels.length === 0}
                            className="h-8 w-full justify-between px-2.5 text-xs"
                          >
                            <span className="truncate font-mono">{activeModelId || "没有可测模型"}</span>
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                            选择模型（{visibleModels.length} 个）
                          </div>
                          {visibleModels.map((m) => (
                            <DropdownMenuItem
                              key={m.id}
                              onSelect={() => setModelId(m.id)}
                              className="text-xs"
                            >
                              <span className="truncate font-mono">{m.id}</span>
                              {!m.enabled ? <span className="text-[10px] text-muted-foreground">已停用</span> : null}
                              {activeModelId === m.id ? <span className="ml-auto text-primary">✓</span> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div>
                    <span className="mb-1 block text-[11.5px] font-medium text-foreground">提示词</span>
                    <textarea
                      readOnly
                      value={TEST_PROMPT}
                      rows={2}
                      aria-label="测试提示词（本版本固定）"
                      className="w-full resize-none rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[12.5px] text-foreground"
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      本版本测试消息固定在网关里（<span className="font-mono">{TEST_PROMPT}</span>），改提示词 / 温度 / 最大 token
                      需要网关新增参数（TODO:test-params），因此这里只读、不做假控件。
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={runCurrent} disabled={running || !activeModelId || !activeChannel}>
                      <Play className="h-3.5 w-3.5" />
                      {running ? "正在测试…" : "开始测试"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setChannelId("")
                        setModelId("")
                        setShowDisabled(false)
                      }}
                      disabled={running}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      重置
                    </Button>
                    <div className="flex-1" />
                    <span className="text-[11px] text-muted-foreground">一次性返回，耐心等几秒</span>
                  </div>
                </>
              )}
            </div>
          </Panel>

          {/* C. 失败时怎么读 */}
          <Panel title="失败时怎么读" sub="四种失败四种话术，不用翻日志">
            <ul className="space-y-1.5 px-4 py-3 text-[12px]">
              {FAILURE_CHEATSHEET.map((f) => (
                <li key={f.label} className="flex items-start gap-2">
                  <Badge variant={f.badge} className="shrink-0 text-[10px]">
                    {f.label}
                  </Badge>
                  <span className="min-w-0 flex-1 text-muted-foreground">{f.text}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {/* D. 最近 5 次测试（真实台账） */}
          <Panel
            title={
              <>
                <History className="h-4 w-4 text-primary" />
                最近 5 次测试
              </>
            }
            sub="本机台账 · 换 Key / 换通道前后可对比"
            right={
              p.testLog.length > 5 ? <span className="text-[11px] text-muted-foreground">共 {p.testLog.length} 条</span> : null
            }
            footer={
              <>
                <span>
                  已测 {logSummary.total} 次 · 成功 {logSummary.ok} · 失败 {logSummary.failed}
                </span>
                <span className="hidden h-3 w-px bg-border sm:block" />
                <span>失败也计入记录，方便对比换通道前后的差异；记录只在本机、按账号分桶。</span>
              </>
            }
          >
            {p.listLoading && configs.length === 0 ? (
              <div className="px-3 py-5">
                <LoadingState text="正在加载…" tone="compact" />
              </div>
            ) : recent.length === 0 ? (
              <div className="px-3 py-4">
                <EmptyState
                  tone="compact"
                  title="还没有测试记录"
                  hint="选好通道与模型，发一条固定消息——几秒内就能看清这条通道通不通、快不快。"
                  action={
                    <Button size="sm" onClick={runCurrent} disabled={running || !activeModelId}>
                      用当前配置测一次
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-secondary/60 text-[11.5px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">模型</th>
                      <th className="px-3 py-2 text-left font-semibold">通道</th>
                      <th className="px-3 py-2 text-right font-semibold">耗时</th>
                      <th className="px-3 py-2 text-left font-semibold">结果</th>
                      <th className="px-3 py-2 text-right font-semibold">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((e) => (
                      <tr key={`${e.key}-${e.at}`} className="border-t border-border/60">
                        <td className="px-3 py-1.5 font-mono text-foreground">{e.modelId}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{e.configName || "—"}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">{formatElapsed(e.elapsedMs)}</td>
                        <td className="px-3 py-1.5">
                          {e.ok ? (
                            <Badge variant="success" className="text-[10px]">
                              成功
                            </Badge>
                          ) : (
                            <Badge variant="danger" className="text-[10px]" title={e.message}>
                              失败
                            </Badge>
                          )}
                          {!e.ok && e.message ? (
                            <span className="ml-1.5 text-[11px] text-muted-foreground">{e.message.slice(0, 40)}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[11.5px] text-muted-foreground">
                          {describeWhen(e.at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* 右栏 */}
        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
          {/* E. 测试结果 */}
          <Panel
            title="测试结果"
            right={
              result ? (
                emptyReply ? (
                  <Badge variant="warning">连通但无内容</Badge>
                ) : resultOk ? (
                  <Badge variant="success">成功</Badge>
                ) : (
                  <Badge variant="danger">失败</Badge>
                )
              ) : (
                <Badge variant="neutral">未测试</Badge>
              )
            }
            footer={
              <>
                <span>只发一条固定消息，不读取客户或标书数据</span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => p.rerunTest()}
                  disabled={!p.testTargetLabel || running}
                  className="font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  再测一次
                </button>
              </>
            }
          >
            <div className="space-y-3 px-4 py-3.5">
              {!result && !running ? (
                <EmptyState
                  tone="compact"
                  title="还没有结果"
                  hint="点左侧「开始测试」，结果会显示在这里：耗时、成败、返回内容。"
                />
              ) : running ? (
                <LoadingState text="正在请求模型…" hint="一次性返回，长文本可能要等十几秒" tone="compact" />
              ) : result ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-foreground">
                      {p.testTargetLabel || activeModelId}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border px-2 py-1.5">
                      <div className="text-[10.5px] text-muted-foreground">首字延迟</div>
                      <div className="font-mono text-[15px] font-semibold text-muted-foreground" title="网关一次性返回整段文本，没有流式时间戳">
                        —
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-2 py-1.5">
                      <div className="text-[10.5px] text-muted-foreground">总耗时</div>
                      <div className="font-mono text-[15px] font-semibold text-foreground">
                        {formatElapsed(typeof result.elapsedMs === "number" ? result.elapsedMs : null)}
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-2 py-1.5">
                      <div className="text-[10.5px] text-muted-foreground">token 用量</div>
                      <div className="font-mono text-[15px] font-semibold text-muted-foreground" title="测试接口不回 usage">
                        —
                      </div>
                    </div>
                  </div>
                  <div className="h-px bg-border" />
                  {resultOk ? (
                    emptyReply ? (
                      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[12.5px] leading-relaxed text-warning">
                        接口返回成功但正文为空——通道是通的，只是这个模型没产出可见内容。常见于推理型模型把
                        <span className="font-mono"> max_tokens </span>
                        全用在思考上（测试固定 200）。想验证它能否出话，请在业务页用更大的输出上限试一次。
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
                        {result.reply}
                      </div>
                    )
                  ) : (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
                      {result.message || "测试失败，请稍后重试"}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </Panel>

          {/* F. 通道速查 */}
          <Panel
            title={
              <>
                <Server className="h-3.5 w-3.5 text-primary" />
                通道速查
              </>
            }
            right={
              <button
                type="button"
                onClick={onGoChannels}
                className="text-[11px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                配置 →
              </button>
            }
          >
            <ul className="space-y-1.5 px-4 py-3 text-[12px]">
              {configs.length === 0 ? (
                <li className="text-muted-foreground">还没有通道</li>
              ) : (
                configs.map((c) => {
                  const last = p.testLog.find((e) => e.configId === c.id)
                  const locallyUnusable = c.is_platform && p.platformLocallyUnusable
                  return (
                    <li key={c.id} className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          locallyUnusable ? "bg-muted-foreground/40" : last ? (last.ok ? "bg-primary" : "bg-destructive") : "bg-muted-foreground/40",
                        )}
                        aria-hidden
                      />
                      <span className={cn("min-w-0 flex-1 truncate", locallyUnusable ? "text-muted-foreground" : "text-foreground")}>
                        {c.config_name || "未命名通道"}
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                        {locallyUnusable ? "本地不可用" : last ? formatElapsed(last.elapsedMs) : "—"}
                      </span>
                    </li>
                  )
                })
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** 型别导出（供测试引用；避免组件文件导出非组件值触发 fast-refresh 规则） */
export type { ModelRef }
