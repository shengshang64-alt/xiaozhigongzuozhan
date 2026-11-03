// ---------------------------------------------------------------------------
// 2026-10-23（P0-2 证据台账）：评分点 → 承接章节 → 需要什么证明材料 → 编号
//
// 为什么需要：五视角评审里「售前」与「评审专家」两个视角指向同一个缺口——
// 正文写了「证明材料见【待填写】」，但没有任何一处把「哪个评分点、对应哪一章、要挂什么材料」串起来。
// 评委按评分表逐项找分，找不到证明材料就等于这条白写。
//
// 本模块纯本地零 AI：从解析报告（评分项）+ 大纲/正文（承接章）+ 规则推断（材料类型）生成台账，
// 再在导出时作为《评分点与证明材料索引表》放在技术标开头（与《投标文件目录对照表》并列）。
// 它不判断材料真伪、也不编造编号——材料编号只是给人工挂载用的占位索引（M1、M2…）。
// ---------------------------------------------------------------------------

import {
  buildScoringCoverageMatrix,
  isDemoScoreTitle,
  numberScoringItems,
  type BidProjectRecord,
  type NumberedScoringItem,
  type ParseReport,
} from "./bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/** 材料类型（按评分标准措辞推断，找不到就归「方案正文」） */
export type EvidenceKind = "截图" | "证书" | "合同" | "社保与证书" | "承诺函" | "方案正文"

export type EvidenceRow = {
  /** 序号（与评分项编号一致，R1/B1） */
  id: string
  item: string
  score: number
  /** 承接的章标题（无落点为空串） */
  chapters: string[]
  /** 需要什么材料 */
  material: EvidenceKind
  /** 材料编号（M1、M2…，供人工挂载时反查） */
  materialNo: string
  /** 是否还需人工挂载：正文里出现【待填写】占位即视为待挂载 */
  pending: boolean
}

export type EvidenceLedger = {
  rows: EvidenceRow[]
  /** 待挂载条数 */
  pendingCount: number
  /** 无承接章的条数 */
  orphanCount: number
}

/** 从评分标准措辞推断材料类型（顺序即优先级） */
export function inferEvidenceKind(criteria: string): EvidenceKind {
  const t = criteria ?? ""
  if (/承诺/.test(t)) return "承诺函"
  if (/社保|人员|团队|项目经理|证书.*人员/.test(t)) return "社保与证书"
  if (/合同|业绩|案例/.test(t)) return "合同"
  if (/软著|著作权|认证|证书|资质|体系/.test(t)) return "证书"
  if (/截图|界面|功能演示|系统功能/.test(t)) return "截图"
  return "方案正文"
}

/** 该章正文里是否还有待挂载占位 */
function hasPendingPlaceholder(chapters: Chapter[], titles: string[]): boolean {
  const set = new Set(titles.map((t) => t.trim()))
  return (chapters ?? []).some(
    (c) => set.has((c.title ?? "").trim()) && /【\s*待填写\s*】|待人工挂载|证明材料见【/.test(c.content ?? ""),
  )
}

export function buildEvidenceLedger(
  report: ParseReport | null,
  outline: OutlineNode[],
  chapters: Chapter[],
): EvidenceLedger {
  const items: NumberedScoringItem[] = numberScoringItems(report).filter((it) => !isDemoScoreTitle(it.item))
  if (!items.length) return { rows: [], pendingCount: 0, orphanCount: 0 }
  const matrix = buildScoringCoverageMatrix(outline ?? [], items)
  const coveredById = new Map(matrix.map((e) => [e.item.id, e.coveredBy]))
  const rows: EvidenceRow[] = []
  let seq = 0
  for (const it of items) {
    const chapterTitles = (coveredById.get(it.id) ?? []).map((t) => String(t ?? "").trim()).filter(Boolean)
    const material = inferEvidenceKind(it.criteria ?? "")
    // 「待挂载」的判据：需要实物材料（非纯方案正文），且要么没有承接章、要么正文里还留着【待填写】占位。
    // 资信/演示类本来就不占技术章，材料由商务分册与现场准备承担，这里只列不判缺。
    const needsPhysical = material !== "方案正文"
    const pending = needsPhysical && (chapterTitles.length === 0 || hasPendingPlaceholder(chapters, chapterTitles))
    seq += 1
    rows.push({
      id: it.id,
      item: it.item,
      score: it.score,
      chapters: chapterTitles,
      material,
      materialNo: `M${seq}`,
      pending,
    })
  }
  return {
    rows,
    pendingCount: rows.filter((r) => r.pending).length,
    orphanCount: rows.filter((r) => !r.chapters.length).length,
  }
}

/** 台账 → 导出用的二维表（表头 + 行），与技术标开头的索引表同构 */
export function evidenceLedgerTableRows(ledger: EvidenceLedger): string[][] {
  const head = ["序号", "评分项", "分值", "承接章节", "需提供材料", "材料编号", "状态"]
  return [
    head,
    ...ledger.rows.map((r) => [
      r.id,
      r.item,
      String(r.score),
      r.chapters.length ? r.chapters.slice(0, 2).join("、") : "—",
      r.material,
      r.materialNo,
      r.pending ? "待挂载" : "见正文",
    ]),
  ]
}

/** 便捷入口：直接吃项目记录 */
export function evidenceLedgerOf(rec: Partial<BidProjectRecord> | null): EvidenceLedger {
  if (!rec) return { rows: [], pendingCount: 0, orphanCount: 0 }
  return buildEvidenceLedger(rec.parse_report ?? null, rec.bid_outline ?? [], rec.bid_chapters ?? [])
}
