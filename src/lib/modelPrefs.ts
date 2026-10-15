/**
 * R216 缺陷修复：模型选择偏好记忆（修复「选 A 模型实际调 B 模型」静默路由错乱）
 *
 * 根因复述（2026-10-12 实测坐实）：
 *   ① 网关 `/api/model-gw/chat` 在前端不传 config_id 时，按 `findRecordsByFilter(... "-updated")`
 *      取第一条有default_model 的个人配置；实测只有 bailing 配了 default_model，
 *      于是所有未显式传 modelRef 的调用（助手 / 情报打标 / 客户画像 / 方案 / 报价）全部静默落到
 *      bailing 的 Ling-3.1-flash——用户选了 sensenova 也照样出 bailing 的结果，且前端从不校验。
 *   ② 前端 `pickFirstPersonalModelRef()` 同病：取 configs 数组「第一个」可用配置，
 *      而 bailing 恰好排首位，同样静默回落。
 *
 * 修复策略（不改动 9 个业务页面的调用代码，统一在网关层收口）：
 *   - 记住「用户实际成功用过的模型」（chatViaGatewayUncached 成功时写入），
 *     下次 `resolveAvailableModels()` 把它作为 defaultRef——用户长期用哪个，默认就是哪个；
 *   - `pickFirstPersonalModelRef()` 兜底优先命中该偏好，而不是数组第一个；
 *   - 响应回显模型与请求模型不一致时前端可见告警，不再静默吞掉。
 *
 * 存储口径：localStorage，按用户 id 分桶，避免多账号串味；任何异常（隐私模式 / 配额满 /
 * 非浏览器环境）一律降级为「无偏好」，绝不阻断主流程。
 */

import { AUTO_MODEL_KEY } from "@/lib/modelRouting"
import type { ModelRef } from "@/lib/modelGateway"

const STORAGE_KEY_PREFIX = "xz_model_pref"
/** 偏好记忆容量上限：只留最近若干条，避免localStorage 无限增长 */
const MAX_TRACKED = 12

