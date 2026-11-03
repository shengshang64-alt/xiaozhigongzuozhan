import { findPlaceholderLeftovers } from "@/pages/PptQuote/deckLint"
import { isAmbiguousDiscount } from "@/lib/discountIntent"

// ---------------------------------------------------------------------------
// R280 delivery-p2-01：跨模块「能不能发给客户」统一端到端验收判据（零 AI、零费用、零新数据模型）
//
// 背景：四大工作台各有自己的确定性自检——标书交卷体检（bidTypes）、方案交付体检
// （solDeliveryCheck）、PPT 结构自检（deckLint），但报价侧此前没有任何交付前硬伤
// 检查，且四者各自为政、口径不一，没有人回答「这份东西到底能不能发给客户」。docs/13
// 交付链记录的缺口即「各模块技术通过却无人判定可发送性」。本模块不另起一套检测引擎：
// 只复用各侧已产出的确定性发现（hits / lint issues / findings），把它们归一到统一的
// 四条硬判据 + 一条编造嫌疑，给出 sendable 建议与整改摘要。
//
// 契约（维持既有裁定，务必遵守）：
//  - 本验收器是「建议」不是「拦截」——sendable=false 只提示暂缓，绝不阻断任何导出动作，
//    与「编造嫌疑未清零禁止导出」维持「只报告不拦截」的全程裁定一致。
//  - fabrication_suspect（编造嫌疑，来自 AI/接地判定）在 buildVerdict 里被强制降级为
//    warn，结构上永不进 blockers、永不让 sendable=false——这是对该裁定的代码级锁。
//  - 入参全部结构化（不 import bidTypes / pptQuoteTypes 运行时），与真实报告类型结构兼容，
//    保持本模块零重依赖、可脱离后端纯单测。
// ---------------------------------------------------------------------------

export type DeliverModule = "bid" | "solution" | "deck" | "quote"

/** 统一硬判据类别（跨四模块同一口径） */
export type DeliverCriterion =
  /** 实质性条款零漏答（含偏离表负偏离：响应低于招标要求） */
  | "star_unanswered"
  /** 逐字零改写：数值/金额/口径与招标事实不一致（含报价超限价、大小写不符、跨章多值） */
  | "verbatim_fidelity"
  /** 导出无占位残留：【待填写】/待补充/XX/{{var}}/元话语/绝对化承诺 */
  | "placeholder_leftover"
  /** 交付完整性：失败章 / 标完成却空正文 / 报价无有效合计 */
  | "incomplete_artifact"
  /** 编造嫌疑（AI/接地判定，维持只报不拦，永不做阻断） */
  | "fabrication_suspect"

export type DeliverSeverity = "blocker" | "warn"

export const CRITERION_LABEL: Record<DeliverCriterion, string> = {
  star_unanswered: "实质性条款零漏答",
  verbatim_fidelity: "数值口径与招标事实一致",
  placeholder_leftover: "占位与元话语残留已清",
  incomplete_artifact: "交付物完整（无失败/空章/空报价）",
  fabrication_suspect: "疑似编造内容（需人工核实）",
}

/** 规范条目：一次验收里同一判据聚成一条 */
export type DeliverIssue = {
  criterion: DeliverCriterion
  severity: DeliverSeverity
  title: string
  detail?: string
  count: number
}

export type DeliverVerdict = {
  module: DeliverModule
  /** 无 blocker 即视为可发送；warn（含编造嫌疑）一律不影响此值 */
  sendable: boolean
  blockers: DeliverIssue[]
  warnings: DeliverIssue[]
  summary: string
}

/** 规则码 -> {判据, 级别}：标书/方案共用同一套 FormatCheckRule/SolCheckRule 词表（同源单一真源） */
const RULE_MAP: Record<string, { criterion: DeliverCriterion; severity: DeliverSeverity }> = {
  meta_leftover: { criterion: "placeholder_leftover", severity: "blocker" },
  decoration_leftover: { criterion: "placeholder_leftover", severity: "blocker" },
  placeholder_leftover: { criterion: "placeholder_leftover", severity: "blocker" },
  number_conflict: { criterion: "verbatim_fidelity", severity: "blocker" },
  param_escalation: { criterion: "verbatim_fidelity", severity: "blocker" },
  metric_conflict: { criterion: "verbatim_fidelity", severity: "blocker" },
  over_price_ceiling: { criterion: "verbatim_fidelity", severity: "blocker" },
  amount_case_mismatch: { criterion: "verbatim_fidelity", severity: "blocker" },
  intra_dup: { criterion: "verbatim_fidelity", severity: "warn" },
  failed_chapter: { criterion: "incomplete_artifact", severity: "blocker" },
  empty_chapter: { criterion: "incomplete_artifact", severity: "blocker" },
  underlength_chapter: { criterion: "incomplete_artifact", severity: "warn" },
  deviation_undercommit: { criterion: "star_unanswered", severity: "blocker" },
}

