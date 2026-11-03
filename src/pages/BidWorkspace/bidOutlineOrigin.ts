import { BID_OUTLINE_REQ_KEY, numberScoringItems, sectionText, type ParseReport } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/**
 * R-023 双层目录——按招标目录原文分类顶层章来源 + 三态差异比对。
 * 第一层（tender）：严格照抄招标「投标文件目录要求」的条目，1:1 映射为顶层章。
 * 第二层（scoring）：技术类评分项未出现在招标目录中时，派生成独立章节追加末尾。
 * 17A 已在 prompt 层强制模型遵循目录顺序，本模块做**生成后本地核验 + 来源标注**，
 * 为 UI 徽标、导出闸门（「招标有但我没生成的」告警）与补入提供可机读依据。零 AI。
 */

export type ChapterOrigin = "tender" | "scoring"

export type CatalogDiffEntry = { name: string; status: "matched" | "missing" | "extra" }

export type CatalogDiff = {
  hasCatalog: boolean
  entries: CatalogDiffEntry[]
  matchedCount: number
  missingCount: number
  extraCount: number
}

function norm(s: string): string {
  return (s ?? "").replace(/[^\p{L}\p{N}]+/gu, "")
}

function mutualMatch(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return false
  return a.includes(b) || b.includes(a)
}

export function classifyOrigins(
  nodes: OutlineNode[],
  report: ParseReport | null,
): { nodes: OutlineNode[]; diff: CatalogDiff } {
  const catalogText = sectionText(report, BID_OUTLINE_REQ_KEY).trim()
  const catalogLines = catalogText
    ? catalogText.split(/\r?\n+/).map((l) => l.trim()).filter((l) => norm(l).length >= 2)
    : []
  const catalogNorms = catalogLines.map(norm)
  const scoringNorms = report
    ? numberScoringItems(report).filter((i) => i.category === "tech").map((i) => norm(i.item)).filter((s) => s.length >= 2)
    : []

  const matchedCatalog = new Set<number>()
  const matchedTitles = new Set<string>()
  const classified: OutlineNode[] = []

  for (const node of nodes) {
    const nt = norm(node.title)
    let origin: ChapterOrigin | undefined
    if (catalogNorms.length) {
      for (let ci = 0; ci < catalogNorms.length; ci++) {
        if (mutualMatch(nt, catalogNorms[ci])) {
          origin = "tender"
          matchedCatalog.add(ci)
          break
        }
      }
    }
    if (!origin && scoringNorms.some((sn) => mutualMatch(nt, sn))) {
      origin = "scoring"
    }
    if (origin) matchedTitles.add(node.title)
    classified.push(origin ? { ...node, origin } : node)
  }

  const entries: CatalogDiffEntry[] = []
  for (let ci = 0; ci < catalogLines.length; ci++) {
    entries.push({ name: catalogLines[ci], status: matchedCatalog.has(ci) ? "matched" : "missing" })
  }
  if (catalogLines.length) {
    for (const node of nodes) {
      if (!matchedTitles.has(node.title)) {
        entries.push({ name: node.title, status: "extra" })
      }
    }
  }

  const diff: CatalogDiff = {
    hasCatalog: catalogLines.length > 0,
    entries,
    matchedCount: entries.filter((e) => e.status === "matched").length,
    missingCount: entries.filter((e) => e.status === "missing").length,
    extraCount: entries.filter((e) => e.status === "extra").length,
  }
  return { nodes: classified, diff }
}
