/**
 * R56：解析报告「三栏化」的数据整形（纯函数，零 AI、零契约变更）。
 *
 * 动机（对标喜鹊标书的解析首屏）：我们的解析报告此前一屏就是 21 个解析项的清单，
 * 用户要自己在里面找「项目基本信息在哪、评分怎么给、技术要求有哪些」。喜鹊的做法是
 * 首屏只给三栏——基本信息 / 评分要求 / 招标需求——明细收进二级视图。
 *
 * 本模块只做**分组与取样**，不改任何解析契约：同一份 ParseSection 既供三栏摘要，
 * 也供既有明细列表；有结构化字段的项直接出「标签→值」（信息卡类），逐条类出前 N 条样本 + 总条数。
 * 每一栏的每个卡片都带 section key，点击即回到既有明细视图并选中该项——不丢任何能力。
 */
import {
  extractScoringFromText,
  parseSectionFields,
  sectionStatus,
  PARSE_STATUS_LABEL,
  type ParseReport,
  type ParseSection,
  type ParseSectionStatus,
} from "./bidTypes"

/** 一栏里的一张卡片 */
export type SummaryCard = {
  /** 对应的解析项 key（点击进明细时用它选中） */
  key: string
  title: string
  status: ParseSectionStatus
  statusLabel: string
  /** 有结构化字段时：标签→值（信息卡类） */
  fields: { label: string; value: string }[]
  /** 无结构化字段时：逐条样本（最多 sample 条） */
  lines: string[]
  /** 逐条类总条数（样本之外还有多少条看得见） */
  count: number
  /** 附加说明（如评分合计） */
  meta?: string
}

export type SummaryColumnId = "basic" | "scoring" | "requirements"

export type SummaryColumn = {
  id: SummaryColumnId
  title: string
  hint: string
  cards: SummaryCard[]
}

/** 三栏的分组口径（key 归哪一栏；未列出的 key 一律进「招标需求」兜底，不丢项） */
const COLUMN_OF: Record<string, SummaryColumnId> = {
  overview: "basic",
  project_info: "basic",
  purchaser_info: "basic",
  agency_info: "basic",
  bid_nodes: "basic",
  bid_deposit: "basic",
  bid_open_req: "basic",
  lots: "basic",
  tech_score: "scoring",
  biz_score: "scoring",
  eval_req: "scoring",
}

const COLUMN_META: { id: SummaryColumnId; title: string; hint: string }[] = [
  { id: "basic", title: "基本信息", hint: "项目/甲方/代理/时间节点/保证金" },
  { id: "scoring", title: "评分要求", hint: "技术分与商务分怎么给" },
  { id: "requirements", title: "招标需求", hint: "技术、服务、资格、废标与格式要求" },
]

const SAMPLE_LINES = 4

function cardOf(sec: ParseSection, sample: number): SummaryCard {
  const status = sectionStatus(sec)
  const fields = parseSectionFields(sec)
  const lines = sec.content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const card: SummaryCard = {
    key: sec.key,
    title: sec.title,
    status,
    statusLabel: PARSE_STATUS_LABEL[status] ?? status,
    fields,
    // 已有结构化字段时不重复出样本（字段就是全部信息）；否则给样本 + 总条数
    lines: fields.length ? [] : lines.slice(0, sample),
    count: lines.length,
  }
  if (sec.key === "tech_score" || sec.key === "biz_score") {
    const items = extractScoringFromText(sec.content)
    const total = items.reduce((a, x) => a + (Number(x.score) || 0), 0)
    card.count = items.length
    if (items.length) card.meta = `${items.length} 项 · 合计 ${Math.round(total * 10) / 10} 分`
  }
  return card
}

/**
 * 解析报告 → 三栏摘要。
 * 空报告返回三栏空壳（面板据此显示"还没有解析结果"），不抛错。
 */
export function buildParseSummary(report: ParseReport | null, opts?: { sample?: number }): SummaryColumn[] {
  const sample = Math.max(1, opts?.sample ?? SAMPLE_LINES)
  const sections = report?.sections ?? []
  const columns: SummaryColumn[] = COLUMN_META.map((m) => ({ ...m, cards: [] }))
  const byId = new Map(columns.map((c) => [c.id, c]))
  for (const sec of sections) {
    const id = COLUMN_OF[sec.key] ?? "requirements"
    byId.get(id)?.cards.push(cardOf(sec, sample))
  }
  return columns
}

/** 三栏摘要的诊断行（面板顶部一句话）：已解析项 / 总数 / 失败项 */
export function summarizeParseHealth(report: ParseReport | null): {
  total: number
  ok: number
  failed: number
  missing: number
  text: string
} {
  const sections = report?.sections ?? []
  let ok = 0
  let failed = 0
  let missing = 0
  for (const s of sections) {
    const st = sectionStatus(s)
    if (st === "ok") ok += 1
    else if (st === "failed") failed += 1
    else missing += 1
  }
  const bits = [`共 ${sections.length} 项`, `已解析 ${ok} 项`]
  if (failed) bits.push(`失败 ${failed} 项`)
  if (missing) bits.push(`未解析/未提及 ${missing} 项`)
  return { total: sections.length, ok, failed, missing, text: bits.join(" · ") }
}
