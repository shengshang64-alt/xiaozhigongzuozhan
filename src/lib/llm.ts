import { pb, getPocketBaseUrl } from "./pb"
import { getAuthHeaders } from "./auth"

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export interface LlmMessage {
  role: "system" | "user" | "assistant"
  content: string | LlmContentPart[]
}

export interface LlmCallOptions {
  messages: LlmMessage[]
  page?: string
  max_tokens?: number
  temperature?: number
  signal?: AbortSignal
  request_id?: string
}

export interface LlmCallResult {
  ok: boolean
  status: "success" | "failed" | "running" | "pending" | "not_found"
  text: string
  error?: string
  model?: string
  usage?: unknown
  needsLogin?: boolean
  /**
   * R203 模型通道自动回退：本次实际出活的通道唯一键（source:configId:modelId）。
   * 仅当网关把请求改投备用通道并成功产出时存在，供上层把延迟 / 预算证据记到真正
   * 干活的那一路，而不是用户所选（但刚刚失败）的通道。缺省 = 未发生回退。
   */
  actualModelRefKey?: string
}

// 2026-10-07 25000 → 240000：本地 model-gw 的 /chat 是同步返回（响应头要等上游生成完才回来），
// 25s 会把所有超过 25s 的生成（大 JSON 编排、长章节）在响应头阶段就中止，随后轮询本地不存在的
// 平台轮询路由 → 必失败（表现为「返回格式异常，回复内容为空」「编排调用均未产出有效结果」）。
// 平台异步路径不受影响：任务提交的响应头本来就秒回，中止只兜底「提交即挂死」的异常场景。
const CHAT_ABORT_MS = 240000
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 200

/**
 * 平台通道「失败响应」的归一（纯函数，便于单测锁口径）。
 *
 * 背景（阶段 1 · 包 1 止血）：llm.pb.js 的失败分支都是**同步 definitive** 的——
 * 上游 503 时它 `e.json(502, { error: "llm_failed", message: "LLM HTTP 503 …" })`，
 * 任务记录同时被标成 failed。但原实现只要首跳不是 2xx 就 `initialFailed = true`
 * 掉进 200 × 3s ≈ **10 分钟**的轮询，轮询每次都拿到同一个 502 → 最后统一报
 * `error: "timeout"`。用户侧表现就是：明明上游「模型服务繁忙（503）」，却干等十分钟
 * 后被告诉「AI 处理超时」，既不是真因、也没有可执行动作。
 *
 * 口径：
 *   ① 服务端已拼成中文人话（含上游状态码与处置建议）→ 原样透出，不吞细节；
 *   ② 只有英文/原始报文 → **不把上游原文灌给用户**，按内嵌状态码归一成可执行中文；
 *   ③ 2xx 一律返回 null（成功路径不受影响）。
 */
export function platformFailureResult(status: number, body: unknown): LlmCallResult | null {
  if (status >= 200 && status < 300) return null
  if (status === 412) {
    return { ok: false, status: "failed", text: "", error: "rh_login_required", needsLogin: true }
  }
  if (status === 404) return { ok: false, status: "failed", text: "", error: "not_found" }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const message = typeof rec.message === "string" ? rec.message.trim() : ""
  const code = typeof rec.error === "string" ? rec.error.trim() : ""
  if (message && /[\u4e00-\u9fff]/.test(message)) {
    return { ok: false, status: "failed", text: "", error: message }
  }
  // 报文里可能内嵌上游真实状态码（"LLM HTTP 503 …"），它比外层 502 更能指向病灶
  const embedded = message.match(/\b(?:HTTP\s*)?([45]\d{2})\b/)
  const eff = embedded ? Number(embedded[1]) : status
  if (eff === 503) {
    return { ok: false, status: "failed", text: "", error: "模型服务繁忙（HTTP 503），通常稍等几秒重试即可，不是配置错误" }
  }
  if (eff === 429) {
    return { ok: false, status: "failed", text: "", error: "模型通道被限流（HTTP 429），请稍等约半分钟后重试，或切换到其他已配置模型" }
  }
  if (eff === 401 || eff === 403) {
    return { ok: false, status: "failed", text: "", error: "模型通道鉴权失败（可能是 API Key 失效或已过期），请到「模型配置」核对后重试" }
  }
  if (eff >= 500) {
    return { ok: false, status: "failed", text: "", error: `上游模型服务异常（HTTP ${eff}），本次未产出内容，请稍后重试或切换模型` }
  }
  // 兜底：仍不外泄内部错误码，给状态码与下一步
  return {
    ok: false,
    status: "failed",
    text: "",
    error: code ? `模型请求被拒绝（HTTP ${eff}），请检查模型配置后重试` : `模型请求失败（HTTP ${eff}），请稍后重试`,
  }
}

