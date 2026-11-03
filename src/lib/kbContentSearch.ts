// ---------------------------------------------------------------------------
// 知识库正文全文检索客户端（2026-10-29）
//
// 背景：useKnowledge.ts 的列表搜索只扫元数据（title/summary/keywords/folder），
// 注释写明「不再对每篇 content 做全文 includes（1730 篇 × 每次按键 = 卡顿主因）」。
// 结果：搜「电子病历评级」这类正文词搜不到 —— 这是知识库最大的能力缺口。
//
// 后端已用 SQLite FTS5 建好索引（7000 篇 / 1.14 亿字符 / 建索引 116s）：
//   POST /api/kb_docs/search   { q, limit, libTab }  →  { ok, total, items: [{id,title,folder_path,snippet}] }
//   POST /api/kb_docs/reindex  {}                     →  { ok, indexed }
//   GET  /api/kb_docs/search/status                   →  { ok, enabled }
//
// 片段里用 [[关键词]] 标记命中位置，前端渲染成高亮。
// ---------------------------------------------------------------------------

import { vibexAuthHeaders } from "@/lib/rhLogin"
import { getPocketBaseUrl } from "@/lib/pb"

export type KbSearchItem = {
  id: string
  title: string
  folder_path: string
  summary?: string
  updated?: string
  /** 命中片段，用 [[...]] 标记关键词位置 */
  snippet: string
}

export type KbSearchResult =
  | { ok: true; query: string; total: number; items: KbSearchItem[] }
  | { ok: false; message: string }

/** 知识库正文全文检索 */
export async function searchKbContent(opts: {
  q: string
  limit?: number
  libTab?: "team" | "personal"
}): Promise<KbSearchResult> {
  const q = String(opts.q ?? "").trim()
  if (!q) return { ok: false, message: "请输入搜索关键词" }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(`${getPocketBaseUrl()}/api/kb_docs/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
      body: JSON.stringify({ q, limit: opts.limit ?? 30, libTab: opts.libTab ?? "team" }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const j = await res.json()
    if (!j?.ok) return { ok: false, message: j?.message ?? "检索失败" }
    return {
      ok: true,
      query: j.query ?? q,
      total: Number(j.total ?? 0),
      items: Array.isArray(j.items) ? j.items : [],
    }
  } catch (e) {
    return { ok: false, message: `检索请求失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 全量重建正文索引（7000 篇约 2 分钟，管理操作，一般只在初次上线/换机时跑一次） */
export async function reindexKbContent(): Promise<{ ok: boolean; indexed?: number; message?: string }> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 600000)
    const res = await fetch(`${getPocketBaseUrl()}/api/kb_docs/reindex`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
      body: "{}",
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const j = await res.json()
    return j?.ok ? { ok: true, indexed: Number(j.indexed ?? 0) } : { ok: false, message: j?.message ?? "重建失败" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "重建失败" }
  }
}

/** 索引是否就绪 */
export async function kbSearchStatus(): Promise<{ ok: boolean; enabled: boolean }> {
  try {
    const res = await fetch(`${getPocketBaseUrl()}/api/kb_docs/search/status`, { headers: vibexAuthHeaders() })
    const j = await res.json()
    return { ok: Boolean(j?.ok), enabled: Boolean(j?.enabled) }
  } catch {
    return { ok: false, enabled: false }
  }
}

/**
 * 把片段里的 [[关键词]] 标记切成段，供 React 渲染高亮。
 * 返回 [{ text, hit }]，hit=true 的段用 <mark> 样式。
 */
export function splitSnippet(snippet: string): { text: string; hit: boolean }[] {
  const src = String(snippet ?? "")
  if (!src) return []
  const out: { text: string; hit: boolean }[] = []
  const re = /\[\[([\s\S]*?)\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), hit: false })
    out.push({ text: m[1], hit: true })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ text: src.slice(last), hit: false })
  return out
}
