/**
 * 标书**正文取数层**（纯函数 / 零 React / 零 AI）：
 * 「投标正文到底取哪一份」与「招标条款怎么归到章」的确定性口径。
 *
 * R1（整仓重构 · 标书内核拆分）从 `useBidWorkspace.ts` 原样搬出，**行为逐字不变**。
 * 这些函数被废标自查 / 模拟评标 / 交卷体检 / 偏离表共用，是七步主流程的共用底座：
 * 口径一旦漂移，「同一份正文喂给两路 AI 得到不同结论」就会出现——所以它们必须能被单测钉住。
 *
 * 搬家纪律（R1 红线）：只搬迁与封装，不改判定口径、不改文案、不改导出 API；
 * 内部调用点与对外导出都仍走 `./useBidWorkspace` 的同名 re-export。
 */
import {
  assignClausesToChapters,
  chaptersToText,
  clauseMatchesTitle,
  isBizPart,
  normalizeBidSourceMode,
  sliceSectionPieces,
  type BidProjectRecord,
  type OutlineCoverageItem,
  type RequirementClause,
} from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

/** 工具视图的正文没有章节结构，包装成 chaptersToText 兼容的纯文本 */
export function chaptersToTextStub(text: string): string {
  return chaptersToText([{ node_id: "", title: "", sections: [], content: text, gen_status: "done" as const }])
}

// Q28 切片A（天好 Skill 移植）：投标正文统一取数——external 用上传/粘贴全文，internal 用编制章节。
// 老数据缺列容错 internal，行为与现状逐字一致（resolveBidText/bidChaptersFor 对 internal 直接透传）。
export function isExternalBid(cur: { bid_source_mode?: unknown }): boolean {
  return normalizeBidSourceMode(cur.bid_source_mode) === "external"
}

/** 取投标纯文本（废标/评标/交卷体检共用） */
export function resolveBidText(cur: BidProjectRecord): string {
  if (isExternalBid(cur)) return chaptersToTextStub(cur.bid_external_text ?? "")
  return chaptersToText(cur.bid_chapters)
}

/** 取 Chapter[]（评标三路 / 交卷体检需要章节结构）：external 合成单章 stub */
export function bidChaptersFor(cur: BidProjectRecord): Chapter[] {
  if (isExternalBid(cur)) {
    const text = (cur.bid_external_text ?? "").trim()
    if (!text) return []
    return [{ node_id: "", title: "外部投标文件全文", sections: [], content: text, gen_status: "done" }]
  }
  return cur.bid_chapters
}

/**
 * 循环 5 A2：审计用节正文摘录（本地拼装零 AI）——优先按 section_stats 确定性切片取该节片段，
 * 统计缺失时回退标题行定位（截到下一个编号标题行）；统一截断到 max 字控 token。
 */
export function auditLeafExcerpt(ch: Chapter | undefined, sectionTitle: string, max = 800): string {
  const content = (ch?.content ?? "").trim()
  if (!content) return ""
  const needle = (sectionTitle ?? "").trim()
  if (!needle) return content.slice(0, max)
  const stats = ch?.section_stats
  const sections = ch?.sections ?? []
  const idx = sections.findIndex((s) => s.trim() === needle)
  if (stats?.length && idx >= 0) {
    const piece = (sliceSectionPieces(content, stats)[idx] ?? "").trim()
    if (piece) return piece.slice(0, max)
  }
  const lines = content.split("\n")
  const start = lines.findIndex((l) =>
    l.trimStart().replace(/^\d+(\.\d+)*\s*/, "").startsWith(needle),
  )
  if (start < 0) return ""
  const out: string[] = []
  let total = 0
  for (let i = start; i < lines.length && total < max; i++) {
    if (i > start && /^\d+(\.\d+)+\s/.test(lines[i].trimStart()) && lines[i].trim().length < 40) break
    out.push(lines[i])
    total += lines[i].length + 1
  }
  return out.join("\n").trim().slice(0, max)
}

/**
 * 条款归章（改造 3④）：AI coverage 映射优先——node_title 命中章标题/小节标题即归该章；
 * 其余条款按标题相似度归章（assignClausesToChapters）；每章上限 15 条防 prompt 过长。
 */
export function mapClausesToChapters(
  clauses: RequirementClause[],
  coverage: OutlineCoverageItem[],
  chapters: { title: string; sections?: string[]; part?: string }[],
): RequirementClause[][] {
  const per: RequirementClause[][] = chapters.map(() => [])
  if (!clauses.length || !chapters.length) return per
  const byId = new Map(clauses.map((c) => [c.id, c]))
  const assigned = new Set<string>()
  for (const item of coverage) {
    const cl = byId.get(item.clause_id)
    if (!cl || assigned.has(cl.id)) continue
    // 第十三轮改造 4：条款只映射到技术章（商务骨架章不承接条款应答）
    const idx = chapters.findIndex(
      (c) => !isBizPart(c) && (clauseMatchesTitle(item.node_title, c.title) || (c.sections ?? []).some((s) => clauseMatchesTitle(item.node_title, s))),
    )
    if (idx >= 0 && per[idx].length < 15) {
      per[idx].push(cl)
      assigned.add(cl.id)
    }
  }
  const rest = clauses.filter((c) => !assigned.has(c.id))
  if (rest.length) {
    const sim = assignClausesToChapters(rest, chapters)
    sim.forEach((list, i) => {
      if (isBizPart(chapters[i])) return
      for (const cl of list) {
        if (per[i].length < 15 && !per[i].some((x) => x.id === cl.id)) per[i].push(cl)
      }
    })
  }
  return per
}
