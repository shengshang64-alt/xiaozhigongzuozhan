// 知识库「调用时组装」层（第一期·组装层赋能）：
// 在既有 searchKbDocs（BM25+IDF 块级检索，红线不动）之上，叠加：
//   1) 可见文档共享缓存 —— 替代标书/方案每次/每章节重复 listKbDocs() 全库拉取；
//   2) 赛道(track)/用途桶(bucket) 软加权 —— 让场景相关的既有语料排到前面（相关度仍主导，绝不屏蔽强相关）；
//   3) 缺料探测 —— 场景赛道在库内候选过少时显式回传，供 UI 提示「该赛道语料不足」。
// 竞品/助手场景第一期不接线；本模块对无 track 的调用与 searchKbDocs 逐条等价。

import {
  listKbDocs,
  onKbMutation,
  searchKbDocs,
  visibleKbDocs,
  type KbDocRow,
  type KbSearchHit,
} from "@/lib/kbCore"

// ---------------------------------------------------------------------------
// 可见文档共享缓存（模块级，按 userId 维度）
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000

interface KbCacheEntry {
  userId: string | null
  ts: number
  promise: Promise<KbDocRow[]>
  /** 标记 promise 是否已 fulfilled（非阻塞 API 用） */
  resolved: boolean
  /** fulfilled 后的结果引用 */
  data: KbDocRow[] | null
}

let kbCache: KbCacheEntry | null = null

/** 让缓存失效（入库/删除/编辑 kb_docs 后调用），下次组装重新拉全库 */
export function invalidateKbCache(): void {
  kbCache = null
}

// R104 断链接线：知识库入库/删除/编辑（全部经 kbCore 三个变更函数广播）后
// 立即失效共享缓存，标书/方案侧马上能组到最新语料，不再等 5 分钟 TTL。
// 注册时机：缓存就在本文件，模块未加载则缓存不存在，不存在漏听时序问题。
onKbMutation(invalidateKbCache)


/** 缓存是否已命中且数据就绪（同 userId、TTL 内、promise 已 fulfilled）——纯 O(1) */
export function isKbCacheWarm(userId: string | null): boolean {
  return kbCache !== null && kbCache.userId === userId && kbCache.resolved && Date.now() - kbCache.ts < CACHE_TTL_MS
}

/** 非阻塞取缓存：仅当缓存已 fulfilled 时返回数据，in-flight 或冷缓存一律返回空数组（零等待）。
 *  适用护栏/轻查等可降级路径，避免首次冷加载阻塞主流程。 */
export function getCachedVisibleDocsNonBlocking(userId: string | null): Promise<KbDocRow[]> {
  if (kbCache && kbCache.userId === userId && kbCache.resolved && kbCache.data) {
    return Promise.resolve(kbCache.data)
  }
  return Promise.resolve([])
}

/** 预热缓存：fire-and-forget，已热则跳过，失败静默。
 *  在项目选中/进入标书模块时调用，利用用户阅读/操作的窗口期后台拉全库。 */
export function prewarmKbCache(userId: string | null): void {
  if (isKbCacheWarm(userId)) return
  // 触发 getCachedVisibleDocs 内部走正常缓存逻辑（写 cache + 共享 promise），
  // 调用方无需 await；失败时缓存置 null，下次操作会重试。
  getCachedVisibleDocs(userId).catch(() => { /* 预热失败静默：下次访问再走正式路径 */ })
}


/** 会话内共享的可见文档：并发调用复用同一 promise，TTL 内不重复拉全库 */
export function getCachedVisibleDocs(userId: string | null): Promise<KbDocRow[]> {
  const now = Date.now()
  if (kbCache && kbCache.userId === userId && now - kbCache.ts < CACHE_TTL_MS) {
    return kbCache.promise
  }
  const promise = listKbDocs()
    .then((rows) => {
      const data = visibleKbDocs(rows, userId)
      if (kbCache && kbCache.userId === userId) { kbCache.resolved = true; kbCache.data = data }
      return data
    })
    .catch((err) => {
      // 失败不留缓存，下次重试；调用方按空数组降级
      kbCache = null
      throw err
    })
  kbCache = { userId, ts: now, promise, resolved: false, data: null }
  return promise
}

/**
 * 2026-10-31 性能优化：按查询渐进加载语料。
 *
 * 为什么需要：getCachedVisibleDocs 无条件拉全量正文（实测 7000 篇 = 121MB / 2.4s），
 * 但检索只需要「与 query 相关的少数文档」的正文。实测元数据只有 7.6MB（省 94%）。
 *
 * 策略：元数据全量 → 按元数据粗筛（标题/摘要/关键词/赛道）→ 只给候选补正文。
 * 返回结构仍是完整 KbDocRow[]（未命中的 content 为空），调用方接口不变。
 *
 * 适用：标书/方案装配（都是「有明确 query 的检索场景」）。
 * 不适用：需要遍历全部正文的功能（如全文导出）——那些仍应用 getCachedVisibleDocs。
 */
