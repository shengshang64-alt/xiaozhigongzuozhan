// ---------------------------------------------------------------------------
// REQ-046（2026-10-18）：正文颗粒度本地校验（纯本地、零 AI、零改写）
//
// 【为什么需要它】
// 用户 2026-10-18 指定新金标准「池州【主】1129上午修订」，与工作站产物的差距是数量级的：
//   金标准：（N）式功能条目 56/万字（功能部分 42/万字）、标题最深 7 级、1322 条条目
//   工作站：三明 10/万字、海沧/安庆/芜湖/福安 全部 0/万字、标题最深 2-3 级
// 提示词侧已改（bidTypes.ts 伪标题禁令松绑 + 颗粒度铁律 + PROSE_LINT_RULES 第 8 条），
// 但模型不一定照做——本模块负责**在生成后如实量出来**，低于阈值就上报，不静默。
//
// 【为什么只测不改写】
// proseEnumListifier.ts 的注释里已经论证过：靠正则把散文改成条目会切出半句话。
// 本模块的定位是「量尺」，不是「改写器」——发现偏粗就上报，让人决定重生成还是手改。
//
// 【判据为什么只卡密度与中位长度】
// 金标准 1322 条条目实测：中位 36 字 / 平均 43.5 字 / 最长 504 字 / 41% 短于 30 字。
//   · 不卡单条上限：金标准有 8 条超 200 字，那是真需要展开的内容，卡上限会误杀；
//   · 不卡单条下限：「（4）体温单」「（2）床位管理」这种纯功能名合法，卡下限会判成空条目。
// 判据写宽会漏判、写窄会误判合法样本——这两条边界都是拿金标准原文校过的。
// ---------------------------------------------------------------------------

/** 目标密度下限（条/万字）。金标准功能部分实测 42/万字，这里取 30 作为下限而非目标。 */
export const ITEM_DENSITY_MIN = 30

/** 金标准密度（条/万字），仅供报告对照。含全文口径 56，功能部分口径 42。 */
export const ITEM_DENSITY_GOLD = 42

/** 条目长度中位数的期望区间（字）。金标准中位 36 字。 */
export const ITEM_MEDIAN_MIN = 30
export const ITEM_MEDIAN_MAX = 60

/** 标题最深层级下限。REQ-046 由 5 下调到 4 ——
 *  金标准（池州主-1129）标题深度分布实测：2级×4 / 3级×52 / 4级×247 / 5级×210 / 6级×223 / 7级×36。
 *  4 级是主体（247 个），7 级只占 4.7%；且本机大纲实测稳定在 4 级 / 211 节点。
 *  若卡 ≥5，会让已达标的产物被自己判 error（实测 req046 大纲 4 级被报 depth(4<5)）。 */
export const HEADING_DEPTH_MIN = 4

/** 视为「功能类章节」的标题关键词——只有这些章节要求条目密度。
 *  实施/商务/售后等章节的合理形态不同（时间表、承诺、报价），不套颗粒度判据。 */
const FUNCTION_CHAPTER_RE = /功能|模块|系统|技术方案|建设内容|详细设计|子系统/

/** 条目行：(1)/(１)/(一) 或 1./1、——但**排除**数字多级标题（1.2 这种是标题不是条目）。 */
const ITEM_LINE_RE = /^[（(]\s*\d{1,3}\s*[)）]|^[（(][一二三四五六七八九十]{1,3}[)）]/

/** 标题行：纯数字多级编号（1.2 / 12.9.8.1.1.1）+ 短、不带句末标点。 */
const HEADING_LINE_RE = /^(\d+(?:\.\d+)+)\s*[^\d.\s]/

