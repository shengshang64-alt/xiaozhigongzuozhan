/**
 * UX-v2 ② 解析确认：本屏要的四类结果卡、评分分布、解析目录、解析质量、废标逐条确认表
 * 的**数据整形**（纯函数、零 AI、零 DOM）。
 *
 * 为什么要单独一层：原型 prototype/bid/parse.html 首屏全是「四类结果的数与分布」，
 * 而解析报告本身是一份 21 项的 section 列表。硬凑就要么编数字、要么把报告拍平。
 * 这里只做**派生**——每一项都能指到解析报告 / 招标原文 / 已经跑过的本地扫描函数上：
 *
 *   废标项      buildComplianceRows —— ★/▲、废标、资格[强制]、符合性 四类条款（报告推导）
 *   评分办法    numberScoringItems + listPriceScoringCandidates —— 评分项与价格分口径
 *   技术参数    extractParamCandidates —— 招标原文 ★/▲ 参数行（本地扫描，零误报口径）
 *   时间节点    bid_nodes 分区（结构化字段优先，老报告回退「节点：时间」行）
 *   条款覆盖率  parseCoverageRatio —— 与解析报告面板同一口径，不另算一套
 *   疑似漏抽    crossCheckScores —— 本地扫描 vs 解析报告（既有「评分项核对」同源）
 *   表格识别    summarizeTenderTables —— 上传 docx 时本地还原的表格
 *
 * 现网没有的数据**不编**：原型页头那两行「解析耗时」与「页码可回溯」都没有落库字段，
 * 前者整条不渲染，后者由 UI 显式写「未接入」并说明口径（见 ParseConfirmScreen 的 quality 卡）。
 */
import {
  numberScoringItems,
  parseSectionFields,
  parseSectionTitle,
  sectionText,
  type ParseReport,
  type ParseSection,
} from "./bidTypes"
import { buildComplianceRows, type ComplianceProgressMap, type ComplianceRow } from "./complianceMatrix"
import { applyChoices, extractParamCandidates, summarizeParams } from "./paramMatchTypes"
import { coveragePercent, parseCoverageRatio } from "./parseCoverage"
import { crossCheckScores } from "./scoreItemsScan"
import { listPriceScoringCandidates } from "./priceScoreModel"
import { summarizeTenderTables, type TenderTableRecord } from "./tenderTables"

export type ConfirmTone = "red" | "blue" | "amber" | "purple" | "green" | "gray"

export type ConfirmTag = { label: string; tone: ConfirmTone }

export type ConfirmCard = {
  id: "void" | "score" | "param" | "node"
  label: string
  tone: ConfirmTone
  /** 主数字；null = 该项没有可展示的真值（UI 渲染「—」而不是 0） */
  value: number | null
  tags: ConfirmTag[]
  foot: string
}

export type ScoreSplit = {
  hasScoring: boolean
  itemCount: number
  techCount: number
  bizCount: number
  priceCount: number
  techSum: number
  /** 商务分（已剔除价格分项，避免与技术/价格三栏重复计数） */
  bizSum: number
  priceSum: number | null
  subjectiveCount: number
  subjectiveScore: number
  /** 价格分口径原文（能机械复算时给公式原文） */
  priceFormula: string | null
  /** 认不出价格分口径时的人话原因（认不出就不给数） */
  priceFormulaNote: string
}

export type DirNode = {
  id: string
  label: string
  count: number
  indent?: boolean
  /** 点击跳解析明细的分区 key；null = 打开明细总览 */
  focusKey: string | null
}

export type QualityStat = {
  id: string
  label: string
  value: string
  unit: string
  tone: "ok" | "warn" | "muted"
  /** 数字旁边的短说明（口径写清，避免读成「系统保证」） */
  note: string
}

export type VoidConfirmRow = {
  id: string
  text: string
  /** 原文出处（条款号/章节）。没有出处的行显示「—」，不假装有页码 */
  citation: string
  level: "阻断" | "强制"
}

export type ParseConfirmModel = {
  cards: ConfirmCard[]
  score: ScoreSplit
  directory: DirNode[]
  quality: QualityStat[]
  /** 逐条确认表（废标 + ★/▲ + 资格[强制]），未确认在前 */
  rows: VoidConfirmRow[]
  /** 已确认 / 未确认（按覆盖进度状态：covered/na = 已确认） */
  confirmedCount: number
  pendingCount: number
  totalRows: number
  /** 系统分组（采购需求结构）条数，技术参数卡脚注用 */
  systemCount: number
}

