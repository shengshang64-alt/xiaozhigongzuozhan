// ---------------------------------------------------------------------------
// R-038③（R258）长文档解析覆盖率度量与门禁（纯函数、零模型、零 DOM）
//
// 背景（全局优化汇总·第一优先 R-038）：解析输出被模型 max_tokens 与「段数超上限回落检索」双重硬限，
// 与原文长度无关——天坛 41.7 万字仅解析出约 1.8 万字（覆盖率 4.4%）。用 4% 的信息生成的标书，一旦漏掉
// 否决/废标条款就是废标。本轮先做「可见 + 拦截」安全网：覆盖率在报告显式呈现，过低时告警并在生成前阻断，
// 把静默风险转成用户可感知的门禁。（提高段数上限/跨块汇总以真正拉高覆盖率涉额外 AI 成本——已由 R-038 Slice B（R260）落地：废标/评分关键项放宽切段上限走整文全量覆盖 + 跨段合并，其余项维持通用上限与检索回落。）
//
// 口径：覆盖率 = 各解析项正文非空白字符合计 / 招标文件原文非空白字符（与汇总文档实测口径一致）。
// 短原文精简输出属常态（输出占比天然偏低≠漏内容），故「阻断」仅在原文足够大（非空白≥阈值）时生效，只告警不误伤。
// ---------------------------------------------------------------------------

import type { ParseSection } from "./bidTypes"

/** 覆盖率告警阈值：<50% 醒目提示（多数长文档回落检索后落此区间） */
export const COVERAGE_WARN = 0.5
/** 覆盖率阻断阈值：<30% 阻止生成（对齐汇总文档「<30% 阻止生成」） */
export const COVERAGE_BLOCK = 0.3
/** 原文非空白字符低于此值时不硬阻断（短文件精简输出≠漏内容，防误伤），最多告警 */
export const COVERAGE_MIN_BLOCK_SOURCE_CHARS = 8000

const nonWs = (s: string): number => (s ?? "").replace(/\s+/g, "").length

/** 各解析项正文的非空白字符合计（近似解析产出规模） */
export function parsedContentChars(sections: ParseSection[]): number {
  return (sections ?? []).reduce((a, s) => a + nonWs(s.content), 0)
}

/** 解析覆盖率：产出/原文非空白字符比，0~1；原文为空返回 null（无从判定） */
export function parseCoverageRatio(sections: ParseSection[], sourceText: string): number | null {
  const src = nonWs(sourceText)
  if (!src) return null
  return Math.min(1, parsedContentChars(sections) / src)
}

export type CoverageLevel = "ok" | "warn" | "block"

/** 覆盖率分级：block 需原文非空白≥阈值且比例<阻断线；否则 warn(<告警线)；其余 ok；无原文 ok（不臆断） */
export function coverageLevel(ratio: number | null, sourceText: string): CoverageLevel {
  if (ratio == null) return "ok"
  if (ratio < COVERAGE_BLOCK && nonWs(sourceText) >= COVERAGE_MIN_BLOCK_SOURCE_CHARS) return "block"
  if (ratio < COVERAGE_WARN) return "warn"
  return "ok"
}

/** 覆盖率百分比（整数），null 原样返回 null */
export function coveragePercent(ratio: number | null): number | null {
  return ratio == null ? null : Math.round(ratio * 100)
}

// ---------------------------------------------------------------------------
// R288+（2026-10-13 真实场景实测·主导者）：生成前门禁的「关键解析项」判据
//
// 为什么改判据：原门禁用「覆盖率 < 30%」一刀切阻断生成，但覆盖率口径 = 解析产出字数 / 原文非空白字数，
// 而解析产出是**要点摘要**（非全文）——长文档天然偏低（本文件上方注释即记录天坛 41.7 万字→4.4%）；
// 2026-10-13 对 38.2 万字真实招标文件实测：22 项解析产出约 3 万字、覆盖率 8%，直接阻断生成。
// 实测同时暴露真正的病灶：「响应文件要求」「投标文件目录要求」解析为空，而这两项正是大纲硬依赖
// （OUTLINE_DEPEND_KEYS）——真风险是「关键项没解析出来」，不是「摘要比全文短」。
// 故：阻断改由本判据（关键项缺失即阻断），覆盖率降级为告警（保留可见性）。
// ---------------------------------------------------------------------------

/** 生成前门禁的关键解析项：覆盖大纲依赖、评分、废标与目录编排，漏任一项即影响响应完整性 */
export const CRITICAL_SECTION_KEYS: readonly string[] = [
  "tech_score", // 技术评分要求（大纲硬依赖）
  "response_req", // 响应文件要求（大纲硬依赖）
  "biz_score", // 商务评分要求（大纲硬依赖）
  "void_items", // 无效标与废标项（漏一条即废标）
  "bid_outline_req", // 投标文件目录要求（大纲/正文编排依赖）
]

/** 解析「空态」文本：模型未取到内容时的占位表述，等同缺失 */
const EMPTY_SECTION_RE = /^(原文未提及|暂无内容|未解析|未提取到|无)$/

/**
 * 返回「缺失」的关键解析项 key 列表（顺序同 keys）。
 * 缺失判据（三者任一即缺失，防「有壳无肉」）：① 该 key 不存在；② status 存在且非 "ok"；
 * ③ content 为空或仅空态占位文本。
 */
export function missingCriticalSections(
  sections: ParseSection[],
  keys: readonly string[] = CRITICAL_SECTION_KEYS,
): string[] {
  const byKey = new Map<string, ParseSection>()
  for (const s of sections ?? []) byKey.set(s.key, s)
  return keys.filter((k) => {
    const s = byKey.get(k)
    if (!s) return true
    if (s.status && s.status !== "ok") return true
    const text = String(s.content ?? "").trim()
    return !text || EMPTY_SECTION_RE.test(text)
  })
}
