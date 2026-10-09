import type { ParseReport } from "./bidTypes"

// ---------------------------------------------------------------------------
// R008（B-2 阶段一）：评分项本地交叉核对——零 AI 费用。
// 从招标原文本地扫描评分项（对标第十二轮 star_clauses 本地扫描模式），
// 再与 AI 解析报告的 tech_score / biz_score 分节交叉比对，暴露：
// ①AI 漏抽的评分项 ②分值不一致 ③各类合计 ≠ 总分/100 的口径问题。
// 局限（诚实声明）：pdfjs 表格抽取后行结构不可控，本扫描是核对辅助而非真值来源；
// 漏报长表合并行、误报含「分」的普通句子均有可能，逐条提示供人工复核。
// R194（closing r193-score-scan-multiline-table）：表格抽取的两种常见断裂形态补全——
// ①项名与分值分居两行（pdfjs 按列拆行：上一行是项名、下一行是裸「（20分）」），按「纯分值行
//   回并上一行」聚合；②竖线/制表符分隔的表格行（markdown 导出、剪贴板/TSV），列分隔符归一为
//   空格后再走既有单行启发式。聚合均为启发式而非真值来源，仍逐条供人工复核。
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

// 贴身数字分值的假阳性字（值得/加分/扣分/每个5分…）
const BAD_PREV = new Set(["得", "加", "减", "扣", "每", "值", "足"])

// 评分行的分值形态多样：净括号（20分）、冒号（：15分）、区间（10-20分）、上限（最高20分/满分15分）、
// 逐条带上限（每项2分，最高20分）、贴身汉字（速度15分）。R193 之前仅识别单值形态：区间与
// 「最高/满分」上限整行漏报，逐条带上限把「每项2分」误当权重且项名截残。下列规则按「有效权重」归一，
// 区间取上界、带上限取上限。单位一律仅认「分」，排除「分钟/分数」（R47/F7）。
const RE_CAP = /(?:最高|最多|至多|上限|不超过)[^0-9]{0,4}(\d+(?:\.\d+)?)\s*分(?!数|钟)/
const RE_FULLMARK = /满分[^0-9]{0,4}(\d+(?:\.\d+)?)\s*分(?!数|钟)/
const RE_PERUNIT = /每\s*[个项类条种次]?[^0-9，,。]{0,6}?(\d+(?:\.\d+)?)\s*分(?!数|钟)/
const RE_PAREN = /[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）]/
const RE_COLON = /[:：]\s*(\d+(?:\.\d+)?)\s*分(?!数|钟)/
const RE_RANGE = /(\d+(?:\.\d+)?)\s*[-–—~～－]\s*(\d+(?:\.\d+)?)\s*分(?!数|钟)/
const RE_ATTACHED = /([\u4e00-\u9fa5])(\d+(?:\.\d+)?)\s*分(?!数|钟)/
const RE_LOOSE = /(?:^|\s)(\d+(?:\.\d+)?)\s*分(?!数|钟)/

// R194：跨行断裂评分项聚合——pdfjs 按列拆行时评分表的「分值列」常整体落在下一行，
// 形成纯分值行：（20分） / 20分 / 10-20分 / 最高20分。「最高/满分」前缀排除裸「满分N分」
// 行（无项名可归，且总分行 R154 已收紧，宁可漏报不虚报）。
const RE_SCORE_LINE_PURE = /^(?:[（(]\s*(?:最高|最多|上限|不超过)?\s*\d+(?:\.\d+)?\s*(?:[-–—~～－]\s*\d+(?:\.\d+)?)?\s*分\s*[)）]|\d+(?:\.\d+)?\s*(?:[-–—~～－]\s*\d+(?:\.\d+)?)?\s*分|最[高多]?分?\s*\d+(?:\.\d+)?\s*分)$/
// 表格列标签行（markdown/HTML 表格抽取首行）：整行由标签单元组成，本身不是评分项；
// 兼容「评分因素/评审因素」与尾随「分值」列标签（序号|评分因素|分值|评分标准 只匹配前缀部分）
const RE_TABLE_LABEL_LINE = /^[|｜\s]*(?:序号[|｜\s]*)?(?:评分|评审)(?:因|标)?素?[|｜\s]*(?:分值[|｜\s]*)?$/
// R194：竖线/制表符表格行归一，先去掉首尾孤立分隔符再统一转空格
const RE_PIPE_CELL = /[|｜\t]+/g

/** R194：纯分值行判定——整行只是一个分值描述，项名在上一行 */
function isPureScoreLine(line: string): boolean {
  if (/分[数钟]/.test(line)) return false
  return RE_SCORE_LINE_PURE.test(line)
}

/** R194：该行是否已命中任一计分形态（含区间/上限），用于避免跨行误并 */
function hasAnyScoreHit(line: string): boolean {
  return pickScoreHit(line) !== null
}

/** 是否为逐条计量行（每…N分）——用于区分「总分/满分」grand-total 行与「…每个X分，满分Y分」评分行 */
function hasPerUnit(line: string): boolean {
  return RE_PERUNIT.test(line)
}

