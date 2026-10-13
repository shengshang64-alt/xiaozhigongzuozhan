// ---------------------------------------------------------------------------
// R203（docs/13 §3.3「模型通道自动回退」）：模型网关封装层的通道级 failover 决策内核。
//
// 背景：本机 BYO 多通道实测里，上游 429（「接口限流或余额不足」）、API Key 失效、
// 5xx / 连接被对方关闭都属于「这一路暂时不通」，而用户一次只能选一个通道。此前只有
// Q28 切片F 的会话冷却闸门（同参退避重发）与标书侧 R177/R180 的超时降级阶梯：
// 实测「9 章批量 7 章 failed、正文停在几十页」就是这么来的——退避重发仍在同一个被限流的
// 账号上撞窗，最终只能提示用户「去顶部手动换模型」。本模块把「换一个已启用的通道再试一次」
// 变成网关封装层的自动动作，标书 / 方案 / PPT 三条主链路与助手、知识库问答、竞品分析、
// 情报摘要等所有 chatViaGateway 消费者同享。
//
// 口径（刻意的边界，防误伤与防重复计费）：
//  - 只在明确「未产出」的账号级失败上回退：限流 / 余额不足 / 认证失败 / 服务不可用 /
//    模型已停用 / 模型不存在（404）、个人配置不可用。「超时」与「回复内容为空」不回退——二者分别由标书侧 R177/R180 降级阶梯
//    与 F1 关思考重试独占，此处再叠一层会把延迟翻倍并对同一次产出重复计费；
//  - 用户取消 / 需要登录绝不回退（回退既无意义又会掩盖真实原因）；
//  - 候选排序：优先别的配置（429 与余额都按账号 TPM 滚动，同账号换模型同样撞窗），
//    各配置内先取其默认模型；其次同配置的其它已启用模型；最后才是平台内置。本地自用域
//    平台令牌恒空必然 412（与 ModelSelect.tsx 的禁用口径一致），故不参与回退；
//  - 平台内置通道自身失败不跨源回退到个人通道——那会静默改用用户的付费账户；
//  - 失败通道按「配置级 + 模型级」打会话内冷却戳（60s 起、连击逐次拉长、封顶 5 分钟），
//    冷却中的通道不再被选作候选；用户所选通道每次仍先如实尝试，保持选择权，
//    代价只是一次秒级快失败（429 实测 ~0.7s 返回）；
//  - 回退成功才改判结果，并带上 actualModelRefKey 供上层把延迟证据记到真正出活的通道；
//    回退失败则原样交回首个错误（用户看到的仍是自己所选通道的真实原因）。
// 纯会话内存：零持久化 / 零 collection / 零 pb_hooks / 零提示词。
// Author: loop-R203
// ---------------------------------------------------------------------------
import type { LlmCallResult } from "@/lib/llm"

export type ModelSourceLite = "platform" | "personal"

/** 通道引用：与 modelGateway.ModelRef 同构，本模块只按结构取值，不反向依赖网关层 */
export interface FailoverRefLite {
  source: ModelSourceLite
  configId: string
  configName: string
  modelId: string
}

/** 回退候选：一个可被选作备用通道的已启用模型 */
export interface FailoverCandidate {
  /** 唯一键，source:configId:modelId（与 modelRefKey 同口径，由网关层传入） */
  key: string
  ref: FailoverRefLite
  configId: string
  /** 是否该配置自身的默认模型（同档内优先） */
  isConfigDefault: boolean
}

export type CallFailureClass =
  | "rate_limit"
  | "auth"
  | "model_disabled"
  | "model_missing"
  | "unavailable"
  | "config_broken"
  | "timeout"
  | "empty_reply"
  | "cancelled"
  | "login_required"
  | "other"

