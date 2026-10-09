import { BID_STAGE_LABEL } from "@/pages/CustomerManagement/customerTypes"
import { DOC_STATUS_LABEL, type DocStatus } from "@/pages/SolutionStudio/solutionTypes"
import { DECK_STATUS_LABEL, type DeckStatus } from "@/pages/PptQuote/pptQuoteTypes"

// ---------------------------------------------------------------------------
// R196 驾驶舱「进行中的项目」数据打通（docs/13 §3.2）：
// 站内真实生产活动分散在标书 / 方案 / PPT / 报价四个工作台，而首页原「进行中的
// 项目」卡读的是独立的 projects 手工清单，常年空置、名不副实。本模块把四个集合
// 的「进行中」条目纯客户端聚合为统一只读视图（零后端 / 零新 collection / 不写任何
// 数据，只做读取与跳转），供首页只读卡消费。取数与逻辑分离，纯函数可脱离后端单测。
// ---------------------------------------------------------------------------

export type ActiveWorkKind = "bid" | "solution" | "deck" | "quote"

export type ActiveWorkItem = {
  key: string
  kind: ActiveWorkKind
  name: string
  subtitle: string
  statusLabel: string
  route: string
  updated: string
}

export type BidLike = {
  id: string
  project_name?: string
  hospital?: string
  stage?: string
  updated?: string
  archived?: boolean
  deleted_at?: string | null
}
export type SolutionLike = {
  id: string
  solution_name?: string
  hospital?: string
  doc_status?: string
  updated?: string
}
export type DeckLike = {
  id: string
  deck_name?: string
  audience?: string
  doc_status?: string
  updated?: string
}
export type QuoteLike = {
  id: string
  quote_name?: string
  ref_name?: string
  updated?: string
}

export type ActiveWorkSourceRows = {
  bids: BidLike[]
  solutions: SolutionLike[]
  decks: DeckLike[]
  quotes: QuoteLike[]
}

export const ACTIVE_WORK_KIND_LABEL: Record<ActiveWorkKind, string> = {
  bid: "标书",
  solution: "方案",
  deck: "PPT",
  quote: "报价",
}

/** 单卡最多展示的在制事项数：驾驶舱是总览不是清单，超出按更新时间截断 */
const MAX_ITEMS = 12

/** 已结束口径：软删除 / 已归档的标书都不算「进行中」 */
export function isBidActive(b: BidLike): boolean {
  if (b.deleted_at) return false
  if (b.archived === true) return false
  return b.stage !== "archived"
}

/** 方案 doc_status 缺省视为「大纲中」，仅 done 判为已结束 */
function isSolutionActive(s: SolutionLike): boolean {
  return (s.doc_status || "outline") !== "done"
}

/** PPT doc_status 缺省视为「草稿」，仅 done 判为已结束 */
function isDeckActive(d: DeckLike): boolean {
  return (d.doc_status || "draft") !== "done"
}

export function buildActiveWork(rows: ActiveWorkSourceRows): ActiveWorkItem[] {
  const out: ActiveWorkItem[] = []

  for (const b of rows.bids) {
    if (!isBidActive(b)) continue
    out.push({
      key: `bid_${b.id}`,
      kind: "bid",
      name: b.project_name || "未命名标书项目",
      subtitle: b.hospital || "",
      statusLabel: BID_STAGE_LABEL[b.stage || ""] || "进行中",
      route: `/bid-workspace?project=${b.id}`,
      updated: b.updated || "",
    })
  }
  for (const s of rows.solutions) {
    if (!isSolutionActive(s)) continue
    out.push({
      key: `solution_${s.id}`,
      kind: "solution",
      name: s.solution_name || "未命名方案",
      subtitle: s.hospital || "",
      statusLabel: DOC_STATUS_LABEL[(s.doc_status || "outline") as DocStatus] || "进行中",
      route: `/solution-studio?solution=${s.id}`,
      updated: s.updated || "",
    })
  }
  for (const d of rows.decks) {
    if (!isDeckActive(d)) continue
    out.push({
      key: `deck_${d.id}`,
      kind: "deck",
      name: d.deck_name || "未命名 PPT",
      subtitle: d.audience ? `汇报对象 · ${d.audience}` : "",
      statusLabel: DECK_STATUS_LABEL[(d.doc_status || "draft") as DeckStatus] || "进行中",
      route: `/ppt-quote?deck=${d.id}`,
      updated: d.updated || "",
    })
  }
  for (const q of rows.quotes) {
    // 报价无成稿状态字段：作为参考性在制事项全量纳入
    out.push({
      key: `quote_${q.id}`,
      kind: "quote",
      name: q.quote_name || "未命名报价",
      subtitle: q.ref_name ? `关联 ${q.ref_name}` : "",
      statusLabel: "报价参考",
      route: `/ppt-quote?quote=${q.id}`,
      updated: q.updated || "",
    })
  }

  out.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))
  return out.slice(0, MAX_ITEMS)
}

export type ActiveWorkStats = {
  total: number
  byKind: Record<ActiveWorkKind, number>
}

/** 进行中口径与 buildActiveWork 完全一致，但返回真实总数（不受单卡 12 上限截断）+ 分工作台明细 */
export function countActiveWork(rows: ActiveWorkSourceRows): ActiveWorkStats {
  const byKind: Record<ActiveWorkKind, number> = { bid: 0, solution: 0, deck: 0, quote: 0 }
  for (const b of rows.bids) if (isBidActive(b)) byKind.bid++
  for (const s of rows.solutions) if (isSolutionActive(s)) byKind.solution++
  for (const d of rows.decks) if (isDeckActive(d)) byKind.deck++
  // 报价无成稿状态字段：与 buildActiveWork 一致全量纳入
  byKind.quote = rows.quotes.length
  const total = byKind.bid + byKind.solution + byKind.deck + byKind.quote
  return { total, byKind }
}

const KIND_ORDER: ActiveWorkKind[] = ["bid", "solution", "deck", "quote"]

/** 分工作台明细可读串（跳过 0 项），如「标书 3 · PPT 2 · 报价 1」；全 0 返回空串 */
export function formatActiveWorkBreakdown(byKind: Record<ActiveWorkKind, number>): string {
  return KIND_ORDER
    .filter((k) => byKind[k] > 0)
    .map((k) => `${ACTIVE_WORK_KIND_LABEL[k]} ${byKind[k]}`)
    .join(" · ")
}