/** 从计分描述之前的片段提取项名：切首个分隔标点或空格（R194：竖线/制表符单元格归一后的列边界）、去序号前缀、去空白 */
function nameFromHead(head: string): string {
  return head
    .split(/[（(：:，,、；;]/)[0]
    .replace(/^[（([]*[0-9一二三四五六七八九十]{1,3}[）)]*/, "")
    .replace(/^[、.．\s\u3000]+/, "")
    .replace(/[\s\u3000]+/g, "")
    .trim()
}

type ScoreHit = { score: number; cut: number }

/** 归一化抽取评分行的有效权重与截断点；cut 为计分描述起始位置（项名在其之前） */
function pickScoreHit(line: string): ScoreHit | null {
  const cap = RE_CAP.exec(line)
  if (cap) return { score: Number(cap[1]), cut: cap.index }
  const perUnit = RE_PERUNIT.exec(line)
  const full = RE_FULLMARK.exec(line)
  if (perUnit && full) return { score: Number(full[1]), cut: full.index }
  const paren = RE_PAREN.exec(line)
  if (paren) return { score: Number(paren[1]), cut: paren.index }
  const colon = RE_COLON.exec(line)
  if (colon) return { score: Number(colon[1]), cut: colon.index }
  const range = RE_RANGE.exec(line)
  if (range) return { score: Number(range[2]), cut: range.index }
  const attached = RE_ATTACHED.exec(line)
  if (attached && !BAD_PREV.has(attached[1])) return { score: Number(attached[2]), cut: attached.index + 1 }
  const loose = RE_LOOSE.exec(line)
  if (loose) return { score: Number(loose[1]), cut: loose.index + (loose[0].charAt(0) === " " ? 1 : 0) }
  return null
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
  // R194：先归一（竖线/制表符表格行 → 空格分隔；全角空格并入），空行丢弃；
  // 再逐行判定，纯分值行回并上一行（跨行断裂评分项）。长度阈值在归一后判，
  // 归一本身只缩不涨，不会让原本超阈值的行重新入池。
  const lines: string[] = []
  for (const rawLine of (text ?? "").split(/\n+/)) {
    let t = rawLine
      .replace(/^[|｜\s]+/, "")
      .replace(/[|｜\s]+$/, "")
      .replace(RE_PIPE_CELL, " ")
      .replace(/[\s\u3000]+/g, " ")
      .trim()
    // R194：markdown/HTML 表格行归一后常以纯序号单元开头（「1 技术方案比选 10-20分 …」），
    // 旧序号前缀正则要求紧跟分隔符，吞不掉带空格的序号格，项名会被截成空。剔除纯序号首格；
    // 「12 分」「1 2」等「数字+单位/后续单元」形态不受影响（仅剥走孤立序号，分值单元仍在其后）。
    t = t.replace(/^\d+\s+(?=\S)/, "")
    if (t) lines.push(t)
  }
  let prev = ""
  for (let idx = 0; idx < lines.length; idx++) {
    const bare = lines[idx]
    // R194：prev 会在回并判定后被覆写为当前行，总分分支需要真正的「上一行」快照
    const prevLine = prev
    if (!bare || bare.length > 120) {
      prev = bare
      continue
    }
    let line = bare
    if (
      isPureScoreLine(bare) &&
      prevLine &&
      prevLine.length <= 100 &&
      !/^\d+$/.test(prevLine) &&
      !(/合计|总分|满分/.test(prevLine) && !/^(?:合计|总分|满分)$/.test(prevLine)) &&
      !hasAnyScoreHit(prevLine) &&
      !CATEGORY_HEADER_RULES.some(({ re }) => re.test(prevLine)) &&
      !RE_TABLE_LABEL_LINE.test(prevLine) &&
      !/^(?:序号|评分因素|评分项|评审因素|分值|评分标准)$/.test(prevLine)
    ) {
      // 项名行 + 纯分值行回并；若并后仍命中任一计分形态才采纳，否则拆分错位、保持原行
      const joined = prevLine + " " + bare
      if (hasAnyScoreHit(joined)) line = joined
    }
    prev = bare
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
    // R194：表格列标签行（序号｜评分因素｜分值）与孤立「分值」单元不参与评分项
    if (RE_TABLE_LABEL_LINE.test(line) || line === "分值") continue
    if ((/合计|总分|满分/.test(line) || /^(?:合计|总分)$/.test(prevLine)) && !hasPerUnit(line)) {
      // R154/r151-score-scan-206：总分行必须显式带「N分」分值单位才可信——
      // 真实三明精简版（_eval/R142_faithful_tender.txt，62596 字 harness 复现）曾把
      // 建设范围行「…合计约206个系统/子系统模块…」经裸数字兜底误报为总分 206（真实 100 分制）。
      // 本扫描仅核对辅助，宁可漏报不虚报。
      // R193：含逐条计量（每…N分）的「…每个5分，满分15分」是评分行（上限）而非总分，
      // 交回下面评分项抽取按上限取分，不再误置 total。
      const hit = pickScoreHit(line)
      if (hit && hit.score > 0 && total.value === null) {
        total.value = hit.score
        total.raw = line
      }
      continue
    }
    // R193：区间（10-20分取上界）、上限（最高/满分N分）、逐条带上限（每项X分最高Y分取Y）
    // 此前整行漏报或项名截残——归一到「有效权重 + 干净项名」后入项，杜绝评分表常见形态的漏报/误报。
    const hit = pickScoreHit(line)
    if (!hit) continue
    const score = hit.score
    if (score <= 0 || score > 100) continue
    const name = nameFromHead(line.slice(0, hit.cut))
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
