// 医疗信息化重点话题分桶（t136 C 节词表落地，纯函数，不写库）。
// 供审阅第一屏「要闻」四栏、话题徽标、今日工作加分与数字卡计算复用。

export const INTEL_TOPIC_KEYS = [
  "评级测评",
  "智慧医院/互联网医院",
  "核心系统",
  "等保与安全",
  "信创国产化",
  "医保信息化",
  "政策规划",
  "招标中标",
  "竞品厂商",
  "AI/大模型",
  "区域卫生/公卫",
] as const

export type IntelTopicKey = (typeof INTEL_TOPIC_KEYS)[number]

export type HeadlineColumnKey = "policy" | "bid" | "competitor" | "media"

export type BidKind = "software" | "mixed" | "hardware" | "other"

const TOPIC_RES: { key: IntelTopicKey; re: RegExp }[] = [
  { key: "评级测评", re: /电子病历.{0,8}(评级|分级|应用水平)|互联互通|智慧服务.{0,4}(评级|分级|测评)|智慧管理.{0,4}(评级|分级)|成熟度测评|分级评价/i },
  { key: "智慧医院/互联网医院", re: /智慧医院|互联网医院|智慧病房|数字医院|智慧服务|未来医院/i },
  { key: "核心系统", re: /\bHIS\b|\bEMR\b|\bLIS\b|\bPACS\b|\bRIS\b|\bHRP\b|\bCDR\b|集成平台|医院信息系统|电子病历|临床决策|CDSS|数据中心|一体化/i },
  { key: "等保与安全", re: /等保|等级保护|网络安全|信息安全|数据安全|密评|密码应用/i },
  { key: "信创国产化", re: /信创|国产化/i },
  { key: "医保信息化", re: /医保|DRG|DIP/i },
  { key: "政策规划", re: /卫健委|卫生健康委|卫生健康局|国家卫健|国务院|通知|意见|办法|规划|标准|指南|条例|政策/i },
  { key: "招标中标", re: /招标|中标|采购|成交|询价|磋商|谈判|单一来源|比选|遴选|入围/i },
  { key: "竞品厂商", re: /卫宁|创业慧康|东华|东软|万达信息|嘉和美康|和仁|麦迪|久远银海|讯飞医疗|医渡|零氪|联众|中联|智业|众阳|望海|京东健康|阿里健康|腾讯健康|金蝶医疗|用友医疗|天健|方正|易联众|山大地纬|新开普|岱嘉|海泰|迈瑞|百度灵医/i },
  { key: "AI/大模型", re: /人工智能|\bAI\b|大模型|DeepSeek|智能体|AIGC/i },
  { key: "区域卫生/公卫", re: /区域卫生|全民健康|医共体|医联体|公共卫生|疾控|基层/i },
]

/** 标题命中的重点话题（一条可命中多个，顺序与 C 节词表一致） */
export function matchIntelTopics(title: string): IntelTopicKey[] {
  const t = String(title || "")
  if (!t) return []
  return TOPIC_RES.filter((x) => x.re.test(t)).map((x) => x.key)
}

const FOCUS_TOPICS: IntelTopicKey[] = [
  "评级测评",
  "智慧医院/互联网医院",
  "核心系统",
  "等保与安全",
  "信创国产化",
  "医保信息化",
  "政策规划",
  "竞品厂商",
]

/** 命中「医疗信息化重点」（不含纯招标/纯 AI/公卫弱信号） */
export function hasFocusTopic(title: string): boolean {
  const hit = new Set(matchIntelTopics(title))
  return FOCUS_TOPICS.some((k) => hit.has(k))
}

/** 纯 AI 泛资讯：只命中 AI 桶，或几乎只命中 AI（可同时命中招标但这种媒体观点仍算泛资讯时需其它重点） */
export function isPureAiGeneric(title: string, itemType = ""): boolean {
  const topics = matchIntelTopics(title)
  if (!topics.includes("AI/大模型")) return false
  const others = topics.filter((k) => k !== "AI/大模型" && k !== "招标中标")
  if (others.length > 0) return false
  if (itemType === "policy" || itemType === "bid" || itemType === "competitor") return false
  return true
}

const SOFTWARE_RE = /信息化|数字化|智慧|系统|软件|平台|HIS|EMR|LIS|PACS|HRP|集成|数据中心|电子病历|运维服务|数据库|云|网络信息|信息安全|等保|信创/i
const HARDWARE_RE = /电脑|台式机|笔记本|显示器|打印机|复印机|耗材|试剂|病床|家具|窗帘|标识标牌|呼吸机|监护仪|麻醉机|超声|磁共振|内窥镜|CT机|DR机|服务器机柜|空调|电梯/i

export function classifyBidKind(title: string, itemType = ""): BidKind {
  if (itemType && itemType !== "bid") return "other"
  const t = String(title || "")
  const soft = SOFTWARE_RE.test(t)
  const hard = HARDWARE_RE.test(t)
  if (soft && hard) return "mixed"
  if (soft) return "software"
  if (hard) return "hardware"
  return itemType === "bid" ? "other" : "other"
}

