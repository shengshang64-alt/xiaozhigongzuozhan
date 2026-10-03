// ---------------------------------------------------------------------------
// T13 解析重构·结构感知层（2026-09-28 用户反馈轮：评分办法解析不到 / 内容重复 / 重点看不到）
//
// 设计来源（综合参考项目调研）：
// - 腾讯 SkillHub「telehot-bid-compliance-check」（Apache-2.0）：抽取优先级——投标人须知前附表
//   （效力最高）→ 评标办法（含符合性审查表、打分表）→ 资格要求 → 技术需求书 → 合同条款 →
//   投标文件格式；outline→search→局部精读三步走；某类条目为 0 必须回补搜索，不得「搜不到就跳过」。
// - OpenBidKit_Yibiao：分块→按项检索选块（已在 T12 落地，本模块补上它缺失的「章节结构」一环）。
//
// T12 检索的实锤缺陷（用真实招标文件复现，见 tenderStructure.test.ts）：
//  1) 表格行「8 | 无线键盘鼠标 | …」被标题正则误判为标题行 → 块归属全乱、标题加分打歪；
//  2) 评分打分只按关键词命中次数——第三章采购需求几十页设备参数表满是「评分项/技术」字样，
//     把真正的第四章评分表挤出 top12（实测 tech_score 只选中 4/35 块，2 块是设备参数表）；
//  3) extractScoringSectionExcerpt（评分章节本地定位）在 T12 重构后已无人调用，定位能力被丢弃。
//
// 本模块做三件事，全部零 AI：
//  A. detectTenderChapters：章/部分/篇/附件级标题识别——容忍「第四章\n评标方法和标准」拆行
//     （裸章号行向后吸收标题行）、排除表格行/页码目录行/叙述句；同名标题（目录 stub 与正文）
//     经 dedupeChaptersByTitle 取最长 span。
//  B. classifyChapterTitle：章节标题 → 结构类别（评分/须知/需求/合同/格式/其他）。
//  C. buildScoringMaterial：tech_score/biz_score 专属素材——评分章全文（封顶）+ 前附表评标方法行，
//     不再依赖关键词检索选块；找不到评分章返回空串，调用方回退检索。
// ---------------------------------------------------------------------------

/** 章节级标题类型（对齐参考实现的抽取优先级） */
export type TenderChapterCategory =
  | "scoring" // 评标办法/评分办法/评分标准（含资格审查表、符合性审查表、打分表）
  | "instructions" // 投标人须知/投标邀请/招标公告（前附表效力最高）
  | "requirements" // 采购需求/技术需求/货物需求
  | "contract" // 合同条款
  | "format" // 投标文件格式
  | "other"

export interface TenderChapterSpan {
  title: string
  category: TenderChapterCategory
  /** 在全文中的起止偏移（含标题行，不含下一章标题行） */
  start: number
  end: number
}

/** 归一：去全部空白（docx/PDF 拆行把「第 四 章」拆成碎 run） */
function normalizeHeadingText(line: string): string {
  return (line ?? "").replace(/[\s\u3000]+/g, "")
}

/** 章级标题正则（作用在去空白归一后的行上）：
 *  第X章/部分/篇（中文或阿拉伯数字）或 附件N/附录N，后可跟 ≤60 字标题文字 */
const CHAPTER_HEADING_RE =
  /^(?:第[0-9一二三四五六七八九十百]+(?:章|部分|篇)|附件[0-9一二三四五六七八九十]+|附录[0-9一二三四五六七八九十]+)(?:[、.．:：]?\s*.{0,60})?$/

/** 供标题吸收的行：短、无句读、非表格行；遇到节级编号行（一、/1./（一））即停——那是正文开始，
 *  否则正文标题会多吸一行导致与目录 stub 同名去重失败（实测中西医结合第四批） */
function isTitleContinuationLine(line: string): boolean {
  const raw = (line ?? "").trim()
  if (!raw || raw.length > 40) return false
  if (raw.includes(" | ") || raw.includes("｜")) return false
  if (/[。；;：]/.test(raw)) return false
  const norm = normalizeHeadingText(raw)
  if (/^\d+(\.\d+)*$/.test(norm)) return false // 纯页码行
  if (/^(?:[0-9]+(?:\.[0-9]+)*[、.．]|[一二三四五六七八九十]+[、.]|（[一二三四五六七八九十]+）|\([0-9]+\))/.test(norm)) return false
  return true
}

/**
 * 判定一行是否章级标题行：
 * - 归一后命中章级正则；
 * - 原行短（≤70 字符）、无句读收尾；
 * - 表格行（含竖线）绝不作标题——「8 | 无线键盘鼠标 | …」曾把块归属全打歪；
 * - 行尾纯页码（docx 目录「…（综合评分法）197」）不作标题；带括号收尾的正文标题不受影响。
 */
