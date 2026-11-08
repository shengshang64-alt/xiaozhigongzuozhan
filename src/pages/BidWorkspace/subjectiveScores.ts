// UX-R3: S12 主观分逐条确认 2026-11-08
//
// 背景：招标文件里的主观分（isSubjective: true，含「得 N-M 分」/优秀·良·一般·差/方案质量·
// 完整性·合理性等评判词，见 bidTypes.classifySubjective）是评标专家**人工打分**的部分——
// AI 能帮你写，但「每一分打算拿几分、拿什么材料支撑」必须人逐条确认，不能 AI 默认就过。
//
// 本模块只做两件事：① 从解析报告提取主观分清单 + 与章节落点关联；② 读写确认状态。
// 纯函数、零 AI、零网络；确认状态落 bid_projects.subjective_confirmations（json 列）。
import { numberScoringItems, type BidProjectRecord, type NumberedScoringItem } from "./bidTypes"

/** 单条主观分的确认记录（键=评分项稳定编号 R1/B1…） */
export type SubjectiveConfirmation = {
  /** 已勾选「已确认应对策略」 */
  confirmed: boolean
  /** 我们怎么拿这条的分（人工填写） */
  strategy: string
  /** 确认时间（ISO）；未确认空串 */
  confirmed_at: string
}

/** 项目记录上的确认表；缺省/损坏一律容错为空表（老项目零行为变化） */
export type SubjectiveConfirmations = Record<string, SubjectiveConfirmation>

export function normalizeSubjectiveConfirmations(raw: unknown): SubjectiveConfirmations {
  if (!raw || typeof raw !== "object") return {}
  const out: SubjectiveConfirmations = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k ?? "").trim()
    if (!id || !v || typeof v !== "object") continue
    const r = v as Record<string, unknown>
    out[id] = {
      confirmed: r.confirmed === true,
      strategy: String(r.strategy ?? "").slice(0, 1000),
      confirmed_at: String(r.confirmed_at ?? ""),
    }
  }
  return out
}

/** 一条主观分的展示模型：评分项 + 落点章节 + 当前确认状态 */
export type SubjectiveScoreRow = {
  id: string
  /** 评分项名（NumberedScoringItem.item） */
  item: string
  score: number
  /** 评分标准原文（criteria；空串表示解析未给出细则） */
  criteria: string
  category: "tech" | "biz"
  /** 已落点的章节标题（同名/评分标注命中；未落点为空数组） */
  landedTitles: string[]
  confirmation: SubjectiveConfirmation
}

const EMPTY_CONFIRMATION: SubjectiveConfirmation = { confirmed: false, strategy: "", confirmed_at: "" }

/** 评分项 → 是否已有章节承接（按 [响应:Rx] 标注与标题包含两种既有口径） */
function landedChapterTitles(item: NumberedScoringItem, chapters: { title?: string; content?: string }[]): string[] {
  const out: string[] = []
  const idTag = `[响应:${item.id}]`
  for (const c of chapters) {
    const title = String(c.title ?? "")
    const content = String(c.content ?? "")
    // ① 内容里带 [响应:Rx] 标注（R292 的方括号口径）
    if (content.includes(idTag)) {
      out.push(title)
      continue
    }
    // ② 章节标题与评分项名有足够长的公共片段（≥6 字，与 outlineChapterScoringAlignment 同量级）
    const name = item.item.replace(/[（(].*?[）)]/g, "").trim()
    if (name.length >= 4 && title.includes(name)) out.push(title)
  }
  return out.slice(0, 3)
}

/**
 * 提取项目里全部主观分项（只列 isSubjective=true；客观分不出现）。
 * 数据源与评分矩阵/交卷体检同源：numberScoringItems(parse_report)。
 */
export function buildSubjectiveScoreRows(rec: Partial<BidProjectRecord> | null): SubjectiveScoreRow[] {
  if (!rec) return []
  const items = numberScoringItems(rec.parse_report ?? null).filter((it) => it.isSubjective)
  const chapters = Array.isArray(rec.bid_chapters) ? rec.bid_chapters : []
  const confirmations = normalizeSubjectiveConfirmations(rec.subjective_confirmations)
  return items.map((it) => ({
    id: it.id,
    item: it.item,
    score: it.score,
    criteria: it.criteria,
    category: it.category,
    landedTitles: landedChapterTitles(it, chapters),
    confirmation: confirmations[it.id] ?? EMPTY_CONFIRMATION,
  }))
}

/** 未确认条数（面板顶部徽标 + 交卷清单用） */
export function countUnconfirmedSubjective(rec: Partial<BidProjectRecord> | null): { total: number; unconfirmed: number } {
  const rows = buildSubjectiveScoreRows(rec)
  return { total: rows.length, unconfirmed: rows.filter((r) => !r.confirmation.confirmed).length }
}

/** 写单条确认（返回新表，不修改入参——交给 updateProject 落库） */
export function withConfirmation(
  raw: unknown,
  id: string,
  patch: Partial<SubjectiveConfirmation>,
): SubjectiveConfirmations {
  const cur = normalizeSubjectiveConfirmations(raw)
  const prev = cur[id] ?? EMPTY_CONFIRMATION
  const next: SubjectiveConfirmation = {
    confirmed: patch.confirmed ?? prev.confirmed,
    strategy: patch.strategy !== undefined ? patch.strategy.slice(0, 1000) : prev.strategy,
    confirmed_at: patch.confirmed_at !== undefined ? patch.confirmed_at : prev.confirmed_at,
  }
  // 勾选确认时补时间戳；取消确认时清空时间戳（避免「未确认但有确认时间」的矛盾态）
  if (patch.confirmed === true && !next.confirmed_at) next.confirmed_at = new Date().toISOString()
  if (patch.confirmed === false) next.confirmed_at = ""
  return { ...cur, [id]: next }
}
