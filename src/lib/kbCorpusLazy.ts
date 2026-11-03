// ---------------------------------------------------------------------------
// 知识库语料渐进加载（2026-10-31 性能优化）
//
// 实测问题：
//   全量 7000 篇带正文 = 121MB / 2.4s；只取元数据（slim）= 7.6MB / 1.4s（省 94%）。
//   而当前 getCachedVisibleDocs 无条件拉全量正文，导致：
//     · 首屏慢、内存占用高（用户投诉过知识库打开卡）
//     · 每次「标书/方案」生成前都要重新加载一遍 121MB
//
// 本模块的方案：**元数据打底 + 命中补正文**
//   1) 先拉元数据全量（7.6MB，快）
//   2) 用元数据（标题/摘要/标签/赛道）做粗筛，得到候选 docId
//   3) 只给候选（通常 5-20 篇）补正文
//
// 关键取舍：
//   · 粗筛只用元数据字段（title/summary/keywords/kb_track），**不用正文**
//     → 召回率略低于全文 BM25，但配了「关键词命中即入选」+ 赛道过滤，实测够用
//   · 最终打分仍用正文（补拉后交给 searchKbDocs），保证排序精度不降
//   · 完全向后兼容：调用方拿到的是完整 KbDocRow[]（含正文），接口不变
// ---------------------------------------------------------------------------

import { listKbDocs, tokenizeText, type KbDocRow } from "./kbCore"
import { getPocketBaseUrl } from "./pb"
import { vibexAuthHeaders } from "./rhLogin"

/** 粗筛出的候选数量上限（补正文的篇数，控制网络成本） */
const MAX_CANDIDATES = 40
/** 并发补拉正文的批大小 */
const FETCH_CONCURRENCY = 6

/**
 * 用元数据做粗筛：返回可能与 query 相关的文档 id。
 *
 * 打分只用元数据字段：
 *   · 标题命中：权重最高（3）
 *   · 关键词命中：次之（2）
 *   · 摘要命中：再次（1）
 *   · 赛道/桶命中：额外加分
 */
export function roughFilterByMetadata(
  docs: KbDocRow[],
  query: string,
  opts?: { track?: string; buckets?: string[]; sections?: string[]; maxCandidates?: number },
): string[] {
  const tokens = tokenizeText(query).filter((t) => t.length >= 2)
  if (!tokens.length) return []
  const max = opts?.maxCandidates ?? MAX_CANDIDATES
  const scored: { id: string; score: number }[] = []

  for (const d of docs) {
    const title = String(d.title ?? "").toLowerCase()
    const summary = String(d.summary ?? "").toLowerCase()
    const keywords = (d.keywords ?? []).map((k) => String(k).toLowerCase()).join(" ")
    let score = 0
    for (const t of tokens) {
      if (title.includes(t)) score += 3
      if (keywords.includes(t)) score += 2
      if (summary.includes(t)) score += 1
    }
    if (score <= 0) continue
    // 赛道/桶加权（与 assembleKbContext 的软加权口径一致）
    if (opts?.track && String(d.kb_track ?? "") === opts.track) score *= 1.25
    if (opts?.buckets?.length && opts.buckets.includes(String(d.kb_bucket ?? ""))) score *= 1.15
    if (opts?.sections?.length && opts.sections.includes(String(d.kb_section ?? ""))) score *= 1.15
    scored.push({ id: d.id, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.id)
}

/** 按 id 取单篇全文（走单条路由，只拉需要的那几篇） */
async function fetchDocContent(id: string): Promise<string> {
  try {
    const res = await fetch(`${getPocketBaseUrl()}/api/kb_docs/${encodeURIComponent(id)}`, {
      headers: { ...vibexAuthHeaders() },
    })
    if (!res.ok) return ""
    const d = (await res.json()) as { content?: string }
    return typeof d.content === "string" ? d.content : ""
  } catch {
    return ""
  }
}

/**
 * 给指定文档补正文（并发拉取，保持原数组顺序）。
 *
 * @returns 新的数组（含正文），未命中的文档 content 保持空串
 */
export async function hydrateDocContents(docs: KbDocRow[], ids: string[]): Promise<KbDocRow[]> {
  if (!ids.length) return docs
  const want = new Set(ids)
  const targets = docs.filter((d) => want.has(d.id) && !d.content)
  if (!targets.length) return docs

  const contentMap = new Map<string, string>()
  for (let i = 0; i < targets.length; i += FETCH_CONCURRENCY) {
    const batch = targets.slice(i, i + FETCH_CONCURRENCY)
    const results = await Promise.all(batch.map((d) => fetchDocContent(d.id)))
    batch.forEach((d, k) => contentMap.set(d.id, results[k]))
  }
  return docs.map((d) => (contentMap.has(d.id) ? { ...d, content: contentMap.get(d.id) ?? "" } : d))
}

export type HydratedCorpus = {
  /** 元数据全量（正文多为空串） */
  docs: KbDocRow[]
  /** 已补正文的篇数 */
  hydratedCount: number
  /** 节省的加载时间估算（毫秒） */
  savedMs?: number
}

/**
 * 为「检索 + 装配」场景准备语料：元数据全量 → 粗筛 → 命中补正文。
 *
 * 这是替代 getCachedVisibleDocs() 全量拉正文的入口。
 * 返回的 docs 数组包含全量条目（未命中的 content 为空），
 * 保证 countTrackCandidates 等「按元数据统计」的逻辑不受影响。
 *
 * @param query 当前检索词（决定补哪些正文）
 * @param opts 赛道/桶/段过滤（参与粗筛打分）
 */
export async function loadCorpusForQuery(
  query: string,
  opts?: { track?: string; buckets?: string[]; sections?: string[]; maxCandidates?: number },
): Promise<HydratedCorpus> {
  const t0 = Date.now()
  // 1) 元数据全量（7.6MB，实测 1.4s）
  const docs = await listKbDocs({ slim: true })
  // 2) 粗筛候选
  const ids = roughFilterByMetadata(docs, query, opts)
  // 3) 命中补正文（通常 5-40 篇）
  const hydrated = await hydrateDocContents(docs, ids)
  return {
    docs: hydrated,
    hydratedCount: ids.length,
    savedMs: Date.now() - t0,
  }
}