/** 结构化入参：只声明验收需要的最小字段，与真实报告类型结构兼容 */
type TaggedHit = { rule: string; level?: string }

/** 把一组带 rule 的命中（标书 FormatCheckHit[] / 方案 SolCheckHit[]）折叠成按判据聚合的条目 */
function collapseTaggedHits(hits: TaggedHit[]): DeliverIssue[] {
  const byCriterion = new Map<DeliverCriterion, { severity: DeliverSeverity; count: number; rules: Map<string, number> }>()
  for (const h of hits) {
    const m = RULE_MAP[h.rule]
    if (!m) continue // 与「可发送」无关的其它禁则（如暗标彩色文字）不纳入，避免误拦正常交付
    let cur = byCriterion.get(m.criterion)
    if (!cur) {
      cur = { severity: m.severity, count: 0, rules: new Map() }
      byCriterion.set(m.criterion, cur)
    }
    cur.count += 1
    cur.rules.set(h.rule, (cur.rules.get(h.rule) ?? 0) + 1)
    // 同一判据下只要有一条 blocker 就整体按 blocker（最严优先）
    if (m.severity === "blocker") cur.severity = "blocker"
  }
  return [...byCriterion.entries()].map(([criterion, v]) => ({
    criterion,
    severity: v.severity,
    title: CRITERION_LABEL[criterion],
    detail: [...v.rules.entries()].map(([r, n]) => `${r}*${n}`).join("、"),
    count: v.count,
  }))
}

/** PPT 结构自检码 -> 判据：只收「可发送硬判据」相关，纯排版打磨项忽略（PPT 面板已另行提示） */
const DECK_MAP: Record<string, { criterion: DeliverCriterion; severity: DeliverSeverity }> = {
  placeholder_leftover: { criterion: "placeholder_leftover", severity: "blocker" },
  empty_page: { criterion: "incomplete_artifact", severity: "blocker" },
  chart_len_mismatch: { criterion: "verbatim_fidelity", severity: "warn" },
}

type DeckIssueLike = { code: string }

/** 方案交付体检报告 -> 统一条目（复用 auditSolutionDelivery 已算好的 hits，不重扫） */
export function solutionIssuesFromReport(report: { hits: TaggedHit[] }): DeliverIssue[] {
  return collapseTaggedHits(report?.hits ?? [])
}

/** 标书交卷体检命中 -> 统一条目；额外并入「条款漏答数」「编造嫌疑数」两个来源 */
export function bidIssuesFromFindings(
  hits: TaggedHit[],
  extra?: { starUnansweredCount?: number; fabricationSuspectCount?: number },
): DeliverIssue[] {
  const issues = collapseTaggedHits(hits ?? [])
  const starN = extra?.starUnansweredCount ?? 0
  if (starN > 0) {
    const at = issues.find((x) => x.criterion === "star_unanswered")
    if (at) {
      at.count += starN
      at.severity = "blocker"
      at.detail = at.detail ? `${at.detail}、star_unanswered*${starN}` : `star_unanswered*${starN}`
    } else {
      issues.push({
        criterion: "star_unanswered",
        severity: "blocker",
        title: CRITERION_LABEL.star_unanswered,
        detail: `star_unanswered*${starN}`,
        count: starN,
      })
    }
  }
  const fab = extra?.fabricationSuspectCount ?? 0
  if (fab > 0) issues.push(fabricationIssue(fab))
  return issues
}

/** PPT 结构自检 -> 统一条目（复用 lintDeck 已算好的 issues，不重扫） */
export function deckIssuesFromLint(issues: DeckIssueLike[]): DeliverIssue[] {
  const byCriterion = new Map<DeliverCriterion, { severity: DeliverSeverity; count: number }>()
  for (const it of issues ?? []) {
    const m = DECK_MAP[it.code]
    if (!m) continue
    const cur = byCriterion.get(m.criterion)
    if (!cur) byCriterion.set(m.criterion, { severity: m.severity, count: 1 })
    else {
      cur.count += 1
      if (m.severity === "blocker") cur.severity = "blocker"
    }
  }
  return [...byCriterion.entries()].map(([criterion, v]) => ({
    criterion,
    severity: v.severity,
    title: CRITERION_LABEL[criterion],
    count: v.count,
  }))
}

/** 编造嫌疑条目：级别恒为 warn（该判据不允许作为阻断项，锁死「只报不拦」裁定） */
function fabricationIssue(count: number): DeliverIssue {
  return {
    criterion: "fabrication_suspect",
    severity: "warn",
    title: CRITERION_LABEL.fabrication_suspect,
    detail: `consistencyGuard*${count}`,
    count,
  }
}

export type QuoteItemLike = { item_name?: string; qty?: number; price?: number; discount?: number }
export type QuoteGroupLike = { name?: string; items?: QuoteItemLike[] }
export type QuoteLike = { quote_name?: string; tax_note?: string; groups?: QuoteGroupLike[] }