// 分类正则覆盖 model_gateway.pb.js（红线区，文案即稳定契约）与 llm.ts 的两代错误串。
const RATE_LIMIT_RE = /429|tpm|rate\s*limit|限流|too\s*many\s*requests|余额不足|insufficient[_\s-]*balance/i
const AUTH_RE = /认证失败|api\s*key|invalid\s+key|unauthoriz|forbidden/i
const MODEL_DISABLED_RE = /已停用|已下线|model_disabled|not\s+enabled/i
// R296：模型不存在（上游 404 / 改名下线）。逐字对齐 model_gateway.pb.js：
//   chatOnce 非 200 且带 detail 时透出 "接口返回异常（HTTP 404）：… does not exist …"，
//   PATCH 设默认路径的显式 code "model_not_found" / 文案 "不存在这个模型"。
// \b404\b 只匹配独立状态码，避免误伤正文里的四位数字；配置级 "配置不存在" 不含 404 语义不在此类。
const MODEL_MISSING_RE =
  /模型不存在|不存在这个模型|does\s+not\s+exist|no\s+such\s+model|invalid\s+model|unknown\s+model|model[_\s-]*not[_\s-]*found|\b404\b/i
const TIMEOUT_RE = /超时|限定时间内返回|timeout|timed out|deadline/i
const UNAVAILABLE_RE =
  /http\s*5\d\d|\b5\d\d\b|服务暂时不可用|服务异常|无法连通|连接被对方关闭|econnreset|connection\s*reset|broken\s*pipe|socket|网络异常|\beof\b/i
const EMPTY_REPLY_RE = /回复内容为空|内容为空|返回格式异常/i
// R208：个人配置不可用（被删 / 缺 Key / 无启用模型）——网关回退内核前抛的内部哨兵 code
const CONFIG_BROKEN_RE = /personal_config_unavailable|fallback_to_platform/i

/** 允许自动换通道的失败类别：全部是「这一路根本没产出」的账号级不可用 */
const FAILOVER_ELIGIBLE: ReadonlySet<CallFailureClass> = new Set<CallFailureClass>([
  "rate_limit",
  "auth",
  "model_disabled",
  "model_missing",
  "unavailable",
  "config_broken",
])

/**
 * 把网关 / 平台返回的错误串归类。顺序即口径：先专用（取消 / 需登录 / 超时 / 空回复），
 * 后泛化（限流 / 认证 / 停用 / 不可用），避免「超时…可稍后重试或切换模型」被当成不可用。
 * 纯函数。
 */
export function classifyCallFailure(error?: string): CallFailureClass {
  const raw = (error ?? "").trim()
  if (!raw) return "other"
  if (raw === "user_cancelled") return "cancelled"
  if (raw === "rh_login_required") return "login_required"
  if (CONFIG_BROKEN_RE.test(raw)) return "config_broken"
  if (TIMEOUT_RE.test(raw)) return "timeout"
  if (EMPTY_REPLY_RE.test(raw)) return "empty_reply"
  if (RATE_LIMIT_RE.test(raw)) return "rate_limit"
  if (MODEL_DISABLED_RE.test(raw)) return "model_disabled"
  if (MODEL_MISSING_RE.test(raw)) return "model_missing"
  if (AUTH_RE.test(raw)) return "auth"
  if (UNAVAILABLE_RE.test(raw)) return "unavailable"
  return "other"
}

export function isFailoverEligible(cls: CallFailureClass): boolean {
  return FAILOVER_ELIGIBLE.has(cls)
}

// ---------------------------------------------------------------------------
// 会话内通道冷却登记（与 rateLimitGate 的「同参退避」互补：那边管重发节奏，
// 这边管「哪一路暂时别再选」）
// ---------------------------------------------------------------------------
// 导出供单测锁口径（避免测试里硬编码窗长），实现内仍用短名
export const BASE_COOL_MS_FOR_TEST = 60_000
export const MAX_COOL_MS_FOR_TEST = 5 * 60_000
const BASE_COOL_MS = BASE_COOL_MS_FOR_TEST
const MAX_COOL_MS = MAX_COOL_MS_FOR_TEST

interface CoolingEntry {
  until: number
  strikes: number
}

const cooling = new Map<string, CoolingEntry>()

// R233：UI（ModelSelect）只读订阅冷却登记表的变化，以便通道刚被戳上冷却时即时呈现徽标，
// 无需轮询。纯内存监听器集合，零持久化；回调异常一律吞掉，绝不影响回退主流程。
type CoolingListener = () => void
const coolingListeners = new Set<CoolingListener>()

