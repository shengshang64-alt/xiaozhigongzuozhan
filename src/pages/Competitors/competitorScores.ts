// 竞品对比分析支撑层：能力维度定义 + 档案启发式评分。
// 评分为「基于档案文本关键词与软著规模」的自动估算，仅供对比参考，界面需注明非实测数据。
import type { CompetitorRow } from "./competitorsCore"

/** 六维能力模型（与原型一致，5 分制） */
export const CAPABILITY_DIMS = [
  "电子病历",
  "集成平台",
  "CDSS/AI",
  "移动端",
  "实施交付",
  "价格竞争力",
] as const

/** 各维度的档案关键词：命中越多分越高。短英文词（ai/app/esb…）按词边界匹配，防 "maintenance" 误命中 "ai" */
const DIM_KEYWORDS: string[][] = [
  ["电子病历", "emr", "病案", "病历评级", "五级评审", "四级甲等"],
  ["集成平台", "esb", "互联互通", "hl7", "fhir", "接口平台", "数据中心", "全民健康", "区域卫生"],
  ["cdss", "临床决策", "人工智能", "大模型", "ai", "智能", "知识库"],
  ["移动", "掌上", "app", "小程序", "床旁", "护理闭环", "互联网医院"],
  ["实施", "交付", "运维", "服务网络", "本地化", "itss", "驻场"],
  ["性价比", "低价", "普惠", "轻量化", "saas"],
]

const LATIN_KW_RE = /^[a-z0-9]+$/

function keywordHit(text: string, kw: string): boolean {
  if (LATIN_KW_RE.test(kw)) return new RegExp(`\\b${kw}\\b`).test(text)
  return text.includes(kw)
}

/** R63/F20：命中密度分级——单命中 3 分起步、命中全表才满分，替代「3 命中即 5 分」的饱和映射 */
function hitsToScore(hits: number, total: number): number {
  if (hits <= 0) return 2
  return clamp5(3 + Math.round((hits / Math.max(1, total)) * 2))
}

function haystack(row: CompetitorRow): string {
  return [
    row.positioning, row.products, row.strengths, row.weaknesses,
    row.summary, row.ai_evolution, row.xinchuang, row.certifications,
    row.customer_profile, row.regions,
  ].join(" ").toLowerCase()
}

function clamp5(v: number): number {
  return Math.max(1, Math.min(5, v))
}

/**
 * 启发式估算六维评分（1-5）：
 * - 前五个维度：档案文本关键词命中密度分级（R63/F20：无命中 2、单命中 3、全命中才 5），
 *   短英文关键词按词边界匹配；软著规模 ≥ 行业中位数再 +1（封顶 5）。
 * - 价格竞争力：软著规模越大本方定价能力越强 → 得分越低（保守代理指标）。
 * 返回数组与 CAPABILITY_DIMS 一一对应。
 */
export function estimateScores(row: CompetitorRow, rows: CompetitorRow[]): number[] {
  const text = haystack(row)
  const crs = rows.map((r) => r.software_copyrights || 0).sort((a, b) => a - b)
  const median = crs.length ? crs[Math.floor(crs.length / 2)] || 1 : 1
  const max = Math.max(1, crs[crs.length - 1] || 1)
  const big = (row.software_copyrights || 0) >= median

  const scores: number[] = []
  for (let d = 0; d < CAPABILITY_DIMS.length; d += 1) {
    if (d === CAPABILITY_DIMS.length - 1) {
      // 价格竞争力：规模越大分越低（1~5），规模为零给中性 3
      const norm = (row.software_copyrights || 0) / max
      scores.push(row.software_copyrights ? clamp5(5 - Math.round(norm * 3.5)) : 3)
      continue
    }
    let hits = 0
    for (const kw of DIM_KEYWORDS[d]) if (keywordHit(text, kw)) hits += 1
    let s = hitsToScore(hits, DIM_KEYWORDS[d].length)
    if (big) s = clamp5(s + 1)
    scores.push(s)
  }
  return scores
}

// ---------------------------------------------------------------------------
// AI 校准分覆盖（localStorage）：AI 深度分析产出的评分优先于启发式估算
// ---------------------------------------------------------------------------