export function isChapterHeadingLine(line: string): boolean {
  const raw = (line ?? "").trim()
  if (!raw || raw.length > 70) return false
  if (raw.includes(" | ") || raw.includes("｜")) return false
  if (/[。；;，,]$/.test(raw)) return false
  const norm = normalizeHeadingText(raw)
  if (!CHAPTER_HEADING_RE.test(norm)) return false
  if (/\d{1,4}$/.test(norm) && !/[）)]$/.test(raw)) return false
  return true
}

/** 章节标题 → 结构类别（评分类关键词最先判，避免「评分办法前附表」被须知类抢先） */
export function classifyChapterTitle(title: string): TenderChapterCategory {
  const t = normalizeHeadingText(title ?? "")
  if (/评标办法|评标方法|评标方案|评审办法|评审标准|评分办法|评分标准|评分细则|评标标准|评标细则|详细评审|综合评分/.test(t)) return "scoring"
  if (/投标人须知|投标须知|投标邀请|招标公告|采购公告|磋商公告|谈判公告|询价公告|投标邀请书/.test(t)) return "instructions"
  if (/采购需求|技术需求|项目需求|货物需求|服务需求|技术规格|建设要求|采购内容/.test(t)) return "requirements"
  if (/合同/.test(t)) return "contract"
  if (/投标文件格式|响应文件格式|投标文件组成|文件格式/.test(t)) return "format"
  return "other"
}

interface ScanLine {
  text: string
  start: number
}

/** 按行扫描并保留精确偏移（\r\n 也按 2 字符推进，保证 span 切片不错位） */
function scanLines(src: string): ScanLine[] {
  const lines: ScanLine[] = []
  let offset = 0
  while (offset < src.length) {
    let nl = src.indexOf("\n", offset)
    let end = nl < 0 ? src.length : nl
    let text = src.slice(offset, end)
    if (text.endsWith("\r")) text = text.slice(0, -1)
    lines.push({ text, start: offset })
    if (nl < 0) break
    offset = nl + 1
  }
  return lines
}

/**
 * 章节树识别：扫描全部章级标题行，span = 本标题行起 → 下一章级标题行止。
 * 裸章号行（「第四章」与标题被提取器拆成两行）向后吸收 ≤2 行标题行并入 span 标题——
 * 这样目录 stub（第一章+投标邀请+1）与正文标题归一为同名，交给 dedupeChaptersByTitle 取最长。
 */
export function detectTenderChapters(text: string): TenderChapterSpan[] {
  const src = text ?? ""
  if (!src.trim()) return []
  const lines = scanLines(src)
  const spans: TenderChapterSpan[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!isChapterHeadingLine(line.text)) continue
    // 裸章号（归一后只有章号词）：向后吸收 ≤2 行标题行拼全标题
    let title = line.text.trim().replace(/\s{2,}/g, " ")
    let endScan = i
    const bareNorm = normalizeHeadingText(title)
    const bare = /^(?:第[0-9一二三四五六七八九十百]+(?:章|部分|篇)|附件[0-9一二三四五六七八九十]+|附录[0-9一二三四五六七八九十]+)[、.．:：]?$/.test(bareNorm)
    if (bare) {
      const absorbed: string[] = []
      for (let j = i + 1; j < lines.length && absorbed.length < 2; j++) {
        const next = lines[j].text.trim()
        if (!next) continue // 跳过空行（拆行常伴随空行）
        if (!isTitleContinuationLine(next)) break
        absorbed.push(next.replace(/\s{2,}/g, " "))
        endScan = j
      }
      if (absorbed.length) title = `${bareNorm.replace(/[、.．:：]$/, "")} ${absorbed.join(" ")}`.slice(0, 80)
    }
    spans.push({ title, category: classifyChapterTitle(title), start: line.start, end: src.length })
    if (spans.length > 1) spans[spans.length - 2].end = line.start
    i = Math.max(i, endScan)
  }
  return spans
}

/** 同名 span 去重：同名标题取最长 span（正文远长于目录 stub），其余丢弃；按出现顺序返回。
 *  短 span（<120 字）再按章节号 token（第四章/附件2…）或同类长 span 二次折叠——
 *  目录 stub 与正文的标题常差一个后缀（如「（综合评分法）」），按全名去重会漏（实测中西医结合第四批） */
