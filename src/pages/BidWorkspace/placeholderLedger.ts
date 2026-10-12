// ---------------------------------------------------------------------------
// r277 切片1 · 评审报告 A3/C5：占位符台账（本地零 AI）
// 评审发现「【此处插入截图】」「【待填写】」「（填写‘全称’）」等指令性占位原样流入交卷稿——
// ▲/检测报告类客观项缺证据＝直接零分。本模块扫各章正文，按章×形态聚合成台账，
// 以 warn 并入交卷体检（rule=placeholder_leftover）。
// 合法空位白名单口径：签章线的下划线空位（____）与「（盖章）（签字）」不报。
// ---------------------------------------------------------------------------
import type { Chapter, } from "@/pages/SolutionStudio/solutionTypes"
import type { FormatCheckHit, } from "./bidTypes"

const PLACEHOLDER_RES: RegExp[] = [
  /【[^】]{0,20}(?:待填写|待补充|待确认|待插入|此处插入|插入)[^】]{0,20}】/g,
  /[（(]\s*(?:请)?填写[^）)]{0,14}[）)]/g,
  /\[\s*(?:待填写|待补充|待确认|TBD|TODO)\s*\]/gi,
]

/** 占位台账：每章每形态聚合 1 条（列前 3 个样例 + 总数），全量 ≤24 条 */
export function placeholderLedgerHits(chapters: Chapter[]): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  for (const ch of chapters) {
    if (hits.length >= 24) break
    const content = ch.content ?? ""
    if (!content.trim()) continue
    const title = (ch.title ?? "").slice(0, 30) || "（未命名）"
    for (const re of PLACEHOLDER_RES) {
      const all = content.match(re)
      if (!all || !all.length) continue
      const uniq = [...new Set(all.map((s) => s.trim().slice(0, 24)))].slice(0, 3)
      hits.push({
        chapter: title,
        rule: "placeholder_leftover",
        quote: `占位未填 ${all.length} 处：${uniq.join("、")}${all.length > 3 ? " 等" : ""}`,
        level: "warn",
      })
    }
  }
  return hits
}