const GUARD_KEY = "zx_comp_scores_v1"

type ScoreOverrides = Record<string, number[]>

function readOverrides(): ScoreOverrides {
  try {
    const raw = localStorage.getItem(GUARD_KEY)
    const obj = raw ? (JSON.parse(raw) as unknown) : null
    return obj && typeof obj === "object" ? (obj as ScoreOverrides) : {}
  } catch {
    return {}
  }
}

/** 最终评分：AI 校准覆盖优先，否则启发式估算 */
export function finalScores(row: CompetitorRow, rows: CompetitorRow[]): number[] {
  const ov = readOverrides()[row.id]
  if (ov && ov.length === CAPABILITY_DIMS.length) return ov
  return estimateScores(row, rows)
}

/** 导出对比矩阵 CSV（含 BOM，Excel 中文不乱码） */

// ---------------------------------------------------------------------------
// R71/F24：对比重点速览——把能力矩阵自动提炼成 3-4 条「人话结论」，
// 解决"满屏数字看不到重点"（售前 2 分钟内要知道：赢哪、输哪、防谁）。
// 纯本地计算零 AI；只描述已选竞品范围内的对比事实，不做无依据推断。
// ---------------------------------------------------------------------------

export type CompareTakeaway = { kind: "lead" | "gap" | "threat"; text: string }

export type TakeawayEntry = { name: string; scores: number[]; copyrights: number; positioning: string }

export function buildCompareTakeaways(entries: TakeawayEntry[]): CompareTakeaway[] {
  const out: CompareTakeaway[] = []
  const self = entries.find((e) => e.name === "智业软件") ?? entries[0]
  if (!self) return out
  const rivals = entries.filter((e) => e !== self)
  if (!rivals.length) return out

  // ① 领先维度（我方为唯一领先者且分值≥4，最多取 2 条）
  const leads: string[] = []
  for (let d = 0; d < CAPABILITY_DIMS.length && leads.length < 2; d++) {
    const mx = Math.max(...entries.map((e) => e.scores[d] ?? 0))
    const mine = self.scores[d] ?? 0
    if (mine === mx && mine >= 4 && rivals.every((r) => (r.scores[d] ?? 0) < mine)) {
      leads.push(`「${CAPABILITY_DIMS[d]}」${mine} 分（其余对手最高 ${Math.max(...rivals.map((r) => r.scores[d] ?? 0))} 分）`)
    }
  }
  if (leads.length) out.push({ kind: "lead", text: `我方领先：${leads.join("；")}` })

  // ② 最大差距维度（最强对手与我方分差最大的维度）
  let worst = { dim: "", rival: "", diff: 0 }
  for (let d = 0; d < CAPABILITY_DIMS.length; d++) {
    const mine = self.scores[d] ?? 0
    for (const r of rivals) {
      const diff = (r.scores[d] ?? 0) - mine
      if (diff > worst.diff) worst = { dim: CAPABILITY_DIMS[d], rival: r.name, diff }
    }
  }
  if (worst.diff > 0) {
    out.push({ kind: "gap", text: `最大差距：${worst.dim}落后 ${worst.rival} ${worst.diff} 分（我方 ${self.scores[CAPABILITY_DIMS.indexOf(worst.dim as (typeof CAPABILITY_DIMS)[number])]} 分）——标书中需重点应对` })
  }

  // ③ 头号威胁（六维合计最高的竞品 + 其定位摘要首句）
  const totals = rivals.map((r) => ({ name: r.name, total: r.scores.reduce((a, b) => a + (b || 0), 0), pos: (r.positioning || "").replace(/\s+/g, " ").slice(0, 60) }))
  totals.sort((a, b) => b.total - a.total)
  if (totals.length && (!self || totals[0].total > self.scores.reduce((a, b) => a + (b || 0), 0))) {
    out.push({ kind: "threat", text: `最需关注：${totals[0].name}（六维合计 ${totals[0].total} 分）${totals[0].pos ? `——${totals[0].pos}` : ""}` })
  }
  return out
}