// 老代际后端兼容 (发布刷新契约, rh_vc_deploy 依赖 "legacyLlmRoutes" 这个标记判断
// 本模板可以安全刷进老 app):
// 2026-07-01 aa25af8 之前的 llm.pb.js 注册的是按模型分路由
// (/api/llm/<model>/chat|poll), 没有扁平路由 /api/llm/chat|poll。
// 发布刷新只换前端 lib、不动 app 已装的 pb_hooks, 所以扁平路由 404 时自动降级
// 到按模型路由并记住结果 (同一个后端只有一种代际)。新后端永远不会命中 404,
// 这个分支零开销。
let legacyLlmRoutes: boolean | null = null

function llmUrl(kind: "chat" | "poll", modelName: string): string {
  const base = getPocketBaseUrl()
  return legacyLlmRoutes === true
    ? `${base}/api/llm/${encodeURIComponent(modelName)}/${kind}`
    : `${base}/api/llm/${kind}`
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return "req-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 10)
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...getAuthHeaders() }
  if (pb.authStore.token) headers.Authorization = pb.authStore.token
  return headers
}

async function pollOnce(modelName: string, requestId: string, signal?: AbortSignal): Promise<LlmCallResult> {
  let res: Response
  try {
    res = await fetch(llmUrl("poll", modelName), {
      method: "POST",
      credentials: "include",
      headers: buildHeaders(),
      body: JSON.stringify({ request_id: requestId }),
      signal,
    })
  } catch {
    return { ok: false, status: "running", text: "", error: "" }
  }
  if (res.status === 412) {
    return { ok: false, status: "failed", text: "", error: "rh_login_required", needsLogin: true }
  }
  // 路由不存在 (代际不匹配/后端没装 llm hook) 时立刻走 3 次 not_found 快速失败,
  // 不要按瞬时故障无限轮询。
  if (res.status === 404) return { ok: false, status: "not_found", text: "", error: "" }
  if (!res.ok) return { ok: false, status: "running", text: "", error: "" }
  const data = await res.json().catch(() => ({}))
  return {
    ok: !!data.ok,
    status: data.status || "running",
    text: data.text || "",
    error: data.error || "",
    model: data.model,
  }
}

