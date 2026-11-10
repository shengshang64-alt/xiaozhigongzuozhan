/**
 * 「连通测试」的真实验证台账（本地存储，按用户分桶）。
 *
 * 为什么要有它：网关只在调用当场返回结果，**测试结果不落库**——刷新页面就没了。
 * 于是「通道卡上的最近测试」「最近 5 次测试」「今日已测 N 次」三个位置永远只能是「—」，
 * 用户没法对比换 Key / 换通道前后的差异。
 *
 * 口径（重要，别越线）：
 *  - 只记**用户亲手点过「测试」**的那一次真实调用：模型、通道、成败、总耗时、失败原因。
 *  - 不记首字延迟（网关一次性返回整段文本，没有流式时间戳）；
 *  - 不记 token 用量（测试接口不回 usage）；
 *  - 不推断调用量 / 成功率——那需要按次调用台账，测试记录不是调用台账。
 * 这三条是「不许编数」的边界，改动前先确认后端是否真的能给。
 *
 * 存储与 modelHealth / modelPrefs 同族：localStorage、按用户分桶、任何异常降级为空、
 * 上限淘汰最旧。纯前端，零 collection。
 */
import { decodeRhToken } from "@/lib/rhLogin"

const STORAGE_KEY_PREFIX = "xz_model_test_log"
/** 保留条数：够「最近 5 次」翻几页，又不至于把 localStorage 撑大 */
const MAX_ENTRIES = 40
const MESSAGE_MAX = 160

export interface ModelTestLogEntry {
  /** source:configId:modelId（与 modelRefKey 同口径） */
  key: string
  configId: string
  configName: string
  modelId: string
  ok: boolean
  /** 总耗时（ms）；接口没回耗时则为 null，不填 0 */
  elapsedMs: number | null
  /** 失败原因（截断），成功为 "" */
  message: string
  at: number
}

function storageKeyFor(userId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${userId && userId.trim() ? userId.trim() : "anonymous"}`
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    return window.localStorage
  } catch {
    /* 隐私模式禁用存储 → 视为无台账 */
    return null
  }
}

const listeners = new Set<() => void>()

function notify(): void {
  for (const cb of listeners) {
    try {
      cb()
    } catch {
      /* 刷新失败不得影响测试主流程 */
    }
  }
}

/** 订阅台账变化；返回退订函数（供 React effect 清理） */
export function onTestLogChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 读取台账（新的在前）。脏值 / 存储不可用一律降级为空数组 */
export function readTestLog(userId: string | null): ModelTestLogEntry[] {
  const st = safeStorage()
  if (!st) return []
  let parsed: unknown
  try {
    const raw = st.getItem(storageKeyFor(userId))
    if (!raw) return []
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: ModelTestLogEntry[] = []
  for (const v of parsed) {
    if (!v || typeof v !== "object") continue
    const e = v as Partial<ModelTestLogEntry>
    if (typeof e.at !== "number" || typeof e.key !== "string" || !e.key) continue
    if (typeof e.modelId !== "string" || !e.modelId) continue
    out.push({
      key: e.key,
      configId: typeof e.configId === "string" ? e.configId : "",
      configName: typeof e.configName === "string" ? e.configName : "",
      modelId: e.modelId,
      ok: e.ok === true,
      elapsedMs: typeof e.elapsedMs === "number" && Number.isFinite(e.elapsedMs) ? e.elapsedMs : null,
      message: typeof e.message === "string" ? e.message : "",
      at: e.at,
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** 记一次测试结果（runTest 落定后调用） */
export function recordTestResult(
  userId: string | null,
  input: Omit<ModelTestLogEntry, "at"> & { at?: number },
): void {
  const st = safeStorage()
  if (!st) return
  const entry: ModelTestLogEntry = {
    key: input.key,
    configId: input.configId,
    configName: input.configName,
    modelId: input.modelId,
    ok: input.ok,
    elapsedMs: input.elapsedMs,
    message: (input.message ?? "").trim().slice(0, MESSAGE_MAX),
    at: input.at ?? Date.now(),
  }
  const next = [entry, ...readTestLog(userId)].slice(0, MAX_ENTRIES)
  try {
    st.setItem(storageKeyFor(userId), JSON.stringify(next))
  } catch {
    /* 配额满 → 放弃本次落盘 */
    return
  }
  notify()
}

/** 单测边界 / 用户主动清空 */
export function clearTestLog(userId: string | null): void {
  const st = safeStorage()
  if (!st) return
  try {
    st.removeItem(storageKeyFor(userId))
  } catch {
    /* 清不掉也不阻断 */
  }
  notify()
}

export interface TestLogSummary {
  total: number
  ok: number
  failed: number
  /** 今天（本地日）测过几次 */
  today: number
  /** 最近一次测试时间戳；没有记录为 null */
  latestAt: number | null
}

/** 汇总：只做计数，不产出「成功率」这类跨口径指标（测试不是调用） */
export function summarizeTestLog(entries: ModelTestLogEntry[], now: number = Date.now()): TestLogSummary {
  const nowDate = new Date(now)
  const sameDay = (ts: number) => {
    const d = new Date(ts)
    return (
      d.getFullYear() === nowDate.getFullYear() &&
      d.getMonth() === nowDate.getMonth() &&
      d.getDate() === nowDate.getDate()
    )
  }
  let ok = 0
  let today = 0
  for (const e of entries) {
    if (e.ok) ok += 1
    if (sameDay(e.at)) today += 1
  }
  return {
    total: entries.length,
    ok,
    failed: entries.length - ok,
    today,
    latestAt: entries.length ? entries[0].at : null,
  }
}

/**
 * 人话时间：今天 08:52 / 昨天 18:20 / 11-06 09:14。
 * 表里只放这一种格式，避免同一屏出现「今天」和「2026-11-06 08:52」两种读法。
 */
export function describeWhen(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return "—"
  const pad = (n: number) => String(n).padStart(2, "0")
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date(now)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (dayDiff === 0) return `今天 ${hm}`
  if (dayDiff === 1) return `昨天 ${hm}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

/** 当前登录用户的台账（组件不直接碰 localStorage，走统一入口） */
export function readTestLogForCurrentUser(): ModelTestLogEntry[] {
  return readTestLog(decodeRhToken()?.sub ?? null)
}

/** 耗时展示：ms → 「1.2s」；没有耗时返回「—」（不写 0） */
export function formatElapsed(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return "—"
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)}ms`
  return `${(elapsedMs / 1000).toFixed(1)}s`
}
