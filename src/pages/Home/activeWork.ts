import { BID_STAGE_LABEL } from "@/pages/CustomerManagement/customerTypes"
import { DOC_STATUS_LABEL, type DocStatus } from "@/pages/SolutionStudio/solutionTypes"
import { DECK_STATUS_LABEL, type DeckStatus } from "@/pages/PptQuote/pptQuoteTypes"

// ---------------------------------------------------------------------------
// R196 驾驶舱「进行中的项目」数据打通（docs/13 §3.2）：
// 站内真实生产活动分散在标书 / 方案 / PPT / 报价四个工作台，而首页原「进行中的
// 项目」卡读的是独立的 projects 手工清单，常年空置、名不副实。本模块把四个集合
// 的「进行中」条目纯客户端聚合为统一只读视图（零后端 / 零新 collection / 不写任何
// 数据，只做读取与跳转），供首页只读卡消费。取数与逻辑分离，纯函数可脱离后端单测。
// R302（close r281-active-work-per-entity-cap）修正一处口径谎报：取数按「最近更新前 30 条」取样，
// 样本可能小于全库，而旧注释与界面文案都称计数为「真实总数」。现把 list 路由回显的服务端总数
// （totalItems）一起带进统计：报价无状态字段、全量计入，直接采用服务端总数出精确值；标书 / 方案 /
// PPT 的「进行中」要按客户端逐条判状态，样本没覆盖全库时如实标记下限，由界面补「+」并说明取样口径。
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

/**
 * R302：四个集合的**服务端真总数**（list 路由在 totalItems 里回显的、按用户过滤后的全库条数）。
 * -1 = 服务端未回显 / 请求失败，按「未知」保守处理（不判截断，维持旧口径）。
 */
export type ActiveWorkServerTotals = Record<ActiveWorkKind, number>

export const UNKNOWN_SERVER_TOTALS: ActiveWorkServerTotals = { bid: -1, solution: -1, deck: -1, quote: -1 }

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
  /** R302：该工作台的样本未覆盖全库（服务端总数 > 已加载条数）→ 计数只是**下限** */
  truncated: Record<ActiveWorkKind, boolean>
  /** R302：标书/方案/PPT 三个计数是否都是精确值（报价恒精确，见下） */
  exact: boolean
}

/**
 * 进行中口径与 buildActiveWork 完全一致。R302 起可接受服务端总数，把「取样下限」如实带出：
 *  - 报价无成稿状态字段、全量计入 → 服务端总数就是真值，直接采用（30 条之外的历史报价不再漏计）；
 *  - 标书 / 方案 / PPT 的「进行中」要逐条判状态 → 样本未覆盖全库时计数只是下限（truncated=true）；
 *  - totals 缺省（-1 未知）时不判截断，与 R302 之前的调用口径逐字一致。
 */
export function countActiveWork(
  rows: ActiveWorkSourceRows,
  totals: ActiveWorkServerTotals = UNKNOWN_SERVER_TOTALS,
): ActiveWorkStats {
  const byKind: Record<ActiveWorkKind, number> = { bid: 0, solution: 0, deck: 0, quote: 0 }
  for (const b of rows.bids) if (isBidActive(b)) byKind.bid++
  for (const s of rows.solutions) if (isSolutionActive(s)) byKind.solution++
  for (const d of rows.decks) if (isDeckActive(d)) byKind.deck++
  // 报价无成稿状态字段：与 buildActiveWork 一致全量纳入，因而服务端总数即精确值（取两者较大防回退）
  const srvQuote = totals.quote ?? -1
  byKind.quote = srvQuote >= 0 ? Math.max(srvQuote, rows.quotes.length) : rows.quotes.length
  const total = byKind.bid + byKind.solution + byKind.deck + byKind.quote
  const truncated: Record<ActiveWorkKind, boolean> = {
    bid: (totals.bid ?? -1) > rows.bids.length,
    solution: (totals.solution ?? -1) > rows.solutions.length,
    deck: (totals.deck ?? -1) > rows.decks.length,
    quote: false,
  }
  const exact = !truncated.bid && !truncated.solution && !truncated.deck
  return { total, byKind, truncated, exact }
}

const KIND_ORDER: ActiveWorkKind[] = ["bid", "solution", "deck", "quote"]

/** 分工作台明细可读串（跳过 0 项），如「标书 3 · PPT 2 · 报价 1」；全 0 返回空串；R302 下限项带「+」 */
export function formatActiveWorkBreakdown(
  byKind: Record<ActiveWorkKind, number>,
  truncated?: Partial<Record<ActiveWorkKind, boolean>>,
): string {
  return KIND_ORDER
    .filter((k) => byKind[k] > 0)
    .map((k) => `${ACTIVE_WORK_KIND_LABEL[k]} ${byKind[k]}${truncated?.[k] ? "+" : ""}`)
    .join(" · ")
}

/**
 * R302 截断口径的中文说明（悬停 / 提示行用）：点名哪些工作台全库条数超出样本；精确时返回空串。
 * 全库数取「服务端总数与样本量的较大值」，防服务端未回显 totalItems 时说出「全库 0 条」这种谎话。
 */
export function formatActiveWorkCaveat(
  stats: ActiveWorkStats,
  totals: ActiveWorkServerTotals,
  sampleSize: number,
): string {
  const hit = KIND_ORDER.filter((k) => stats.truncated[k])
  if (!hit.length) return ""
  const detail = hit.map((k) => `${ACTIVE_WORK_KIND_LABEL[k]}全库 ${Math.max(totals[k], sampleSize)} 条`).join("、")
  return `${detail}，当前只按最近更新 ${sampleSize} 条取样统计，数字是下限`
}

/**
 * R302 取数编排（注入 get，可脱离 React 与后端单测）：并行拉四个集合最近 sampleSize 条，并把 list
 * 路由回显的 totalItems 读成服务端总数——旧实现只看 items，服务端总数被丢弃，才有「最多 30×4 却称
 * 真实总数」的静默截断。单卡失败 / 字段缺失一律降级为空数组 + 未知总数(-1)，绝不抛错阻塞首页
 * （沿用旧语义：pbJsonGet 失败返回 null）。
 */
export async function loadActiveWork(
  get: (path: string) => Promise<unknown>,
  userId: string,
  sampleSize: number,
): Promise<{ rows: ActiveWorkSourceRows; totals: ActiveWorkServerTotals }> {
  const q = encodeURIComponent(userId)
  const grab = async <T>(path: string): Promise<{ items: T[]; total: number }> => {
    try {
      const env = (await get(path)) as { items?: T[]; totalItems?: number } | null | undefined
      const raw = env?.totalItems
      const total = typeof raw === "number" && raw >= 0 ? raw : -1
      return { items: env?.items ?? [], total }
    } catch {
      return { items: [], total: -1 }
    }
  }
  const [bid, solution, deck, quote] = await Promise.all([
    grab<BidLike>(`/api/bid_projects?rh_user_id=${q}&perPage=${sampleSize}&sort=-updated`),
    grab<SolutionLike>(`/api/solutions?rh_user_id=${q}&perPage=${sampleSize}&sort=-updated`),
    grab<DeckLike>(`/api/ppt_decks?rh_user_id=${q}&perPage=${sampleSize}&sort=-updated`),
    grab<QuoteLike>(`/api/quotes?rh_user_id=${q}&perPage=${sampleSize}&sort=-updated`),
  ])
  return {
    rows: { bids: bid.items, solutions: solution.items, decks: deck.items, quotes: quote.items },
    totals: { bid: bid.total, solution: solution.total, deck: deck.total, quote: quote.total },
  }
}