/** 按用户分桶的存储键；userId 缺失时用anonymous 桶（登录前后的选择不混淆） */
function storageKeyFor(userId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${userId && userId.trim() ? userId.trim() : "anonymous"}`
}

/** localStorage 可能不可用（SSR / 隐私模式 / 配额满），统一收敛为 null 而不抛错 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    return window.localStorage
  } catch {
    /*访问被拒（如隐私模式禁用存储）→ 视为无偏好 */
    return null
  }
}

/**
 * 归一化并校验候选 key：必须是 `source:configId:modelId` 三段非空形式，
 * 防localStorage 被外部写脏后污染默认模型选择（脏值只在读取时被丢弃，不影响写入）。
 */
export function normalizeModelKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (!s) return null
  const parts = s.split(":")
  if (parts.length !== 3) return null
  if (!parts[0] || !parts[1] || !parts[2]) return null
  if (parts[0] !== "platform" && parts[0] !== "personal") return null
  return s
}

/**
 * 纯函数：在候选模型中挑出应作为默认的模型。
 * 口径优先级：用户偏好 > 配置声明的默认 > 调用方传入的兜底（通常是平台回退）> 候选首项。
 * 偏好命中要求「配置与模型都仍在候选清单内」，否则视为过期偏好并忽略（配置被删 / 模型被停用）。
 */
export function pickPreferredModelRef<T>(
  candidates: T[],
  preferredKey: string | null,
  fallback: T | null,
  keyOf: (item: T) => string,
): T | null {
  const list = Array.isArray(candidates) ? candidates : []
  if (preferredKey) {
    const hit = list.find((m) => keyOf(m) === preferredKey)
    if (hit) return hit
  }
  if (fallback) return fallback
  return list.length ? list[0] : null
}

/**
 * 读偏好键：存储不可用 / 数据缺失 / 脏值，一律返回 null（无偏好）。
 * 读取协议与 rememberUsedModel 的写入协议严格一致——都走 readHistory 的 JSON 数组，
 * 取首元素。此前实现误按「单值键」读取，而写入的是 JSON 数组，导致写成功后读必为 null
 * （2026-10-12 补测时由断言当场暴露）。
 */
export function readPreferredModelKey(userId: string | null): string | null {
  return readHistory(userId)[0] ?? null
}

/** 内部：读取已记录的偏好序列（最近使用在前），脏值已剔除 */
function readHistory(userId: string | null): string[] {
  const st = safeStorage()
  if (!st) return []
  try {
    const raw = st.getItem(storageKeyFor(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeModelKey).filter((k): k is string => k !== null)
  } catch {
    /* JSON 损坏 / 非数组 → 当作无历史，不阻断 */
    return []
  }
}

/**
 * 记录一次「用户实际成功使用的模型」。
 * 幂等：同 key 重复调用不重复入列；越界时截断保留最近 MAX_TRACKED 条。
 * 写入失败（配额 / 权限）静默降级——偏好记忆是体验优化，绝不能因此让 AI 功能不可用。
 */
export function rememberUsedModel(userId: string | null, key: string): void {
  const clean = normalizeModelKey(key)
  if (!clean) return
  const st = safeStorage()
  if (!st) return
  try {
    const next = [clean, ...readHistory(userId).filter((k) => k !== clean)].slice(0, MAX_TRACKED)
    st.setItem(storageKeyFor(userId), JSON.stringify(next))
  } catch {
    /* 配额满 / 写入被拒 → 放弃本次记忆，不影响主流程 */
  }
}

/**
 * 用户当前偏好对应的 ModelRef：在候选清单中解析成结构化引用。
 * 纯函数（无存储依赖），便于单测锁口径——存储读取请显式调 readPreferredModelKey 后传入。
 */
export function resolvePreferredRef(
  models: ModelRef[],
  preferredKey: string | null,
): ModelRef | null {
  if (!preferredKey) return null
  const list = Array.isArray(models) ? models : []
  return list.find((m) => m && `${m.source}:${m.configId}:${m.modelId}` === preferredKey) ?? null
}

/** 仅供测试：清空某用户的偏好记忆 */
export function clearPreferredModel(userId: string | null): void {
  const st = safeStorage()
  if (!st) return
  try {
    st.removeItem(storageKeyFor(userId))
  } catch {
    /* 清不掉也无所谓，下一次写入会覆盖 */
  }
}

// ---------------------------------------------------------------------------
// 显式选择记忆（R-latest，用户反馈：默认应由我自己选，系统别替我判断）
//
// 与记忆「实际成功用过的模型」（rememberUsedModel，R216 自动记录）的区别：
//   - 显式选择 = 用户在模型选择器里亲手点的那个，**优先级最高**，且连「自动」档也照记
//     （用户点了自动，就是明确想要自动，不能又被系统改回去）；
//   - 成功用过 = 自动口径的兜底，仅在用户还没表过态时决定默认值。
// 两者分开存（不同键），互不覆盖：清掉显式选择只回到自动口径，不会丢使用历史。
//
// 存储口径与既有偏好一致：localStorage、按用户分桶、读写全部 try/catch 降级为无值。
// ---------------------------------------------------------------------------

const CHOICE_KEY_PREFIX = "xz_model_choice"

/** 按用户分桶的显式选择键（与偏好键分开，互不覆盖） */
function choiceKeyFor(userId: string | null): string {
  return `${CHOICE_KEY_PREFIX}:${userId && userId.trim() ? userId.trim() : "anonymous"}`
}

/** 读用户显式选择的模型（含 AUTO_MODEL_KEY 哨兵）；没表过态 / 值脏 / 存储不可用 → null */
export function readModelChoice(userId: string | null): string | null {
  const st = safeStorage()
  if (!st) return null
  try {
    const raw = st.getItem(choiceKeyFor(userId))
    if (!raw) return null
    if (raw === AUTO_MODEL_KEY) return raw
    return normalizeModelKey(raw)
  } catch {
    return null
  }
}

/** 记住用户的显式选择（选择器 onChange 调用）；非法 key / 存储不可用一律静默跳过 */
export function saveModelChoice(userId: string | null, key: string): void {
  const clean = key === AUTO_MODEL_KEY ? key : normalizeModelKey(key)
  if (!clean) return
  const st = safeStorage()
  if (!st) return
  try {
    st.setItem(choiceKeyFor(userId), clean)
  } catch {
    /* 配额满 / 写入被拒 → 放弃本次记忆，不影响主流程 */
  }
}

/** 仅供测试：清空某用户的显式选择 */
export function clearModelChoice(userId: string | null): void {
  const st = safeStorage()
  if (!st) return
  try {
    st.removeItem(choiceKeyFor(userId))
  } catch {
    /* 清不掉也无所谓 */
  }
}