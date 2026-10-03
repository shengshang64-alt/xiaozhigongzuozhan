// ---------------------------------------------------------------------------
// R102 quote-history-01 phase-2: 成交参考区间智能推荐（纯函数，零 AI，零新集合）
// 从 R79 沉淀的 won_sample 成交样本池，按「医院等级 + 床位数 + 模块组合」三维
// 相似度打分，给出相似项目成交总价的推荐区间与逐模块单价参考区间。
// ---------------------------------------------------------------------------
import type { QuoteRecord } from "./pptQuoteTypes"
import { quoteTotal } from "./pptQuoteTypes"

/** 当前报价的推荐维度（等级/床位/模块名集合） */
export type QuoteDimensions = {
  hospital_level: string
  beds_total: number
  modules: string[]
  /** 当前报价涉及的产品/条目名：用于把逐模块单价参考按相关性排序；缺省不影响向后兼容 */
  items?: string[]
}

export type LevelMatch = "same" | "near" | "diff"

/** 单个成交样本的匹配明细 */
export type SimilarMatch = {
  id: string
  name: string
  total: number
  score: number
  level: LevelMatch
  beds_ratio: number
  module_overlap: number
}

/** 一组数值的区间统计 */
export type RangeStat = {
  count: number
  low: number
  median: number
  high: number
}

/** 逐模块单价参考区间 */
export type ModuleRange = {
  name: string
  count: number
  low: number
  median: number
  high: number
  /** 该模块是否为当前报价涉及条目（用于相关性置顶） */
  in_current: boolean
}

export type Recommendation = {
  /** 样本池是否可用（至少一份有总价的成交样本） */
  available: boolean
  /** 匹配到的相似项目（score>=minScore，按分降序） */
  matches: SimilarMatch[]
  /** 总价推荐区间（基于匹配样本；匹配为空时基于全部成交样本） */
  total_range: RangeStat | null
  /** 逐模块单价参考区间（基于全部成交样本） */
  module_ranges: ModuleRange[]
  /** 口径说明（无匹配/样本偏少等降级提示） */
  note: string
}

const CN_TIER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }

/** 解析医院等级：兼容全称「三级甲等」与简称「三甲」；无法识别 tier=0 */
export function parseLevel(raw: string | null | undefined): { tier: number; grade: string } {
  const s = String(raw ?? "").trim()
  if (!s) return { tier: 0, grade: "" }
  let grade = ""
  if (s.includes("甲")) grade = "甲"
  else if (s.includes("乙")) grade = "乙"
  else if (s.includes("丙")) grade = "丙"
  let tier = 0
  const mFull = /([一二三四五])\s*级/.exec(s)
  if (mFull) tier = CN_TIER[mFull[1]] ?? 0
  else {
    const mShort = /([一二三四五])\s*[甲乙丙]/.exec(s)
    if (mShort) tier = CN_TIER[mShort[1]] ?? 0
  }
  return { tier, grade }
}

/** 等级相似度：同级且同甲乙= same；仅同级= near；不同级或一方缺= diff */
export function levelSimilarity(a: string | null | undefined, b: string | null | undefined): LevelMatch {
  const pa = parseLevel(a)
  const pb = parseLevel(b)
  if (!pa.tier || !pb.tier) return "diff"
  if (pa.tier === pb.tier) {
    if (pa.grade && pb.grade && pa.grade === pb.grade) return "same"
    return "near"
  }
  return "diff"
}

/** 床位规模比：min/max ∈ (0,1]；任一无床位数据返回 0（不计入打分） */
export function bedsRatio(a: number, b: number): number {
  const x = Number(a) || 0
  const y = Number(b) || 0
  if (x <= 0 || y <= 0) return 0
  return Math.min(x, y) / Math.max(x, y)
}

/** Jaccard 相似度：交集/并集；任一为空返回 0 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** 中位数（不修改入参） */
export function median(nums: number[]): number {
  const arr = [...nums].sort((x, y) => x - y)
  if (!arr.length) return 0
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 ? round2(arr[mid]) : round2((arr[mid - 1] + arr[mid]) / 2)
}