/**
 * 报价交付检查（此前报价侧无任何交付前硬伤检查，本函数补齐确定性一条）：
 *  - 无有效合计（total<=0）或无任何明细行 -> 交付不完整（blocker）
 *  - 明细行存在但个别 item_name 为空 -> 半成品提醒（warn，避免误拦老记录）
 *  - 明细行折扣 <5%（可能把「几折」当百分比填）-> 数值口径提醒（warn，只报不拦）
 *  - 报价名/税率备注/明细名残留模板占位（复用 deckLint 的 findPlaceholderLeftovers）-> 占位残留（blocker）
 * @param total 由调用方传入 quoteTotal(groups)（单一真源，本模块不重复实现金额汇总）
 */
export function quoteIssuesFromRecord(record: QuoteLike, total: number): DeliverIssue[] {
  const issues: DeliverIssue[] = []
  const groups = record?.groups ?? []
  const items = groups.flatMap((g) => g?.items ?? [])
  if (!(typeof total === "number" && Number.isFinite(total) && total > 0) || items.length === 0) {
    issues.push({
      criterion: "incomplete_artifact",
      severity: "blocker",
      title: CRITERION_LABEL.incomplete_artifact,
      detail: items.length === 0 ? "报价无任何明细行" : "报价合计为 0（明细缺单价或未生效）",
      count: 1,
    })
  }
  const unnamed = items.filter((it) => !(it?.item_name ?? "").trim()).length
  if (unnamed > 0) {
    issues.push({
      criterion: "incomplete_artifact",
      severity: "warn",
      title: CRITERION_LABEL.incomplete_artifact,
      detail: `${unnamed} 条明细缺名称`,
      count: unnamed,
    })
  }
  // R40（B8）：折扣 <5% 的行既可能是真按百分之几计价，也可能是把「几折」当百分比填了
  // （填 3 想表达 3 折 = 按 30% 计），金额差 10~100 倍且不会报错，属最高危的「悄悄错」。
  // 级别钉在 warn：维持「只报告不拦截」裁定，不把老记录挡在发送之外。
  const oddDiscount = items.filter((it) => isAmbiguousDiscount(it.discount))
  if (oddDiscount.length > 0) {
    const firstName = (oddDiscount[0]?.item_name ?? "").trim() || "未命名行"
    const firstVal = oddDiscount[0]?.discount
    issues.push({
      criterion: "verbatim_fidelity",
      severity: "warn",
      title: CRITERION_LABEL.verbatim_fidelity,
      detail: `${oddDiscount.length} 行折扣小于 5%（如「${firstName}」填了 ${firstVal}），疑似按「几折」填写，现已按原价的百分之几计入合计`,
      count: oddDiscount.length,
    })
  }
  const hay = [record?.quote_name ?? "", record?.tax_note ?? "", ...items.map((it) => it?.item_name ?? "")].join("\n")
  const leftover = findPlaceholderLeftovers(hay)
  if (leftover.length) {
    issues.push({
      criterion: "placeholder_leftover",
      severity: "blocker",
      title: CRITERION_LABEL.placeholder_leftover,
      detail: leftover.slice(0, 3).join("、"),
      count: leftover.length,
    })
  }
  return issues
}

/**
 * 汇总为验收结论。不变量：fabrication_suspect 强制降级为 warn，绝不进 blockers、
 * 绝不让 sendable=false（代码级锁死「编造嫌疑只报不拦」裁定）。sendable 只由 blocker 决定。
 */
export function buildVerdict(module: DeliverModule, issues: DeliverIssue[]): DeliverVerdict {
  const coerced = issues.map((it) =>
    it.criterion === "fabrication_suspect" && it.severity !== "warn" ? { ...it, severity: "warn" as DeliverSeverity } : it,
  )
  const blockers = coerced.filter((it) => it.severity === "blocker")
  const warnings = coerced.filter((it) => it.severity === "warn")
  const sendable = blockers.length === 0
  return { module, sendable, blockers, warnings, summary: summarizeVerdict(module, blockers, warnings) }
}

function summarizeVerdict(module: DeliverModule, blockers: DeliverIssue[], warnings: DeliverIssue[]): string {
  const head = "交付验收："
  if (blockers.length) {
    return `${head}建议暂缓发送——${blockers.map((b) => `${b.title}（${b.count}）`).join("；")}`
  }
  if (warnings.length) {
    return `${head}可发送（提醒：${warnings.map((w) => `${w.title}（${w.count}）`).join("；")}）`
  }
  return `${head}未发现阻断项，可发送（${MODULE_LABEL[module]}）`
}

const MODULE_LABEL: Record<DeliverModule, string> = {
  bid: "标书",
  solution: "方案",
  deck: "PPT",
  quote: "报价",
}

export function moduleLabel(module: DeliverModule): string {
  return MODULE_LABEL[module]
}
