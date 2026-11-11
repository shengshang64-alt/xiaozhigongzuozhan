/**
 * UX-v2 ⑥ 交卷自查：四类闸门 + 问题清单的**数据整形**（纯函数、零 AI、零 DOM）。
 *
 * 原型 prototype/bid/check.html 的四道闸门（废标 / 一致性 / 暗标 / 格式）此前被判定为
 * 「现网没有对应模型，不硬凑」。复核后确认：四类的数据在现网**都有真实来源**，只是散在
 * 四个面板里，从没在一屏回答过「能不能交卷、卡在哪」：
 *
 *   废标闸门  void_check.items（逐条应答 + critical 未核销）＋ 偏离表覆盖率
 *   一致性闸门 detectNumberConflicts（跨章同指标多值）＋ submission_check.fact_conflicts（AI 事实核对）
 *   暗标闸门  format_report 里 identity_leak 命中 ＋ format_settings.sealed 是否开启
 *   格式闸门  format_report 里其余规则命中（level=warn 计数）
 *
 * 每个闸门都给「通过 / 未通过 / 未运行」三态——未运行绝不显示成通过（此仓的假绿红线：
 * format_check_not_run 就是为这个加的）。问题清单按 阻断 → 警告 → 提示 排序，与原型同序。
 *
 * 与 stage_gates 的关系：那五类（解析/大纲/编制/检查/评标）是**流程留痕**，本屏这四类是
 * **交付质量闸门**，两套并存、互不改写（⑦ 的导出仍只认 stage_gates 全确认）。
 */
import {
  FORMAT_RULE_LABEL,
  effectiveVoidStatus,
  type BidProjectRecord,
  type FormatCheckHit,
  type FormatSettings,
  type VoidItem,
} from "./bidTypes"
import { detectNumberConflicts } from "./composeGates"
import type { Chapter } from "../SolutionStudio/solutionTypes"

export type GateStatus = "pass" | "fail" | "not_run"

export type GateCheck = {
  /** 单行结论（如「12 / 12 逐条应答」） */
  label: string
  /** 该项是否通过；null = 未运行/无数据 */
  ok: boolean | null
  /** 右侧短结论（如「9 / 9 已响应」「3 处待核销」） */
  verdict: string
}

export type Gate = {
  id: "void" | "consistency" | "sealed" | "format"
  label: string
  status: GateStatus
  headline: string
  checks: GateCheck[]
}

export type IssueLevel = "block" | "warn" | "info"

export type IssueRow = {
  id: string
  level: IssueLevel
  /** 类别（一致性 / 暗标 / 废标 / 格式 / 偏离表） */
  category: string
  title: string
  /** 位置（章 · 节 / 条款出处 / 全文） */
  location: string
  /** 可跳转的步骤；null = 无对应步骤 */
  step: number | null
}

export type CheckModel = {
  gates: Gate[]
  issues: IssueRow[]
  blockCount: number
  warnCount: number
  infoCount: number
  /** 四闸门是否全通过（决定能否导出） */
  allPass: boolean
  /** 有任何闸门未运行 */
  hasNotRun: boolean
}

export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  pass: "通过",
  fail: "未通过",
  not_run: "未运行",
}

/** 暗标相关规则（从格式命中里挑出来归到「暗标闸门」） */
const SEALED_RULES = new Set(["identity_leak"])

/** 废标级格式规则：命中即阻断（与 composeGates.GATE_FATAL_RULES 同一口径，避免两处判定漂移） */
const FATAL_FORMAT_RULES = new Set([
  "star_quote_fidelity",
  "placeholder_leftover",
  "over_price_ceiling",
  "deviation_undercommit",
  "amount_case_mismatch",
  "schedule_consistency",
])

export type BuildInput = {
  project: Pick<BidProjectRecord, "void_check" | "bid_chapters" | "submission_check" | "format_settings" | "identity_words">
  format: FormatSettings
  /** 偏离表未应答条数（techParamCoverage.uncovered） */
  deviationUncovered: number
  /** 偏离表总条数 */
  deviationTotal: number
}

function voidItemsOf(project: BuildInput["project"]): VoidItem[] {
  return project.void_check?.items ?? []
}

function formatHitsOf(project: BuildInput["project"]): { hits: FormatCheckHit[]; ran: boolean } {
  const rep = project.submission_check?.format_report
  if (!rep) return { hits: [], ran: false }
  // format_check_not_run 是「没跑」的显式留痕，不算命中，但要把它当「未运行」
  const ran = !rep.hits.some((h) => h.rule === "format_check_not_run")
  return { hits: rep.hits.filter((h) => h.rule !== "format_check_not_run"), ran }
}

