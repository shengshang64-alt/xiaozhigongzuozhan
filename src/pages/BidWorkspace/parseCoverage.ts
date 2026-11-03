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

import { parseSectionTitle, type ParseReport, type ParseSection } from "./bidTypes"

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

/** 解析覆盖率：产出/原文非空白字符比，0~1；原文为空返回 null（无从判定）。
 * R-031 P6 口径显式化：分子 = 各解析项正文非空白字符合计，分母 = 招标文件原文非空白字符；
 * 降级分区（content 以「〔系统降级」开头）、内容薄分区（<50 非空白字）、
 * 命中 requiredParseFailures 的分区 → 不计入有效分子（视为未完成）。
 */
export function parseCoverageRatio(sections: ParseSection[], sourceText: string): number | null {
  const src = nonWs(sourceText)
  if (!src) return null
  // R-031 P6：仅计"有效"分区产出——排除降级/薄区/失败区
  const effectiveChars = (sections ?? []).reduce((a, s) => {
    const t = (s.content ?? "").trim()
    if (t.startsWith("〔系统降级")) return a // 降级不计
    if (s.status === "failed" || s.status === "pending") return a // 未完成不计
    const n = nonWs(t)
    if (n < 50) return a // 薄区不计
    return a + n
  }, 0)
  return Math.min(1, effectiveChars / src)
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
  "qualification", // 资格性审查（不通过即出局；2026-10-22 升为必选并要求门禁覆盖）
  "compliance", // 符合性检查（实质性偏离即废标；同上）
  "bid_outline_req", // 投标文件目录要求（大纲/正文编排依赖）
]

/** 解析「空态」文本：模型未取到内容时的占位表述，等同缺失 */
const EMPTY_SECTION_RE = /^(原文未提及|暂无内容|未解析|未提取到|无)$/

/**
 * 「缺失」是否应当阻断生成。
 *
 * R289（2026-10-13 真实场景实测·主导者）：**miss 不阻断**。
 * 取证：真实招标文件（安庆二院 CG-AQ-2021-5149 / 三明 38.2 万字稿）里并不存在
 * 「投标文件目录」这一专章 —— 该要求是通过「投标文件格式」章节表达的
 * （原文：「投标文件应该按照"投标文件格式"规定的内容和顺序进行编写」，全文「投标文件目录」0 次）。
 * 故模型如实回答「原文未提及」（status=miss）是**正确且完整**的解析结果，不是失败。
 * R288 曾把「status 非 ok」一律判为缺失，实测会把所有真实项目永久挡在生成之外 —— 假阻断。
 * 仅 failed（技术性失败）与 pending/真空（未产出）才是真缺失，才阻断。
 */
export function isBlockingMissingStatus(status: ParseSection["status"] | undefined): boolean {
  // status 缺失（旧数据/历史批次）时不据其阻断，交由内容空判据兜底，避免臆断
  if (!status) return false
  return status !== "ok" && status !== "miss"
}

/**
 * 「这个分区算不算缺失」——**唯一判据**（三者任一即缺失，防「有壳无肉」）：
 * ① 该 key 不存在；② status 为真缺失（failed/pending，见 isBlockingMissingStatus）；
 * ③ content 为空或仅空态占位文本（EMPTY_SECTION_RE）。
 *
 * R56：此前这段判据只存在于 missingCriticalSections 内部，而调用方要给用户看的**中文清单**
 * 走的是 bidTypes.missingSectionTitles（判据是「content 是否为空」）——两者口径不同，
 * 于是真实数据里出现了「判缺 1 项（原文未提及 5 字占位）但中文清单为空」的组合，
 * 红字提示变成了「关键解析项缺失：（驱动大纲编排…）」，用户看不到到底缺哪一项。
 * 现在判据抽成这一个内部函数，key 清单与中文清单同源，口径不可能再漂移。
 */
