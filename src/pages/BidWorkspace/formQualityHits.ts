// ---------------------------------------------------------------------------
// r277 切片1 · 评审报告 C3/C4/C7：形式质量三查（本地零 AI）
// ① Markdown 标记残留：AI 产出的 **加粗** / # 标题 / [文字](链接) / |---| 分隔行原样流入交卷正文；
// ② 编号连续性：培训课表「第N期」行首序列重复或倒序（建阳课程表两行「第三期」教训）；
//    诚实局限：仅统计行首「第X期」句式（句中回指如「复盘第一期」不误报），其他编号形态暂不覆盖。
// ③ 落款日期核对：正文日期晚于投标截止日＝交卷已截止（评审报告 C7 倒签嫌疑）。
// ---------------------------------------------------------------------------
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { FormatCheckHit } from "./bidTypes"

/** ① Markdown 残留：只匹配明确排版标记，普通中文星标/乘号不误伤 */
const MD_RES: RegExp[] = [
  /\*\*[^*\n]{1,80}\*\*/,
  /^#{1,6}\s+\S/,
  /\[[^\]\n]{2,30}\]\([^)\n]{0,60}\)/,
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/,
]

export function markdownResidueHits(chapters: Chapter[]): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  for (const ch of chapters) {
    if (hits.length >= 24) break
    const content = ch.content ?? ""
    if (!content.trim()) continue
    const bad: string[] = []
    for (const line of content.split(/\r?\n/)) {
      if (MD_RES.some((re) => re.test(line))) bad.push(line.trim().slice(0, 40))
      if (bad.length >= 2) break
    }
    if (bad.length) {
      hits.push({
        chapter: (ch.title ?? "").slice(0, 30) || "（未命名）",
        rule: "markdown_residue",
        quote: `排版标记残留：${bad.join(" ／ ")}`,
        level: "warn",
      })
    }
  }
  return hits
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 中文/阿拉伯数字 → 整数（十~九十九；解析失败返回 -1） */
export function cnNum(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (s === "十") return 10
  const tens = s.indexOf("十")
  if (tens > 0) {
    const t = CN_DIGITS[s.slice(0, tens)] ?? 1
    const u = s.length > tens + 1 ? CN_DIGITS[s.slice(tens + 1)] ?? 0 : 0
    return t * 10 + u
  }
  if (tens === 0) return 10 + (CN_DIGITS[s.slice(1)] ?? 0)
  return CN_DIGITS[s] ?? -1
}

/** ② 「第N期」行首序列：重复或倒序即报（每章 ≤1 条，全量 ≤12 条） */
const PHASE_LINE_RE = /^\s*第\s*([一二三四五六七八九十\d]{1,4})\s*期/
export function numberingSequenceHits(chapters: Chapter[]): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  for (const ch of chapters) {
    if (hits.length >= 12) break
    const content = ch.content ?? ""
    if (!content.trim()) continue
    const seq: { v: number; raw: string }[] = []
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(PHASE_LINE_RE)
      if (!m) continue
      const v = cnNum(m[1])
      if (v > 0) seq.push({ v, raw: m[1] })
    }
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].v <= seq[i - 1].v) {
        hits.push({
          chapter: (ch.title ?? "").slice(0, 30) || "（未命名）",
          rule: "numbering_sequence",
          quote: `「第${seq[i].raw}期」出现在「第${seq[i - 1].raw}期」之后未推进，表内编号重复/乱序`,
          level: "warn",
        })
        break
      }
    }
  }
  return hits
}

const DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g

function toIso(y: string, mo: string, d: string): string {
  const mm = Number(mo)
  const dd = Number(d)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return ""
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
}

/** ③ 前置：从解析文本提取投标截止日（「投标/递交…截止」「开标时间」锚点后 120 字窗内首个日期） */
export function extractDeadlineIso(text: string): string {
  const t = text ?? ""
  const anchor = t.search(/投标(?:文件)?截止|递交[^。\n]{0,8}截止|开标时间|开标日期/)
  if (anchor < 0) return ""
  const win = t.slice(anchor, anchor + 120)
  DATE_RE.lastIndex = 0
  const m = DATE_RE.exec(win)
  return m ? toIso(m[1], m[2], m[3]) : ""
}