function notifyCoolingChange(): void {
  for (const cb of coolingListeners) {
    try {
      cb()
    } catch {
      /* 徽标刷新失败不得影响回退判定 */
    }
  }
}

/** 订阅冷却登记变化；返回退订函数（供 React effect 清理） */
export function onCoolingChange(cb: CoolingListener): () => void {
  coolingListeners.add(cb)
  return () => {
    coolingListeners.delete(cb)
  }
}

/** 配置级冷却键（429 / 欠费 / 认证失败都是账号维度，同账号换模型同样撞窗） */
export function configCoolingKey(configId: string): string {
  return `cfg:${configId}`
}

/** 打一枚冷却戳并返回本次窗长；连击在窗内逐次拉长（60s / 120s / … 封顶 5 分钟） */
export function markChannelCooling(key: string, now: number = Date.now()): number {
  const strikes = (cooling.get(key)?.strikes ?? 0) + 1
  const window = Math.min(BASE_COOL_MS * strikes, MAX_COOL_MS)
  cooling.set(key, { until: now + window, strikes })
  notifyCoolingChange()
  return window
}

export function clearChannelCooling(key: string): void {
  if (cooling.delete(key)) notifyCoolingChange()
}

/** 是否仍在冷却；窗已过则顺手清掉条目（连击计数随之归零） */
export function isChannelCooling(key: string, now: number = Date.now()): boolean {
  const e = cooling.get(key)
  if (!e) return false
  if (e.until <= now) {
    cooling.delete(key)
    return false
  }
  return true
}

export function channelCoolingStrikes(key: string): number {
  return cooling.get(key)?.strikes ?? 0
}

/**
 * 冷却剩余毫秒：未在冷却或窗已过返回 0。纯读、不剪枝（区别于 isChannelCooling 会
 * 顺带清过期条目并归零连击），供 UI 渲染恢复倒计时。
 */
export function channelCoolingRemainingMs(key: string, now: number = Date.now()): number {
  const e = cooling.get(key)
  if (!e) return 0
  return Math.max(0, e.until - now)
}

/** 单测边界用：清空整张登记表 */
export function resetChannelCooling(): void {
  cooling.clear()
  notifyCoolingChange()
}

/**
 * 该次失败应该打哪些冷却键：模型已停用只冷却那个模型，其余账号级失败同时冷却
 * 「整个配置 + 该模型」。纯函数。
 */
export function coolingKeysForFailure(
  cls: CallFailureClass,
  failed: FailoverCandidate | null,
): string[] {
  if (!failed || !isFailoverEligible(cls)) return []
  if (cls === "model_disabled" || cls === "model_missing") return [failed.key]
  return [configCoolingKey(failed.configId), failed.key]
}

// ---------------------------------------------------------------------------
// 候选挑选
// ---------------------------------------------------------------------------
export interface FailoverPickParams {
  candidates: FailoverCandidate[]
  failedKey: string | null
  failedConfigId: string | null
  failedSource: ModelSourceLite | null
  localDeploy: boolean
  now?: number
  /** 注入冷却判定便于单测（默认读上面的会话登记表） */
  coolingCheck?: (key: string, now: number) => boolean
}

/**
 * 挑一个备用通道：排除失败通道本身与冷却中的通道 / 冷却配置，
 * 按「其它配置的默认模型 → 其它配置 → 同配置其它模型 → 平台内置（非本地域才允许）」排序。
 * 纯函数（冷却判定可注入）。
 */
