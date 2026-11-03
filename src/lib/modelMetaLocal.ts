// ---------------------------------------------------------------------------
// R-038 模型元数据本地存储（localStorage，按用户分桶）
//
// 用途：为每个「个人配置 × 模型」组合存 擅长/额度 两条用户标注，
//       不动后端（model_configs.models 字段仍只存 {id, enabled}）。
// 边界：
//   - 换设备 / 清缓存 → 标注丢失（用户裁定的取舍）
//   - 按 userId 分桶（与 R119 隐私收口同族：登出即清本用户桶）
//   - Key 格式 `personal:<configId>:<modelId>`（与 modelHealth 同口径）
// ---------------------------------------------------------------------------

const STORE_KEY = "xiaozhi.modelMeta.v1"

/** R-041 结构化额度 */
export interface ModelQuota {
  tier: "go" | "go_plus" | "unlimited" | "custom"
  /** 每 5 小时请求数（-1 = ∞；custom 可空） */
  requests5h?: number
  /** 月费美元（-1 = ∞；custom 可空） */
  monthlyUsd?: number
  /** custom 档自由文本 */
  customText?: string
}

export interface ModelMetaEntry {
  /** 用户手填的擅长描述（覆盖内置知识表） */
  specialty?: string
  /** 用户手填的场景标签（可选） */
  tags?: string[]
  /** R-041 结构化额度（旧版 string 自动迁移为 custom） */
  quota?: ModelQuota
  /** 额度最后更新时间（ISO） */
  quotaUpdatedAt?: string
  /** 擅长最后更新时间 */
  updatedAt: string
}

type Store = Record<string, ModelMetaEntry>

function readRaw(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as Store
  } catch {
    return {}
  }
}

function writeRaw(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // 存储满或隐私模式：静默失败，UI 会显示"未标注"
  }
}

function bucketKey(userId: string | null | undefined): string {
  return userId ? `u:${userId}` : "u:anon"
}

/** 读某一 bucket 下的所有条目 */
function readBucket(userId: string | null | undefined): Store {
  const all = readRaw()
  const b = all[bucketKey(userId)]
  if (!b || typeof b !== "object") return {}
  // 兼容：老结构直接把 key 存顶层
  return b as unknown as Store
}

function writeBucket(userId: string | null | undefined, bucket: Store): void {
  const all = readRaw()
  all[bucketKey(userId)] = bucket as unknown as ModelMetaEntry
  writeRaw(all)
}

/** 组合 key：`personal:<configId>:<modelId>` */
export function metaKey(configId: string, modelId: string): string {
  return `personal:${configId}:${modelId}`
}

/** 归一化：旧版 string 额度自动迁移为 { tier: "custom", customText } */
function migrateEntry(e: ModelMetaEntry | undefined | null): ModelMetaEntry | null {
  if (!e) return null
  const q = (e as { quota?: unknown }).quota
  if (typeof q === "string") {
    return { ...e, quota: q.trim() ? { tier: "custom", customText: q } : undefined }
  }
  return e
}

/** 读取单个模型的元数据 */
export function readModelMeta(
  userId: string | null | undefined,
  configId: string,
  modelId: string,
): ModelMetaEntry | null {
  const bucket = readBucket(userId)
  return migrateEntry(bucket[metaKey(configId, modelId)])
}

/** 读取某用户下所有模型元数据（UI 批量渲染用；旧 string 自动迁移） */
export function readAllModelMeta(userId: string | null | undefined): Record<string, ModelMetaEntry> {
  const bucket = readBucket(userId)
  const out: Record<string, ModelMetaEntry> = {}
  for (const [k, v] of Object.entries(bucket)) {
    const migrated = migrateEntry(v)
    if (migrated) out[k] = migrated
  }
  return out
}

/** 更新单个模型的元数据（合并式：只覆盖传入字段） */
export function upsertModelMeta(
  userId: string | null | undefined,
  configId: string,
  modelId: string,
  patch: Partial<Omit<ModelMetaEntry, "updatedAt">>,
): ModelMetaEntry {
  const bucket = readBucket(userId)
  const key = metaKey(configId, modelId)
  const prev = bucket[key] ?? { updatedAt: "" }
  const next: ModelMetaEntry = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  // 空值清理：全空则删除条目
  const quotaEmpty = !next.quota || (next.quota.tier === "custom" && !next.quota.customText?.trim())
  const isEmpty = !next.specialty?.trim() && quotaEmpty && !(next.tags?.length)
  if (isEmpty) {
    delete bucket[key]
  } else {
    bucket[key] = next
  }
  writeBucket(userId, bucket)
  return next
}

/** 删除某配置下所有模型的元数据（配置被删时调用） */
export function clearConfigMeta(userId: string | null | undefined, configId: string): void {
  const bucket = readBucket(userId)
  const prefix = `personal:${configId}:`
  for (const k of Object.keys(bucket)) {
    if (k.startsWith(prefix)) delete bucket[k]
  }
  writeBucket(userId, bucket)
}

/** 登出/切账号时清本用户桶（R119 隐私收口同族） */
export function clearUserMetaBucket(userId: string | null | undefined): void {
  if (!userId) return
  const all = readRaw()
  delete all[bucketKey(userId)]
  writeRaw(all)
}

/** 订阅变更（同 tab 内即时刷新；跨 tab 走 storage 事件） */
type Listener = () => void
const listeners = new Set<Listener>()
export function onModelMetaChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  for (const fn of Array.from(listeners)) {
    try { fn() } catch { /* noop */ }
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY) notify()
  })
}