function isSectionMissing(s: ParseSection | undefined): boolean {
  if (!s) return true
  const text = String(s.content ?? "").trim()
  // 2026-10-22：降级交付（〔系统降级…）是 AI 没解析成功的产物，不是「本文没有这一项」——
  // 原判据只看 status（解析批次未落 status 时为 undefined）与空态正则，降级内容会被当成「有内容」放行，
  // 生成门禁因此在废标项降级时仍判 green。此判据优先于 status，与 requiredParseFailures 口径对齐。
  if (text.startsWith("〔系统降级")) return true
  // miss = 原文本就没有这一项，是正确完整的解析结果 → 不算缺失（见 isBlockingMissingStatus 注释）
  if (s.status === "miss") return false
  if (isBlockingMissingStatus(s.status)) return true
  return !text || EMPTY_SECTION_RE.test(text)
}

/**
 * 返回「缺失」的关键解析项 key 列表（顺序同 keys）。判据见 isSectionMissing。
 *
 * R58（B28）：增加 `requestedKeys` 参数。**存量项目**的 key 档解析并不请求 void_items
 * （2026-10-22 起新解析已把它升为必选，但历史报告仍可能没有）；若不看请求范围就判缺，
 * 会把大量旧 key 档项目误拦。调用方应传入该项目 `parse_config` 实际请求的 keys，未请求的关键项不算缺失。
 */
export function missingCriticalSections(
  sections: ParseSection[],
  keys: readonly string[] = CRITICAL_SECTION_KEYS,
  requestedKeys?: readonly string[],
): string[] {
  const byKey = new Map<string, ParseSection>()
  for (const s of sections ?? []) byKey.set(s.key, s)
  return keys.filter((k) => {
    if (requestedKeys && !requestedKeys.includes(k)) return false
    return isSectionMissing(byKey.get(k))
  })
}

/**
 * R56（B27）：与 missingCriticalSections **同判据**的中文清单——给用户看的拦截原因。
 * R58（B28）：同步支持 `requestedKeys`，保证提示名单与拦截判据同源。
 */
export function missingCriticalSectionTitles(
  report: ParseReport | null,
  keys: readonly string[] = CRITICAL_SECTION_KEYS,
  requestedKeys?: readonly string[],
): string[] {
  return missingCriticalSections(report?.sections ?? [], keys, requestedKeys).map((k) => parseSectionTitle(k))
}

/**
 * R58（B28）：生成前关键项门禁的**动作判定**（纯函数，供 runGenerateOutline 与测试共用）。
 *
 * 为什么要抽出来：光凭 `criticalMissing.length > 0` 就 toast.error 硬拦，会把**已经有大纲**的项目
 * （用户已投入人工调整）一并挡在生成之外——实测 25 条真实记录里这类假拦截有 7 条。
 * 已复核：这 7 条项目的大纲均非空，硬拦后用户既看不到旧大纲的问题、也做不了任何补救。
 *
 * 判据（三态）：
 *  · "pass"    没有关键项缺失 → 正常放行；
 *  · "confirm" 关键项缺失、但项目**已有非空大纲** → 不硬拦，改二次确认（默认取消，防一键覆盖）；
 *  · "block"   关键项缺失且**无大纲** → 保持硬拦（真缺内容时先解析再生成，避免白花钱）。
 */
export type OutlineCriticalGateDecision = "pass" | "confirm" | "block"

export function decideOutlineCriticalGate(
  criticalMissing: readonly string[],
  hasOutline: boolean,
): OutlineCriticalGateDecision {
  if (!criticalMissing.length) return "pass"
  return hasOutline ? "confirm" : "block"
}

/**
 * R-031 P6（安中医 2026BFAFZ50845 实测）：返回「未完成」分区清单（供 UI 覆盖率数字旁展示）。
 * 判据：status 为 failed/pending、content 以降级前缀开头、或正文 <50 非空白字符。
 */
