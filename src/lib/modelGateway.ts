// 统一模型网关前端调用层
// - 个人模型：经 __pb 代理走 /api/model-gw/*（服务端转发，前端绝不直连第三方地址）
// - 平台内置 gpt-5.5：仍走 @/lib/llm 的 callLlmWithFallback（poll-first 由其内部处理）
// - 收到 fallback_to_platform 时自动回退平台模型
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders, decodeRhToken } from "@/lib/rhLogin"
import { callLlmWithFallback, type LlmCallResult, type LlmMessage } from "@/lib/llm"
import { llmCacheGet, llmCacheSet } from "@/lib/llmCache"

export const PLATFORM_MODEL_ID = "gpt-5.5"
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
      return { ok: false, message: res.ok ? "返回格式异常" : `服务异常（HTTP ${res.status}），请稍后重试` }
    }
    return data as GwResult<T>
  } catch {
    return { ok: false, message: "网络异常，请稍后重试" }
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
  return { configs: res.items, ...buildAvailableModels(res.items) }
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
  if (!opts.cacheable) return chatViaGatewayUncached(opts)
  const userId = decodeRhToken()?.sub ?? null
  const identity = llmCacheIdentity(opts)
  const hit = await llmCacheGet(userId, identity)
  if (hit) return hit
  const result = await chatViaGatewayUncached(opts)
  void llmCacheSet(userId, identity, result, opts.cacheTtlMs)
  return result
}

// 个人模型出站前端兜底超时：服务端转发上限 120s，留 30s 余量；
// 防跨服务重启的请求连接半开挂死、生成按钮无限转圈不报错
const PERSONAL_CHAT_TIMEOUT_MS = 150_000

async function chatViaGatewayUncached(opts: ChatViaGatewayOptions): Promise<LlmCallResult> {
  const ref = opts.modelRef
  if (!ref || ref.source === "platform") {
    return callLlmWithFallback(PLATFORM_MODEL_ID, {
      messages: opts.messages,
      page: opts.page,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
      signal: opts.signal,
    })
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
    return { ok: false, status: "failed", text: "", error: "个人模型请求超时（可能网络波动或服务重启），请重试或切换平台内置模型" }
  }
  if (!res.ok) {
    if (res.needLogin) {
      return { ok: false, status: "failed", text: "", error: "rh_login_required", needsLogin: true }
    }
    // 个人配置不可用（被删 / 缺 Key / 无启用模型）→ 回退平台模型，保证生成不中断
    if (res.code === "fallback_to_platform") {
      return callLlmWithFallback(PLATFORM_MODEL_ID, {
        messages: opts.messages,
        page: opts.page,
        max_tokens: opts.max_tokens,
        temperature: opts.temperature,
        signal: opts.signal,
      })
    }
    return { ok: false, status: "failed", text: "", error: res.message || "生成失败，请重试" }
  }
  return { ok: true, status: "success", text: res.text, model: res.model ?? ref.modelId }
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
    return { ok: false, needLogin: res.needLogin, message: res.message || "测试失败，请稍后重试" }
  }
  return { ok: true, reply: res.reply, elapsedMs: res.elapsed_ms ?? Date.now() - startedAt }
}