export function dedupeChaptersByTitle(spans: TenderChapterSpan[]): TenderChapterSpan[] {
  const best = new Map<string, TenderChapterSpan>()
  for (const s of spans) {
    const prev = best.get(s.title)
    if (!prev || s.end - s.start > prev.end - prev.start) best.set(s.title, s)
  }
  const out = [...best.values()].sort((a, b) => a.start - b.start)
  const chapterToken = (title: string) => (title.match(/^(第[0-9一二三四五六七八九十百]+[章部分篇]|附[件录][0-9一二三四五六七八九十]+)/)?.[1] ?? "")
  const longOfToken = new Map<string, number>()
  const longOfCategory = new Map<TenderChapterCategory, number>()
  for (const s of out) {
    const len = s.end - s.start
    if (len < 120) continue
    const token = chapterToken(s.title)
    if (token) longOfToken.set(token, Math.max(longOfToken.get(token) ?? 0, len))
    longOfCategory.set(s.category, Math.max(longOfCategory.get(s.category) ?? 0, len))
  }
  return out.filter((s) => {
    const len = s.end - s.start
    if (len >= 120) return true
    const token = chapterToken(s.title)
    if (token && (longOfToken.get(token) ?? 0) > len) return false
    return !((longOfCategory.get(s.category) ?? 0) > len)
  })
}

/** 评分素材单章封顶与总预算：评分章常含整章打分表，30k 单章 / 36k 总量（大于通用检索 20k 预算） */
export const SCORING_MATERIAL_MAX_SECTION = 30000
export const SCORING_MATERIAL_MAX_TOTAL = 36000
/** 节级评分标题的取材上限（评分表通常连续且远小于整章） */
const SCORING_SECTION_MAX = 15000

/**
 * 节级评分标题行（评分办法内嵌在须知/需求章时的落点，实测安庆二院「26.3、综合评分：」）：
 * 必须带编号/序号前缀或冒号收尾，裸「评分细则」一词的行不认——需求章参数表里同名行太多，会误吞。
 */
const SECTION_SCORING_RE =
  /^(?:[0-9]+(?:[、.．][0-9]*)*|（[一二三四五六七八九十]+）|[一二三四五六七八九十]+[、.]|附[件录][、.．:：]?)\s*(?:评分细则|评分办法|评分标准|评审细则|评审标准|评标办法|评标方法|评审办法|评分方法|综合评分|打分表|评分表)[、.．:：]?\s*$/

/** 归一后的编号深度：26.3 → 2；27 → 1；中文序号/括号序号 → 1；无编号 → null */
function leadingNumberDepth(norm: string): number | null {
  const m = norm.match(/^(\d+(?:\.[0-9]+)*)[、.．]/)
  if (m) return m[1].split(".").length
  if (/^(?:[一二三四五六七八九十]+[、.]|（[一二三四五六七八九十]+）|\([0-9]+\))/.test(norm)) return 1
  return null
}

/**
 * 在非评分章内扫描节级评分标题，返回各标题的 span：
 * 终点 = 下一章级标题 / 编号深度 ≤ 自身深度-1 的节标题 / 换章级标题；单段封顶 SCORING_SECTION_MAX。
 * 只扫描章级识别出的 span 覆盖不到的重复风险由调用方按区间重叠去重。
 */
function detectSectionScoringSpans(src: string): TenderChapterSpan[] {
  const out: TenderChapterSpan[] = []
  const lines = scanLines(src)
  for (let i = 0; i < lines.length; i++) {
    const norm = normalizeHeadingText(lines[i].text)
    if (!SECTION_SCORING_RE.test(norm) || isChapterHeadingLine(lines[i].text)) continue
    const depth = leadingNumberDepth(norm) ?? 9
    let end = src.length
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text.trim()
      if (isChapterHeadingLine(t)) {
        end = lines[j].start
        break
      }
      const n2 = normalizeHeadingText(t)
      if (SECTION_SCORING_RE.test(n2)) {
        end = lines[j].start
        break
      }
      const d2 = leadingNumberDepth(n2)
      if (d2 !== null && d2 <= depth - 1) {
        end = lines[j].start
        break
      }
    }
    const capped = Math.min(end, lines[i].start + SCORING_SECTION_MAX)
    if (capped - lines[i].start >= 60) out.push({ title: lines[i].text.trim().slice(0, 60), category: "scoring", start: lines[i].start, end: capped })
  }
  return out
}

/** 区间重叠判定（部分重叠也算，同一评分表不重复入素材） */
function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * 评分办法专属素材（tech_score / biz_score 主路径，替代关键词检索选块）：
 *  1) 前附表「评标方法」行（效力最高的一行式声明，如「21.2 | 评标方法 | ☑综合评分法」）——
 *     从须知类 span 的竖线表格行/编号声明行里捞，最多 3 行，置于素材开头；
 *  2) 评分类别章（同名取最长 span）+ 内嵌节级评分标题（评标办法内嵌在须知章时的落点），
 *     按原文顺序拼接、区间重叠去重，单章封顶、总量封顶；
 *  3) 完全找不到评分章节时返回空串（调用方回退通用检索，不硬凑）。
 */
