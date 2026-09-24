// 知识库文档本地缓存（性能第一批）：按登录用户隔离的 IndexedDB 快照。
//
// 目标：消除「每次进入知识库页都全量拉 ~1730 篇含 content 文档」造成的白屏/转场卡顿。
// 策略（stale-while-revalidate）：
//   - 挂载：先读缓存立即直显；若 syncedAt 距今 < TTL，本次挂载跳过网络；
//     否则后台全量 listKbDocs 校准后回写缓存。
//   - 任何数据变更（增删改/移动/上传/删除）与手动刷新仍走 refreshDocs 全量并回写缓存，
//     因此本机产生的修改与删除始终准确；跨用户/他人编辑的陈旧窗口至多一个 TTL。
// 隐私：只缓存当前用户可见的文档（团队库 + 本人个人笔记），不落他人个人笔记。
// 降级：无 indexedDB / 隐私模式禁用 / 打开失败时全部静默返回空，调用方回退到纯网络路径。

import type { KbDocRow } from "@/lib/kbCore"

const DB_VERSION = 1
const DOCS_STORE = "docs"
const META_STORE = "meta"
const META_KEY = "meta"

export interface KbCacheSnapshot {
  docs: KbDocRow[]
  syncedAt: number
}

function dbName(userId: string): string {
  return `kb-doc-cache:${userId}`
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
      if (!db.objectStoreNames.contains(DOCS_STORE)) db.createObjectStore(DOCS_STORE, { keyPath: "id" })
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" })
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

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error("idb tx aborted"))
  })
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? ""
  return name === "QuotaExceededError" || name === "DOMException"
}

/** 读取当前用户缓存快照；无缓存 / 无权限 / 不支持时返回 null（调用方回退网络路径）。 */
export async function loadKbCache(userId: string | null): Promise<KbCacheSnapshot | null> {
  if (!userId) return null
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const store = db.transaction(DOCS_STORE, "readonly").objectStore(DOCS_STORE)
    const docs = (await reqToPromise<KbDocRow[]>(store.getAll())) ?? []
    const metaStore = db.transaction(META_STORE, "readonly").objectStore(META_STORE)
    const meta = (await reqToPromise<{ syncedAt?: number } | undefined>(metaStore.get(META_KEY)))
    if (!docs.length) return null
    return { docs, syncedAt: typeof meta?.syncedAt === "number" ? meta.syncedAt : 0 }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/** 全量替换缓存快照并刷新 syncedAt。失败静默（含配额超限），不影响主流程。 */
export async function saveKbCache(userId: string | null, docs: KbDocRow[]): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction([DOCS_STORE, META_STORE], "readwrite")
    const store = tx.objectStore(DOCS_STORE)
    store.clear()
    for (const d of docs) store.put(d)
    tx.objectStore(META_STORE).put({ key: META_KEY, syncedAt: Date.now(), count: docs.length })
    await txDone(tx)
  } catch (err) {
    if (isQuotaError(err)) {
      // 配额超限：清空缓存，下次退回网络路径，避免反复失败
      try {
        if (db) {
          const cTx = db.transaction(DOCS_STORE, "readwrite")
          cTx.objectStore(DOCS_STORE).clear()
          await txDone(cTx)
        }
      } catch {
        /* ignore */
      }
    }
    /* 静默：缓存只是加速层，失败不应惊扰用户 */
  } finally {
    db?.close()
  }
}

/** 清除当前用户缓存（退出登录 / 用户切换时可调用）。 */
export async function clearKbCache(userId: string | null): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction([DOCS_STORE, META_STORE], "readwrite")
    tx.objectStore(DOCS_STORE).clear()
    tx.objectStore(META_STORE).clear()
    await txDone(tx)
  } catch {
    /* ignore */
  } finally {
    db?.close()
  }
}

/** 缓存新鲜度窗口：此窗口内重进页面跳过后台全量校准（毫秒）。 */
export const KB_CACHE_TTL_MS = 5 * 60 * 1000