/** 一组数值的区间统计（过滤 <=0；空返回 null） */
export function buildRange(nums: number[]): RangeStat | null {
  const arr = nums.filter((n) => Number.isFinite(n) && n > 0)
  if (!arr.length) return null
  const sorted = [...arr].sort((x, y) => x - y)
  return { count: sorted.length, low: round2(sorted[0]), median: median(sorted), high: round2(sorted[sorted.length - 1]) }
}

function modulesOf(rec: QuoteRecord): Set<string> {
  return new Set((rec.groups ?? []).map((g) => String(g.name ?? "").trim()).filter(Boolean))
}

/**
 * 从成交样本池给出参考区间推荐。
 * @param current 当前报价维度（可能缺等级/床位——降级为纯模块/总价参考）
 * @param samples 全部报价记录（内部筛 won_sample===true 且总价>0，排除 currentId）
 */
export function recommendFromHistory(
  current: QuoteDimensions,
  samples: QuoteRecord[],
  currentId = "",
  opts: { limit?: number; minScore?: number } = {},
): Recommendation {
  const limit = opts.limit ?? 8
  const minScore = opts.minScore ?? 1.5
  const pool = (samples ?? []).filter((s) => s && s.won_sample === true && s.id !== currentId)

  const currentItems = new Set((current.items ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))

  const scored: SimilarMatch[] = []
  const priceByModule = new Map<string, number[]>()

  for (const s of pool) {
    const total = quoteTotal(s.groups ?? [])
    if (!(total > 0)) continue

    // 逐模块单价样本（供 module_ranges，不依赖相似度）
    for (const g of s.groups ?? []) {
      for (const it of g.items ?? []) {
        const key = String(it.product_name || it.item_name || "").trim()
        const price = Number(it.price) || 0
        if (key && price > 0) {
          const list = priceByModule.get(key) ?? []
          list.push(price)
          priceByModule.set(key, list)
        }
      }
    }

    const level = levelSimilarity(current.hospital_level, s.hospital_level)
    const beds_ratio = bedsRatio(current.beds_total, Number(s.beds_total) || 0)
    const module_overlap = jaccard(new Set(current.modules.filter(Boolean)), modulesOf(s))

    let score = 0
    score += level === "same" ? 2 : level === "near" ? 1 : 0
    score += beds_ratio > 0 ? round2(beds_ratio * 1.5) : 0
    score += round2(module_overlap * 2)

    scored.push({
      id: s.id,
      name: s.quote_name || "未命名报价",
      total,
      score: round2(score),
      level,
      beds_ratio: round2(beds_ratio),
      module_overlap: round2(module_overlap),
    })
  }

  const matches = scored.filter((m) => m.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit)

  const module_ranges: ModuleRange[] = Array.from(priceByModule.entries())
    .map(([name, prices]) => {
      const r = buildRange(prices)
      return r ? { name, count: r.count, low: r.low, median: r.median, high: r.high, in_current: currentItems.has(name) } : null
    })
    .filter((x): x is ModuleRange => x !== null && x.count >= 2)
    // 相关度优先：当前报价涉及的模块置顶，其次按样本数降序，再按中位价升序
    .sort((a, b) => Number(b.in_current) - Number(a.in_current) || b.count - a.count || a.median - b.median)
    .slice(0, 10)

  if (!scored.length) {
    return { available: false, matches: [], total_range: null, module_ranges, note: "暂无可用的成交样本，先在报价列表把典型项目标记为成交参考样本。" }
  }

  const allTotals = scored.map((m) => m.total)
  let note = ""
  let range_nums: number[]
  if (matches.length) {
    range_nums = matches.map((m) => m.total)
    if (matches.length < 3) note = `相似项目较少（${matches.length} 份），区间仅供参考。`
  } else {
    range_nums = allTotals
    note = "未找到足够相似的历史成交，以下为全部成交项目的总价分布作参考。"
  }

  if (currentItems.size && module_ranges.some((m) => m.in_current)) {
    const hint = "已优先展示当前报价涉及模块的历史单价。"
    note = note ? `${note}${hint}` : hint
  }

  return {
    available: true,
    matches,
    total_range: buildRange(range_nums),
    module_ranges,
    note,
  }
}
