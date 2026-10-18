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

/**
 * 章节标题 → 结构类别（评分类关键词最先判，避免「评分办法前附表」被须知类抢先）
 *
 * REQ-015（2026-10-17）：补「合写标题」缺口。实测 96 份真招标文件里，
 * 福建政采常见章名是「第四章 资格审查与评标」——**评审/评标与资格审查合写在同一章**，
 * 旧词表只有「评标办法|评标方法|评分标准…」这类独立章名，命中不到，于是该章判 other、
 * 评分素材整章丢空（实测 28 例次、17 份文件因此 0 字）。
 * 补词只加「合写」形态，不改成裸 /评标|评分/ 宽判据：宽判据实测会多认 224 个 span、
 * 额外救回 0 份，纯噪声（见 REQ-015 决策实验）。
 */
export function classifyChapterTitle(title: string): TenderChapterCategory {
  const t = normalizeHeadingText(title ?? "")
  if (/评标办法|评标方法|评标方案|评审办法|评审标准|评分办法|评分标准|评分细则|评标标准|评标细则|详细评审|综合评分/.test(t)) return "scoring"
  // 合写标题：资格审查/资格评审 + 评标/评审/评分 同章（福建政采常见「第四章 资格审查与评标」）
  if (/资格(?:审查|评审|预审)?(?:与|和|及|、)?(?:评标|评审|评分)/.test(t)) return "scoring"
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
    const nl = src.indexOf("\n", offset)
    const end = nl < 0 ? src.length : nl
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

/**
 * 评分素材单章封顶与总预算。
 *
 * REQ-020（2026-10-17）：原 30k 单章 / 36k 总量是**纯字符切片**，会把超长评分章从行中间切断：
 *  - #46「第四章 评标办法」章长 56,523 字，只取前 30,000，丢 26,523 字（46.9%），切点落在句中
 *    「…本项满分2分。 | 2」；#60 章长 33,759 字，被切 3,759 字，丢 15 个评分项、T8 被切半句。
 *  - 下游 AI 拿到半条评分标准**却看起来像完整的一条**，比整条缺失更危险。
 *
 * 实测 96 份真实语料（REQ-020 量测，见 chapLen96.txt）：评分章 > 30k 的只有 2 份
 * （#46 56,523 / #60 33,759），有评分章的 65 份中位数 9,553、均值 11,018。
 * 取整章后全库素材总量 682,947 → 712,172（**+29,225 字，+4.3%**），
 * 且只有那 2 份变大（#46 +25,601 / #60 +3,624），其余 94 份**一字不变**。
 * 故把上限放宽到覆盖实测最长章（60k 单章 / 120k 总量），
 * 并配合 sliceWholeLines 的**整行整项**取舍——宁可少取一整行，也不切半句。
 */
export const SCORING_MATERIAL_MAX_SECTION = 60000
export const SCORING_MATERIAL_MAX_TOTAL = 120000
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

// ---------------------------------------------------------------------------
// REQ-018（2026-10-17）：**表锚定**评分表落地——谈判/磋商类文件评分表抓不出。
//
// 缺陷（验收官逐份核完 96 份真语料，25 份 0 素材里 9 份是真缺陷）：
//  - B-1「评分表在第二章竞争性磋商须知内」（#80/#84/#86/#92/#93）：章名不含评分词，
//    整章判 other，章级路径取不到；节级路径要求「编号+评分细则」式的节标题，也取不到。
//  - B-2「五列表，分值在第 3 列」（#82）：表头 `序号 | 考核内容 | 分值 | 评分标准 | 得分`，
//    分值不在第 2 列——任何"按列位置"的判据都会把「序号」当分值。
//  - B-3「完全扁平文档」（#6，36.8 万字、**0 个章级 span**）：扩词表对它完全无效，
//    评分表在文末 37.2 万字符处，只有表锚定能救。
//
// 为什么不扩词表：扩词表只救 B-1（把「竞争性磋商须知」判成 scoring 会让整章 5 万字进素材，
// 其中九成是须知条款而非评分表），B-2/B-3 一点救不了。宽判据 /评标|评分/ 也已实测否决
// （REQ-015 决策实验：多认 224 个 span、额外救回 0 份）。
//
// 判据（硬门槛，逐条都有反向实证）：
//  1) 表头必须**同时**出现「项目标签列」与「分值列名」——这是唯一能挡住 #53（第 2 列是
//     「采购数量」不是分值）、#24/#57（Braden/Ramsay 临床量表）、#66/#40（交叉引用）的闸门；
//     靠列位置或列数都挡不住。
//  2) 分值列必须在项目列右侧，且**不是最后一列**——`… | 评分标准 | 得分` 的「得分」是
//     人工填写栏，锚到它等于把空列当分值。
//  3) 其后只在**列数一致**（或仅尾部单元格被抽取器丢弃）的行上按锚定列位取分值；
//     分值须是 1-100 的纯数字。列数不符即停（#84 的「2 | 供应商具有…」是名称列被合并单元格
//     吞掉的续行，属 REQ-019 的另一类缺陷，不并入评分行数）。
//  4) 允许跳过错行继续收（#6 的评分表被 mammoth 拆成多张 table、中间夹正文），但连续错行
//     超过 MAX_GAP、遇新表头或章级标题即停——否则会把整篇正文吞进表。
// 行数下限 2：单行的「项目 | 分值 | 说明」比表更可能是正文里的零散提及，宁可漏报不虚报。
// ---------------------------------------------------------------------------

/** 表头的「项目标签列」：这些词单独成格才算名称列（`项目`/`名称` 必须整格精确匹配） */
const RE_TABLE_NAME_LABEL =
  /^(?:评标项目|评分项目|评审项目|评审内容|考核内容|评审因素|评分因素|评分项|评分内容|评标方法|评分标准|项目|名称|考核项)$/
/** 表头的「分值列名」：硬门槛——没有这一列就绝不按列取分值 */
const RE_TABLE_SCORE_LABEL = /^(?:分值|分数|权重|满分|标准分|分|评标分值|评分分值)$/
/** 分值单元格：纯数字或「N分」，接受 0-100 */
const RE_TABLE_SCORE_CELL = /^(\d+(?:\.\d+)?)\s*分?$/
/** 允许跨过的非表格行数（#6 被拆表时中间夹正文段落，实测最多夹 4 行） */
const TABLE_ROW_MAX_GAP = 6
/** 表内至少要有几行评分行才认（单行更可能是正文里的零散提及） */
const TABLE_MIN_SCORE_ROWS = 2

interface ScoreTableHit {
  /** 表头行在 lines 里的下标 */
  headerLine: number
  title: string
  rows: number
  /** 表格在全文中的起止偏移（表头行首 → 末个评分行行尾） */
  start: number
  end: number
}

function tableCells(line: string): string[] | null {
  if (!line.includes("|") && !line.includes("｜")) return null
  const cells = line.split(/\s*[|｜]\s*/).map((c) => c.trim())
  return cells.length >= 2 ? cells : null
}

/** 表头锚定：返回名称列与分值列下标；不满足硬门槛返回 null */
function scoreTableAnchor(cells: string[]): { nameIdx: number; scoreIdx: number } | null {
  let nameIdx = -1
  let scoreIdx = -1
  cells.forEach((c, i) => {
    if (nameIdx < 0 && RE_TABLE_NAME_LABEL.test(c)) nameIdx = i
    if (scoreIdx < 0 && RE_TABLE_SCORE_LABEL.test(c)) scoreIdx = i
  })
  if (nameIdx < 0 || scoreIdx < 0 || scoreIdx <= nameIdx) return null
  return { nameIdx, scoreIdx }
}

function tableCellScore(cells: string[], idx: number): number | null {
  const m = RE_TABLE_SCORE_CELL.exec(cells[idx] ?? "")
  if (!m) return null
  const v = Number(m[1])
  return v > 0 && v <= 100 ? v : null
}

/**
 * 扫描表锚定的评分表，只返回**行数达标**的表头位置与疑似项数。
 * 只用于给 buildScoringMaterial 一个取材锚点，不产出评分项真值（真值仍靠下游 AI 读原文）。
 */
function detectScoreTables(lines: ScanLine[]): ScoreTableHit[] {
  const out: ScoreTableHit[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = tableCells(lines[i].text)
    if (!cells || cells.length < 3) continue
    const anchor = scoreTableAnchor(cells)
    if (!anchor) continue
    const width = cells.length
    let rows = 0
    let gap = 0
    let lastRow = i
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j].text.trim()
      if (!raw) {
        if (++gap > TABLE_ROW_MAX_GAP) break
        continue
      }
      // 章级标题一定终止表格（表不会跨章）
      if (isChapterHeadingLine(raw)) break
      const rc = tableCells(raw)
      if (rc && rc.length >= 2) {
        // 下一张表的表头
        if (scoreTableAnchor(rc)) break
        // 列数一致，或仅尾部单元格被抽取器丢弃（分值仍在锚定列位）
        const shapeOk = rc.length === width || (rc.length === width - 1 && tableCellScore(rc, anchor.scoreIdx) !== null)
        if (shapeOk && tableCellScore(rc, anchor.scoreIdx) !== null) {
          rows++
          lastRow = j
          gap = 0
          continue
        }
      }
      if (++gap > TABLE_ROW_MAX_GAP) break
    }
    if (rows >= TABLE_MIN_SCORE_ROWS) {
      const lastText = lines[lastRow].text
      out.push({
        headerLine: i,
        title: `评分表（表锚定·${rows} 行）`,
        rows,
        start: lines[i].start,
        end: lines[lastRow].start + lastText.length,
      })
      i = lastRow
    }
  }
  return out
}

