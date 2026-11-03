// 统一模型网关前端调用层
// - 个人模型：经 __pb 代理走 /api/model-gw/*（服务端转发，前端绝不直连第三方地址）
// - 平台内置 gpt-5.5：仍走 @/lib/llm 的 callLlmWithFallback（poll-first 由其内部处理）
// - 收到 fallback_to_platform 时自动回退平台模型
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders, decodeRhToken } from "@/lib/rhLogin"
import { callLlmWithFallback, type LlmCallResult, type LlmMessage } from "@/lib/llm"
import { llmCacheGet, llmCacheSet } from "@/lib/llmCache"
// R203（docs/13 §3.3）：账号级失败时换一路已启用通道再试一次的决策内核
import { toast } from "sonner"
import { isLocalDeployHost } from "@/lib/rhLogin"
import { isTextGenerationModel } from "@/lib/modelModality"
// R216 缺陷修复：记住用户实际用过的模型，根治「选 A 调 B」的静默路由错乱
import {
  readPreferredModelKey,
  rememberUsedModel,
  resolvePreferredRef,
} from "@/lib/modelPrefs"
import {
  shouldShowFailoverNotice,
  tryFailoverCall,
  type FailoverCandidate,
  type FailoverRefLite,
} from "@/lib/modelFailover"
// R296（r294-default-model-hygiene）：确定性失效（模型不存在 / 上游停用 / Key 失效）
// 落长期健康档案，供配置页与模型选择器显式标注；限流 / 超时等瞬时类由会话冷却负责，不入档。
import { recordCallFailure, recordModelSuccess, readModelHealth } from "@/lib/modelHealth"

export const PLATFORM_MODEL_ID = "gpt-5.5"

// R208：个人配置不可用（被删 / 缺 Key / 无启用模型）的网关内部错误哨兵——不再在回退内核前直接 return 平台，
// 而是交回封装层先试个人备用通道，无可用候选才兜底（modelFailover 据此归为 config_broken 可回退类）
export const PERSONAL_CONFIG_UNAVAILABLE_ERR = "personal_config_unavailable"
// 无可用个人备用通道且本地自用域（平台令牌恒空必然 412）时的可执行引导文案（不含内部字段名）
const PERSONAL_CONFIG_UNAVAILABLE_HINT =
  "当前所选模型的个人配置不可用（可能已删除、缺少 API Key 或没有启用模型），也没有其他可用的已启用通道。请在顶部模型选择器切换到其他已配置的模型后重试。"
export const TEST_PROMPT = "请用一句话介绍你自己"

export type ModelSource = "platform" | "personal"

export interface ModelRef {
  source: ModelSource
  configId: string
  configName: string
  modelId: string
}

export interface GatewayConfigModel {
  id: string
  enabled: boolean
}

export interface GatewayConfig {
  id: string
  config_name: string
  base_url: string
  api_key_masked: string
  has_key: boolean
  models: GatewayConfigModel[]
  default_model: string
  is_platform: boolean
  last_check_status: string
  last_check_error: string
  last_checked_at: string
  created: string
  updated: string
}

export function modelRefKey(r: ModelRef): string {
  return `${r.source}:${r.configId}:${r.modelId}`
}

export function modelRefLabel(r: ModelRef): string {
  return r.source === "platform" ? `平台内置 ${r.modelId}` : `${r.configName} · ${r.modelId}`
}

export function costTextForModel(ref: ModelRef | null): string {
  return ref && ref.source === "personal"
    ? "将使用你配置的接口账户，费用由该账户承担"
    : "按实际 token 用量扣费"
}

// ---------------------------------------------------------------------------
// 网关 fetch 封装
// ---------------------------------------------------------------------------

type GwOk<T> = { ok: true; needLogin?: false } & T
type GwFail = { ok: false; needLogin?: boolean; code?: string; message: string }
export type GwResult<T> = GwOk<T> | GwFail

/** 归因摘要上限：够放下服务端首行真因，又不撑爆 UI 与日志 */
export const GW_FAIL_DETAIL_CHARS = 200

