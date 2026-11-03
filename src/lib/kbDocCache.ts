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

const DB_VERSION = 2
const DOCS_STORE = "docs"
const CORPUS_STORE = "corpus"
const META_STORE = "meta"
const META_KEY = "meta"
const CORPUS_META_KEY = "corpusMeta"
const CORPUS_IDF_KEY = "corpusIdf"

export interface KbCacheSnapshot {
  docs: KbDocRow[]
  syncedAt: number
}

/**
 * A1（2026-10-24）：QA 全文检索语料快照——独立于列表快照（docs store 是 slim 元数据），
 * corpus store 存全量正文行，meta 存新鲜度游标。不做 TTL（新鲜度由调用方游标探针判定，
 * 见 useKnowledge.reconcileCorpusInBackground）。7000 篇实测：写 2.2s / 读 1.4s / 配额充裕。
 */
export interface KbCorpusSnapshot {
  docs: KbDocRow[]
  /** 快照内最大 updated（PB autodate），作为增量新鲜度游标 */
  maxUpdated: string
  syncedAt: number
  /** 上一次「全量」同步时间（删除传播的对账锚点：超过 24h 强制全量，见 useKnowledge） */
  lastFullAt: number
  /** 已持久化的 IDF（df 抽样构建实测 30s，是冷检索真凶；与语料同生命周期写入/清除）。
   * scope = 该 df 对应的检索范围（IDF 按语料子集计算，跨 scope 注入会造成排序漂移；
   * 历史快照无 scope 字段回退 "all"——首版落库均来自默认范围，口径正确）。 */
  idf?: { N: number; df: [string, number][]; scope: string }
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
      // A1（v2）：QA 全文语料快照 store；v1 库自动升级补建，docs/meta 数据保留
      if (!db.objectStoreNames.contains(CORPUS_STORE)) db.createObjectStore(CORPUS_STORE, { keyPath: "id" })
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

/** 清除当前用户缓存（退出登录 / 用户切换时可调用）。A1 起连同 corpus 全文快照一并清除（PHI 不滞留本机）。 */
export async function clearKbCache(userId: string | null): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction([DOCS_STORE, CORPUS_STORE, META_STORE], "readwrite")
    tx.objectStore(DOCS_STORE).clear()
    tx.objectStore(CORPUS_STORE).clear()
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

// ---------------------------------------------------------------------------
// A1：QA 全文语料快照（纯函数 + IO）
// ---------------------------------------------------------------------------

/** 纯函数：语料新鲜度游标 = 最大 updated（先按时间戳比较，非法回退字典序；空语料为 ""）。 */
export function computeCorpusCursor(docs: Pick<KbDocRow, "updated">[]): string {
  let max = ""
  let maxAt = -Infinity
  for (const d of docs) {
    const u = d?.updated ?? ""
    if (!u) continue
    const at = Date.parse(u)
    if (Number.isFinite(at)) {
      if (at > maxAt) {
        maxAt = at
        max = u
      }
    } else if (u > max) {
      max = u
    }
  }
  return max
}

/** 纯函数：游标一致即新鲜（双方都空 = 空库对空库，视为新鲜）。 */
export function isCorpusFresh(localCursor: string, serverMaxUpdated: string): boolean {
  return localCursor === serverMaxUpdated
}

/** 读取 QA 全文语料快照（含可选的持久化 IDF）；无快照 / 无权限 / 不支持 IndexedDB 时返回 null。 */
export async function loadCorpusCache(userId: string | null): Promise<KbCorpusSnapshot | null> {
  if (!userId) return null
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const store = db.transaction(CORPUS_STORE, "readonly").objectStore(CORPUS_STORE)
    const docs = (await reqToPromise<KbDocRow[]>(store.getAll())) ?? []
    if (!docs.length) return null
    const metaStore = db.transaction(META_STORE, "readonly").objectStore(META_STORE)
    const meta = (await reqToPromise<{ maxUpdated?: string; syncedAt?: number; lastFullAt?: number } | undefined>(
      metaStore.get(CORPUS_META_KEY),
    ))
    // A1：IDF 独立 meta 键（首次检索构建完成后异步写入），脏值整体丢弃
    const idfMeta = (await reqToPromise<{ N?: unknown; df?: unknown; scope?: unknown } | undefined>(
      metaStore.get(CORPUS_IDF_KEY),
    )) as { N?: unknown; df?: unknown; scope?: unknown } | undefined
    const idf =
      typeof idfMeta?.N === "number" && Array.isArray(idfMeta.df)
        ? { N: idfMeta.N, df: idfMeta.df as [string, number][], scope: typeof idfMeta.scope === "string" ? idfMeta.scope : "all" }
        : undefined
    return {
      docs,
      maxUpdated: typeof meta?.maxUpdated === "string" ? meta.maxUpdated : computeCorpusCursor(docs),
      syncedAt: typeof meta?.syncedAt === "number" ? meta.syncedAt : 0,
      lastFullAt: typeof meta?.lastFullAt === "number" ? meta.lastFullAt : 0,
      idf,
    }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/** 在语料快照之后异步写入 IDF（首次检索构建完成后调用；实测 42.9 万词条 ~4.2MB）。
 * scope 记录该 df 对应的检索范围，载入时只注入同 scope 的数组（防跨子集排序漂移）。失败静默。 */
export async function saveCorpusIdf(
  userId: string | null,
  idf: { N: number; df: [string, number][]; scope: string },
): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction(META_STORE, "readwrite")
    tx.objectStore(META_STORE).put({ key: CORPUS_IDF_KEY, N: idf.N, df: idf.df, scope: idf.scope })
    await txDone(tx)
  } catch {
    /* 静默：IDB F 只是加速层，缺失则下次检索重建 */
  } finally {
    db?.close()
  }
}

