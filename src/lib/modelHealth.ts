/**
 * R296（r294-default-model-hygiene）：模型通道「实测不可用」长期健康档案。
 *
 * 背景：会话冷却（modelFailover）只处理 rate_limit / timeout / unavailable 这类
 * 「这一路暂时不通」的瞬时失败；而 model_missing（404 模型不存在）、上游 model_disabled、
 * auth（Key 失效）是「这一路就是坏的」，重开页面就查无实据，配置页也毫无标注——
 * R294 实测 7 个启用模型里 3 个长期不可用却全程静默，正源于此。
 *
 * 口径：
 *  - 只挂账 model_missing / model_disabled / auth 三类确定性失效；瞬时类交给会话冷却，不进档案
 *    （否则限流一次就把模型永久标红，误伤）；
 *  - 任一通道成功即清账（recordModelSuccess），用户在配置页改 Key / 刷新模型 / 删除配置也清账；
 *  - 7 天 TTL 自然过期，坏模型长期不碰也不会永远挂着；条目上限 MAX_ENTRIES，超出丢最旧；
 *  - 存储同 modelPrefs：localStorage 按用户分桶，任何异常（隐私模式 / 配额满 / SSR）降级为「无档案」，
 *    绝不阻断 AI 主流程；纯前端，零 collection / 零 pb_hooks / 零提示词。
 *
 * 与冷却的分工：冷却=「别急着再选这条」(会话内、分钟级)；健康档案=「这条已经证实坏了」(持久、天级、可标注处置)。
 * Author: loop-R296
 */
import { classifyCallFailure, type CallFailureClass } from "@/lib/modelFailover"
import { normalizeModelKey } from "@/lib/modelPrefs"

const STORAGE_KEY_PREFIX = "xz_model_health"
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 60
const REASON_MAX = 120

/** 会被长期挂账的确定性失效类别；瞬时类（限流 / 超时 / 不可用）只走会话冷却 */
const PERSIST_CLASSES: ReadonlySet<CallFailureClass> = new Set<CallFailureClass>([
  "model_missing",
  "model_disabled",
  "auth",
  // R301：额度耗尽同样挂账。它不是「永久坏」，但也不是「等一会就好」——
  // 实测 xiaomi/mimo-v2.6-pro（quota exhausted）与 Intern/deepseek-v4-flash-vision
  // （quota exceeded）退避 3 次全败，不充值就必然继续失败。不挂账的后果实测成立：
  // 重开页面仍显示为可用，用户选它 → 立刻失败 → 白跑一次生成。
  "quota_exhausted",
])

export interface ModelHealthEntry {
  cls: CallFailureClass
  /** 首次挂账的原始错误片段（截断），供 tooltip 溯源 */
  reason: string
  /** 挂账时间戳（ms） */
  at: number
}

export type HealthMap = Record<string, ModelHealthEntry>