export async function getDocsForQuery(
  userId: string | null,
  query: string,
  opts?: { track?: string; buckets?: string[]; sections?: string[] },
): Promise<KbDocRow[]> {
  const { loadCorpusForQuery } = await import("./kbCorpusLazy")
  const { docs } = await loadCorpusForQuery(query, opts)
  return visibleKbDocs(docs, userId)
}

/**
 * A2（2026-10-25）：用刚拉取的全量可见行回填共享缓存——QA 语料通道为拿「过滤前的原始行」
 * 计算游标而绕过 getCachedVisibleDocs 直拉 listKbDocs；seed 让助手/标书/方案等共享消费方
 * 仍然复用同一份数据（保持 R229 的并发去重收益）。只用于「刚拉取的新鲜数据」。
 */
export function seedKbCache(userId: string | null, rows: KbDocRow[]): void {
  kbCache = { userId, ts: Date.now(), promise: Promise.resolve(rows), resolved: true, data: rows }
}

// ---------------------------------------------------------------------------
// 组装上下文
// ---------------------------------------------------------------------------

export type TrackCoverageLevel = "ok" | "thin" | "empty" | "na"

export interface TrackStatus {
  level: TrackCoverageLevel
  /** 该赛道在可见库内的文档候选数（level=na 时为 0） */
  count: number
  track?: string
}

export interface AssembleOptions {
  /** 检索语句（透传给 searchKbDocs） */
  query: string
  /** 场景赛道：命中它的文档软加权，未命中真实赛道的降权 */
  track?: string
  /** 场景用途桶：命中任一桶的文档软加权 */
  buckets?: string[]
  /** 章节用途（2026-10-07 用户口径）：命中当前章节用途的文档软加权（设计方案/实施方案/售后方案等） */
  sections?: string[]
  /** 返回篇数（同 searchKbDocs topN，内部仍限 3–8） */
  topN?: number
  /** 缺料判定阈值（该赛道候选 < 该值 → thin；=0 → empty），默认 3 */
  thinThreshold?: number
}

export interface AssembleResult {
  hits: KbSearchHit[]
  trackStatus: TrackStatus
}

// 软加权系数（乘在 searchKbDocs 命中的 score 上；保持正数、幅度温和）
const W_TRACK_MATCH = 1.25
const W_TRACK_CROSS = 0.9
const W_BUCKET_MATCH = 1.15

/** 统计某赛道在可见库内的文档候选数（按 kb_track 精确匹配） */
function countTrackCandidates(docs: KbDocRow[], track: string): number {
  let n = 0
  for (const d of docs) if ((d.kb_track ?? "") === track) n += 1
  return n
}

/** 单条命中相对场景 profile 的加权因子 */
function boostFactor(doc: KbDocRow, track?: string, buckets?: string[], sections?: string[]): number {
  let f = 1
  if (track) {
    const dt = doc.kb_track ?? ""
    if (dt && dt !== "通用" && dt === track) f *= W_TRACK_MATCH
    else if (dt && dt !== "通用" && dt !== track) f *= W_TRACK_CROSS
    // 未分类/通用：中性，不加不降
  }
  if (buckets && buckets.length) {
    const db = doc.kb_bucket ?? ""
    if (db && buckets.includes(db)) f *= W_BUCKET_MATCH
  }
  // 章节用途软加权（2026-10-07 用户口径）：同用途语料排前，未标注的中性
  if (sections && sections.length) {
    const ds = doc.kb_section ?? ""
    if (ds && sections.includes(ds)) f *= W_BUCKET_MATCH
  }
  return f
}

/**
 * 组装场景化知识库上下文：先 BM25 检索，再按赛道/桶软重排，并探测赛道缺料。
 * 无 track 且无 buckets 时，等价于 searchKbDocs(docs, query, topN)。
 */
export function assembleKbContext(docs: KbDocRow[], opts: AssembleOptions): AssembleResult {
  const topN = opts.topN ?? 5
  const hits = searchKbDocs(docs, opts.query, topN)
  const hasProfile = Boolean(opts.track) || Boolean(opts.buckets && opts.buckets.length)

  let out = hits
  if (hasProfile && hits.length) {
    out = hits
      .map((h) => ({ ...h, score: h.score * boostFactor(h.doc, opts.track, opts.buckets, opts.sections) }))
      .sort((a, b) => b.score - a.score)
  }

  let trackStatus: TrackStatus = { level: "na", count: 0 }
  if (opts.track) {
    const count = countTrackCandidates(docs, opts.track)
    const threshold = opts.thinThreshold ?? 3
    trackStatus = {
      level: count === 0 ? "empty" : count < threshold ? "thin" : "ok",
      count,
      track: opts.track,
    }
  }
  return { hits: out, trackStatus }
}