export function pickFailoverCandidate(p: FailoverPickParams): FailoverCandidate | null {
  // 平台内置通道自身失败不跨源回退到个人通道：那会静默改用用户的付费账户
  if (!p.failedSource || p.failedSource === "platform") return null
  const now = p.now ?? Date.now()
  const cool = p.coolingCheck ?? ((key: string, at: number) => isChannelCooling(key, at))
  const usable = p.candidates.filter((c) => {
    if (c.key === p.failedKey) return false
    if (c.ref.source === "platform" && p.localDeploy) return false
    if (cool(c.key, now)) return false
    if (cool(configCoolingKey(c.configId), now)) return false
    return true
  })
  const byDefault = (a: FailoverCandidate, b: FailoverCandidate) =>
    Number(b.isConfigDefault) - Number(a.isConfigDefault)
  const otherCfg = usable
    .filter((c) => c.ref.source === "personal" && c.configId !== p.failedConfigId)
    .sort(byDefault)
  const sameCfg = usable
    .filter((c) => c.ref.source === "personal" && c.configId === p.failedConfigId)
    .sort(byDefault)
  const platform = usable.filter((c) => c.ref.source === "platform")
  return [...otherCfg, ...sameCfg, ...platform][0] ?? null
}

// ---------------------------------------------------------------------------
// 提示去重窗（一次批量生成里同一路回退只说一次，避免每小节刷屏）
// ---------------------------------------------------------------------------
const NOTICE_DEDUPE_MS = 30_000
// 初值用 -Infinity 哨兵表示「本轮会话还没提示过」：不能取 0，否则「距 1970-01-01 不足
// 30 秒」的判定会把首次提示也当成重复而静默。
let lastNoticeAt = Number.NEGATIVE_INFINITY

/** 距上次提示是否已过窗：true 表示本次可以提示（并就地更新时间戳） */
export function shouldShowFailoverNotice(now: number = Date.now()): boolean {
  if (now - lastNoticeAt < NOTICE_DEDUPE_MS) return false
  lastNoticeAt = now
  return true
}

/** 单测边界用：复位为「未提示过」 */
export function resetFailoverNotice(): void {
  lastNoticeAt = Number.NEGATIVE_INFINITY
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------
export interface FailoverDeps {
  /** 用给定通道原样重发一次（参数、预算、计费口径与首调完全一致） */
  chat: (ref: FailoverRefLite) => Promise<LlmCallResult>
  /** 候选来源（由网关层带缓存提供） */
  candidates: () => Promise<FailoverCandidate[]>
  notify?: (from: FailoverRefLite | null, to: FailoverRefLite) => void
  localDeploy?: () => boolean
  now?: () => number
}

export interface FailoverAttempt {
  first: LlmCallResult
  failed: FailoverCandidate | null
  deps: FailoverDeps
}

/**
 * 首调失败后尝试换一路备用通道：
 * @returns 备用通道成功产出的结果（附 actualModelRefKey）；不适用 / 仍失败时返回 null，
 *          交由调用方原样透出首调错误。
 */
export async function tryFailoverCall(p: FailoverAttempt): Promise<LlmCallResult | null> {
  const { first, failed, deps } = p
  if (first.ok || first.needsLogin) return null
  const cls = classifyCallFailure(first.error)
  if (!isFailoverEligible(cls)) return null

  const now = deps.now?.() ?? Date.now()
  for (const key of coolingKeysForFailure(cls, failed)) markChannelCooling(key, now)

  const pick = pickFailoverCandidate({
    candidates: await deps.candidates(),
    failedKey: failed?.key ?? null,
    failedConfigId: failed?.configId ?? null,
    failedSource: failed?.ref.source ?? null,
    localDeploy: deps.localDeploy?.() ?? false,
    now,
  })
  if (!pick) return null

  const second = await deps.chat(pick.ref)
  if (second.ok && second.status === "success" && (second.text ?? "").trim()) {
    // 备用通道已证实可用：清掉它自己的冷却戳（可能是上一轮的旧账），并提示用户本次换了通道
    clearChannelCooling(pick.key)
    clearChannelCooling(configCoolingKey(pick.configId))
    deps.notify?.(failed?.ref ?? null, pick.ref)
    return { ...second, actualModelRefKey: pick.key }
  }
  if (!second.needsLogin) {
    const cls2 = classifyCallFailure(second.error)
    if (isFailoverEligible(cls2)) {
      const at = deps.now?.() ?? Date.now()
      for (const key of coolingKeysForFailure(cls2, pick)) markChannelCooling(key, at)
    }
  }
  return null
}
