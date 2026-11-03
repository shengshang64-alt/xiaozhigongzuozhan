// ---------------------------------------------------------------------------
// 标书编制 · 历史标书检索（2026-10-30）
//
// 场景：
//   写「技术方案」某一章时，往往要参考过去投过的同类项目怎么写的。
//   这些历史标书躺在 D:\...\B标书\ 里，从未入库，以前只能手动翻文件夹。
//   现在：在正文右栏输关键词 → 直接搜到历史标书原文片段 → 一键插入当前章光标处。
//
// 数据来源：AnyTXT 离线索引（GetResult 出命中文件 + GetFragment 出上下文片段）。
// 与「知识库」Tab 的分工：
//   - 知识库：已沉淀、已脱敏、可对客的团队资产
//   - 历史标书：硬盘上的原始历史文件，未脱敏，仅供**内部参考改写**，不要原文照搬
//
// 因此本模块的片段在插入时会自动加「内部参考，须改写」前缀（见 toInsertText）。
// ---------------------------------------------------------------------------

import { contextAnytxt, type AnytxtContextItem } from "@/lib/anytxtClient"

export type HistoryHit = {
  /** AnyTXT 文件 id */
  fid: string
  /** 文件名（去扩展名） */
  title: string
  /** 末两级目录，用于辨认项目来源 */
  dir: string
  /** 完整路径（仅内部记忆，不展示） */
  path: string
  /** 命中上下文片段（含 *<<*高亮*>>* 标记） */
  snippet: string
}

/** AnyTXT 的片段高亮标记是 *<<*关键词*>>*，这里转成纯文本供插入正文 */
function stripHighlight(s: string): string {
  return s.replace(/\*<<\*/g, "").replace(/\*>>\*/g, "")
}

/** 清理片段：去高亮标记、压掉多余空白、去掉表格行噪声 */
function cleanSnippet(raw: string): string {
  const text = stripHighlight(raw)
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    // 去掉「R1: | a | b | c」这类表格导出噪声（历史标书里常见）
    .filter((l) => !/^R\d+:\s*\|/.test(l))
    .filter((l) => (l.match(/[,，|]/g) || []).length / Math.max(l.length, 1) < 0.35)
  return lines.join("\n").slice(0, 1200)
}

/**
 * 把命中结果转成可插入正文的文本。
 *
 * 关键：历史标书**未经脱敏**，可能含别的医院名称、报价、内部批注。
 * 插入时必须显式标注来源与「须改写」，避免同事直接照搬造成事故。
 */
export function toInsertText(hit: HistoryHit): { text: string; label: string } {
  const body = cleanSnippet(hit.snippet).trim()
  return {
    text: `> 参考来源（内部历史标书，须改写后使用）：${hit.title} · ${hit.dir}\n${body}`,
    label: `历史标书 · ${hit.title}`,
  }
}

export type HistorySearchResult =
  | { ok: true; hits: HistoryHit[]; total: number }
  | { ok: false; message: string }

/** 检索本机历史标书（AnyTXT） */
export async function searchHistoryBids(opts: {
  keyword: string
  /** 只在这些目录里搜（用户可限定到标书库，提高准确率） */
  filterDir?: string
  limit?: number
}): Promise<HistorySearchResult> {
  const kw = String(opts.keyword ?? "").trim()
  if (!kw) return { ok: false, message: "请输入检索关键词" }

  // 用 context 接口一次拿「命中文件 + 片段」，比先 search 再逐条 fragment 少一轮往返
  const r = await contextAnytxt({ pattern: kw, topN: Math.min(opts.limit ?? 8, 20), limit: 60 })
  if (!r.ok) return { ok: false, message: r.message }

  const hits: HistoryHit[] = r.items
    .map((it: AnytxtContextItem) => {
      const parts = it.path.split(/[\\/]/).filter(Boolean)
      return {
        fid: it.id,
        title: (it.name || "未命名").replace(/\.[A-Za-z0-9]{1,8}$/, ""),
        dir: parts.slice(-3, -1).join("/") || parts.slice(-1).join(""),
        path: it.path,
        snippet: it.text || "",
      }
    })
    // 没有片段的（取 fragment 失败）不展示，避免插入空内容
    .filter((h) => h.snippet.trim().length > 0)

  // 去重：同一文件可能在多个位置被索引（原目录 + backup + trash 副本），
  // 按「文件名 + 片段前 80 字」判重，只保留第一条，避免右栏出现三张一样的卡
  const seen = new Set<string>()
  const unique = hits.filter((h) => {
    const key = h.title + "|" + h.snippet.replace(/\s+/g, "").slice(0, 80)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { ok: true, hits: unique, total: r.count }
}