/** 全量替换语料快照并写游标。失败静默（含配额超限→自清），不影响主流程。 */
export async function saveCorpusCache(
  userId: string | null,
  docs: KbDocRow[],
  opts?: { cursor?: string; markFull?: boolean },
): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction([CORPUS_STORE, META_STORE], "readwrite")
    const store = tx.objectStore(CORPUS_STORE)
    store.clear()
    for (const d of docs) store.put(d)
    // A2：cursor 可显式传入（应取「过滤可见性之前」的全量行最大 updated——用可见子集算会在
    // 他人个人文档为最新时造成游标永不追平、每次会话重复增量拉取）；增量保存保留 lastFullAt。
    const prev = (await reqToPromise<{ lastFullAt?: number } | undefined>(
      tx.objectStore(META_STORE).get(CORPUS_META_KEY),
    )) as { lastFullAt?: number } | undefined
    tx.objectStore(META_STORE).put({
      key: CORPUS_META_KEY,
      maxUpdated: opts?.cursor ?? computeCorpusCursor(docs),
      syncedAt: Date.now(),
      count: docs.length,
      lastFullAt: opts?.markFull ? Date.now() : typeof prev?.lastFullAt === "number" ? prev.lastFullAt : 0,
    })
    await txDone(tx)
  } catch (err) {
    if (isQuotaError(err)) {
      try {
        if (db) {
          const cTx = db.transaction(CORPUS_STORE, "readwrite")
          cTx.objectStore(CORPUS_STORE).clear()
          await txDone(cTx)
        }
      } catch {
        /* ignore */
      }
    }
    /* 静默：快照只是加速层 */
  } finally {
    db?.close()
  }
}

/** 仅清除语料快照（会内数据变更后防旧正文滞留检索层；列表快照不动；IDF 同生命周期清除）。 */
export async function clearCorpusCache(userId: string | null): Promise<void> {
  if (!userId) return
  let db: IDBDatabase | null = null
  try {
    db = await openDb(userId)
    const tx = db.transaction([CORPUS_STORE, META_STORE], "readwrite")
    tx.objectStore(CORPUS_STORE).clear()
    const metaStore = tx.objectStore(META_STORE)
    metaStore.delete(CORPUS_META_KEY)
    metaStore.delete(CORPUS_IDF_KEY)
    await txDone(tx)
  } catch {
    /* ignore */
  } finally {
    db?.close()
  }
}
