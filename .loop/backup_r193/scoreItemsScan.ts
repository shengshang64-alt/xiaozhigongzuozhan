import type { ParseReport } from "./bidTypes"

// ---------------------------------------------------------------------------
// R008（B-2 阶段一）：评分项本地交叉核对——零 AI 费用。
// 从招标原文本地扫描评分项（对标第十二轮 star_clauses 本地扫描模式），
// 再与 AI 解析报告的 tech_score / biz_score 分节交叉比对，暴露：
// ①AI 漏抽的评分项 ②分值不一致 ③各类合计 ≠ 总分/100 的口径问题。
// 局限（诚实声明）：pdfjs 表格抽取后行结构不可控，本扫描是核对辅助而非真值来源；
// 漏报长表合并行、误报含「分」的普通句子均有可能，逐条提示供人工复核。
// R47/F7：时长「30分钟」不是分值——所有分值正则排除后接「钟」（真实项目 13431「投标截止时间：30分钟内」曾被误判为 30 分评分项）。
// ---------------------------------------------------------------------------

export type ScannedScoreItem = {
  name: string
  score: number
  raw: string
}

export type ScannedTotal = { value: number | null; raw: string }

export type ScanCategory = "tech" | "biz" | "price" | "other"

const CATEGORY_HEADER_RULES: { cat: ScanCategory; re: RegExp }[] = [
  { cat: "tech", re: /技术(?:部分|评分|分)|技术方案评分/ },
  { cat: "biz", re: /商务(?:部分|评分|分)|商务标评分/ },
  { cat: "price", re: /价格(?:部分|评分|分)|报价(?:部分|评分|分)|价格分/ },
]

const SCORE_MARKER =
  /[（(](\d+(?:\.\d+)?)\s*分[)）)]|[:：]\s*(\d+(?:\.\d+)?)\s*分(?!数|钟)|^\s*(\d+(?:\.\d+)?)\s*分(?!数|钟)|\s(\d+(?:\.\d+)?)\s*分(?!数|钟)|[\u4e00-\u9fa5](\d+(?:\.\d+)?)\s*分(?!数|钟)/

// 贴身数字分值的假阳性字（值得/加分/扣分/每个5分…）
const BAD_PREV = new Set(["得", "加", "减", "扣", "每", "值", "足"])

function pickScore(line: string): number | null {
  const paren = line.match(/[（(](\d+(?:\.\d+)?)\s*分[)）)]/)
  if (paren) return Number(paren[1])
  const colon = line.match(/[:：]\s*(\d+(?:\.\d+)?)\s*分(?!数|钟)/)
  if (colon) return Number(colon[1])
  const loose = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*分(?!数|钟)/)
  if (loose) return Number(loose[1])
  const attached = line.match(/([\u4e00-\u9fa5])(\d+(?:\.\d+)?)\s*分(?!数|钟)/)
  if (attached && !BAD_PREV.has(attached[1])) return Number(attached[2])
  return null
}

