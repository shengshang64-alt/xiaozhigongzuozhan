import { searchKbDocs, tokenizeText, visibleKbDocs, type KbDocRow, type KbSearchHit } from "@/lib/kbCore"
import { matchQaPair, visibleQaPairs, type KbQaPairRow } from "@/lib/kbQa"
import { contextSnippetOf } from "@/lib/kbPolicy"

// ---------------------------------------------------------------------------
// R212 切片0.5B：标书编制右栏「素材弹药」的确定性检索/推荐逻辑。
// 三来源——知识库 / 弹药库(标准问答) / 本标书其它已生成章节；引用即复制、零 AI、
// 零新 collection。可见性与脱敏策略全部复用 kbCore / kbQa / kbPolicy 既有真源，
// 本模块只做组合与打分，便于单测锈死。React 侧 BidMaterialAmmoPanel 仅消费导出函数。
// ---------------------------------------------------------------------------

export type BidMaterialTab = "kb" | "ammo" | "sibling" | "history"

export type BidMaterialKbHit = {
  key: string
  title: string
  badge: string
  snippet: string
  label: string
}

export type BidMaterialAmmoItem = {
  key: string
  title: string
  badge: string
  snippet: string
  label: string
}

export type BidMaterialSiblingItem = {
  key: string
  title: string
  badge: string
  snippet: string
  text: string
  label: string
}

export type BidMaterialReco = {
  key: string
  source: BidMaterialTab
  title: string
  badge: string
  snippet: string
  text: string
  label: string
}

/** 本标书其它章节（跨章复用素材源）——由调用方从当前项目已生成章节筛出后传入 */
export type BidSiblingChapter = { id: string; title: string; content: string }

const KB_LIMIT = 8
const AMMO_LIMIT = 20

/** 知识库：按块命中 + 脱敏/禁入策略自动生效 */
export function pickKbHits(docs: KbDocRow[], userId: string | null, query: string, limit = KB_LIMIT): BidMaterialKbHit[] {
  const q = (query || "").trim()
  if (!q) return []
  // 2026-10-30 场景归位接入：编标书时只取「标书弹药 + 方案素材」且可对客的材料。
  // 内部参考类（含报价/失标/内部制度）不进正文，避免把敏感内容写进投标文件。
  const scoped = visibleKbDocs(docs, userId).filter((d) => {
    // 未归位的材料（历史数据）不拦，保持向后兼容
    if (!d.kb_scenes) return true
    if (d.kb_audience === "internal_only") return false
    const scenes = String(d.kb_scenes)
    return scenes.includes("bid") || scenes.includes("proposal") || scenes.includes("faq")
  })
  const hits: KbSearchHit[] = searchKbDocs(scoped, q, Math.max(3, Math.min(limit, 8)))
  return hits.map((h) => {
    const snippet = contextSnippetOf(h.doc, { snippet: h.snippet })
    return {
      key: `kb:${h.doc.id}:${h.chunkStart ?? "doc"}`,
      title: h.doc.title,
      badge: h.headingPath || h.doc.folder_path || "知识库",
      snippet,
      label: `《${h.doc.title}》${h.headingPath ? ` · ${h.headingPath}` : ""}`,
    }
  })
}

function toAmmoItem(pair: KbQaPairRow): BidMaterialAmmoItem {
  return {
    key: `ammo:${pair.id}`,
    title: pair.question,
    badge: pair.category || "标准问答",
    snippet: pair.answer,
    label: `弹药库 · ${pair.question}`,
  }
}

/** 弹药库：仅取已审批可见问答；有搜索词按相似度打分排序 */
export function pickAmmoPairs(pairs: KbQaPairRow[], userId: string | null, query: string): BidMaterialAmmoItem[] {
  const approved = visibleQaPairs(pairs, userId).filter((r) => r.status === "approved")
  const q = (query || "").trim()
  if (!q) return approved.slice(0, AMMO_LIMIT).map(toAmmoItem)
  const scored: { pair: KbQaPairRow; score: number }[] = []
  for (const pair of approved) {
    const matched = matchQaPair(q, [pair])
    if (matched) scored.push({ pair, score: matched.score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, AMMO_LIMIT).map((s) => toAmmoItem(s.pair))
}

function toSiblingItem(c: BidSiblingChapter): BidMaterialSiblingItem {
  const text = (c.content || "").trim()
  return {
    key: `sibling:${c.id}`,
    title: c.title,
    badge: "本标书章节",
    snippet: text,
    text,
    label: `标书章节 · ${c.title}`,
  }
}

/** 本标书其它已生成章节：默认全列，有搜索词按标题/正文词命中打分排序（排除当前章） */
export function pickSiblingChapters(
  chapters: BidSiblingChapter[],
  activeId: string | null,
  query: string,
  limit = 12,
): BidMaterialSiblingItem[] {
  const pool = (chapters || []).filter((c) => c.id !== activeId && (c.content || "").trim().length > 0)
  const q = (query || "").trim()
  if (!q) return pool.slice(0, limit).map(toSiblingItem)
  const tokens = tokenizeText(q).filter((t) => t.length >= 2)
  const scored = pool.map((c) => {
    let hit = 0
    for (const tok of tokens) {
      if ((c.title || "").includes(tok)) hit += 2
      if ((c.content || "").includes(tok)) hit += 1
    }
    return { c, hit }
  })
  return scored
    .filter((s) => s.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, limit)
    .map((s) => toSiblingItem(s.c))
}

/**
 * 智能推荐：未输入搜索词时按「当前章主题」跨三来源本地打分推荐，零 AI 调用。
 * 与手动搜索共用同一套可见性/脱敏策略（pickKbHits / pickAmmoPairs）。
 */
export function buildBidRecos(args: {
  docs: KbDocRow[]
  pairs: KbQaPairRow[]
  siblings: BidSiblingChapter[]
  userId: string | null
  chapterQuery: string
  activeChapterId: string | null
}): BidMaterialReco[] {
  const q = (args.chapterQuery || "").trim()
  if (!q) return []
  const out: BidMaterialReco[] = []
  for (const h of pickKbHits(args.docs, args.userId, q, 2)) {
    out.push({ key: `reco:${h.key}`, source: "kb", title: h.title, badge: h.badge, snippet: h.snippet, text: h.snippet, label: h.label })
  }
  for (const a of pickAmmoPairs(args.pairs, args.userId, q).slice(0, 2)) {
    out.push({ key: `reco:${a.key}`, source: "ammo", title: a.title, badge: a.badge, snippet: a.snippet, text: a.snippet, label: a.label })
  }
  for (const s of pickSiblingChapters(args.siblings, args.activeChapterId, q, 2)) {
    out.push({ key: `reco:${s.key}`, source: "sibling", title: s.title, badge: s.badge, snippet: s.snippet, text: s.text, label: s.label })
  }
  return out.slice(0, 6)
}