/**
 * REQ-020：按**整行**截取 src[start, end)，绝不切在行中间。
 *
 * 旧实现 `src.slice(start, start + budget)` 是纯字符切片，切点常落在句中——实测 #46 切在
 * 「…本项满分2分。 | 2」、#60 把 T8 从 286 字切成 103 字（断在「…内容与要点」）。
 * 下游 AI 拿到半条评分标准却看起来像完整一条，比整条缺失更危险。
 *
 * 规则：逐行累加，**整行**放得进 budget 才收；第一行就放不下的，也至少收这一整行
 * （否则短 budget 会返回空串，反而比旧行为更差）。
 * 返回 { text, complete }：complete=false 表示因预算没取完。
 */
function sliceWholeLines(src: string, start: number, end: number, budget: number): { text: string; complete: boolean } {
  const cap = Math.max(0, budget)
  const out: string[] = []
  let used = 0
  let offset = start
  let complete = true
  while (offset < end) {
    let nl = src.indexOf("\n", offset)
    if (nl < 0 || nl > end) nl = end
    const line = src.slice(offset, nl)
    const cost = line.length + 1 // +1 计入换行，保证 joined 长度不超过 budget
    if (used + cost > cap && out.length > 0) {
      complete = false
      break
    }
    out.push(line)
    used += cost
    offset = nl + 1
  }
  if (offset < end) complete = false
  return { text: out.join("\n"), complete }
}