function cleanName(line: string, scoreIdx: number): string {
  const head = line.slice(0, scoreIdx)
  return head
    .replace(/^[（([]*[0-9一二三四五六七八九十]{1,3}[）)]*/, "")
    .replace(/^[、.．\s\u3000]+/, "")
    .replace(/[\s\u3000]+/g, "")
    .trim()
}

/** 从招标原文逐行扫描评分项；「合计/总分」行单独记录为总分；返回按当前类目归组的结果 */
export function scanScoreItems(text: string): {
  items: (ScannedScoreItem & { cat: ScanCategory })[]
  total: ScannedTotal
  categorySums: Record<ScanCategory, number>
} {
  const items: (ScannedScoreItem & { cat: ScanCategory })[] = []
  const total: ScannedTotal = { value: null, raw: "" }
  const categorySums: Record<ScanCategory, number> = { tech: 0, biz: 0, price: 0, other: 0 }
  let cat: ScanCategory = "other"
  for (const rawLine of (text ?? "").split(/\n+/)) {
    const line = rawLine.replace(/[\s\u3000]+/g, " ").trim()
    if (!line || line.length > 120) continue
    let isHeader = false
    for (const { cat: c, re } of CATEGORY_HEADER_RULES) {
      if (re.test(line)) {
        cat = c
        isHeader = true
        break
      }
    }
    // 类目标题行（如「技术部分（60分）」）只用于归类上下文，不作为评分项
    if (isHeader) continue
    if (/合计|总分|满分/.test(line)) {
      // R154/r151-score-scan-206：总分行必须显式带「N分」分值单位才可信——
      // 真实三明精简版（_eval/R142_faithful_tender.txt，62596 字 harness 复现）曾把
      // 建设范围行「…合计约206个系统/子系统模块…」经裸数字兜底误报为总分 206（真实 100 分制）。
      // 本扫描仅核对辅助，宁可漏报不虚报。
      const n = pickScore(line)
      if (n !== null && n > 0 && total.value === null) {
        total.value = n
        total.raw = line
      }
      continue
    }
    const score = pickScore(line)
    if (score === null || score <= 0 || score > 100) continue
    // R61/r47-scan-name-trunc-06：贴身式（汉字+数字分）的匹配把分值前一个汉字含进起点，
    // 该汉字属于项名——markerIdx 后移一字，名字不再截尾（如「系统响应速度15分」全名保留）
    const markerMatch = SCORE_MARKER.exec(line)
    const markerIdx = markerMatch ? markerMatch.index + (/^[\u4e00-\u9fa5]/.test(markerMatch[0]) ? 1 : 0) : -1
    const name = cleanName(line, markerIdx)
    if (!name || name.length < 2) continue
    if (/^(序号|评分因素|评分项|评审因素|分值|评分标准)$/.test(name)) continue
    items.push({ name, score, raw: line.slice(0, 120), cat })
    categorySums[cat] += score
  }
  return { items, total, categorySums }
}

// ------------------------------ 与解析报告交叉比对 ------------------------------

export type ParsedScoreItem = { name: string; score: number; section: "tech_score" | "biz_score" }

/** 解析报告评分行格式：「评分项名（分值 分）：评分标准摘要」 */
export function parseScoreSectionLines(report: ParseReport | null | undefined): ParsedScoreItem[] {
  const out: ParsedScoreItem[] = []
  for (const key of ["tech_score", "biz_score"] as const) {
    const section = report?.sections?.find((s) => s.key === key)
    if (!section?.content) continue
    for (const line of section.content.split(/\n+/)) {
      const m = line.trim().match(/^(.+?)[（(](\d+(?:\.\d+)?)\s*分[)）]/)
      if (!m) continue
      const name = m[1].trim()
      if (!name) continue
      out.push({ name, score: Number(m[2]), section: key })
    }
  }
  return out
}

function nameSimilar(a: string, b: string): boolean {
  const na = a.replace(/[\s\u3000（）()]/g, "")
  const nb = b.replace(/[\s\u3000（）()]/g, "")
  if (!na || !nb) return false
  return na.includes(nb) || nb.includes(na)
}

export type ScoreCrossCheck = {
  scanned: (ScannedScoreItem & { cat: ScanCategory })[]
  parsed: ParsedScoreItem[]
  missingInReport: (ScannedScoreItem & { cat: ScanCategory })[]
  /** 反向核对：解析报告抽了、但本地原文扫描未匹配到的评分项（可能原文表格丢行，或抽取依据需复核） */
  extraInReport: ParsedScoreItem[]
  scoreMismatch: { scanned: ScannedScoreItem; parsed: ParsedScoreItem }[]
  categorySums: Record<ScanCategory, number>
  total: ScannedTotal
  totalSumWarn: string | null
  sumOfParsed: number
}

export function crossCheckScores(
  tenderText: string,
  report: ParseReport | null | undefined,
): ScoreCrossCheck {
  const scan = scanScoreItems(tenderText ?? "")
  const parsed = parseScoreSectionLines(report)
  const missingInReport = scan.items.filter((s) => !parsed.some((p) => nameSimilar(s.name, p.name)))
  const extraInReport = parsed.filter((p) => !scan.items.some((s) => nameSimilar(s.name, p.name)))
  const scoreMismatch: ScoreCrossCheck["scoreMismatch"] = []
  for (const p of parsed) {
    const hit = scan.items.find((s) => nameSimilar(s.name, p.name))
    if (hit && hit.score !== p.score) scoreMismatch.push({ scanned: hit, parsed: p })
  }
  const sumOfParsed = parsed.reduce((acc, p) => acc + p.score, 0)
  let totalSumWarn: string | null = null
  if (scan.total.value !== null && sumOfParsed > 0 && Math.abs(sumOfParsed - scan.total.value) > 0.01) {
    totalSumWarn = `解析评分项合计 ${sumOfParsed} 分 ≠ 招标文件总分 ${scan.total.value} 分`
  } else if (scan.total.value === 100 && sumOfParsed > 0 && Math.abs(sumOfParsed - 100) > 0.01) {
    totalSumWarn = `解析评分项合计 ${sumOfParsed} 分 ≠ 100 分`
  }
  return {
    scanned: scan.items,
    parsed,
    missingInReport,
    extraInReport,
    scoreMismatch,
    categorySums: scan.categorySums,
    total: scan.total,
    totalSumWarn,
    sumOfParsed,
  }
}