/** 条款末尾出处：只认「第X条/章/节」「附件」「页码」这类可定位信息，后果描述（如「投标无效」）不算出处 */
export function citationOf(text: string): string {
  const m = (text ?? "").trim().match(/[（(]([^（）()]{2,40})[）)]\s*$/)
  if (!m) return "—"
  const inner = m[1].replace(/\s+/g, " ").trim()
  if (!/(第\s*[0-9一二三四五六七八九十百]+\s*[条章节款项]|附件|第?\s*\d+\s*页)/.test(inner)) return "—"
  return inner
}

function nonEmptyLines(content: string | undefined): string[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 时间节点对：结构化字段优先（整文 JSON 通道），老报告回退「节点：时间」行 */
export function bidNodePairs(report: ParseReport | null | undefined): { label: string; value: string }[] {
  const sec: ParseSection | undefined = (report?.sections ?? []).find((s) => s.key === "bid_nodes")
  if (!sec) return []
  const fields = parseSectionFields(sec)
  if (fields.length) return fields
  const out: { label: string; value: string }[] = []
  for (const line of nonEmptyLines(sec.content)) {
    const m = line.match(/^(.{1,24}?)\s*[：:]\s*(.+)$/)
    if (!m) continue
    out.push({ label: m[1].trim(), value: m[2].trim() })
  }
  return out
}

/** 评分办法分布：技术 / 商务（剔价格）/ 价格 三栏 + 主观分；价格分只认可机械复算的候选 */
export function scoreSplitOf(report: ParseReport | null | undefined): ScoreSplit {
  const items = numberScoringItems(report ?? null)
  const empty: ScoreSplit = {
    hasScoring: false,
    itemCount: 0,
    techCount: 0,
    bizCount: 0,
    priceCount: 0,
    techSum: 0,
    bizSum: 0,
    priceSum: null,
    subjectiveCount: 0,
    subjectiveScore: 0,
    priceFormula: null,
    priceFormulaNote: "解析报告里还没有评分办法",
  }
  if (!items.length) return empty

  const candidates = listPriceScoringCandidates(items)
  // 价格分项通常落在 biz_score（解析口径：商务项一般只有价格分），从商务合计里剔除，
  // 否则三根柱子加起来会多出一份价格分（原型是 技术45/商务25/价格30 三栏互斥）。
  const priceNames = new Set(candidates.map((c) => c.item.item))
  const okCandidate = candidates.find((c) => c.parse.ok)
  const badCandidate = candidates.find((c) => !c.parse.ok)

  const round1 = (n: number) => Math.round(n * 10) / 10
  const tech = items.filter((i) => i.category === "tech")
  const biz = items.filter((i) => i.category === "biz" && !priceNames.has(i.item))
  const price = items.filter((i) => priceNames.has(i.item))
  const sum = (arr: { score: number }[]) => round1(arr.reduce((a, x) => a + (Number.isFinite(x.score) ? x.score : 0), 0))

  const formulaRaw = okCandidate && okCandidate.parse.ok ? okCandidate.parse.formula.raw : null
  const badReason = badCandidate && !badCandidate.parse.ok ? badCandidate.parse.reason : null

  return {
    hasScoring: true,
    itemCount: items.length,
    techCount: tech.length,
    bizCount: biz.length,
    priceCount: price.length,
    techSum: sum(tech),
    bizSum: sum(biz),
    priceSum: price.length ? sum(price) : null,
    subjectiveCount: items.filter((i) => i.isSubjective).length,
    subjectiveScore: sum(items.filter((i) => i.isSubjective)),
    priceFormula: formulaRaw,
    priceFormulaNote: formulaRaw ? "" : (badReason ?? "评分办法里没有价格分项，或价格分未单列"),
  }
}

/** 解析质量四栏：覆盖率 / 疑似漏抽 / 表格识别 / 页码可回溯（后者现网无落库，如实「未接入」） */
export function qualityStatsOf(input: {
  report: ParseReport | null | undefined
  tenderText: string
  tenderTables?: TenderTableRecord[] | null
}): QualityStat[] {
  const { report, tenderText } = input
  const sections = report?.sections ?? []

  const ratio = parseCoverageRatio(sections, tenderText ?? "")
  const pct = coveragePercent(ratio)
  const coverage: QualityStat =
    pct == null
      ? { id: "coverage", label: "条款覆盖率", value: "—", unit: "", tone: "muted", note: "招标原文为空，无从计算" }
      : {
          id: "coverage",
          label: "条款覆盖率",
          value: `${pct}%`,
          unit: "",
          tone: pct >= 50 ? "ok" : "warn",
          note: pct >= 50 ? "解析产出 / 原文非空白字数" : "偏低：长文档解析产出是摘要，字数少于原文属常态",
        }

  const cross = (tenderText ?? "").trim() ? crossCheckScores(tenderText, report) : null
  const missing = cross?.missingInReport.length ?? null
  const missingStat: QualityStat =
    missing == null
      ? { id: "missing", label: "疑似漏抽", value: "—", unit: "", tone: "muted", note: "没有招标原文，无法本地比对" }
      : {
          id: "missing",
          label: "疑似漏抽评分项",
          value: String(missing),
          unit: "条",
          tone: missing > 0 ? "warn" : "ok",
          note: "本地扫描招标原文 vs 解析报告（零 AI 费用）",
        }

  const tables = summarizeTenderTables(input.tenderTables)
  const tableStat: QualityStat =
    tables.total === 0
      ? {
          id: "tables",
          label: "表格识别",
          value: "—",
          unit: "",
          tone: "muted",
          note: "上传 docx 时本地还原的表格；本项目的原文里没有可还原表格",
        }
      : {
          id: "tables",
          label: "表格识别",
          value: String(tables.total),
          unit: "张",
          tone: "ok",
          note: `采购清单 ${tables.purchaseList} · 技术参数 ${tables.techParams}`,
        }

  return [
    coverage,
    missingStat,
    tableStat,
    {
      id: "pagetrace",
      label: "页码可回溯",
      value: "未接入",
      unit: "",
      tone: "muted",
      note: "页码未落库，条款按编号/章节定位；不假装每条都带页码",
    },
  ]
}

export type BuildParseConfirmInput = {
  report: ParseReport | null | undefined
  tenderText: string
  tenderTables?: TenderTableRecord[] | null
  /** 条款覆盖进度（② 的逐条确认与「条款覆盖矩阵」共用同一份 localStorage） */
  progress: ComplianceProgressMap
}

export function buildParseConfirmModel(input: BuildParseConfirmInput): ParseConfirmModel {
  const { report, tenderText, progress } = input
  const rows: ComplianceRow[] = buildComplianceRows(report ?? null)

  const byKind = {
    void: rows.filter((r) => r.kind === "void"),
    star: rows.filter((r) => r.kind === "star"),
    qual: rows.filter((r) => r.kind === "qual"),
    comp: rows.filter((r) => r.kind === "comp"),
  }
  // 逐条确认表收全部四类（原型「废标条款 12 条 = 资格性 5 + 符合性 4 + 格式性 3」同一口径）：
  // 资格不符、符合性负偏离、★ 负偏离与废标条款一样，漏一条就是出局，不能只确认 void 一类。
  // 级别按后果分档——废标项/符合性检查 = 阻断，资格[强制]/★▲ = 强制。
  const isConfirmed = (id: string) => {
    const st = progress[id]?.status
    return st === "covered" || st === "na"
  }
  const confirmRows: VoidConfirmRow[] = rows
    .map((r) => ({
      id: r.id,
      text: r.text,
      citation: citationOf(r.text),
      level: r.kind === "void" || r.kind === "comp" ? ("阻断" as const) : ("强制" as const),
    }))
    .sort((a, b) => Number(isConfirmed(a.id)) - Number(isConfirmed(b.id)))
  const pendingCount = confirmRows.filter((r) => !isConfirmed(r.id)).length
  const confirmedCount = confirmRows.length - pendingCount

  const score = scoreSplitOf(report)
  const params = applyChoices(extractParamCandidates(tenderText ?? ""), report?.param_match_choices)
  const paramSummary = summarizeParams(params)
  const nodes = bidNodePairs(report)
  const systemCount = nonEmptyLines(sectionText(report ?? null, "req_structure")).length
  const tables = summarizeTenderTables(input.tenderTables)

  const cards: ConfirmCard[] = [
    {
      id: "void",
      label: "废标项",
      tone: "red",
      value: rows.length || null,
      tags: [
        ...(pendingCount > 0 ? [{ label: `${pendingCount} 条待确认`, tone: "red" as const }] : []),
        ...(confirmedCount > 0 ? [{ label: `${confirmedCount} 已确认`, tone: "green" as const }] : []),
      ],
      foot: rows.length
        ? `资格性 ${byKind.qual.length} · 符合性 ${byKind.comp.length} · ★▲ ${byKind.star.length}`
        : "解析报告里还没有废标/资格/符合性/★▲ 条款",
    },
    {
      id: "score",
      label: "评分办法",
      tone: "blue",
      value: score.itemCount || null,
      tags: score.hasScoring
        ? [
            { label: "已拆出", tone: "green" },
            {
              label: `技术 ${score.techSum} / 商务 ${score.bizSum}${score.priceSum != null ? ` / 价格 ${score.priceSum}` : ""}`,
              tone: "gray",
            },
          ]
        : [],
      foot: score.hasScoring
        ? `${score.itemCount} 个评分点已拆出，③ 大纲按此对齐`
        : "解析报告里还没有评分办法，③ 大纲无法对齐评分点",
    },
    {
      id: "param",
      label: "技术参数",
      tone: "amber",
      value: params.length || null,
      tags: params.length
        ? [
            ...(params.filter((r) => r.substantive).length > 0
              ? [{ label: `★ ${params.filter((r) => r.substantive).length} 条`, tone: "red" as const }]
              : []),
            ...(paramSummary.untyped > 0 ? [{ label: `${paramSummary.untyped} 条待研判`, tone: "amber" as const }] : []),
            ...(paramSummary.untyped === 0 && paramSummary.typed > 0
              ? [{ label: "已全部研判", tone: "green" as const }]
              : []),
          ]
        : [],
      foot: params.length
        ? `表格 ${tables.total} 张 · ${systemCount} 个系统分组`
        : "招标原文里没扫到带 ★/▲ 标注的技术参数行",
    },
    {
      id: "node",
      label: "时间节点",
      tone: "purple",
      value: nodes.length || null,
      tags: nodes.length
        ? [
            { label: "已提取", tone: "green" },
            { label: `最近 ${nodes[0].label} ${truncate(nodes[0].value, 14)}`, tone: "gray" },
          ]
        : [],
      foot: nodes.length ? nodes.map((n) => n.label).slice(0, 5).join(" / ") : "解析报告里还没有投标关键节点",
    },
  ]

  const directory: DirNode[] = [
    { id: "void", label: "废标条款", count: byKind.void.length, focusKey: "void_items" },
    { id: "qual", label: "资格性审查", count: byKind.qual.length, indent: true, focusKey: "qualification" },
    { id: "comp", label: "符合性检查", count: byKind.comp.length, indent: true, focusKey: "compliance" },
    { id: "star", label: "★/▲ 条款", count: byKind.star.length, indent: true, focusKey: "star_clauses" },
    { id: "score", label: "评分办法", count: score.itemCount, focusKey: "tech_score" },
    { id: "param", label: "技术参数", count: params.length, focusKey: "delivery_req" },
    { id: "node", label: "时间节点", count: nodes.length, focusKey: "bid_nodes" },
    {
      id: "contract",
      label: "合同条款",
      count: nonEmptyLines(sectionText(report ?? null, "contract_terms")).length,
      focusKey: "contract_terms",
    },
    {
      id: "rest",
      label: "其他解析项",
      count: Math.max(0, (report?.sections ?? []).length - 7),
      focusKey: null,
    },
  ]

  return {
    cards,
    score,
    directory,
    quality: qualityStatsOf({ report, tenderText, tenderTables: input.tenderTables }),
    rows: confirmRows,
    confirmedCount,
    pendingCount,
    totalRows: confirmRows.length,
    systemCount,
  }
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** 供 ② 屏页头/脚注复用：某 section 的中文名（报告自带 title 优先） */
export function sectionTitleOf(report: ParseReport | null | undefined, key: string): string {
  const sec = (report?.sections ?? []).find((s) => s.key === key)
  return sec?.title?.trim() || parseSectionTitle(key)
}
