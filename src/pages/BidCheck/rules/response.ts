// ---------------------------------------------------------------------------
// response.ts —— L2 响应层（二期 r261-bidcheck-followons）。零 AI、零费用、零 collection schema。
//
// 复用 BidWorkspace 现成的两把本地尺子，把「标书是否逐条回应招标要求」的发现结论汇入检查中枢：
//  · L2-R1 ★实质性条款正文回应核对 —— complianceMatrix.buildComplianceRows + complianceCoverage.auditComplianceCoverage
//    逐字命中判定：某 ★ 条款的要点在任一章正文出现即算「说过」；正文未见/仅标题/部分命中列为待人工确认。
//  · L2-R2 技术评分项落点核对 —— scoreCoverageCheckup.buildScoreCheckup
//    按【分值】而非条款数统计技术评分项是否有正文承接章节，丢几分看得见。
//
// ⚠️ 只标不改：只读解析报告 + 已生成正文推导，绝不改正文、绝不写回。
// ⚠️ 只报不拦：逐字未命中可能只是换了表述，故一律 severity=high / status=warn（丢分风险·建议整改），
//    不标 critical/fail，不触发暗标导出门禁 —— 与「疑似编造未清零禁止导出」维持「只报告不拦截」同口径。
// 上传文件（无解析报告/正文）或未生成正文的项目 → 标 skipped，诚实说明「无法核对」，绝不瞎判。
// ---------------------------------------------------------------------------

import { buildComplianceRows } from "@/pages/BidWorkspace/complianceMatrix"
import {
  auditComplianceCoverage,
  COMPLIANCE_COVERAGE_LABEL,
  COMPLIANCE_COVERAGE_ORDER,
  type ComplianceCoverageLevel,
  type ComplianceCoverageRow,
} from "@/pages/BidWorkspace/complianceCoverage"
import { buildScoreCheckup } from "@/pages/BidWorkspace/scoreCoverageCheckup"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { CheckHit, CheckItem, Severity } from "../bidCheckTypes"

/** 单项最多列出的待核对条款数（防超长清单淹没右栏，超出仅在依据里给总数） */
const MAX_HITS = 30

function clip(s: string): string {
  const t = (s || "").trim().replace(/\s+/g, " ")
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

function baseItem(
  code: string,
  category: string,
  title: string,
  severity: Severity,
  status: CheckItem["status"],
  basis: string,
  suggestion: string,
  hits: CheckHit[],
): CheckItem {
  return { code, level: "L2", category, title, severity, status, basis, suggestion, hits, confidence: null }
}

/** 待核对等级排序权重：正文未见 < 仅在标题 < 部分命中（越靠前越该先看） */
const LEVEL_ORDER: Record<ComplianceCoverageLevel, number> = {
  missing: 0,
  outline: 1,
  partial: 2,
  full: 3,
}

/** ★条款正文回应核对（L2-R1） */
function checkStarClauses(rec: BidProjectRecord | null): CheckItem {
  const code = "L2-R1"
  const title = "实质性条款（★）正文回应核对"
  const suggestion = "逐条在技术正文中补足对 ★ 条款的实质响应；若已换表述回应仍显未命中，人工确认后忽略本条提示即可。"
  const report = rec?.parse_report ?? null
  if (!report) {
    return baseItem(code, "条款响应", title, "info", "skipped",
      "需选择已完成解析的标书项目（上传文件无解析报告，无法核对招标条款）。", suggestion, [])
  }
  const rows = buildComplianceRows(report)
  const hasStar = rows.some((r) => r.kind === "star")
  if (!hasStar) {
    return baseItem(code, "条款响应", title, "info", "skipped",
      "解析报告未含 ★/▲ 实质性技术条款（或未解析该分区），无需核对。", suggestion, [])
  }
  const chapters = rec?.bid_chapters ?? []
  const cov = auditComplianceCoverage(rows, chapters)
  if (cov.generatedChapters === 0) {
    return baseItem(code, "条款响应", title, "info", "skipped",
      "项目正文尚未生成，暂无法核对 ★ 条款回应情况（生成正文后重跑即可）。", suggestion, [])
  }
  // 零容忍原文响应：未全命中（level≠full）或未逐字命中（originalHit=false，疑改写）都要人工过目
  const byId = Object.values(cov.byRow)
  const textById = new Map(rows.map((r) => [r.id, r.text]))
  const review = byId
    .filter((r) => r.level !== "full" || !r.originalHit)
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.verbatimRatio - b.verbatimRatio)
  const nonVerbatim = byId.filter((r) => !r.originalHit).length
  const hits: CheckHit[] = review.slice(0, MAX_HITS).map((r) => toStarHit(r, textById.get(r.id) ?? ""))
  if (!review.length) {
    return baseItem(code, "条款响应", title, "high", "pass",
      `共 ${cov.total} 条 ★/▲ 条款，正文逐字命中（原文响应达标）。`, suggestion, [])
  }
  const dist = COMPLIANCE_COVERAGE_ORDER
    .map((lv) => `${COMPLIANCE_COVERAGE_LABEL[lv]} ${cov.counts[lv]}`)
    .join(" · ")
  const more = review.length > MAX_HITS ? `（仅列前 ${MAX_HITS} 条）` : ""
  return baseItem(code, "条款响应", title, "high", "warn",
    `共 ${cov.total} 条 ★/▲ 条款，待人工确认 ${review.length} 条${more}（其中未见原文逐字响应 ${nonVerbatim} 条）：${dist}。`, suggestion, hits)
}