/** 单行化 + 截断：异常 message 可能带换行/堆栈，压成一行短摘要（空串表示无可读信息，不编造） */
function gwFailDetail(raw: unknown): string {
  const s = typeof raw === "string" ? raw : raw instanceof Error ? raw.message || raw.name : ""
  const one = s.replace(/\s+/g, " ").trim()
  if (!one) return ""
  return one.length > GW_FAIL_DETAIL_CHARS ? `${one.slice(0, GW_FAIL_DETAIL_CHARS)}…` : one
}

/**
 * R39b：网关调用失败文案的归因口径（纯函数，便于单测锁口径）。
 * 此前「fetch 抛错」与「有 HTTP 响应但正文不是网关 JSON 契约」两条完全不同的语义
 * 共用同一个 catch，一律输出「网络异常，请稍后重试」——用户看到的永远是同一句
 * 无法执行的话，真因（状态码 / 异常原文）只能靠翻服务端日志。
 * 现按两语义分别成文，并把可读摘要带回来；**锚点「网络异常」「服务异常」必须保留**——
 * @/lib/modelFailover 的 classifyCallFailure 正是靠它们把这类失败归为 unavailable
 * （账号级不可用、可自动换通道），换掉措辞会静默破坏回退策略。
 */
export function gwFetchFailMessage(
  input:
    | { kind: "thrown"; error: unknown }
    | { kind: "response"; status: number; ok: boolean },
): string {
  if (input.kind === "thrown") {
    const detail = gwFailDetail(input.error)
    return detail ? `网络异常，请稍后重试（${detail}）` : "网络异常，请稍后重试"
  }
  if (input.ok) return "返回格式异常"
  return `服务异常（HTTP ${input.status}），请稍后重试`
}

