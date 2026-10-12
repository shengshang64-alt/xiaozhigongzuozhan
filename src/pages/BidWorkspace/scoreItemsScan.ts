import type { ParseReport } from "./bidTypes"

// ---------------------------------------------------------------------------
// R008（B-2 阶段一）：评分项本地交叉核对——零 AI 费用。
// 从招标原文本地扫描评分项（对标第十二轮 star_clauses 本地扫描模式），
// 再与 AI 解析报告的 tech_score / biz_score 分节交叉比对，暴露：
// ①AI 漏抽的评分项 ②分值不一致 ③各类合计 ≠ 总分/100 的口径问题。
// 局限（诚实声明）：pdfjs 表格抽取后行结构不可控，本扫描是核对辅助而非真值来源；
// 漏报长表合并行、误报含「分」的普通句子均有可能，逐条提示供人工复核。
// R195：三列式评分表（评标项目 | 评标分值 | 评标方法描述）——分值单独成列且不带「分」字，
// 单行启发式与 R194 的分隔符归一都拿不到（归一后长行还会被 120 字阈值丢弃），两份真实招标文件
// 整表提取 0 项。改为「表头锚定的列模板」提取：表头须同时出现项目标签列与分值标签列，分值列下标
// 由表头确定，其后只在列数完全一致的行上按列取值，任一行对不上即模板失效；描述格还须带评分语汇
// 才采纳——同形状的采购清单/数据集目录/付款方式表因此不会被误读为分值。另修类目小计（「①价格项
// （F1×A1）满分为30分」）被误当全表总分的口径缺陷。
// R247（收 r195-score-table-n1-merged-col）：提取端（bidFiles 表格遍历的 filter(Boolean)、pdfjs 按列拆行）
// 丢掉空单元时连同其分隔符一起丢，评分表里「评标项目」格本就没有编号的行因此从三列退化成两列
// （`3 | 投标人或所投品牌…得3分`）；旧实现「列数不符即模板失效」把这类行判死，连带其后的正常行整表漏配
// （真实信息化招标评分表差分实测 6 项 -> 21 项，新增 15 项逐条人工判真、删失 0 项）。现在允许「列数恰差 1 且整行只有唯一一个分值形状单元」的近形行
// 按内容对齐取分值，护栏不足仍按原口径失效模板——宁可漏报不虚报。
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

// R195：表头锚定的列模板用常量——列分隔、项目标签列、分值标签列、分值单元、编号单元、评分语汇
const RE_CELL_SEP = /[|｜\t]/
const RE_CELL_SPLIT = /[|｜\t]+/
const RE_HDR_NAME_LABEL = /评标项目|评分项目|评审因素|评分因素|评标方法|评分标准|评分项/
const RE_HDR_SCORE_LABEL = /(?:分值|得分|权重)\s*$|^(?:分值|评分分值|评标分值|得分)$/
const RE_CELL_SCORE = /^(\d+(?:\.\d+)?)(?:\s*[-–—~～－]\s*(\d+(?:\.\d+)?))?\s*分?$/
const RE_CELL_INDEX = /^[A-Za-z]?\d+(?:\.\d+)?(?:[-–.—～.]\d+(?:\.\d+)?)*[、.．)）]?$/
const RE_TABLE_VOCAB = /得\s*[\d.]+\s*分|不得分|满分|扣|评[分标]|评议|评价|响应|满足|证书|业绩|方案|能力/
// R195：类目小计行（价格项/技术项/商务项各自满分说明），是全表总分的组成部分而非总分本身
const RE_CATEGORY_SUBTOTAL = /(?:技术|商务|价格|经济)项.{0,12}满\s*分/
// R195：「得满分N分」是逐条评分规则而非全表总分声明——真实两份标书分别把价格项「得满分10分」、
// 技术条款「得满分8分」报成「原文总分 10 / 8」。这类行不认作总分，交回下面的评分项抽取逐条入项。
const RE_ITEM_RULE = /得\s*满分/