/** 要闻卡徽标：优先评级/等保/HIS 等，避免展示「采购/临床」这类泛标签 */
export function primaryTopicBadge(title: string): string | null {
  const t = String(title || "")
  const topics = matchIntelTopics(t)
  if (topics.includes("评级测评")) {
    if (/互联互通/.test(t)) return "互联互通"
    return "评级"
  }
  if (topics.includes("等保与安全")) {
    if (/等保|等级保护/.test(t)) return "等保"
    if (/数据安全/.test(t)) return "数据安全"
    return "网络安全"
  }
  if (topics.includes("核心系统")) {
    if (/\bHIS\b/i.test(t)) return "HIS"
    if (/\bEMR\b|电子病历/i.test(t)) return "EMR"
    if (/\bLIS\b/i.test(t)) return "LIS"
    if (/\bPACS\b/i.test(t)) return "PACS"
    if (/\bHRP\b/i.test(t)) return "HRP"
    if (/集成平台/.test(t)) return "集成平台"
    return "核心系统"
  }
  if (topics.includes("医保信息化")) return "医保"
  if (topics.includes("信创国产化")) return /信创/.test(t) ? "信创" : "国产化"
  if (topics.includes("智慧医院/互联网医院")) return /互联网医院/.test(t) ? "互联网医院" : "智慧医院"
  if (topics.includes("政策规划")) return "政策"
  if (topics.includes("竞品厂商")) return "竞品"
  if (topics.includes("区域卫生/公卫")) return "医共体"
  return null
}

export interface HeadlineItem {
  id: string
  title: string
  item_type?: string
  published_at?: string
  created?: string
  my_status?: string
  item_status?: string
}

export interface HeadlineColumns<T extends HeadlineItem> {
  policy: T[]
  bid: T[]
  competitor: T[]
  media: T[]
}

function recency(item: HeadlineItem): number {
  const raw = item.published_at || item.created || ""
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

/** 审阅第一屏四栏要闻，每栏最多 limit 条 */
export function selectHeadlineColumns<T extends HeadlineItem>(
  items: T[],
  limit = 5,
): HeadlineColumns<T> {
  const used = new Set<string>()
  const take = (pred: (it: T) => boolean): T[] => {
    const out: T[] = []
    const ranked = items
      .filter(pred)
      .slice()
      .sort((a, b) => recency(b) - recency(a))
    for (const it of ranked) {
      if (used.has(it.id)) continue
      used.add(it.id)
      out.push(it)
      if (out.length >= limit) break
    }
    return out
  }

  const policy = take(
    (it) =>
      it.item_type === "policy" ||
      matchIntelTopics(it.title).some((k) => k === "评级测评" || k === "政策规划" || k === "医保信息化"),
  )
  const bid = take((it) => {
    if (it.item_type !== "bid") return false
    const kind = classifyBidKind(it.title, it.item_type)
    return kind === "software" || kind === "mixed"
  })
  const competitor = take(
    (it) => it.item_type === "competitor" || matchIntelTopics(it.title).includes("竞品厂商"),
  )
  const media = take((it) => {
    if (it.item_type !== "media" && it.item_type !== "" && it.item_type !== "tech") return false
    if (isPureAiGeneric(it.title, it.item_type || "media")) return false
    return matchIntelTopics(it.title).some(
      (k) => k === "智慧医院/互联网医院" || k === "核心系统" || k === "等保与安全" || k === "信创国产化",
    )
  })
  return { policy, bid, competitor, media }
}

/** GET /api/intel/items 的 since 参数必须是 YYYY-MM-DD */
export function intelSinceDate(days: number, now = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function buildIntelItemsQueryString(opts: {
  item_status?: string
  item_type?: string
  since?: string
  page?: number
  per_page?: number
}): string {
  const qs = new URLSearchParams()
  qs.set("item_status", opts.item_status || "pending,confirmed")
  if (opts.item_type === "policy" || opts.item_type === "competitor" || opts.item_type === "bid" || opts.item_type === "media") {
    qs.set("item_type", opts.item_type)
  }
  if (opts.since && /^20\d{2}-\d{2}-\d{2}$/.test(opts.since)) qs.set("since", opts.since)
  qs.set("page", String(opts.page && opts.page > 0 ? opts.page : 1))
  const per = opts.per_page && opts.per_page > 0 ? Math.min(opts.per_page, 50) : 50
  qs.set("per_page", String(per))
  return qs.toString()
}

export interface IntelSourceHealthRow {
  enabled: boolean
  last_status: string
  fetched_count?: number
}

export function summarizeSourceHealth(sources: IntelSourceHealthRow[]): {
  enabledCount: number
  sourceCount: number
  enabledErrorCount: number
  silentEmptyCount: number
} {
  const sourceCount = sources.length
  const enabled = sources.filter((s) => s.enabled)
  const enabledErrorCount = enabled.filter((s) => s.last_status === "error").length
  const silentEmptyCount = enabled.filter(
    (s) => s.last_status === "ok" && (s.fetched_count ?? 0) === 0,
  ).length
  return {
    enabledCount: enabled.length,
    sourceCount,
    enabledErrorCount,
    silentEmptyCount,
  }
}