async function gwFetch<T>(path: string, init?: RequestInit): Promise<GwResult<T>> {
  try {
    const res = await fetch(`${getPocketBaseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...vibexAuthHeaders(),
        ...(init?.headers ?? {}),
      },
    })
    if (res.status === 401) {
      return { ok: false, needLogin: true, code: "LOGIN_REQUIRED", message: "请先登录后再使用模型功能" }
    }
    const data = (await res.json().catch(() => null)) as (GwResult<T> & Record<string, unknown>) | null
    if (!data) {
      return { ok: false, message: gwFetchFailMessage({ kind: "response", status: res.status, ok: !!res.ok }) }
    }
    return data as GwResult<T>
  } catch (err) {
    return { ok: false, message: gwFetchFailMessage({ kind: "thrown", error: err }) }
  }
}

// ---------------------------------------------------------------------------
// 配置 CRUD（model-config 页使用）
// ---------------------------------------------------------------------------

export async function listGatewayConfigs(): Promise<GwResult<{ items: GatewayConfig[] }>> {
  return gwFetch<{ items: GatewayConfig[] }>(`/api/model-gw/configs`)
}

export async function createGatewayConfig(input: {
  config_name: string
  base_url: string
  api_key: string
}): Promise<GwResult<{ config: GatewayConfig }>> {
  return gwFetch<{ config: GatewayConfig }>(`/api/model-gw/configs`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateGatewayConfig(
  id: string,
  patch: {
    config_name?: string
    base_url?: string
    api_key?: string
    models?: GatewayConfigModel[]
    default_model?: string
    clear_default?: boolean
  },
): Promise<GwResult<{ config: GatewayConfig }>> {
  return gwFetch<{ config: GatewayConfig }>(`/api/model-gw/configs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function deleteGatewayConfig(id: string): Promise<GwResult<Record<string, never>>> {
  return gwFetch<Record<string, never>>(`/api/model-gw/configs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function refreshGatewayModels(id: string): Promise<GwResult<{ config: GatewayConfig }>> {
  return gwFetch<{ config: GatewayConfig }>(
    `/api/model-gw/configs/${encodeURIComponent(id)}/refresh-models`,
    { method: "POST" },
  )
}

// ---------------------------------------------------------------------------
// 可用模型解析（三个 AI 页面 + 本页共用）
// ---------------------------------------------------------------------------

export interface AvailableModels {
  configs: GatewayConfig[]
  models: ModelRef[]
  defaultRef: ModelRef | null
  platformRef: ModelRef | null
}

export function buildAvailableModels(configs: GatewayConfig[]): Omit<AvailableModels, "configs"> {
  const models: ModelRef[] = []
  let platformRef: ModelRef | null = null
  let defaultRef: ModelRef | null = null
  for (const cfg of configs) {
    for (const m of cfg.models ?? []) {
      if (!m || !m.enabled) continue
      const ref: ModelRef = {
        source: cfg.is_platform ? "platform" : "personal",
        configId: cfg.id,
        configName: cfg.config_name,
        modelId: m.id,
      }
      models.push(ref)
      if (cfg.is_platform) platformRef = ref
      if (cfg.default_model === m.id) defaultRef = ref
    }
  }
  return { models, defaultRef: defaultRef ?? platformRef, platformRef }
}

export async function resolveAvailableModels(): Promise<AvailableModels> {
  const res = await listGatewayConfigs()
  if (!res.ok) return { configs: [], models: [], defaultRef: null, platformRef: null }
  const built = buildAvailableModels(res.items)
  // R216 缺陷修复：默认模型不再由「配置声明顺序」决定，而优先取用户实际成功用过的那个。
  // 原实现只用 buildAvailableModels 的 defaultRef（=唯一声明了 default_model 的那条配置），
  // 实测导致所有页面默认落到 bailing，用户在顶部选了别的模型也会被静默改回。
  const userId = decodeRhToken()?.sub ?? null
  const preferred = resolvePreferredRef(built.models, readPreferredModelKey(userId))
  // P0 修复（默认模型卫生）：健康档案挂账的通道（额度耗尽 / 已下线 / Key 失效）不再作为
  // 默认模型——实测 bailing 默认模型 quota 挂账后，各页面首轮 AI 仍默认选中它、必然失败，
  // 用户看到的就是「一发问就报错」。偏好或配置默认命中挂账时，顺位取第一个健康模型；
  // 全部挂账时维持原口径（用户显式选择不受影响，仍可在选择器里手动选中挂账模型）。
  const health = readModelHealth(userId)
  const isUnhealthy = (m: ModelRef | null): boolean => !!m && modelRefKey(m) in health
  let defaultRef = preferred ?? built.defaultRef
  if (isUnhealthy(defaultRef)) {
    defaultRef = built.models.find((m) => !isUnhealthy(m)) ?? built.platformRef ?? defaultRef
  }
  return { configs: res.items, ...built, defaultRef }
}

// ---------------------------------------------------------------------------
// 统一对话入口
// ---------------------------------------------------------------------------

export interface ChatViaGatewayOptions {
  modelRef?: ModelRef | null
  messages: LlmMessage[]
  max_tokens?: number
  temperature?: number
  page?: string
  /** T13：推理型模型把 max_tokens 耗在思考上导致 content 为空——解析类调用置 true 关闭思考 */
  disableThinking?: boolean
  /** p1-ux：外部可中断信号；用户点「取消」时置 aborted，前端区分于服务超时 */
  signal?: AbortSignal
  /**
   * LLM 降耗：开启后对「同模型 + 完整 messages + 参数 + page」完全一致的请求做精确响应缓存，
   * 命中直接返回、不再出站计费。默认关闭——不改变「重新生成」等期望每次新结果的调用行为，
   * 仅由确定性强、重复收益高的调用（如知识库问答）显式开启。
   */
  cacheable?: boolean
  /** 缓存存活时长（毫秒），默认 24h */
  cacheTtlMs?: number
}

// 精确缓存命中口径：把影响输出的全部入参序列化为一一映射的稳定 identity。
function llmCacheIdentity(opts: ChatViaGatewayOptions): string {
  const ref = opts.modelRef
  const isPlatform = !ref || ref.source === "platform"
  return JSON.stringify({
    src: isPlatform ? "platform" : "personal",
    cid: isPlatform ? "" : ref!.configId,
    mid: isPlatform ? PLATFORM_MODEL_ID : ref!.modelId,
    msgs: opts.messages,
    mt: opts.max_tokens ?? null,
    t: opts.temperature ?? null,
    p: opts.page ?? "",
    dt: opts.disableThinking ?? false,
  })
}

export async function chatViaGateway(opts: ChatViaGatewayOptions): Promise<LlmCallResult> {
  // R203：缓存未命中/不缓存的路径都经回退包装（命中缓存的答复本就成功）
  if (!opts.cacheable) return chatViaGatewayWithFailover(opts)
  const userId = decodeRhToken()?.sub ?? null
  const identity = llmCacheIdentity(opts)
  const hit = await llmCacheGet(userId, identity)
  if (hit) return hit
  const result = await chatViaGatewayWithFailover(opts)
  void llmCacheSet(userId, identity, result, opts.cacheTtlMs)
  return result
}

// 个人模型出站前端兜底超时：服务端转发上限 120s，留 30s 余量；
// 防跨服务重启的请求连接半开挂死、生成按钮无限转圈不报错
const PERSONAL_CHAT_TIMEOUT_MS = 150_000

/**
 * 个人模型「超时」失败的可执行引导文案（R177）。
 * 网关服务端单请求转发上限约 120s（model_gateway.pb.js 红线区），慢模型 / 超长小节易触发；
 * 旧文案「请重试或切换平台内置模型」在本地自用域是死路——平台内置令牌恒空必然 412 且已禁用
 * （见 ModelSelect.tsx 本地禁用逻辑），故改为「切换到更快的已配置模型 / 分章生成」的正确指引。
 */
export const PERSONAL_TIMEOUT_MSG =
  "该模型本次响应超时（网关单次请求上限约 120 秒，偏慢的模型或超长小节容易触发）。请在顶部切换到更快的已配置模型（例如 sensenova-flash-lite）后点「继续生成 / 继续生成正文」重试，或改为逐章分次生成。"

/**
 * 把客户端 abort 或服务端返回的超时详情串归一为可执行文案；命中超时返回 PERSONAL_TIMEOUT_MSG，
 * 非超时返回 null（交由调用方按原始信息透出）。纯函数，便于单测锁口径。
 */
export function personalTimeoutError(rawMessage?: string): string | null {
  const t = (rawMessage ?? "").toLowerCase()
  if (/超时|限定时间内返回|timeout|timed out|deadline/.test(t)) return PERSONAL_TIMEOUT_MSG
  return null
}

// 超时降级重试的单次输出预算下限（R178 抽为可测契约，供 llmGenerate 恢复循环节流）
export const TIMEOUT_RETRY_MIN_TOKENS = 2048

/**
 * 超时降级重试的下一档输出预算：折半但不低于下限。纯函数，锁死恢复节奏防重构回退。
 */
export function nextDegradedBudget(prevTokens: number): number {
  return Math.max(Math.floor(prevTokens / 2), TIMEOUT_RETRY_MIN_TOKENS)
}

/**
 * 是否应走超时降级重试：仅「请求失败（ok=false）且错误串命中超时」为真。
 * 用户取消 / 需登录 / 内容审核 / 余额等非超时一律假，交由调用方原样处理，不盲目重试计费。
 */
export function shouldDegradeRetry(resultOk: boolean, error?: string): boolean {
  return !resultOk && personalTimeoutError(error) !== null
}

// R216 缺陷修复：原实现取 configs 数组「第一个」可用配置——而接口返回顺序里 bailing 恰好排首位
//   且是唯一声明了 default_model 的配置，于是任何未显式传 modelRef 的调用都被静默改道到 bailing。
//   现改为「用户偏好优先，其次声明了默认模型的配置，最后才退到首个可用配置」，
//   并对同一配置的模型做可用性校验，保证选中的一定是enabled 且真实存在的模型。
/**
 * 从个人配置里挑一条「能直接发」的通道（纯函数，单测锁口径）。
 *
 * 排序口径：
 *   ① 用户偏好命中的配置 —— 用户长期用哪个就优先用哪个
 *   ② 显式声明了 default_model 的配置 —— 配置者主动指定，语义强于数组顺序
 *   ③ 其余保持接口返回顺序 —— 不引入额外不确定性
 *
 * R302：在此之上叠加健康档案过滤——原实现只做上面的排序，从不看
 * `getModelHealth`，于是这台浏览器上已实测「已停用 / 模型不存在 / Key 失效」的通道
 * 依然会被挑中，用户看到的就是「刚修好又报同一个错」。健康档案本身是「失败后才记账」，
 * 所以从未成功过的新模型不会被它挡掉（那是对的：没证据就不判它坏），
 * 这里只负责把**已有确凿坏证据**的通道排到最后。
 */
export function pickUsablePersonalRef(
  configs: GatewayConfig[],
  isUnhealthy: (key: string) => boolean,
  preferredKey: string | null = null,
): ModelRef | null {
  const personal = (configs || []).filter((c) => c && !c.is_platform && c.has_key)
  const rank = (c: GatewayConfig): number => {
    if (preferredKey && preferredKey.startsWith(`personal:${c.id}:`)) return 0
    return c.default_model ? 1 : 2
  }
  const ordered = [...personal].sort((a, b) => rank(a) - rank(b))
  let fallback: ModelRef | null = null
  for (const c of ordered) {
    const enabled = (c.models || []).filter((m) => m && m.enabled !== false)
    const modelId = c.default_model || (enabled[0] && enabled[0].id) || ""
    if (!modelId) continue
    // 默认模型已从启用列表中移除时不能硬发（下游会返回 model_disabled），退回该配置首个可用模型
    const live = enabled.length ? enabled.some((m) => m.id === modelId) : false
    const useId = live ? modelId : enabled.length ? enabled[0].id : ""
    if (!useId) continue
    const ref: ModelRef = { source: "personal", configId: c.id, configName: c.config_name || c.id, modelId: useId }
    if (!isUnhealthy(modelRefKey(ref))) return ref
    if (!fallback) fallback = ref
  }
  // 全部挂账时仍返回首选（用户显式使用不受影响；总比直接报"没有可用通道"好）
  return fallback
}

async function pickFirstPersonalModelRef(): Promise<ModelRef | null> {
  try {
    const cfgs = await gwFetch<{ items: GatewayConfig[] }>(`/api/model-gw/configs`)
    if (!cfgs.ok) return null
    const userId = decodeRhToken()?.sub ?? null
    const health = readModelHealth(userId)
    return pickUsablePersonalRef(cfgs.items || [], (key) => key in health, readPreferredModelKey(userId))
  } catch {
    /* 配置拉取失败则放弃兜底 */
  }
  return null
}

/**
 * R216：响应回显模型与请求模型不一致时的告警文案。
 * 网关正常会回显实际使用的模型；若不一致说明上游做了模型改道（别名 / 降级 / 网关重写），
 * 此时必须让用户知道「你选的不是实际出内容的那个」——静默吞掉就是投标事故的源头。
 * 返回 null 表示一致，无需提示。纯函数便于单测。
 */
export function modelMismatchNotice(requested: string, actual: string | undefined | null): string | null {
  const want = (requested || "").trim()
  const got = (actual || "").trim()
  if (!got || !want) return null
  if (got === want) return null
  return `注意：本次实际由模型「${got}」生成，与所选的「${want}」不一致。`
}

async function chatViaGatewayUncached(opts: ChatViaGatewayOptions): Promise<LlmCallResult> {
  const ref = opts.modelRef
  if (!ref || ref.source === "platform") {
    const plat = await callLlmWithFallback(PLATFORM_MODEL_ID, {
      messages: opts.messages,
      page: opts.page,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
      signal: opts.signal,
    })
    // R215：本地部署未登录 RunningHub 时平台通道必挂（rh_login_required）。
    // 自动落回第一个可用的个人网关配置，让补全/生成等 AI 功能在本地环境照样可用；
    // RH 已登录用户不受影响（平台成功时直接返回）。
    if (!plat.ok && plat.needsLogin) {
      const alt = await pickFirstPersonalModelRef()
      if (alt) {
        const r2 = await chatViaGatewayUncached({ ...opts, modelRef: alt })
        if (r2.ok) return { ...r2, model: r2.model || alt.modelId }
      }
    }
    return plat
  }
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), PERSONAL_CHAT_TIMEOUT_MS)
  // 用户主动取消 → 联动内部 ctrl.abort；用 userAborted 标记区分服务超时
  let userAborted = false
  if (opts.signal) {
    if (opts.signal.aborted) {
      userAborted = true
      ctrl.abort()
    } else {
      opts.signal.addEventListener("abort", () => {
        userAborted = true
        ctrl.abort()
      }, { once: true })
    }
  }
  let res: GwResult<{ text: string; model?: string }>
  try {
    res = await gwFetch<{ text: string; model?: string }>(`/api/model-gw/chat`, {
      method: "POST",
      signal: ctrl.signal,
      body: JSON.stringify({
        config_id: ref.configId,
        model: ref.modelId,
        messages: opts.messages,
        max_tokens: opts.max_tokens,
        temperature: opts.temperature,
        ...(opts.disableThinking ? { disable_thinking: true } : {}),
      }),
    })
  } finally {
    window.clearTimeout(timer)
  }
  if (userAborted) {
    return { ok: false, status: "failed", text: "", error: "user_cancelled" }
  }
  if (!res.ok && ctrl.signal.aborted) {
    return { ok: false, status: "failed", text: "", error: PERSONAL_TIMEOUT_MSG }
  }
  if (!res.ok) {
    if (res.needLogin) {
      return { ok: false, status: "failed", text: "", error: "rh_login_required", needsLogin: true }
    }
    // R208：个人配置不可用（被删 / 缺 Key / 无启用模型）→ 抛内部哨兵交回封装层，先试个人备用通道再谈兜底
    if (res.code === "fallback_to_platform") {
      return { ok: false, status: "failed", text: "", error: PERSONAL_CONFIG_UNAVAILABLE_ERR }
    }
    // R296：拿到上游原始错误串即记账——只挂确定性失效，限流 / 超时自动忽略
    recordCallFailure(decodeRhToken()?.sub ?? null, modelRefKey(ref), res.message)
    return {
      ok: false,
      status: "failed",
      text: "",
      error: (personalTimeoutError(res.message) ?? res.message) || "生成失败，请重试",
    }
  }
  // R216：成功即记忆本次实际使用的模型，作为下次默认（根治静默改道）；
  // 同时校验网关回显的模型是否就是所选模型，不一致时明确告知用户而非静默吞掉。
  rememberUsedModel(decodeRhToken()?.sub ?? null, modelRefKey(ref))
  // R296：本次实调成功 → 清掉该通道此前的「实测不可用」挂账
  recordModelSuccess(decodeRhToken()?.sub ?? null, modelRefKey(ref))
  const actualModel = res.model ?? ref.modelId
  const mismatch = modelMismatchNotice(ref.modelId, res.model)
  if (mismatch) {
    console.warn("[modelGateway] 模型回显不一致", { requested: ref.modelId, actual: res.model, configId: ref.configId })
    toast.warning(mismatch)
  }
  return { ok: true, status: "success", text: res.text, model: actualModel }
}

// ---------------------------------------------------------------------------
// R203（docs/13 §3.3）：通道级自动回退接线——决策与冷却登记在 @/lib/modelFailover，
// 此处只提供「候选来源 + 出站 + 用户提示」三件网关层才知道的事。
// ---------------------------------------------------------------------------

/** 候选缓存 TTL：只有某次调用已经失败才拉配置，健康路径零额外请求 */
const FAILOVER_CANDIDATE_TTL_MS = 60_000

/**
 * 把可用模型清单转成回退候选：只保留文本生成模型（向量 / 图像 / 视频 / 语音模型拿去聊天
 * 必然胡说，模态口径复用 R88 modelModality 单一真源），并标记各配置自身的默认模型。
 * 纯函数，便于单测锁口径。
 */
export function buildFailoverCandidates(av: AvailableModels): FailoverCandidate[] {
  const defaultKeys = new Set(
    av.configs
      .filter((c) => !!c.default_model)
      .map((c) => `${c.is_platform ? "platform" : "personal"}:${c.id}:${c.default_model}`),
  )
  const out: FailoverCandidate[] = []
  for (const m of av.models) {
    if (!isTextGenerationModel(m.modelId)) continue
    const key = modelRefKey(m)
    out.push({ key, ref: m, configId: m.configId, isConfigDefault: defaultKeys.has(key) })
  }
  return out
}

let failoverCandidatesCache: { at: number; items: FailoverCandidate[] } | null = null

async function getCachedFailoverCandidates(): Promise<FailoverCandidate[]> {
  const now = Date.now()
  const cached = failoverCandidatesCache
  if (cached && now - cached.at < FAILOVER_CANDIDATE_TTL_MS) return cached.items
  const items = buildFailoverCandidates(await resolveAvailableModels())
  failoverCandidatesCache = { at: now, items }
  return items
}

/** 回退成功的可见提示：30s 去重窗内同一次批量只说一次（文案不含内部字段名） */
function notifyModelFailover(from: FailoverRefLite | null, to: FailoverRefLite): void {
  if (!shouldShowFailoverNotice()) return
  toast.info(
    `${from ? modelRefLabel(from) : "当前模型"} 的接口暂时不可用，本次已自动改用备用通道「${modelRefLabel(to)}」完成生成。如需长期更换，请在顶部模型选择器里切换。`,
  )
}

/**
 * 统一出站的「先按所选通道，账号级失败则换一路再试一次」包装：
 * 回退成功返回备用通道结果（带 actualModelRefKey），否则原样交回首调错误。
 */
async function chatViaGatewayWithFailover(opts: ChatViaGatewayOptions): Promise<LlmCallResult> {
  const first = await chatViaGatewayUncached(opts)
  if (first.ok) return first
  const ref = opts.modelRef
  const failed: FailoverCandidate | null = ref
    ? { key: modelRefKey(ref), ref, configId: ref.configId, isConfigDefault: false }
    : null
  const out = await tryFailoverCall({
    first,
    failed,
    deps: {
      chat: (r) => chatViaGatewayUncached({ ...opts, modelRef: r }),
      candidates: getCachedFailoverCandidates,
      notify: notifyModelFailover,
      localDeploy: isLocalDeployHost,
    },
  })
  if (out) return out
  // R208：个人配置不可用且无可用个人备用通道时才兜底——云端落平台、本地自用域给可执行引导，
  // 修复此前「配置坏了」在回退内核之前就直接 return 平台、本地域被导成 412 死路且绕过候选挑选的问题
  if (first.error === PERSONAL_CONFIG_UNAVAILABLE_ERR) {
    if (!isLocalDeployHost()) {
      return callLlmWithFallback(PLATFORM_MODEL_ID, {
        messages: opts.messages,
        page: opts.page,
        max_tokens: opts.max_tokens,
        temperature: opts.temperature,
        signal: opts.signal,
      })
    }
    return { ok: false, status: "failed", text: "", error: PERSONAL_CONFIG_UNAVAILABLE_HINT }
  }
  return first
}

// ---------------------------------------------------------------------------
// 模型测试（model-config 页测试面板）
// ---------------------------------------------------------------------------

export interface TestModelResult {
  ok: boolean
  reply?: string
  elapsedMs?: number
  message?: string
  needLogin?: boolean
}

export async function testGatewayModel(ref: ModelRef): Promise<TestModelResult> {
  const startedAt = Date.now()
  if (ref.source === "platform") {
    const r = await callLlmWithFallback(PLATFORM_MODEL_ID, {
      messages: [{ role: "user", content: TEST_PROMPT }],
      page: "model-config",
      max_tokens: 200,
    })
    const elapsedMs = Date.now() - startedAt
    if (r.needsLogin) return { ok: false, needLogin: true, message: "请先登录后再测试" }
    if (!r.ok || r.status !== "success" || !r.text) {
      return { ok: false, elapsedMs, message: r.error === "insufficient_balance" ? "RunningHub 账户余额不足，请充值后重试" : r.error || "测试失败，请稍后重试" }
    }
    return { ok: true, reply: r.text, elapsedMs }
  }
  const testCtrl = new AbortController()
  const testTimer = window.setTimeout(() => testCtrl.abort(), PERSONAL_CHAT_TIMEOUT_MS)
  let res: GwResult<{ reply: string; elapsed_ms?: number }>
  try {
    res = await gwFetch<{ reply: string; elapsed_ms?: number }>(`/api/model-gw/test`, {
      method: "POST",
      signal: testCtrl.signal,
      body: JSON.stringify({ config_id: ref.configId, model: ref.modelId }),
    })
  } finally {
    window.clearTimeout(testTimer)
  }
  if (!res.ok && testCtrl.signal.aborted) {
    return { ok: false, elapsedMs: Date.now() - startedAt, message: "测试请求超时（可能网络波动或服务重启），请重试" }
  }
  if (!res.ok) {
    // R296：「测试」是用户对不可用通道的处置闭环——失败按类别挂账，成功即清账
    recordCallFailure(decodeRhToken()?.sub ?? null, modelRefKey(ref), res.message)
    return { ok: false, needLogin: res.needLogin, message: res.message || "测试失败，请稍后重试" }
  }
  recordModelSuccess(decodeRhToken()?.sub ?? null, modelRefKey(ref))
  return { ok: true, reply: res.reply, elapsedMs: res.elapsed_ms ?? Date.now() - startedAt }
}