/**
 * 评分办法专属素材（tech_score / biz_score 主路径，替代关键词检索选块）：
 *  1) 前附表「评标方法」行（效力最高的一行式声明，如「21.2 | 评标方法 | ☑综合评分法」）——
 *     从须知类 span 的竖线表格行/编号声明行里捞，最多 3 行，置于素材开头；
 *  2) 评分类别章（同名取最长 span）+ 内嵌节级评分标题（评标办法内嵌在须知章时的落点），
 *     按原文顺序拼接、区间重叠去重，单章封顶、总量封顶；
 *  3) REQ-018：上述两条都覆盖不到的**表锚定评分表**（谈判/磋商类，评分表藏在须知章内、
 *     或整篇扁平无章级 span）作为兜底入素材——只取表头行到末个评分行，不扩到整章；
 *  4) 完全找不到评分章节时返回空串（调用方回退通用检索，不硬凑）。
 */
export function buildScoringMaterial(text: string, opts?: { sectionCap?: number; totalCap?: number }): string {
  return buildScoringMaterialDetail(text, opts).text
}

/** REQ-020（2026-10-18）：评分素材的**带诊断**版本——多返回「是否被截断 / 收了多少 / 丢了多少 / 从第几行丢」。
 *
 * 为什么要单开一个函数而不是改 buildScoringMaterial 的返回值：
 *   buildScoringMaterial 被 40+ 处测试与 3 处生产调用点直接引用，改签名会连带动一大批断言；
 *   这里只做「加一个带诊断的入口」，原函数签名与行为逐字不变（委托调用，输出完全一致）。
 *
 * 截断提示此前只拼进素材文本（`…（本章超长，已按整行截断…）`）→ 只喂给模型，
 * **用户在界面上看不到**，等于仍然静默。本函数的诊断字段供解析主链写进
 * `parse_report.scoringTruncation`，由 ParseReportPanel 在界面上展示。
 *
 * 为什么告警不进 `parse_report.warnings`：`summarizeParseWarnings` 把 `warnings.length`
 * 当 `failedChunks` 返回，且 `bidParseBackfill.test.ts:61` 断言它为 2 ——
 * 往 warnings 里 push 一条会破该断言，而改断言等于放宽既有校验（禁止）。故独立成字段。 */
