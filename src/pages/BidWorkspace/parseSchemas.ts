// ---------------------------------------------------------------------------
// R-026（R253）评分项 JSON Schema 结构化存储
//
// 背景：T14 整文通道已让 tech_score/biz_score 走 JSON 契约（见 prompts/wholeParse
// TECH_SCORE_TASK/BIZ_SCORE_TASK），但落库前 flattenScoring 把结构化对象摊平成行式
// 文本、丢弃结构，下游 extractScoringFromText 只能按行正则回读（分值/出处易错位）。
// 本模块在不改摊平链路（下游零改动、老文本报告继续可用）的前提下，把 JSON 原对象
// 保留为 ParseSection.structured：numberScoringItems 优先按结构读取，并对「原文声明
// 总分 vs 评分项合计」做 schema 级自检；老报告无 structured 时按 needs_reparse 提示
// 整文重解析以启用结构化。
//
// 注意：ScoringBlockJSON 与 wholeParse 的 tech_score/biz_score JSON items 字段严格对齐
// （name/score/criteria/source），仅 bidTypes 侧按结构类型读取、不 import 本模块，避免环依赖。
// ---------------------------------------------------------------------------

import type { ScoringItem } from "./bidTypes"

/** 单个评分项的结构化表示（对齐 wholeParse tech_score/biz_score items 字段） */
export type ScoringItemJSON = {
  name: string
  score: number
  criteria: string
  source: string
}

/** 评分块结构化表示（tech_score / biz_score 各一，存入 ParseSection.structured） */
export type ScoringBlockJSON = {
  kind: "scoring"
  /** 原文声明的总分构成原句；无则空串 */
  score_composition: string
  /** 从 score_composition 解析出的声明总分；未声明/解析不出为 null */
  declared_total: number | null
  items: ScoringItemJSON[]
}

const missing = (s: string): boolean => !s || /没有提及|未提及|暂无|^[-—\s]*$/.test(s.trim())

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

/** 从「总分 N 分（技术 N 分…）」声明句解析声明总分；解析不出返回 null */
export function parseDeclaredTotal(comp: string): number | null {
  const t = comp.trim()
  if (missing(t)) return null
  const m = t.match(/总分[^0-9]{0,6}(\d+(?:\.\d+)?)/) ?? t.match(/(\d+(?:\.\d+)?)\s*分/)
  return m ? Number(m[1]) : null
}

/**
 * 从整文 JSON 原对象构建评分块；非评分项 key / 无有效 items 返回 undefined。
 * score 只取首个数字（对齐 wholeParse flattenScoring 的 scoreNumber 口径）。
 */
export function buildScoringStructured(key: string, obj: unknown): ScoringBlockJSON | undefined {
  if (key !== "tech_score" && key !== "biz_score") return undefined
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined
  const rec = obj as Record<string, unknown>
  const rawItems = Array.isArray(rec.items) ? rec.items : []
  const items: ScoringItemJSON[] = []
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue
    const r = it as Record<string, unknown>
    const name = str(r.name).trim()
    if (missing(name)) continue
    const scoreM = str(r.score).match(/\d+(?:\.\d+)?/)
    const criteria = [str(r.criteria), str(r.criteria_or_formula)]
      .map((s) => s.trim())
      .filter((s) => s && !missing(s))
      .join("；")
    const source = str(r.source).trim()
    items.push({ name, score: scoreM ? Number(scoreM[0]) : 0, criteria, source: missing(source) ? "" : source })
  }
  if (!items.length) return undefined
  const compRaw = str(rec.score_composition).trim()
  const score_composition = missing(compRaw) ? "" : compRaw
  return { kind: "scoring", score_composition, declared_total: parseDeclaredTotal(score_composition), items }
}

/** 结构化 → 下游 ScoringItem[]（criteria 合并出处，与 extractScoringFromText 行文本口径一致） */
export function scoringItemsFromStructured(b: ScoringBlockJSON): ScoringItem[] {
  return b.items.map((it) => ({
    item: it.name,
    score: it.score,
    criteria: `${it.criteria}${it.source ? `（出处：${it.source}）` : ""}`,
  }))
}

/** schema 级自检：评分项合计 vs 原文声明总分；偏差返回人话提示，一致/无声明返回 null */
export function selfCheckScoringTotal(b: ScoringBlockJSON): string | null {
  if (b.declared_total == null) return null
  const sum = b.items.reduce((acc, it) => acc + it.score, 0)
  if (sum <= 0) return null
  if (Math.abs(sum - b.declared_total) > 0.01) {
    return `评分项合计 ${sum} 分 ≠ 招标文件声明总分 ${b.declared_total} 分，请复核评分表是否漏行/错值`
  }
  return null
}