/** R194：纯分值行判定——整行只是一个分值描述，项名在上一行 */
function isPureScoreLine(line: string): boolean {
  if (/分[数钟]/.test(line)) return false
  return RE_SCORE_LINE_PURE.test(line)
}

/** R194：该行是否已命中任一计分形态（含区间/上限），用于避免跨行误并 */
function hasAnyScoreHit(line: string): boolean {
  return pickScoreHit(line) !== null
}

/** R195：竖线/制表符切列，丢弃空单元 */
function tableCells(line: string): string[] {
  return line.split(RE_CELL_SPLIT).map((c) => c.trim()).filter(Boolean)
}

/**
 * R195：评分表表头判定，返回分值列下标（无则 null）。
 * 要求「项目/因素/标准」标签列与「分值/得分/权重」标签列同时出现，且分值列在项目列之后——
 * 只有这种表头才能授权后面按列取分值，避免普通多列表格被当评分表。
 */
function scoreTableHeaderIdx(cells: string[]): number | null {
  if (cells.length < 2) return null
  let nameIdx = -1
  let scoreIdx = -1
  cells.forEach((c, i) => {
    if (nameIdx < 0 && RE_HDR_NAME_LABEL.test(c)) nameIdx = i
    if (scoreIdx < 0 && RE_HDR_SCORE_LABEL.test(c)) scoreIdx = i
  })
  if (nameIdx < 0 || scoreIdx < 0 || scoreIdx <= nameIdx) return null
  return scoreIdx
}

/** R195：分值单元取值——纯数字 / 「N分」 / 区间取上界；越界（含 0 与 >100）判为不可信 */
function cellScore(cell: string | undefined): number | null {
  if (!cell) return null
  const m = RE_CELL_SCORE.exec(cell)
  if (!m) return null
  const v = Number(m[2] ?? m[1])
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : null
}

/**
 * R195：模板行项名——分值列前一格若是纯编号（1-1 / T1、 / ①）则项名在描述格，
 * 并回挂编号保持可追溯（同名的逐条评分项不互相覆盖）；否则项名取该格。
 */
