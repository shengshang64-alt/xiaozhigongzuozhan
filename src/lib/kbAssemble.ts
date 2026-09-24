// 知识库「调用时组装」层（第一期·组装层赋能）：
// 在既有 searchKbDocs（BM25+IDF 块级检索，红线不动）之上，叠加：
//   1) 可见文档共享缓存 —— 替代标书/方案每次/每章节重复 listKbDocs() 全库拉取；
//   2) 赛道(track)/用途桶(bucket) 软加权 —— 让场景相关的既有语料排到前面（相关度仍主导，绝不屏蔽强相关）；
//   3) 缺料探测 —— 场景赛道在库内候选过少时显式回传，供 UI 提示「该赛道语料不足」。
// 竞品/助手场景第一期不接线；本模块对无 track 的调用与 searchKbDocs 逐条等价。

import {
  listKbDocs,
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
}

let kbCache: KbCacheEntry | null = null

/** 让缓存失效（入库/删除/编辑 kb_docs 后调用），下次组装重新拉全库 */
export function invalidateKbCache(): void {
  kbCache = null
}

/** 会话内共享的可见文档：并发调用复用同一 promise，TTL 内不重复拉全库 */
export function getCachedVisibleDocs(userId: string | null): Promise<KbDocRow[]> {
  const now = Date.now()
  if (kbCache && kbCache.userId === userId && now - kbCache.ts < CACHE_TTL_MS) {
    return kbCache.promise
  }
  const promise = listKbDocs()
    .then((rows) => visibleKbDocs(rows, userId))
    .catch((err) => {
      // 失败不留缓存，下次重试；调用方按空数组降级
      kbCache = null
      throw err
    })
  kbCache = { userId, ts: now, promise }
  return promise
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
function boostFactor(doc: KbDocRow, track?: string, buckets?: string[]): number {
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
      .map((h) => ({ ...h, score: h.score * boostFactor(h.doc, opts.track, opts.buckets) }))
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

/** 便捷格式化：把组装结果拼成正文生成用的素材块（与既有消费方口径一致） */
export function formatAssembleHits(
  hits: KbSearchHit[],
  snippetOf: (h: KbSearchHit) => string,
): string {
  if (!hits.length) return ""
  return hits
    .map((h) => `（来源文档：《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}）\n${snippetOf(h)}`)
    .join("\n\n")
}