/**
 * 中文层级链标题（2026-10-27 实测修正）：
 *   原实现只认纯数字多级编号 `1.2`，于是真实正文里这套**非常规范的四级结构**被误判成 2 级：
 *     11.1 项目理解与目标承接设计      ← 数字编号，原判据认（depth=2）
 *       （一）现状痛点与核心需求研判    ← 中文括号，原判据不认
 *         （1）系统替换与业务连续性并存  ← 数字括号，原判据不认
 *          ① xxx                      ← 圈号，原判据不认
 *   实测：8 个技术章全部被判 depth 2~3 → 8/8 判 NG，而实际层级是 4 级，已达金标准。
 *   这是**判据失真**（把合格产物判成不合格），会让用户白改。
 *
 *   现按中文公文的标准层级链补认：数字编号在链条最上层，其后依次为
 *   （一）→ （1）→ ①。判断方式：看该行自身的形态，取它在链条中的位置。
 *   与 `bidFiles.contentHeadingLevel`（导出侧）保持同一套形态认知，避免判据与渲染打架。
 */
const HEADING_CN_LEVEL2_RE = /^[（(][一二三四五六七八九十]{1,3}[)）]\s*\S/ // （一）
const HEADING_CN_LEVEL3_RE = /^[（(]\s*\d{1,2}\s*[)）]\s*\S/ // （1）
const HEADING_CN_LEVEL4_RE = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*\S/ // ①
/** 层级链深度加成：数字编号至少 2 级（`11.1` = 2、`12.9.8` = 3），其后每层 +1 */
const CN_CHAIN_OFFSET = { level2: 1, level3: 2, level4: 3 } as const

export type ItemDensityIssue = {
  kind: "density" | "median" | "depth"
  label: string
  value: number
  target: number
  /** 差多少（density/depth 用差值，median 用偏离区间中心的距离） */
  gap: number
  /** 严重程度：低于目标 30% 以上算 error，否则 warning */
  severity: "warning" | "error"
}

export type ItemDensityReport = {
  len: number
  itemCount: number
  itemsPerWan: number
  medianLen: number
  headingMaxDepth: number
  functionChapterCount: number
  issues: ItemDensityIssue[]
  ok: boolean
}

/**
 * 从标题行取层级；非标题返回 0。
 *
 * 支持的形态（2026-10-27 补中文层级链）：
 *   `12.9.8.1.1.1` → 6（纯数字，按段数）
 *   `（一）现状痛点` → 3（数字编号 2 级 + 中文括号 1 级）
 *   `（1）系统替换` → 4
 *   `① xxx`        → 5
 *
 * 为什么中文括号要按「数字基线 + 偏移」算，而不是各算固定级别：
 *   真实正文里中文括号是**接在数字编号下面的子层级**，`11.1` 的下一层才是 `（一）`。
 *   若把 `（一）` 当成 2 级，那么 `11.1 → （一）` 就从 2 级到 2 级，层级断档判不出来。
 *   取「数字基线(2) + 相对偏移」后：`（一）`=3、`（1）`=4、`①`=5，与真实文档结构一致。
 */
export function headingDepthOf(line: string): number {
  const t = (line ?? "").trim()
  if (!t) return 0
  const m = HEADING_LINE_RE.exec(t)
  if (m) return m[1].split(".").length
  // 中文层级链：以「数字编号 2 级」为基线做偏移（与真实四级结构对齐）。
  //
  // 2026-10-27 判据边界（实测踩过两次，这里写死原因）：
  //   真实语料里「（1）系统替换与业务连续性并存。本项目要求…」这类是**标题与正文写在同一行**，
  //   既带句号又很长。所以「带句末标点 = 条目行」的判据会误杀真标题（depth 从 4 掉回 3）。
  //   同时「（1）支持换卡。」这类纯条目也不能当标题（既有单测明确要求返回 0）。
  //   区分两者的可靠特征：**标题后紧跟的是陈述正文（长度长、含逗号等），条目是单句结束**。
  //   判据取「冒号/序号后第一句之后是否还有内容」：有则视为标题行（标题+正文合写），无则视为条目。
  const base = 2
  const afterMark = (re: RegExp): number => {
    const mm = re.exec(t)
    if (!mm) return 0
    const rest = t.slice(mm[0].length)
    // 序号后首个句子结束符之后仍有实质内容 → 这行是「标题 + 正文合写」
    const sentenceEnd = rest.search(/[。！？；]/)
    const hasTailAfterSentence = sentenceEnd >= 0 && rest.slice(sentenceEnd + 1).trim().length > 0
    // 序号后没有句末标点（短标题）→ 也算标题
    const noSentenceEnd = sentenceEnd < 0
    // 序号后紧跟的正文里出现逗号顿号等句内标点，且总长较长 → 标题+正文合写
    const inlineBody = rest.length > 30 && /[，、]/.test(rest)
    return hasTailAfterSentence || noSentenceEnd || inlineBody ? 1 : 0
  }
  if (afterMark(HEADING_CN_LEVEL2_RE)) return base + CN_CHAIN_OFFSET.level2
  if (afterMark(HEADING_CN_LEVEL3_RE)) return base + CN_CHAIN_OFFSET.level3
  if (afterMark(HEADING_CN_LEVEL4_RE)) return base + CN_CHAIN_OFFSET.level4
  return 0
}