function tableItemName(prev: string, desc: string): string {
  if (!prev || RE_CELL_INDEX.test(prev)) {
    const name = desc.split(/[（(：:，,、；;]/)[0].replace(/[\s\u3000]+/g, "")
    if (!name) return ""
    return prev ? `${name}（${prev}）` : name
  }
  // 名称格自带编号前缀（「T1、技术服务响应程度」）：先剥编号再切标点，否则项名只剩「T1」；
  // 名称格不按顿号切——「节能、环境标志产品」是一个评审因素，切成「节能」即失真。
  return prev
    .replace(/^[0-9A-Za-z]{1,4}[、.．]/, "")
    .split(/[（(：:，,；;]/)[0]
    .replace(/[\s\u3000]+/g, "")
}

/**
 * R195：精确按列取分值——分值列下标由表头授权，其右描述格须带评分语汇才采纳。
 * 拿不到可信分值或项名时返回 null（该行回落单行启发式，列模板保持有效）。
 */
function resolveTemplateRow(cells: string[], scoreIdx: number): { name: string; score: number } | null {
  const v = cellScore(cells[scoreIdx])
  const desc = cells[scoreIdx + 1] ?? ""
  if (v === null || !RE_TABLE_VOCAB.test(desc)) return null
  const name = tableItemName(cells[scoreIdx - 1] ?? "", desc)
  return name.length >= 2 ? { name, score: v } : null
}

/**
 * R247：列数恰差 1 的「近形行」按内容对齐取分值（空单元被提取端连分隔符一起丢掉的退化形态）。
 * 护栏逐条收紧，任一不成立即返回 null（由调用方按旧口径判死模板）：
 * ①列数只允许差 1；②整行只允许出现一个分值形状单元——两个及以上就分不清哪列才是分值列；
 * ③该单元须落在表头授权分值列的 ±1 内（只是少一列，不是换了一张表）；
 * ④其右描述格带评分语汇；⑤项名仍走 R195 那套规则（名称格优先，没有名称格取描述格主题）。
 */
function alignNearTemplateRow(
  cells: string[],
  tpl: { cells: number; scoreIdx: number },
): { name: string; score: number } | null {
  if (Math.abs(cells.length - tpl.cells) !== 1) return null
  const scoreIdxs: number[] = []
  cells.forEach((c, i) => {
    if (cellScore(c) !== null) scoreIdxs.push(i)
  })
  if (scoreIdxs.length !== 1) return null
  const j = scoreIdxs[0]
  if (Math.abs(j - tpl.scoreIdx) > 1) return null
  const v = cellScore(cells[j])
  const desc = cells[j + 1] ?? ""
  if (v === null || !RE_TABLE_VOCAB.test(desc)) return null
  const name = tableItemName(cells[j - 1] ?? "", desc)
  // 名称格被吞掉时项名落在描述格主题上，尾巴常挂着「…的得1分」这类评分从句——剥掉后项名才是可核对的名称
  const lean = name.split(/[得扣]\s*\d+(?:\.\d+)?\s*分/)[0].replace(/[的得扣，,、；;：:（(]+$/, "")
  const finalName = lean.length >= 2 ? lean : name
  return finalName.length >= 2 ? { name: finalName, score: v } : null
}

/** R195：模板行按行内证据归类（表格块与正文类目头两套状态不共享，取自身关键词更稳） */
function categoryOfRow(text: string): ScanCategory {
  if (/价格|报价/.test(text)) return "price"
  if (/商务|业绩|资质|证书|企业实力|产品实力|信誉|团队|人员|服务能/.test(text)) return "biz"
  if (/技术|方案|实施|响应|架构|功能|性能|培训/.test(text)) return "tech"
  return "other"
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
  // R195：表头锚定的列模板状态（列数 + 分值列下标）；遇列数不符的行即失效
  let tpl: { cells: number; scoreIdx: number } | null = null
  // R195：同一表格块内的类目继承——描述格常不含类目关键词（「总体设计」的 1-16/1-17 同行异述），
  // 逐行独立判类会把同名评分项劈进两个类目、categorySums 失真；本表块无关键词时沿用上一行类目。
  // 只作用于列模板分支，不与正文类目头（cat）共享状态，避免污染单行启发式的归类。
  let tplCat: ScanCategory = "other"
  for (const rawLine of (text ?? "").split(/\n+/)) {
    const raw = rawLine.trim()
    // R195：带列分隔符的行先走列模板——表头授权后按列取分值，命中即消费该行（不再进单行启发式，防重复入项）
    if (raw && RE_CELL_SEP.test(raw)) {
      const cells = tableCells(raw)
      const h = scoreTableHeaderIdx(cells)
      if (h !== null) {
        tpl = { cells: cells.length, scoreIdx: h }
        continue
      }
      if (tpl) {
        // R247：列数一致走精确取列；列数恰差 1 的近形行按内容对齐（不再一判死就整表漏配）。
        // 两条分支都没拿到可信分值时，列数不符的行仍按原口径失效模板
        const hit =
          cells.length === tpl.cells ? resolveTemplateRow(cells, tpl.scoreIdx) : alignNearTemplateRow(cells, tpl)
        if (hit) {
          const guess = categoryOfRow(cells.join(" "))
          const c = guess === "other" ? tplCat : guess
          if (guess !== "other") tplCat = guess
          items.push({ name: hit.name, score: hit.score, raw: raw.slice(0, 120), cat: c })
          categorySums[c] += hit.score
          continue
        }
        if (cells.length !== tpl.cells) tpl = null
      }
    }
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
    // R195：类目小计行（「①价格项（F1×A1）满分为30分」）只切换类目上下文，不当全表总分——
    // 真实两份标书曾分别把 30 / 10 报成「原文总分」，交叉核对的总分口径整体失真。
    if (RE_CATEGORY_SUBTOTAL.test(line)) {
      const c = categoryOfRow(line)
      if (c !== "other") cat = c
      continue
    }
    if (
      (/合计|总分|满分/.test(line) || /^(?:合计|总分)$/.test(prevLine)) &&
      !hasPerUnit(line) &&
      !RE_ITEM_RULE.test(line)
    ) {
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
