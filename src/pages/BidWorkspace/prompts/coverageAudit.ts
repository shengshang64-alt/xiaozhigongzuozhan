// ---------------------------------------------------------------------------
// R68 提示词搬迁第四批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// R101 实质性修订：三档升四档新增 covered=over（过度承诺/加码），PROMPT_VERSION 1→2，新旧口径对比见 .loop/reports
// ---------------------------------------------------------------------------

import { COVERAGE_LEVEL_LABEL, CoverageAuditEntry, CoverageAuditLeafInput, CoverageLevel, clipText, extractJsonLoose, asArray, asString, collectLeafIdsUnder } from "../bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 2 // R101：判定口径新增第 4 条 over（超出招标要求与写作计划的加码承诺）

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
    "4. 正文出现超出招标要求与写作计划的加码承诺（更高的参数指标、免费赠送、缩短工期、加重违约责任等）→ covered=over，missing_points 逐条列出加码承诺点；over 与漏项并存时按更严重档判定（有遗漏优先 partial/missing）；",
    "5. 未设置任何计划（焦点/事实/表格均空）的节，按正文是否实质响应节标题判定。",
    "missing_points 每条不超过 40 字、最多 6 条，必须是计划或标题响应中可核对的要点，禁止编造额外要求；covered=full 时输出空数组。",
    "suggestion 写不超过 60 字的修复建议（full 时可为空串；over 时给出收敛口径）。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"leaf_id":"","covered":"full","missing_points":[],"suggestion":""}]',
  ].join("\n")
  const user = `${clipText(blocks, 24000)}\n\n请逐节核对写作方案是否在正文中落实，输出 JSON 数组（每个 leaf_id 都要出现在返回里）。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 审计输出清洗：只收输入清单内的 leaf_id；covered 归一四档（非法值按 missing_points 判）；按输入文档序去重输出 */
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
      rawLevel === "full" || rawLevel === "partial" || rawLevel === "missing" || rawLevel === "over"
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

// ---------------------------------------------------------------------------
// R103 按章聚合回注（prompt-fabscan-03 剩余切片）：把逐叶审计结果按顶层章聚合为
// 章级改进建议（纯本地零 AI），供交卷体检「按章聚合」视图展示、复制回注文本，
// 并经 runRegenerateSection 逐小节串行重写回注（指令口径与单叶补写同源）。
// ---------------------------------------------------------------------------

/** 单条问题叶的回注指令文案：over 走收敛口径、partial/missing 走补写口径；漏点与建议皆空返回空串（等同不注入） */
export function buildReflowDirective(covered: CoverageLevel, missingPoints: string[], suggestion: string): string {
  const extra = [...missingPoints, suggestion].filter((s) => s.trim()).join("；")
  if (!extra) return ""
  return covered === "over"
    ? `必须删除正文中以下过度承诺（加码）点，收敛回招标要求与写作计划的口径，不得再作无依据承诺：${extra}`
    : `必须补充覆盖审计发现的以下漏点并给出实质性响应：${extra}`
}

/** 章内一条问题叶（按章聚合视图行内展示 + 回注定位用） */
export type ChapterAuditItem = {
  leaf_id: string
  title: string
  covered: CoverageLevel
  missing_points: string[]
  suggestion: string
}

/** 章级聚合结果：items 按审计条目原序；worst 为章内最严重档；directive 为可直接复制的整章改进建议文本 */
export type ChapterAuditImprovement = {
  chapterId: string
  chapterTitle: string
  problemCount: number
  worst: CoverageLevel
  items: ChapterAuditItem[]
  directive: string
}

const COVERAGE_WORST_RANK: Record<CoverageLevel, number> = { full: 0, partial: 1, over: 2, missing: 3 }

/** 章级聚合改进建议文本（复制回注用）：每问题节一行 = 档位 + 漏点 + 建议 */
function buildChapterAuditDirective(chapterTitle: string, items: ChapterAuditItem[]): string {
  const lines = [`【${chapterTitle}】覆盖审计改进建议（${items.length} 节待整改）：`]
  items.forEach((it, i) => {
    const points = it.missing_points.length ? it.missing_points.join("；") : "（未列具体漏点）"
    const tail = it.suggestion ? `；建议：${it.suggestion}` : ""
    lines.push(`${i + 1}.「${it.title}」[${COVERAGE_LEVEL_LABEL[it.covered]}]：${points}${tail}`)
  })
  return lines.join("\n")
}

/**
 * 覆盖审计结果按章聚合（纯本地）：非 full 条目经 resolveLeafSection 归入顶层章，
 * 章按大纲顶层顺序排列；审计对应的叶已从大纲删除（改过大纲后复用旧审计结果）时静默丢弃。
 */
export function aggregateAuditByChapter(entries: CoverageAuditEntry[], outline: OutlineNode[]): ChapterAuditImprovement[] {
  const byId = new Map<string, ChapterAuditImprovement>()
  const titleById = new Map((outline ?? []).map((t) => [t.id, t.title]))
  const orderById = new Map((outline ?? []).map((t, i) => [t.id, i]))
  for (const entry of entries ?? []) {
    if (!entry || entry.covered === "full") continue
    const resolved = resolveLeafSection(outline, entry.leaf_id)
    if (!resolved) continue
    let group = byId.get(resolved.chapterId)
    if (!group) {
      group = {
        chapterId: resolved.chapterId,
        chapterTitle: titleById.get(resolved.chapterId) ?? resolved.chapterId,
        problemCount: 0,
        worst: "partial",
        items: [],
        directive: "",
      }
      byId.set(resolved.chapterId, group)
    }
    group.items.push({
      leaf_id: entry.leaf_id,
      title: entry.title,
      covered: entry.covered,
      missing_points: entry.missing_points,
      suggestion: entry.suggestion,
    })
    group.problemCount += 1
    if (COVERAGE_WORST_RANK[entry.covered] > COVERAGE_WORST_RANK[group.worst]) group.worst = entry.covered
  }
  const groups = [...byId.values()].sort(
    (a, b) =>
      (orderById.get(a.chapterId) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.chapterId) ?? Number.MAX_SAFE_INTEGER),
  )
  for (const g of groups) g.directive = buildChapterAuditDirective(g.chapterTitle, g.items)
  return groups
}

/**
 * 聚合结果落位为「可回注的小节重写清单」：问题叶按小节标题匹配 bid_chapters.sections 下标，
 * 定位不到（整章级叶/小节清单缺失）不产生回注项；同一小节被多个叶命中时指令合并为一次重写。
 */
export function collectReflowFixItems(
  group: ChapterAuditImprovement,
  outline: OutlineNode[],
  chapter: { sections?: string[] } | undefined,
): { sectionIdx: number; directive: string }[] {
  const byIdx = new Map<number, string[]>()
  for (const item of group.items) {
    const resolved = resolveLeafSection(outline, item.leaf_id)
    if (!resolved || !resolved.sectionTitle) continue
    const sectionIdx = (chapter?.sections ?? []).findIndex((s) => s.trim() === resolved.sectionTitle.trim())
    if (sectionIdx < 0) continue
    const directive = buildReflowDirective(item.covered, item.missing_points, item.suggestion)
    if (!directive) continue
    const bucket = byIdx.get(sectionIdx)
    if (bucket) bucket.push(directive)
    else byIdx.set(sectionIdx, [directive])
  }
  return [...byIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sectionIdx, directives]) => ({ sectionIdx, directive: directives.join("\n") }))
}