export function buildCheckModel(input: BuildInput): CheckModel {
  const { project, format } = input
  const chapters: Chapter[] = (project.bid_chapters ?? []) as Chapter[]
  const issues: IssueRow[] = []

  // ---------- ① 废标闸门 ----------
  const voidItems = voidItemsOf(project)
  const voidTotal = voidItems.length
  const voidCompliant = voidItems.filter((it) => effectiveVoidStatus(it) === "compliant").length
  const voidUnresolved = voidItems.filter(
    (it) => effectiveVoidStatus(it) !== "compliant" && it.severity === "critical" && it.review_status === "pending",
  ).length

  for (const it of voidItems) {
    if (effectiveVoidStatus(it) === "compliant") continue
    if (it.review_status !== "pending") continue
    issues.push({
      id: `void-${it.id}`,
      level: it.severity === "critical" ? "block" : "warn",
      category: "废标",
      title: `废标条款未合规应答：${it.clause.slice(0, 40)}${it.clause.length > 40 ? "…" : ""}`,
      location: it.source_location || "未标注出处",
      step: 5,
    })
  }

  const deviationPass = input.deviationTotal > 0 && input.deviationUncovered === 0
  const voidStatus: GateStatus =
    voidTotal === 0 && input.deviationTotal === 0 ? "not_run" : voidUnresolved > 0 || !deviationPass ? "fail" : "pass"

  const voidGate: Gate = {
    id: "void",
    label: "废标项闸门",
    status: voidStatus,
    headline:
      voidTotal === 0
        ? "还没有废标检查结果"
        : voidUnresolved > 0
          ? `${voidUnresolved} 条阻断级条款待核销`
          : `${voidCompliant} / ${voidTotal} 已合规应答`,
    checks: [
      {
        label: "废标条款逐条判定",
        ok: voidTotal === 0 ? null : voidUnresolved === 0,
        verdict: voidTotal === 0 ? "未运行" : `${voidCompliant} / ${voidTotal} 合规`,
      },
      {
        label: "技术参数偏离表覆盖",
        ok: input.deviationTotal === 0 ? null : deviationPass,
        verdict:
          input.deviationTotal === 0
            ? "未生成"
            : `${input.deviationTotal - input.deviationUncovered} / ${input.deviationTotal} 已应答`,
      },
    ],
  }

  // ---------- ② 一致性闸门 ----------
  const numberConflicts = detectNumberConflicts(chapters)
  const factConflicts = project.submission_check?.fact_conflicts ?? null
  // 本地跨章扫描零成本、有正文就能算；「与招标事实核对」必须跑过交卷体检才有结果。
  // 两者分开判：有正文且无冲突时子项可给「一致」，但整闸门在事实核对未跑时只能是「未运行」。
  const localScanRan = chapters.some((c) => (c.content ?? "").trim().length > 0)
  const factRunRan = factConflicts != null
  const factConflictCount = factConflicts?.length ?? 0

  for (const c of numberConflicts) {
    issues.push({
      id: `num-${c.topic}`,
      level: "warn",
      category: "一致性",
      title: `${c.topic}跨章数值不一致：${c.values.join(" / ")}`,
      location: c.chapters.slice(0, 2).join("、") || "全文",
      step: 4,
    })
  }
  for (const f of factConflicts ?? []) {
    issues.push({
      id: `fact-${f.fact.slice(0, 20)}-${f.chapter}`,
      level: "block",
      category: "一致性",
      title: `与招标事实不一致：${f.fact.slice(0, 40)}`,
      location: f.chapter || "全文",
      step: 4,
    })
  }

  const consistencyStatus: GateStatus = !localScanRan
    ? "not_run"
    : numberConflicts.length > 0 || factConflictCount > 0
      ? "fail"
      : factRunRan
        ? "pass"
        : "not_run"

  const consistencyGate: Gate = {
    id: "consistency",
    label: "一致性闸门",
    status: consistencyStatus,
    headline:
      consistencyStatus === "not_run"
        ? localScanRan
          ? "跨章数值一致，但还没跑过与招标事实的核对"
          : "还没有正文可核对"
        : consistencyStatus === "pass"
          ? "跨章数值与招标事实一致"
          : `${numberConflicts.length + factConflictCount} 处不一致`,
    checks: [
      {
        label: "跨章指标数值（可用性/响应时间/质保/保留期）",
        ok: !localScanRan ? null : numberConflicts.length === 0,
        verdict: !localScanRan ? "未运行" : numberConflicts.length ? `${numberConflicts.length} 处不一致` : "一致",
      },
      {
        label: "与招标事实核对（保证金/工期/金额）",
        ok: factRunRan ? factConflictCount === 0 : null,
        verdict: !factRunRan ? "未运行" : factConflictCount ? `${factConflictCount} 处不一致` : "一致",
      },
    ],
  }

  // ---------- ③ 暗标闸门 ----------
  const { hits: fmtHits, ran: formatRan } = formatHitsOf(project)
  const identityWords = (project.identity_words ?? "")
    .split(/[,，、]/)
    .map((w) => w.trim())
    .filter(Boolean)
  const sealedOn = format.sealed === true
  const sealedHits = fmtHits.filter((h) => SEALED_RULES.has(h.rule))
  for (const h of sealedHits) {
    issues.push({
      id: `sealed-${h.chapter}-${h.quote.slice(0, 12)}`,
      level: "warn",
      category: "暗标",
      title: `疑似身份泄露：${h.quote.slice(0, 40)}`,
      location: h.chapter || "全文",
      step: 4,
    })
  }

  const sealedStatus: GateStatus = !sealedOn
    ? identityWords.length > 0
      ? sealedHits.length > 0
        ? "fail"
        : "pass"
      : "not_run"
    : sealedHits.length > 0
      ? "fail"
      : "pass"

  const sealedGate: Gate = {
    id: "sealed",
    label: "暗标闸门",
    status: sealedStatus,
    headline: sealedOn
      ? sealedHits.length > 0
        ? `${sealedHits.length} 处身份信息命中`
        : "暗标脱敏检查通过"
      : identityWords.length > 0
        ? sealedHits.length > 0
          ? `${sealedHits.length} 处身份词命中`
          : "身份词扫描通过"
        : "未开启暗标，也未设置身份词",
    checks: [
      {
        label: "是否暗标编制",
        ok: sealedOn,
        verdict: sealedOn ? "已开启" : "未开启",
      },
      {
        label: "身份词 / 公司名模式扫描",
        ok: identityWords.length === 0 && !sealedOn ? null : sealedHits.length === 0,
        verdict:
          identityWords.length === 0 && !sealedOn
            ? "未运行"
            : sealedHits.length
              ? `${sealedHits.length} 处命中`
              : "无命中",
      },
    ],
  }

  // ---------- ④ 格式闸门 ----------
  const nonSealedHits = fmtHits.filter((h) => !SEALED_RULES.has(h.rule))
  const formatFatal = nonSealedHits.filter((h) => FATAL_FORMAT_RULES.has(h.rule))
  const formatWarn = nonSealedHits.filter((h) => !FATAL_FORMAT_RULES.has(h.rule))

  for (const h of nonSealedHits) {
    issues.push({
      id: `fmt-${h.rule}-${h.chapter}-${h.quote.slice(0, 10)}`,
      level: FATAL_FORMAT_RULES.has(h.rule) ? "block" : "warn",
      category: "格式",
      title: `${FORMAT_RULE_LABEL[h.rule] ?? h.rule}：${h.quote.slice(0, 40)}`,
      location: h.chapter || "全文",
      step: 4,
    })
  }

  const formatStatus: GateStatus = !formatRan
    ? "not_run"
    : formatFatal.length > 0
      ? "fail"
      : formatWarn.length > 0
        ? "fail"
        : "pass"

  const formatGate: Gate = {
    id: "format",
    label: "格式闸门",
    status: formatStatus,
    headline:
      formatStatus === "not_run"
        ? "还没有跑过交卷体检"
        : formatFatal.length > 0
          ? `${formatFatal.length} 条废标级体检项`
          : formatWarn.length > 0
            ? `${formatWarn.length} 条格式问题`
            : "格式体检无命中",
    checks: [
      {
        label: "交卷体检（格式/引文/占位/报价等规则）",
        ok: formatStatus === "not_run" ? null : formatStatus === "pass",
        verdict:
          formatStatus === "not_run"
            ? "未运行"
            : formatFatal.length + formatWarn.length > 0
              ? `${formatFatal.length + formatWarn.length} 条命中`
              : "无命中",
      },
      {
        label: "目录 / 页码 / 页眉开关",
        ok: Boolean(format.toc || format.pageNumber),
        verdict: `${format.toc ? "目录" : "无目录"} · ${format.pageNumber ? "有页码" : "无页码"}`,
      },
    ],
  }

  // 偏离表未应答单独进清单（它不属于上面四类，但会丢分）
  if (input.deviationUncovered > 0) {
    issues.push({
      id: "deviation-uncovered",
      level: "info",
      category: "偏离表",
      title: `${input.deviationUncovered} 条技术参数未进偏离表也未建大纲节点`,
      location: "偏离表",
      step: 5,
    })
  }

  const gates = [voidGate, consistencyGate, sealedGate, formatGate]
  const levelRank: Record<IssueLevel, number> = { block: 0, warn: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => levelRank[a.level] - levelRank[b.level])

  return {
    gates,
    issues: sorted,
    blockCount: sorted.filter((i) => i.level === "block").length,
    warnCount: sorted.filter((i) => i.level === "warn").length,
    infoCount: sorted.filter((i) => i.level === "info").length,
    // 「未运行」不算通过——否则会把「没检查」显示成「已通过」（本仓假绿红线）
    allPass: gates.every((g) => g.status === "pass"),
    hasNotRun: gates.some((g) => g.status === "not_run"),
  }
}

export const ISSUE_LEVEL_LABEL: Record<IssueLevel, string> = {
  block: "阻断",
  warn: "警告",
  info: "提示",
}