export async function callLlmWithFallback(modelName: string, opts: LlmCallOptions): Promise<LlmCallResult> {
  const requestId = opts.request_id || uuid()
  const payload: Record<string, unknown> = {
    model: modelName,
    messages: opts.messages,
    page: opts.page || "",
    max_tokens: opts.max_tokens,
    request_id: requestId,
  }
  if (opts.temperature !== undefined && opts.temperature !== null && !/gpt-?5/i.test(modelName)) {
    payload.temperature = opts.temperature
  }

  const ctrl = new AbortController()
  const timeoutId = window.setTimeout(() => ctrl.abort(), CHAT_ABORT_MS)
  // 用户主动取消 → 联动内部 ctrl.abort；用 userAborted 标记区分「用户取消」与「服务超时」
  // （口径同 modelGateway.ts 的同名标记，错误码用 llmError 既有的 user_cancelled）
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

  // 首跳的**每一个**非异常出口都在 try 内直接 return（成功 / 404 双代际 / 412 / 4xx-5xx 确定性失败），
  // 因此「能走到 try/catch 之后」等价于「首跳抛错或被超时中止」——这正是要转入轮询取结果的
  // 既有恢复路径（长生成 >240s）。不再需要 initialFailed 布尔量来做二次判定。
  try {
    let res = await fetch(llmUrl("chat", modelName), {
      method: "POST",
      credentials: "include",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (res.status === 404 && legacyLlmRoutes === null) {
      // 扁平路由不存在 → 老代际后端, 降级重试按模型路由。
      legacyLlmRoutes = true
      res = await fetch(llmUrl("chat", modelName), {
        method: "POST",
        credentials: "include",
        headers: buildHeaders(),
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      if (res.status === 404) {
        // 两种代际都 404: 后端根本没装这个模型的 llm 路由, 快速失败, 不进 poll。
        legacyLlmRoutes = null
        return { ok: false, status: "failed", text: "", error: "not_found" }
      }
    }
    window.clearTimeout(timeoutId)
    // 阶段 1 · 包 1：502/500（上游 503 等**确定性**失败）必须立即如实返回，
    // 不能当瞬时故障掉进 10 分钟轮询后被改写成人人看不懂的「超时」。
    // llm.pb.js 的 /api/llm/chat 是同步路由：成功 200{ok:true}、鉴权 412、其余失败 4xx/5xx
    // 且任务记录已标 failed——非 2xx 再轮询也只会反复拿到同一个错，故在此收口。
    // 响应正文本就只读一次，先取出再分流（避免前后两次 res.json() 读同一个已消费的流）。
    const bodyData: unknown = await res.json().catch(() => null)
    const failedResp = platformFailureResult(res.status, bodyData)
    if (failedResp) return failedResp
    const data = (bodyData ?? {}) as Record<string, unknown>
    const rawStatus = typeof data.status === "string" ? data.status : ""
    const knownStatus =
      rawStatus === "success" || rawStatus === "failed" || rawStatus === "running" || rawStatus === "pending" || rawStatus === "not_found"
        ? rawStatus
        : "success"
    return {
      ok: !!data.ok,
      status: knownStatus,
      text: typeof data.text === "string" ? data.text : "",
      error: typeof data.error === "string" ? data.error : "",
      model: typeof data.model === "string" ? data.model : undefined,
      usage: data.usage,
    }
  } catch {
    /* 首跳抛错 / 被 CHAT_ABORT_MS 中止：转入下面的轮询取结果 */
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (userAborted) return { ok: false, status: "failed", text: "", error: "user_cancelled" }

  // 2026-10-20：轮询必须认取消。此前这里完全不看 opts.signal —— 一旦首跳失败进入轮询，
  // 用户点「取消」无效（ctrl 只作用于首跳的 fetch），最长要等满 POLL_ATTEMPTS × POLL_INTERVAL_MS
  // = 200 × 3s = 10 分钟，加上首跳 240s 上限约 14 分钟，期间在飞请求照常计费。
  //
  // ⚠️ 轮询必须用**独立的**控制器，不能直接复用 ctrl.signal：首跳超时（CHAT_ABORT_MS）也会
  // ctrl.abort()，而「首跳超时 → 转入轮询取结果」正是上面 CHAT_ABORT_MS 注释写明的正常路径。
  // 一旦复用，超时后 ctrl.signal.aborted 恒为 true，每次轮询 fetch 都会被立刻中断，
  // 等于把长生成（>240s）的恢复路径整条打死。故 pollCtrl 只绑用户取消信号。
  const pollCtrl = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) pollCtrl.abort()
    else opts.signal.addEventListener("abort", () => pollCtrl.abort(), { once: true })
  }
  let notFoundCount = 0
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (userAborted) return { ok: false, status: "failed", text: "", error: "user_cancelled" }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const r = await pollOnce(modelName, requestId, pollCtrl.signal)
    if (userAborted) return { ok: false, status: "failed", text: "", error: "user_cancelled" }
    if (r.needsLogin) return r
    if (r.status === "success") return r
    if (r.status === "failed") return r
    if (r.status === "not_found") {
      notFoundCount++
      if (notFoundCount >= 3) return { ok: false, status: "failed", text: "", error: "not_found" }
    } else {
      notFoundCount = 0
    }
  }
  return { ok: false, status: "failed", text: "", error: "timeout" }
}

