// 标准问答弹药库（轮次 D-3）：kb_qa_pairs 的 CRUD 封装 + 重合率匹配（三色置信度）。
// approved QA 对高置信直答零费用；低命中且检索为空时自动入待补答队列。

import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { tokenizeText } from "@/lib/kbCore"

// ---------------------------------------------------------------------------
// 行类型（字段名与 kb_qa_pairs collection 100% 一致，snake_case）
// ---------------------------------------------------------------------------

export interface KbQaPairRow {
  id: string
  rh_user_id: string
  question: string
  answer: string
  category: string
  /** approved | pending */
  status: string
  /** manual | qa_gap */
  source: string
  /** team | personal */
  visibility: string
  created: string
  updated: string
}

/** 小智取数直答哨兵：fetchSiteData 返回以此为前缀时，executeTurn 跳过后续 LLM 调用 */
export const KB_QA_DIRECT_PREFIX = "[[KB_QA_DIRECT]]\n"

async function qaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
    err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

export async function listKbQaPairs(): Promise<KbQaPairRow[]> {
  // 循环7 C2-3：服务端单页上限 200，原实现只拉第 1 页会截断；
  // 改循环翻页拉全（返回条数 < 一页即止），安全上限 10 页（2000 条），超限 console.warn。
  const PER_PAGE = 200
  const MAX_PAGES = 10
  const all: KbQaPairRow[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await qaFetch<{ items: KbQaPairRow[]; perPage?: number }>(
      `/api/kb_qa_pairs?page=${page}&perPage=${PER_PAGE}`,
    )
    const rows = data.items ?? []
    all.push(...rows)
    const effectivePerPage =
      typeof data.perPage === "number" && data.perPage > 0 ? data.perPage : PER_PAGE
    if (rows.length < effectivePerPage) return all
    if (page === MAX_PAGES) {
      console.warn(
        `[kbQa] listKbQaPairs 达到翻页安全上限 ${MAX_PAGES} 页（已取 ${all.length} 条），超出部分未返回`,
      )
    }
  }
  return all
}

/** 当前用户可见的 QA 对：team 全员可见，personal 仅本人 */
export function visibleQaPairs(rows: KbQaPairRow[], userId: string | null): KbQaPairRow[] {
  return rows.filter((r) => r.visibility !== "personal" || (!!userId && r.rh_user_id === userId))
}

export async function createKbQaPair(body: {
  rh_user_id: string
  question: string
  answer: string
  category: string
  status: string
  source: string
  visibility: string
}): Promise<KbQaPairRow> {
  return qaFetch<KbQaPairRow>(`/api/kb_qa_pairs`, { method: "POST", body: JSON.stringify(body) })
}

export async function updateKbQaPair(
  id: string,
  body: Partial<Pick<KbQaPairRow, "question" | "answer" | "category" | "status" | "visibility">>,
): Promise<KbQaPairRow> {
  return qaFetch<KbQaPairRow>(`/api/kb_qa_pairs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export async function deleteKbQaPair(id: string): Promise<void> {
  await qaFetch<{ ok: boolean }>(`/api/kb_qa_pairs/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// 匹配与三色置信度：token 重合率与字符 bigram 重合率取较大者
// ---------------------------------------------------------------------------

export interface QaMatch {
  pair: KbQaPairRow
  level: "high" | "medium"
  score: number
}

function charBigrams(text: string): Set<string> {
  const src = (text ?? "").toLowerCase().replace(/\s+/g, "")
  const grams = new Set<string>()
  for (let i = 0; i + 2 <= src.length; i++) grams.add(src.slice(i, i + 2))
  return grams
}

export function matchQaPair(question: string, approvedPairs: KbQaPairRow[]): QaMatch | null {
  const q = (question ?? "").trim()
  if (!q || approvedPairs.length === 0) return null
  const qToks = new Set(tokenizeText(q).filter((t) => t.length >= 2))
  if (qToks.size === 0) return null
  const qGrams = charBigrams(q)
  let best: QaMatch | null = null
  for (const pair of approvedPairs) {
    const pToks = new Set(tokenizeText(pair.question ?? "").filter((t) => t.length >= 2))
    if (pToks.size === 0) continue
    let tokInter = 0
    for (const t of pToks) {
      if (qToks.has(t)) tokInter += 1
    }
    const tokRatio = tokInter / qToks.size
    const pGrams = charBigrams(pair.question ?? "")
    let gramInter = 0
    for (const g of pGrams) {
      if (qGrams.has(g)) gramInter += 1
    }
    const gramRatio = qGrams.size > 0 ? gramInter / qGrams.size : 0
    const score = Math.max(tokRatio, gramRatio)
    const level: QaMatch["level"] | null = score >= 0.75 ? "high" : score >= 0.45 ? "medium" : null
    if (level && (!best || score > best.score)) best = { pair, level, score }
  }
  return best
}

/** 待补答去重键：同用户同问题（忽略大小写与首尾空白） */
export function qaGapDedupeKey(question: string): string {
  return (question ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}