export function buildScoringMaterialDetail(
  text: string,
  opts?: { sectionCap?: number; totalCap?: number },
): { text: string; truncated: boolean; keptChars: number; droppedChars: number; droppedFromLine: number } {
  const src = text ?? ""
  const empty = { text: "", truncated: false, keptChars: 0, droppedChars: 0, droppedFromLine: 0 }
  if (!src.trim()) return empty
  const sectionCap = opts?.sectionCap ?? SCORING_MATERIAL_MAX_SECTION
  const totalCap = opts?.totalCap ?? SCORING_MATERIAL_MAX_TOTAL
  const spans = dedupeChaptersByTitle(detectTenderChapters(src))
  const chapterScoring = spans.filter((s) => s.category === "scoring")
  const sectionScoring = detectSectionScoringSpans(src).filter(
    (sec) => !chapterScoring.some((ch) => spansOverlap(sec, ch)),
  )
  // REQ-018：表锚定兜底。只在**章级/节级都没覆盖到**的评分表上生效——
  // 已经从评分章整章取材的文件（海沧/福安等）行为不变，避免同一张表被取两遍。
  const knownScoring = [...chapterScoring, ...sectionScoring]
  const tableScoring: TenderChapterSpan[] = detectScoreTables(scanLines(src))
    .filter((t) => !knownScoring.some((s) => spansOverlap(t, s)))
    .map((t) => ({ title: t.title, category: "scoring" as const, start: t.start, end: t.end }))
  const scoring = [...chapterScoring, ...sectionScoring, ...tableScoring].sort((a, b) => a.start - b.start)
  if (!scoring.length) return empty

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
  // REQ-020：收集截断诊断（首个被截断的 span 起始行 + 累计丢弃字数）
  let droppedChars = 0
  let droppedFromLine = 0
  let truncated = false
  for (const span of scoring) {
    if (used >= totalCap) {
      // 总额封顶导致后续整章未纳入，同样算截断
      truncated = true
      droppedChars += span.end - span.start
      if (!droppedFromLine) droppedFromLine = src.slice(0, span.start).split("\n").length
      continue
    }
    const budget = Math.min(span.category === "scoring" && chapterScoring.includes(span) ? sectionCap : SCORING_SECTION_MAX, totalCap - used)
    // REQ-020：整行整项取舍，绝不切在句中（旧实现 src.slice 会把评分标准切成半句）
    const { text: body, complete } = sliceWholeLines(src, span.start, span.end, budget)
    const trimmed = body.trim()
    if (!trimmed) continue
    if (!complete) {
      truncated = true
      // body 实际覆盖的字符数 ≈ trimmed 长度（去掉首尾空白），剩余部分即被丢弃
      const took = trimmed.length
      droppedChars += Math.max(0, span.end - span.start - took)
      if (!droppedFromLine) droppedFromLine = src.slice(0, span.start + took).split("\n").length
    }
    const clipped = complete
      ? trimmed
      : `${trimmed}\n…（本章超长，已按整行截断，完整内容以原文为准）`
    parts.push(`【评分章节：${span.title}】\n${clipped}`)
    used += clipped.length + 12
  }
  const out = parts.join("\n\n").trim()
  return { text: out, truncated, keptChars: out.length, droppedChars, droppedFromLine }
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