/** ③ 落款核对：正文日期晚于截止日（当日不算）＝疑似倒签/错年；无截止日静默跳过 */
export function deadlineDateHits(chapters: Chapter[], deadlineIso: string): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  if (!deadlineIso) return hits
  const limit = Date.parse(`${deadlineIso}T23:59:59`)
  if (Number.isNaN(limit)) return hits
  for (const ch of chapters) {
    if (hits.length >= 20) break
    const content = ch.content ?? ""
    if (!content.trim()) continue
    DATE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    const bad: string[] = []
    while ((m = DATE_RE.exec(content))) {
      const iso = toIso(m[1], m[2], m[3])
      const t = iso ? Date.parse(`${iso}T00:00:00`) : NaN
      if (!Number.isNaN(t) && t > limit) bad.push(m[0])
    }
    if (bad.length) {
      hits.push({
        chapter: (ch.title ?? "").slice(0, 30) || "（未命名）",
        rule: "deadline_date",
        quote: `正文日期 ${[...new Set(bad)].slice(0, 3).join("、")} 晚于投标截止（${deadlineIso}），疑似倒签/笔误`,
        level: "warn",
      })
    }
  }
  return hits
}

/** ④ 工期时序（评审报告 A2：响应表承诺 180 天建成 vs 实施计划 T+240 终验矛盾）：
 *  承诺面 = 全局最短「工期 N 天/个月」承诺（个月按 30 天平折）；计划面 = 「初验/终验/上线/交付/验收 … T+N 日」类里程碑。
 *  最长里程碑 > 承诺 → warn。诚实局限：多标包/单项独立工期不区分；工作日与自然日不换算直接比。 */
const TERM_COMMIT_RE = /(?:整体|总|项目)?工期[^0-9\n。]{0,10}(\d{1,4})\s*(?:个)?\s*(自然日|日历天|工作日|日|天|个月)/g
const MILESTONE_RE = /(?:初验|终验|竣工验收|上线|交付|验收)[^0-9\n。]{0,10}(?:T\s*[+＋]\s*)?(\d{1,3})\s*(?:个)?(?:自然|日历)?日(?![时月秒])/g
/** 月形态里程碑（WP/M8 计划表句式「第8个月完成终验」）：月数 ×30 折天并入同一对账 */
const MILESTONE_MONTH_RE = /第\s*(\d{1,2})\s*个?月[^0-9\n。]{0,12}?(?:初验|终验|竣工验收|上线|交付)/g

export function scheduleConsistencyHits(chapters: Chapter[]): FormatCheckHit[] {
  let commit = 0
  let commitQuote = ""
  let worst = { v: 0, quote: "", chapter: "" }
  for (const ch of chapters) {
    const content = ch.content ?? ""
    if (!content.trim()) continue
    const title = (ch.title ?? "").slice(0, 30) || "（未命名）"
    TERM_COMMIT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TERM_COMMIT_RE.exec(content))) {
      const v = Number(m[1]) * (m[2] === "个月" ? 30 : 1)
      if (v >= 10 && (!commit || v < commit)) {
        commit = v
        commitQuote = m[0].trim().slice(0, 40)
      }
    }
    MILESTONE_RE.lastIndex = 0
    while ((m = MILESTONE_RE.exec(content))) {
      const v = Number(m[1])
      if (v >= 10 && v > worst.v) worst = { v, quote: m[0].trim().slice(0, 40), chapter: title }
    }
    MILESTONE_MONTH_RE.lastIndex = 0
    while ((m = MILESTONE_MONTH_RE.exec(content))) {
      const v = Number(m[1]) * 30
      if (v >= 10 && v > worst.v) worst = { v, quote: m[0].trim().slice(0, 40), chapter: title }
    }
  }
  if (!commit || !worst.v || worst.v <= commit) return []
  return [
    {
      chapter: worst.chapter,
      rule: "schedule_consistency",
      quote: `工期矛盾：承诺「${commitQuote}」=${commit} 天，但计划「${worst.quote}」第 ${worst.v} 天，超承诺 ${worst.v - commit} 天`,
      level: "warn",
    },
  ]
}