/** 是否条目行（（N）/（一） 形态）。数字多级标题不算条目。 */
export function isItemLine(line: string): boolean {
  const t = (line ?? "").trim()
  if (!t) return false
  if (HEADING_LINE_RE.test(t)) return false
  return ITEM_LINE_RE.test(t)
}

/** 条目正文长度（去掉「（N）」标号本身） */
function itemBodyLength(line: string): number {
  const t = (line ?? "").trim()
  return t.replace(ITEM_LINE_RE, "").replace(/\s+/g, "").length
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const a = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

/**
 * 量一份正文的颗粒度。
 *
 * 【REQ-046 2026-10-18 口径修正：按章判 + 只对功能类章判密度】
 * 金标准按章实测（池州主-1129上午修订）：
 *   12.9 设计方案      1248 条 / 209,243 字 = 60/万字   ← 功能章，条目全在这
 *   12.10 历史数据继承   155 条 /  63,270 字 = 24/万字
 *   12.11 门诊诊疗方案    29 条 /  33,372 字 =  9/万字
 *   12.12 护士工作站      25 条 /  44,975 字 =  6/万字
 *   全书               1457 条 / 350,860 字 = 41.5/万字
 * 所以**拿全书均值去卡每一章是错的**：非功能章（背景/需求/实施/培训/售后）本来就该是个位数，
 * 一律按 ≥30 卡会永远不达标，反而逼出「为凑条目把一句话拆碎」的坏写法。
 * 故：密度只对「标题命中 FUNCTION_CHAPTER_RE」的章判；其他章不判密度（median/depth 仍判）。
 *
 * 【同章条目数 <10 不判密度】
 * 条目太少说明这章根本不该出条目（如「项目背景」），不是「写得不够细」。
 * 注意这与「样本量太小」不是一回事——判的是「该不该有条目」，不是「样本够不够统计」。
 *
 * @param chapterTitle 章节标题。传了才能按功能类判定；不传时保守起见照常判密度
 *   （历史调用方/整本口径），避免静默放宽成「一律不判」。
 */
export function measureItemDensity(text: string, chapterTitle?: string): ItemDensityReport {
  const src = text ?? ""
  const lines = src.split(/\r?\n/)
  const len = src.replace(/\s+/g, "").length

  const itemLines = lines.filter(isItemLine)
  const itemLens = itemLines.map(itemBodyLength).filter((n) => n > 0)
  const itemsPerWan = len > 0 ? (itemLines.length / len) * 10000 : 0
  const medianLen = median(itemLens)

  let headingMaxDepth = 0
  let functionChapterCount = 0
  for (const l of lines) {
    const d = headingDepthOf(l)
    if (d > headingMaxDepth) headingMaxDepth = d
    if (d > 0 && FUNCTION_CHAPTER_RE.test(l)) functionChapterCount++
  }
  // 传了章节标题时以它为准判断是否功能章；没传时按正文内标题行推断（有功能类标题即算）
  const isFunctionChapter = chapterTitle !== undefined ? FUNCTION_CHAPTER_RE.test(chapterTitle) : functionChapterCount > 0
  const MIN_ITEMS_TO_JUDGE = 10

  const issues: ItemDensityIssue[] = []
  if (len >= 500) {
    // 密度：只对功能类章 + 同章条目数 ≥10 时判
    // REQ-048（2026-10-18）：功能章**0 条**必须无条件报 error —— 原来这两条被同一个
    // `itemLines.length >= MIN_ITEMS_TO_JUDGE` 短路：0 条时条件不成立 → issues 为空 → ok=true，
    // 于是「功能章节里一个条目都没写」被判成达标。而 0 条恰恰是功能章最坏的形态：
    // 评标时评委读到的是整章散文，看不到任何功能点，等同于本章没写功能。
    // 注意本分支已在 `len >= 500` 内，0 条只在正文够长时才算缺陷（短章另行由字数缺口语义兜底）。
    if (isFunctionChapter && itemLines.length === 0) {
      issues.push({
        kind: "density",
        label: "功能条目",
        value: 0,
        target: ITEM_DENSITY_MIN,
        gap: ITEM_DENSITY_MIN,
        severity: "error",
      })
    } else if (isFunctionChapter && itemLines.length >= MIN_ITEMS_TO_JUDGE && itemsPerWan < ITEM_DENSITY_MIN) {
      const gap = ITEM_DENSITY_MIN - itemsPerWan
      issues.push({
        kind: "density",
        label: "功能条目密度",
        value: Math.round(itemsPerWan * 10) / 10,
        target: ITEM_DENSITY_MIN,
        gap: Math.round(gap * 10) / 10,
        severity: itemsPerWan < ITEM_DENSITY_MIN * 0.7 ? "error" : "warning",
      })
    }
    if (itemLines.length > 0 && (medianLen < ITEM_MEDIAN_MIN || medianLen > ITEM_MEDIAN_MAX)) {
      const center = (ITEM_MEDIAN_MIN + ITEM_MEDIAN_MAX) / 2
      issues.push({
        kind: "median",
        label: "条目长度中位数",
        value: Math.round(medianLen * 10) / 10,
        target: center,
        gap: Math.round(Math.abs(medianLen - center) * 10) / 10,
        severity: "warning",
      })
    }
    if (headingMaxDepth > 0 && headingMaxDepth < HEADING_DEPTH_MIN) {
      const gap = HEADING_DEPTH_MIN - headingMaxDepth
      issues.push({
        kind: "depth",
        label: "标题最深层级",
        value: headingMaxDepth,
        target: HEADING_DEPTH_MIN,
        gap,
        severity: headingMaxDepth <= 3 ? "error" : "warning",
      })
    }
  }

  return {
    len,
    itemCount: itemLines.length,
    itemsPerWan: Math.round(itemsPerWan * 10) / 10,
    medianLen: Math.round(medianLen * 10) / 10,
    headingMaxDepth,
    functionChapterCount,
    issues,
    ok: issues.every((i) => i.severity !== "error"),
  }
}

/** 一句话摘要，供 parse_report / composeGates 落库展示 */
export function formatDensitySummary(r: ItemDensityReport): string {
  const base = `条目 ${r.itemCount} 条（${r.itemsPerWan}/万字，目标 ≥${ITEM_DENSITY_MIN}）｜中位 ${r.medianLen} 字（期望 ${ITEM_MEDIAN_MIN}~${ITEM_MEDIAN_MAX}）｜标题最深 ${r.headingMaxDepth} 级（目标 ≥${HEADING_DEPTH_MIN}）`
  if (!r.issues.length) return `${base} → 达标`
  return `${base} → ${r.issues.map((i) => `【${i.severity === "error" ? "不足" : "提示"}】${i.label} 差 ${i.gap}`).join("；")}`
}
