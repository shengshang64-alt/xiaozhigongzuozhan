// ---------------------------------------------------------------------------
// 批量采纳用途推荐（2026-11-01 审核吞吐优化）
//
// 背景：原子库已扩到 3659 条 approved + 数千条 pending。
//   逐条点「一键采纳 + 通过」在数据量面前不现实（3659 条 × 8 秒 = 8 小时）。
//
// 本模块提供**批量采纳**：把「推荐置信度 ≥ 阈值 且 推荐用途命中指定集合」的原子
// 一次性勾好用途并置为待通过，供审核人整体确认。
//
// 与 P3 原则的关系：
//   · P3 要求「通过必须由人勾选用途」——本模块的产出仍需审核人点「批量通过」确认
//   · 推荐只是**预填**，审核人可先筛选查看、也可拒绝
//   · 不提供「无人工确认直接入库」的路径
// ---------------------------------------------------------------------------

import type { ReviewAtom } from "./kbReview"
import { recommendUsableFor, type UsableFor } from "./kbUsableRecommend"

export type BulkAdoptOptions = {
  /** 最低推荐置信度（默认 0.6） */
  minConfidence?: number
  /** 只采纳推荐里包含这些用途的（空=不过滤） */
  requireAnyOf?: UsableFor[]
  /** 最多采纳多少条（防止一次操作过多） */
  limit?: number
}

export type BulkAdoptResult = {
  /** 可采纳的原子 id → 建议用途 */
  items: { id: string; usableFor: UsableFor[]; confidence: number }[]
  /** 被跳过的条数及原因 */
  skipped: { lowConfidence: number; noUsable: number; notMatched: number }
}

/**
 * 计算「可批量采纳」的清单。
 *
 * 只是**算出建议**，不改任何数据——调用方（UI）拿到后展示给审核人确认。
 */
export function planBulkAdopt(atoms: ReviewAtom[], opts?: BulkAdoptOptions): BulkAdoptResult {
  const minConf = opts?.minConfidence ?? 0.6
  const requireAny = opts?.requireAnyOf ?? []
  const limit = opts?.limit ?? Number.POSITIVE_INFINITY

  const items: BulkAdoptResult["items"] = []
  const skipped = { lowConfidence: 0, noUsable: 0, notMatched: 0 }

  for (const a of atoms) {
    const rec = recommendUsableFor(a.atomType, a.title, a.body)
    if (!rec.usableFor.length) {
      skipped.noUsable += 1
      continue
    }
    if (rec.confidence < minConf) {
      skipped.lowConfidence += 1
      continue
    }
    if (requireAny.length && !rec.usableFor.some((u) => requireAny.includes(u))) {
      skipped.notMatched += 1
      continue
    }
    if (items.length >= limit) break
    items.push({ id: a.id, usableFor: rec.usableFor, confidence: rec.confidence })
  }

  return { items, skipped }
}

/** 把批量采纳清单渲染成给人看的摘要（含用途分布） */
export function summarizeBulkAdopt(r: BulkAdoptResult): string {
  const dist: Record<string, number> = {}
  for (const it of r.items) for (const u of it.usableFor) dist[u] = (dist[u] ?? 0) + 1
  const parts = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")
  const skippedTotal = r.skipped.lowConfidence + r.skipped.noUsable + r.skipped.notMatched
  return `可批量采纳 ${r.items.length} 条（${parts || "无"}）；跳过 ${skippedTotal} 条（低置信 ${r.skipped.lowConfidence} / 无建议 ${r.skipped.noUsable} / 不匹配 ${r.skipped.notMatched}）`
}
