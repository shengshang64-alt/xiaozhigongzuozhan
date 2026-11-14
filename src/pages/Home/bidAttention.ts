// 工作台总览「标书要事」纯逻辑。
//
// 与 BidNodesCard 同源：用 bid_projects 的 bid_open_date（src/lib/bidOpenDay），
// 不用首页手工 projects.deadline。
// 「还没写完」只用列表里已有的 stage 与章节是否有正文，不扫占位符、不算评分点，
// 避免把交卷自查里的「50 处待填写」搬到首页（那要拉齐每份标书的全文）。

import { MS_PER_DAY, bidOpenDayMs } from "@/lib/bidOpenDay"
import type { BidNodeRow } from "@/components/home/bidNodesLogic"

export const BID_ATTENTION_HORIZON_DAYS = 60
export const BID_ATTENTION_LIMIT = 5

const WRITING_STAGES = new Set(["pending_parse", "composing", "checking"])

const STAGE_LABEL: Record<string, string> = {
  pending_parse: "待解析",
  composing: "编制中",
  checking: "检查中",
  evaluated: "已评标",
  archived: "已归档",
}

export type BidAttentionRow = BidNodeRow & {
  bid_result?: string | null
  archived?: boolean
  bid_chapters?: ReadonlyArray<{ content?: string | null }>
}

export type BidAttentionItem = {
  id: string
  title: string
  /** 开标日，恒为 YYYY-MM-DD；未填或解析失败则为空 */
  date: string
  /** 距开标天数：未来为正，当天为 0，已过为负；没有可解析开标日则为 null */
  daysLeft: number | null
  stage: string
  stageLabel: string
  /** 有章节数组时给出「已写 x/y 章」或「尚未建章」；否则为空 */
  chapterLine: string
  href: string
}

export type BidAttention = {
  upcoming: BidAttentionItem[]
  incomplete: BidAttentionItem[]
  pendingResults: BidAttentionItem[]
}

function resultOf(row: BidAttentionRow): string {
  return String(row.bid_result ?? "").trim()
}

export function isPendingBidResult(result: string): boolean {
  return result === "" || result === "pending"
}

function isArchivedRow(row: BidAttentionRow): boolean {
  return row.archived === true || row.stage === "archived"
}

function chapterLineOf(row: BidAttentionRow): string {
  const chapters = row.bid_chapters
  if (!Array.isArray(chapters)) return ""
  if (chapters.length === 0) return "尚未建章"
  const written = chapters.filter((c) => String(c?.content ?? "").trim()).length
  return `已写 ${written}/${chapters.length} 章`
}

function toItem(row: BidAttentionRow, todayMs: number): BidAttentionItem {
  const raw = String(row.bid_open_date ?? "").trim()
  const openMs = raw ? bidOpenDayMs(raw) : Number.NaN
  const daysLeft = Number.isNaN(openMs) ? null : Math.round((openMs - todayMs) / MS_PER_DAY)
  const archived = isArchivedRow(row)
  const stage = String(row.stage ?? "")
  return {
    id: row.id,
    title: row.project_name || "未命名项目",
    date: Number.isNaN(openMs) ? "" : raw.slice(0, 10),
    daysLeft,
    stage,
    stageLabel: archived ? "已归档" : (STAGE_LABEL[stage] ?? (stage || "编制中")),
    chapterLine: chapterLineOf(row),
    href: `/bid-workspace?project=${encodeURIComponent(row.id)}`,
  }
}

function isIncomplete(row: BidAttentionRow): boolean {
  if (isArchivedRow(row) || row.deleted_at) return false
  const stage = String(row.stage ?? "")
  if (stage === "evaluated") return false
  return WRITING_STAGES.has(stage) || stage === ""
}

/**
 * 把投标项目分成三组：即将开标、还在编制、开标已过且结果未登记。
 * @param todayMs 今天当地零点毫秒（调用方注入，便于单测固定时钟）
 */
export function buildBidAttention(
  rows: readonly BidAttentionRow[],
  todayMs: number,
  horizonDays: number = BID_ATTENTION_HORIZON_DAYS,
): BidAttention {
  const upcoming: BidAttentionItem[] = []
  const incomplete: BidAttentionItem[] = []
  const pendingResults: BidAttentionItem[] = []

  for (const row of rows) {
    if (row.deleted_at) continue
    const item = toItem(row, todayMs)
    const archived = isArchivedRow(row)

    if (!archived && item.daysLeft != null && item.daysLeft >= 0 && item.daysLeft <= horizonDays) {
      upcoming.push(item)
    }

    if (!archived && item.daysLeft != null && item.daysLeft < 0 && isPendingBidResult(resultOf(row))) {
      pendingResults.push(item)
    }

    if (isIncomplete(row)) incomplete.push(item)
  }

  upcoming.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.title.localeCompare(b.title, "zh"))
  pendingResults.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.title.localeCompare(b.title, "zh"))
  incomplete.sort((a, b) => {
    const da = a.daysLeft ?? 9999
    const db = b.daysLeft ?? 9999
    return da - db || a.title.localeCompare(b.title, "zh")
  })

  return { upcoming, incomplete, pendingResults }
}