export function buildScoringMaterial(text: string, opts?: { sectionCap?: number; totalCap?: number }): string {
  const src = text ?? ""
  if (!src.trim()) return ""
  const sectionCap = opts?.sectionCap ?? SCORING_MATERIAL_MAX_SECTION
  const totalCap = opts?.totalCap ?? SCORING_MATERIAL_MAX_TOTAL
  const spans = dedupeChaptersByTitle(detectTenderChapters(src))
  const chapterScoring = spans.filter((s) => s.category === "scoring")
  const sectionScoring = detectSectionScoringSpans(src).filter(
    (sec) => !chapterScoring.some((ch) => spansOverlap(sec, ch)),
  )
  const scoring = [...chapterScoring, ...sectionScoring].sort((a, b) => a.start - b.start)
  if (!scoring.length) return ""

  const prefaceLines: string[] = []
  for (const s of spans) {
    if (s.category !== "instructions") continue
    for (const line of src.slice(s.start, s.end).split("\n")) {
      const isTableRow = line.includes(" | ") || line.includes("｜")
      const norm = normalizeHeadingText(line)
      const declarative = !isTableRow && /^[0-9一二三十]+[、.．]*\s*(?:评标方法|评审办法|评分办法|评标标准)[：:].{2,80}$/.test(norm)
      if ((isTableRow || declarative) && /评标方法|评审办法|评分办法|评标标准/.test(norm) && norm.length <= 120) {
        if (!prefaceLines.some((l) => normalizeHeadingText(l) === norm)) prefaceLines.push(line.trim())
        if (prefaceLines.length >= 3) break
      }
    }
    if (prefaceLines.length >= 3) break
  }

  const parts: string[] = []
  let used = 0
  if (prefaceLines.length) {
    const head = `【投标人须知前附表 · 评标方法】\n${prefaceLines.join("\n")}`
    parts.push(head)
    used += head.length
  }
  for (const span of scoring) {
    if (used >= totalCap) break
    const budget = Math.min(span.category === "scoring" && chapterScoring.includes(span) ? sectionCap : SCORING_SECTION_MAX, totalCap - used)
    const body = src.slice(span.start, Math.min(span.end, span.start + budget)).trim()
    if (!body) continue
    const clipped = span.end - span.start > budget ? `${body}\n…（本章超长，已按上限截断，完整内容以原文为准）` : body
    parts.push(`【评分章节：${span.title}】\n${clipped}`)
    used += clipped.length + 12
  }
  return parts.join("\n\n").trim()
}

/**
 * 解析 key 的章节亲和表（对齐参考实现抽取优先级）：
 * 选块时亲和类别内的块按普通关键词分参与排序，亲和外类别需 3 倍关键词分才能入围
 * （抑制「第三章设备参数表」用海量「评分项」字样淹没第四章评分表）。
 */
export const KEY_CATEGORY_AFFINITY: Record<string, Partial<Record<TenderChapterCategory, number>>> = {
  tech_score: { scoring: 1, instructions: 1 },
  biz_score: { scoring: 1, instructions: 1 },
  eval_req: { scoring: 1, instructions: 1 },
  compliance: { scoring: 1, instructions: 1 },
  qualification: { scoring: 1, instructions: 1 },
  void_items: { scoring: 1, instructions: 1, other: 1 },
  delivery_req: { requirements: 1, instructions: 1 },
  purchase_list: { requirements: 1, other: 1 },
  response_req: { format: 1, instructions: 1 },
  bid_outline_req: { format: 1, instructions: 1 },
  contract_terms: { contract: 1, scoring: 1 },
  compilation_basis: { requirements: 1, instructions: 1, other: 1 },
  overview: { instructions: 1, scoring: 1 },
  project_info: { instructions: 1, scoring: 1 },
  purchaser_info: { instructions: 1 },
  agency_info: { instructions: 1 },
  bid_nodes: { instructions: 1, other: 1 },
  bid_deposit: { instructions: 1, contract: 1 },
  lots: { instructions: 1, requirements: 1, other: 1 },
  bid_open_req: { instructions: 1, scoring: 1 },
}

/**
 * key × 类别亲和分：亲和表内的类别 1 分（正常参与），表外类别 0.34（≈1/3——需 3 倍关键词分
 * 才能追平亲和块）；无亲和表的 key 全类别 1（行为同旧版）。
 */
export function categoryAffinity(key: string, category: TenderChapterCategory): number {
  const table = KEY_CATEGORY_AFFINITY[key]
  if (!table) return 1
  return table[category] === 1 ? 1 : 0.34
}