function toStarHit(r: ComplianceCoverageRow, clauseText: string): CheckHit {
  const label = COMPLIANCE_COVERAGE_LABEL[r.level]
  const seen = r.missingKeys.length
    ? `正文未见要点：${r.missingKeys.join("、")}`
    : r.level === "full"
      ? "要点已命中"
      : "正文仅部分命中"
  const verb = r.originalHit ? "" : `｜未见原文逐字响应（命中率 ${Math.round(r.verbatimRatio * 100)}%，疑改写或概括）`
  return {
    location: `★/▲条款 · ${label}`,
    text: clip(clauseText),
    rule: "compliance_coverage",
    basis: `${label}｜${seen}${verb}`,
  }
}

/** 技术评分项落点核对（L2-R2） */
function checkScoreCoverage(rec: BidProjectRecord | null): CheckItem {
  const code = "L2-R2"
  const title = "技术评分项落点核对"
  const suggestion = "为未落点的评分项补写对应技术章节，使每个评分点都有正文承接（章节名近义也能命中）。"
  const report = rec?.parse_report ?? null
  if (!report) {
    return baseItem(code, "评分覆盖", title, "info", "skipped",
      "需选择已完成解析的标书项目（上传文件无解析报告，无法核对评分项）。", suggestion, [])
  }
  const checkup = buildScoreCheckup(rec?.bid_outline ?? [], report)
  if (!checkup.hasScoring) {
    return baseItem(code, "评分覆盖", title, "info", "skipped",
      "解析报告未含技术评分表（或未解析评分办法分区），无需核对。", suggestion, [])
  }
  if (!checkup.missingRows.length) {
    return baseItem(code, "评分覆盖", title, "high", "pass",
      `技术总分 ${checkup.techTotal} 分，评分项已全部有正文承接。`, suggestion, [])
  }
  const hits: CheckHit[] = checkup.missingRows.slice(0, MAX_HITS).map((r) => ({
    location: "技术评分表",
    text: clip(`${r.id} ${r.name}`),
    rule: "score_coverage",
    basis: `未落点 ${r.score} 分${r.subjective ? "（主观分）" : "（客观分）"}`,
  }))
  const more = checkup.missingRows.length > MAX_HITS ? `（仅列前 ${MAX_HITS} 条）` : ""
  return baseItem(code, "评分覆盖", title, "high", "warn",
    `技术总分 ${checkup.techTotal} 分，已落点 ${checkup.techLanded} 分，未落点 ${checkup.techMissing} 分（${checkup.missingRows.length} 项）${more}。`,
    suggestion, hits)
}

/**
 * L2 响应层主入口：返回本层的检查项数组（★条款回应 + 评分项落点）。
 * 仅当层级开关含 L2 时由 runCheck 调用；上传文件（rec=null）会得到两条诚实的 skipped。
 */
export function runResponseChecks(rec: BidProjectRecord | null): CheckItem[] {
  return [checkStarClauses(rec), checkScoreCoverage(rec)]
}
