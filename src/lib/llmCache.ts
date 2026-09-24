// LLM 精确响应缓存（降耗）：prompt_hash → response。
//
// 背景：pb_hooks（含 model_gateway.pb.js）为红线区不可改，故缓存在前端网关封装层
// （chatViaGateway）落地，不触碰服务端。仅对调用方显式开启 cacheable 的请求生效，
// 默认关闭，避免改变「重新生成」等期望每次新结果的既有行为。
//
// 命中口径：source+configId+modelId + 完整 messages + max_tokens + temperature + page
// 全部一致才算同一请求（identity）。以 SHA-256(identity) 作主键，同时存原文 identity
// 于记录内并在命中时比对，杜绝哈希碰撞返回错答。
// 隔离：按登录用户分库（personal 配置 key 属个人），未登录不缓存。
// 失效：读取时按 TTL 判定；写入时顺带清理过期项。任何异常静默降级为「不缓存」。

import type { LlmCallResult } from "@/lib/llm"

const DB_VERSION = 1
const STORE = "resp"
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

interface CacheRecord {
  key: string
  identity: string
  text: string
  model?: string
  usage?: unknown
  createdAt: number
  ttl: number
}

function dbName(userId: string): string {
  return `llm-resp-cache:${userId}`
}

function openDb(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"))
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(dbName(userId), DB_VERSION)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"))
    req.onblocked = () => reject(new Error("indexedDB blocked"))
  })
}

function reqToPromise<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    } catch {
      /* fall through to FNV */
    }
  }
  // 非安全上下文兜底：双 32 位 FNV-1a，仅作主键；命中仍以 identity 原文比对为准。
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return `fnv-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}-${text.length}`
}

/** 读取命中结果；未命中 / 过期 / identity 不符（防碰撞）/ 异常均返回 null。 */
export async function llmCacheGet(userId: string | null, identity: string): Promise<LlmCallResult | null> {
  if (!userId) return null
  let db: IDBDatabase | null = null
  try {
    const key = await sha256Hex(identity)
    db = await openDb(userId)
    const store = db.transaction(STORE, "readonly").objectStore(STORE)
    const rec = (await reqToPromise<CacheRecord | undefined>(store.get(key))) ?? undefined
    if (!rec || rec.identity !== identity) return null
    if (Date.now() - rec.createdAt > rec.ttl) return null
    return { ok: true, status: "success", text: rec.text, model: rec.model, usage: rec.usage }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/** 写入成功响应；顺带清理过期项。失败静默。 */
export async function llmCacheSet(
  userId: string | null,
  identity: string,
  result: LlmCallResult,
  ttlMs = DEFAULT_TTL_MS,
): Promise<void> {
  if (!userId || !result.ok || result.status !== "success" || !result.text) return
  let db: IDBDatabase | null = null
  try {
    const key = await sha256Hex(identity)
    db = await openDb(userId)
    const now = Date.now()
    const tx = db.transaction(STORE, "readwrite")
    const store = tx.objectStore(STORE)
    const all = ((await reqToPromise<CacheRecord[]>(store.getAll())) ?? []).filter(
      (r) => now - r.createdAt <= r.ttl,
    )
    store.clear()
    for (const r of all) store.put(r)
    store.put({
      key,
      identity,
      text: result.text,
      model: result.model,
      usage: result.usage,
      createdAt: now,
      ttl: ttlMs,
    })
  } catch {
    /* 静默：缓存只是降耗层 */
  } finally {
    db?.close()
  }
}

/** 清空当前用户 LLM 响应缓存（模型配置变更 / 用户切换时可调用）。 */
export async function clearLlmCache(userId: string | null): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).clear()
  } catch {
    /* ignore */
  } finally {
    db?.close()
  }
}
