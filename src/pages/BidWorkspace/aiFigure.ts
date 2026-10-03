// ---------------------------------------------------------------------------
// T17（2026-09-29）AI 位图补图阶段的纯函数侧：
//  - collectAiFigureTargets：从编排结果收集「selected 且 type=ai」的配图清单（含所在章节定位）；
//  - applyAiFigureToChapters：生成成功后把 {type:"image"} 图写回对应章 figures（标题匹配挂图注，
//    与 attachFigureCaptions 同语义）；每章一张上限沿用既有口径。
// 与 LLM/aigc 调用完全解耦，便于单测与复用。
// ---------------------------------------------------------------------------

import type { Chapter, FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import type { AiImageStyle, BidOrchestration } from "./bidTypes"
import { collectLeafIdsUnder } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

export type AiFigureTarget = {
  /** 编排叶 nodeId */
  nodeId: string
  leafTitle: string
  chapterNodeId: string
  chapterTitle: string
  title: string
  caption?: string
  scene?: string
  style: AiImageStyle
}

/** 收集编排选中的 AI 位图清单（selected 且 type=ai），并定位其所属顶层章 */
export function collectAiFigureTargets(orch: BidOrchestration, outline: OutlineNode[]): AiFigureTarget[] {
  const out: AiFigureTarget[] = []
  for (const top of outline ?? []) {
    const leafIds = collectLeafIdsUnder(top)
    for (const leafId of leafIds) {
      const e = orch.leaves[leafId]
      if (!e?.figure?.needed || !e.figure.selected || e.figure.type !== "ai") continue
      out.push({
        nodeId: leafId,
        leafTitle: leafId,
        chapterNodeId: top.id,
        chapterTitle: top.title,
        title: e.figure.title,
        caption: e.figure.caption,
        scene: e.figure.scene,
        style: e.figure.image_style ?? "engineering_diagram",
      })
    }
  }
  return out
}

/** 编排叶 id → 叶标题（供生图 prompt 场景兜底与日志展示） */
export function leafTitleOf(outline: OutlineNode[], nodeId: string): string {
  const walk = (list: OutlineNode[]): string => {
    for (const n of list ?? []) {
      if (n.id === nodeId) return n.title
      const hit = walk(n.children ?? [])
      if (hit) return hit
    }
    return ""
  }
  return walk(outline ?? [])
}

/**
 * 把生成的位图写回目标章：按 nodeId 定位章（顶层章持有正文），追加 {type:"image"} 图。
 * 章内已有同名 AI 图时替换（重复补图不堆叠）；每章 AI 图上限 3 张（超出替换最早的）。
 * 返回需更新的 {nodeId → figures}，由调用方 updateChapter 落库。
 */
export function applyAiFigureToChapters(
  chapters: Chapter[],
  targets: { chapterNodeId: string; figure: FigureSpec }[],
): Map<string, FigureSpec[]> {
  const byNode = new Map<string, FigureSpec[]>()
  for (const { chapterNodeId, figure } of targets) {
    const ch = chapters.find((c) => c.node_id === chapterNodeId)
    if (!ch) continue
    const existing = byNode.get(chapterNodeId) ?? (ch.figures ?? []).filter((f) => f.type !== "image" || f.title !== figure.title)
    const aiImages = existing.filter((f) => f.type === "image")
    const next = [...existing, figure]
    // AI 图上限 3 张：超出的丢最早的 image
    if (aiImages.length >= 3) {
      const firstAi = aiImages[0]
      const at = next.indexOf(firstAi)
      if (at >= 0) next.splice(at, 1)
    }
    byNode.set(chapterNodeId, next)
  }
  return byNode
}
