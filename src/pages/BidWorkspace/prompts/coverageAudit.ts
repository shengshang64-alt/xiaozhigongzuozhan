// ---------------------------------------------------------------------------
// R68 提示词搬迁第四批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { CoverageAuditEntry, CoverageAuditLeafInput, CoverageLevel, clipText, extractJsonLoose, asArray, asString, collectLeafIdsUnder } from "../bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/** 覆盖审计 prompt：一次调用核对全部技术叶，输出逐节 JSON 报告（正文摘录截断在调用方完成以控 token） */
export function buildCoverageAuditMessages(leaves: CoverageAuditLeafInput[]): LlmMessage[] {
  const blocks = leaves
    .map((l, i) =>
      [
        `【第${i + 1}节】leaf_id: ${l.leaf_id}`,
        `标题：${l.title}（所属章：${l.chapter}）`,
        `写作焦点：${l.writing_focus.trim() || "（未设置）"}`,
        l.facts.length
          ? `必守事实：\n${l.facts.map((f, j) => `${j + 1}. ${f}`).join("\n")}`
          : "必守事实：（无）",
        `表格计划：${l.table_plan.trim() || "（无）"}`,
        `正文摘录（前 800 字截断）：${l.body_excerpt.trim() || "（正文为空）"}`,
      ].join("\n"),
    )
    .join("\n\n")
  const system = [
    "你是标书质量审核专家，逐节核对写作方案计划的内容（写作焦点、必守事实、表格计划）是否在该节正文中落实。",
    "判定口径：",
    "1. 计划要点在正文中全部有对应落实 → covered=full；",
    "2. 部分要点落实、存在遗漏 → covered=partial，missing_points 逐条列出遗漏的计划要点；",
    "3. 正文为空或计划几乎全部未落实 → covered=missing，missing_points 列出全部未落实要点；",
    "4. 未设置任何计划（焦点/事实/表格均空）的节，按正文是否实质响应节标题判定。",
    "missing_points 每条不超过 40 字、最多 6 条，必须是计划或标题响应中可核对的要点，禁止编造额外要求；covered=full 时输出空数组。",
    "suggestion 写不超过 60 字的补写建议（full 时可为空串）。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"leaf_id":"","covered":"full","missing_points":[],"suggestion":""}]',
  ].join("\n")
  const user = `${clipText(blocks, 24000)}\n\n请逐节核对写作方案是否在正文中落实，输出 JSON 数组（每个 leaf_id 都要出现在返回里）。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 审计输出清洗：只收输入清单内的 leaf_id；covered 归一三档（非法值按 missing_points 判）；按输入文档序去重输出 */
export function sanitizeCoverageAudit(rawText: string, inputLeaves: CoverageAuditLeafInput[]): CoverageAuditEntry[] {
  const data = extractJsonLoose(rawText)
  const rec = data as Record<string, unknown> | null
  const arr = asArray(Array.isArray(data) ? data : (rec?.items ?? rec?.results ?? rec?.audit))
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const id = asString(r.leaf_id ?? r.leafId ?? r.node_id).trim()
    if (id && !byId.has(id)) byId.set(id, r)
  }
  const out: CoverageAuditEntry[] = []
  for (const leaf of inputLeaves) {
    const row = byId.get(leaf.leaf_id)
    if (!row) continue
    const rawLevel = asString(row.covered).trim().toLowerCase()
    const points = asArray(row.missing_points ?? row.missingPoints)
      .map((x) => asString(x).trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 6)
    const level: CoverageLevel =
      rawLevel === "full" || rawLevel === "partial" || rawLevel === "missing"
        ? (rawLevel as CoverageLevel)
        : points.length
          ? "partial"
          : "full"
    const covered: CoverageLevel = level === "full" && points.length ? "partial" : level
    out.push({
      leaf_id: leaf.leaf_id,
      title: leaf.title,
      covered,
      missing_points: covered === "full" ? [] : points,
      suggestion: asString(row.suggestion).trim().slice(0, 120),
    })
  }
  return out
}

/**
 * 叶子定位：返回叶子所属顶层章 nodeId 与其二级小节标题（章自身即叶子时 sectionTitle 为空串）。
 * 供「补写」把审计叶子映射回既有条级重写（章 nodeId + sectionIdx）链路，不新造生成通道。
 */
export function resolveLeafSection(
  outline: OutlineNode[],
  leafId: string,
): { chapterId: string; sectionTitle: string } | null {
  for (const top of outline ?? []) {
    if (top.id === leafId) return { chapterId: top.id, sectionTitle: "" }
    for (const sec of top.children ?? []) {
      if (sec.id === leafId) return { chapterId: top.id, sectionTitle: sec.title }
      if (collectLeafIdsUnder(sec).includes(leafId)) return { chapterId: top.id, sectionTitle: sec.title }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