export function incompleteSections(sections: ParseSection[]): { key: string; title: string; reason: string }[] {
  const out: { key: string; title: string; reason: string }[] = []
  for (const s of sections ?? []) {
    const t = (s.content ?? "").trim()
    if (s.status === "failed") { out.push({ key: s.key, title: s.title, reason: "解析失败" }); continue }
    if (s.status === "pending") { out.push({ key: s.key, title: s.title, reason: "未解析" }); continue }
    if (t.startsWith("〔系统降级")) { out.push({ key: s.key, title: s.title, reason: "AI 降级为原文检索" }); continue }
    if (nonWs(t) < 50 && t.length > 0) { out.push({ key: s.key, title: s.title, reason: `内容过薄（${nonWs(t)} 字）` }); continue }
    if (!t) { out.push({ key: s.key, title: s.title, reason: "无内容" }); continue }
  }
  return out
}

// ---------------------------------------------------------------------------
// R58（B29）：解析层退化自检
//
// 背景：38.2 万字真实标书（三明实测）只解析出 1 个 overview 分区，关键项全缺，
// 后续大纲必然被拦；但界面没有任何「解析结果异常地少」的提示，用户直到生成环节才撞墙。
// 本组常量/函数在解析完成后自检产出规模，异常时给出琥珀色告警 + 「重新解析」入口。
// ---------------------------------------------------------------------------

/** 仅对原文足够大的标书做退化判定（小标书本身分区少，不误伤）。
 *  取 5 万字：实测 25 条真实项目记录（按去空白原文去重后为 **19 份**不同标书；另 1 条记录原文为空、
 *  不计入标书分母——报 20 份即把它计入的口径）中，原文 <5 万字（去空白）的样本**只有 1 条**
 *  （厦门杏林 5471 字 / 7 个分区，产出正常），样本量太小，不足以支撑更低的门槛，故取 5 万字；
 *  且 ≥5 万字才可能出现「大而空」的退化（38.2 万字退化例即在此区间）。
 *  本门槛约束下面**全部**触发条件：原文 <5 万字一律不告警。 */
export const PARSE_DEGRADED_MIN_SOURCE_CHARS = 50000

/** 大标书至少应产出 4 个非空分区。
 *  实测：≥10 万字项目最小为 8 个分区；38.2 万字退化例（三明）仅 1 个分区。
 *  取 4 为保守下限——允许精简解析，但不放过明显退化。
 *  「非空」口径见 detectParseDegradation：复用门禁判据 isSectionMissing
 *  （占位文字/空壳/失败项都不算有内容；status=miss 是「原文没有」的正确结果，不算缺失）。 */
export const PARSE_DEGRADED_MIN_FILLED_SECTIONS = 4

/** 大标书至少应识别出 1 条评分项（技术或商务）。
 *  实测：≥5 万字项目评分项最小为 4；38.2 万字退化例为 0。 */
export const PARSE_DEGRADED_MIN_SCORING_LINES = 1

/** 若废标项被该项**请求过**，大标书至少应识别出 1 条。
 *  实测口径（2026-10-17 复核，更正原注释）：完整档且 ≥10 万字的 12 条项目里，废标项为 0 的有 **3 条**
 *  （13131 32.99 万字、13431 13.16 万字、三明实测 37.14 万字）——并非原注释所称「均 ≥1」，
 *  说明「原文本身没有废标专章」在真实数据里确实存在。
 *  保留这条作为兜底（status=miss 且内容为空时，关键项判据放行而本项仍能命中），
 *  经 25 条真实数据复算未新增误伤：其余情况下它已被上方「关键项无有效内容」覆盖。 */
export const PARSE_DEGRADED_MIN_VOID_LINES = 1

/** 解析退化判定结果 */
export type ParseDegradationResult = {
  degraded: boolean
  /** 供 UI 展示的一句话原因 */
  reason: string
  /** 详细指标，供调试/测试断言 */
  metrics: {
    sourceChars: number
    filledSections: number
    scoringLines: number
    voidLines: number
    voidRequested: boolean
  }
}

function countNonEmptyLines(text: string | undefined | null): number {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0).length
}