function storageKeyFor(userId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${userId && userId.trim() ? userId.trim() : "anonymous"}`
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    return window.localStorage
  } catch {
    /* 访问被拒（如隐私模式禁用存储）→ 视为无档案 */
    return null
  }
}

const healthListeners = new Set<() => void>()

function notifyHealthChange(): void {
  for (const cb of healthListeners) {
    try {
      cb()
    } catch {
      /* 徽标刷新失败不得影响主流程 */
    }
  }
}

/** 订阅健康档案变化；返回退订函数（供 React effect 清理） */
export function onHealthChange(cb: () => void): () => void {
  healthListeners.add(cb)
  return () => {
    healthListeners.delete(cb)
  }
}

/** 读取全量档案，顺带剔除过期 / 脏值项（纯读不写回，写入时自然落盘修剪结果） */
export function readModelHealth(userId: string | null, now: number = Date.now()): HealthMap {
  const st = safeStorage()
  if (!st) return {}
  let parsed: unknown
  try {
    const raw = st.getItem(storageKeyFor(userId))
    if (!raw) return {}
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== "object") return {}
  const out: HealthMap = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeModelKey(k)
    if (!key) continue
    if (!v || typeof v !== "object") continue
    const e = v as Partial<ModelHealthEntry>
    if (typeof e.at !== "number" || now - e.at > TTL_MS) continue
    if (typeof e.cls !== "string" || !PERSIST_CLASSES.has(e.cls)) continue
    out[key] = { cls: e.cls, reason: typeof e.reason === "string" ? e.reason : "", at: e.at }
  }
  return out
}

export function getModelHealth(
  userId: string | null,
  key: string,
  now: number = Date.now(),
): ModelHealthEntry | null {
  const clean = normalizeModelKey(key)
  if (!clean) return null
  return readModelHealth(userId, now)[clean] ?? null
}

function writeHealth(userId: string | null, map: HealthMap): void {
  const st = safeStorage()
  if (!st) return
  try {
    // 修剪：只保留未过期、上限内的最近条目
    const now = Date.now()
    const kept = Object.entries(map)
      .filter(([, e]) => now - e.at <= TTL_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES)
    st.setItem(storageKeyFor(userId), JSON.stringify(Object.fromEntries(kept)))
  } catch {
    /* 配额满 / 写入被拒 → 放弃本次落盘，不影响主流程 */
  }
}

/**
 * 记录一次「通道实测不可用」：先按错误串归类，只有确定性失效类别才入档，
 * 限流 / 超时 / 网络抖动一律忽略（它们由 modelFailover 会话冷却负责，分钟级自动恢复）。
 */
export function recordCallFailure(userId: string | null, key: string, error?: string): void {
  recordModelFailure(userId, key, classifyCallFailure(error), error)
}

export function recordModelFailure(
  userId: string | null,
  key: string,
  cls: CallFailureClass,
  error?: string,
): void {
  if (!PERSIST_CLASSES.has(cls)) return
  const clean = normalizeModelKey(key)
  if (!clean) return
  const map = readModelHealth(userId)
  map[clean] = { cls, reason: (error ?? "").trim().slice(0, REASON_MAX), at: Date.now() }
  writeHealth(userId, map)
  notifyHealthChange()
}

/** 通道成功即清账 */
export function recordModelSuccess(userId: string | null, key: string): void {
  const clean = normalizeModelKey(key)
  if (!clean) return
  const map = readModelHealth(userId)
  if (!(clean in map)) return
  delete map[clean]
  writeHealth(userId, map)
  notifyHealthChange()
}

/** 配置级清账：改 Key / 刷新模型 / 删除配置后，该配置下所有挂账模型重新给一次机会 */
export function clearConfigHealth(userId: string | null, configId: string): void {
  if (!configId) return
  const map = readModelHealth(userId)
  let changed = false
  for (const k of Object.keys(map)) {
    if (k.split(":")[1] === configId) {
      delete map[k]
      changed = true
    }
  }
  if (!changed) return
  writeHealth(userId, map)
  notifyHealthChange()
}

/** 单测边界用：清空某用户档案 */
export function resetModelHealth(userId: string | null): void {
  const st = safeStorage()
  if (!st) return
  try {
    st.removeItem(storageKeyFor(userId))
  } catch {
    /* 清不掉也无所谓，下一次写入会覆盖 */
  }
  notifyHealthChange()
}

/** 纯函数：短标签（下拉 option 后缀 / 徽标文字用）；非挂账类别返回空串 */
export function healthShortLabel(cls: CallFailureClass): string {
  if (cls === "model_missing") return "已下线"
  if (cls === "model_disabled") return "已停用"
  if (cls === "auth") return "Key 失效"
  if (cls === "quota_exhausted") return "额度耗尽"
  return ""
}

/** 纯函数：完整提示 + 处置建议（tooltip 用） */
export function healthNotice(entry: ModelHealthEntry | null): string {
  if (!entry) return ""
  if (entry.cls === "model_missing") {
    return "该模型实测已不存在（接口返回 404），多半已改名或下线。请点「刷新模型」重新拉取列表，或直接改用其他模型。"
  }
  if (entry.cls === "model_disabled") {
    return "该模型在接口侧已被停用。请在模型配置页重新启用，或改用其他模型。"
  }
  if (entry.cls === "auth") {
    return "该配置 API Key 校验失败（认证被拒）。请点「编辑」更新 Key，或改用其他配置。"
  }
  if (entry.cls === "quota_exhausted") {
    return "该模型所属账号额度或余额已耗尽（接口返回 429，提示 quota exhausted / exceeded）。退避重试无用，请到该模型平台充值或提升配额后再用。"
  }
  return ""
}
