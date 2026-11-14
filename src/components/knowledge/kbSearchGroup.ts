// 知识库 · 全文检索的结果分组口径（纯函数，零 React / 零网络）。
//
// ## 为什么要分组
//
// 原型 kb/search.html 的核心是**一个框搜到底，结果按「标题命中 / 正文命中」分组**。
// 分组的意义不是好看，而是回答用户真正会问的那个问题：
//
//   「标题命中」→ 标题里就有这个词，通常**就是要找的那一篇**；
//   「正文命中」→ 正文段落里出现了这个词，给你语境片段，点开能跳到原文那一行。
//
// 合并成一堆「N 条结果」会让用户自己再去分辨，而那正是原型要消灭的成本。
//
// ## 口径
//
// 标题命中：标题里包含检索词（大小写不敏感，中文按子串）。
// 正文命中：服务端 FTS5 全文检索命中（`/api/kb_docs/search`，片段里用 [[词]] 标命中位）。
// 两组**允许重叠**：同一篇文档标题和正文都命中时，两组各出现一次——
// 因为用户点开的方式不同（标题命中直接打开，正文命中跳到片段位置）。

export type TitleHit = {
  id: string
  title: string
  folderPath: string
  updated: string
  summary: string
  format: string
}

/** 标题命中：标题包含检索词 */
export function titleHitsOf(
  docs: { id: string; title: string; folder_path?: string | null; updated?: string; summary?: string | null; doc_format?: string }[],
  query: string,
): TitleHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return docs
    .filter((d) => String(d.title ?? "").toLowerCase().includes(q))
    .map((d) => ({
      id: d.id,
      title: d.title,
      folderPath: d.folder_path ?? "",
      updated: d.updated ?? "",
      summary: d.summary ?? "",
      format: d.doc_format ?? "",
    }))
}

/** 命中次数文案（「命中 4 处」）——按片段里 [[词]] 的出现次数近似 */
export function countSnippetHits(snippet: string): number {
  const m = String(snippet ?? "").match(/\[\[[\s\S]*?\]\]/g)
  return m ? m.length : 0
}

/**
 * 时间分档（原型左栏「时间」三档：近 7 天 / 近 90 天 / 更早）。
 * 纯函数，便于单测。
 */
export type TimeBucket = "d7" | "d90" | "older"

export function timeBucketOf(updated: string, now = Date.now()): TimeBucket {
  const t = Date.parse(String(updated ?? ""))
  if (!Number.isFinite(t)) return "older"
  const days = (now - t) / 86_400_000
  if (days <= 7) return "d7"
  if (days <= 90) return "d90"
  return "older"
}

/** 时间分档统计 */
export function timeBucketCounts(
  items: { updated?: string }[],
  now = Date.now(),
): Record<TimeBucket, number> {
  const out: Record<TimeBucket, number> = { d7: 0, d90: 0, older: 0 }
  for (const it of items) out[timeBucketOf(it.updated ?? "", now)] += 1
  return out
}