/**
 * 解析完成后自检：分区数 / 评分项数 / 废标项数是否显著低于同类规模标书的常态。
 * 纯函数、零 AI、零 DOM。
 *
 * R58（B29）v2a 口径（测试官实测后由主导者裁定）：
 * ① 触发条件必须能盖住「静默退化」——关键项内容全是「原文未提及」这类占位、其余分区看着不少时，
 *    仅靠规模阈值不告警，而生成门禁却判其缺项（两份判据在同一份数据上结论相反）。故新增
 *    「关键项无有效内容」触发，与门禁同判据（missingCriticalSections）。
 * ② 「非空分区」不再用「content 非空白字符 > 0」，改为复用门禁的 isSectionMissing（占位文字不算有内容）。
 * ③ 必须传 `requestedKeys`：不传就会把根本没请求过的项（2026-10-22 之前的 key 档项目不请求 void_items）当缺失，
 *    实测会给 11 条 key 档项目里的 5 条发假告警。`requestedKeys` 只影响「关键项/废标项是否被判缺」，
 *    不影响非空分区计数（见函数内注释）。
 * ④ 全部触发受 PARSE_DEGRADED_MIN_SOURCE_CHARS 门槛约束，小标书不告警。
 */
export function detectParseDegradation(
  report: ParseReport | null,
  sourceText: string | null | undefined,
  requestedKeys?: readonly string[],
): ParseDegradationResult {
  const src = nonWs(sourceText ?? "")
  const sections = report?.sections ?? []
  const byKey = new Map<string, ParseSection>()
  for (const s of sections) byKey.set(s.key, s)
  // 非空分区：门禁同源判据 isSectionMissing（占位文字/空壳/failed/pending 都不算「有内容」；
  // status=miss 是「原文本就没有该项」的正确结果，按判据不算缺失）。
  // 这里**不需要**再按 requestedKeys 过滤：遍历的是报告里**已经存在**的分区，
  // 未请求的项本就不会产出，不会凭空被算进来。
  const filledSections = sections.filter((s) => !isSectionMissing(s)).length
  // 关键项无有效内容（与门禁 missingCriticalSections 完全同源，故不可能出现「门禁判缺、自检沉默」）。
  // 必须传 requestedKeys：否则会把该项目根本没请求过的项（key 档不请求 void_items）当缺失 → 假告警。
  const criticalMissing = missingCriticalSections(sections, CRITICAL_SECTION_KEYS, requestedKeys)
  const scoringLines = countNonEmptyLines(byKey.get("tech_score")?.content) + countNonEmptyLines(byKey.get("biz_score")?.content)
  // 废标项只在**被请求过**时才参与判定：未请求 → 该项不存在是正常的，不能算退化
  const voidRequested = !requestedKeys || requestedKeys.includes("void_items")
  const voidLines = countNonEmptyLines(byKey.get("void_items")?.content)

  const metrics = { sourceChars: src, filledSections, scoringLines, voidLines, voidRequested }

  if (src < PARSE_DEGRADED_MIN_SOURCE_CHARS) {
    return { degraded: false, reason: "", metrics }
  }

  const reasons: string[] = []
  if (criticalMissing.length) {
    const names = criticalMissing.map((k) => parseSectionTitle(k))
    reasons.push(`关键项无有效内容：${names.slice(0, 3).join("、")}${names.length > 3 ? ` 等 ${names.length} 项` : ""}`)
  }
  if (filledSections < PARSE_DEGRADED_MIN_FILLED_SECTIONS) {
    reasons.push(`仅产出 ${filledSections} 个非空分区（低于 ${PARSE_DEGRADED_MIN_FILLED_SECTIONS}）`)
  }
  if (scoringLines < PARSE_DEGRADED_MIN_SCORING_LINES) {
    reasons.push(`未识别到评分项`)
  }
  if (voidRequested && voidLines < PARSE_DEGRADED_MIN_VOID_LINES) {
    reasons.push(`未识别到废标项`)
  }

  if (!reasons.length) {
    return { degraded: false, reason: "", metrics }
  }

  return {
    degraded: true,
    // 文案保持紧凑：本串会随 parse_report.warnings 落库（单条 ≤100 字，见 sanitizeParseWarnings），
    // 超长会被截断；「逐项重解析」的入口提示由 ParseReportPanel 琥珀横幅的既有副文案承担。
    reason: `解析疑似不完整：${reasons.join("；")}。建议回「招标文件」重新解析。`,
    metrics,
  }
}
