// ---------------------------------------------------------------------------
// R-031（安中医 2026BFAFZ50845 实测·编制层 A1-A6）：编制门禁（纯函数、零 AI、可脱离浏览器单测）
//
// 全链路验收发现：解析层病根传导到编制层——大纲重复章、gen_status 失真、★响应张冠李戴、
// 规定目录缺失、数字矛盾、评分无落点。本模块把六项检查固化为可自动运行的门禁函数，
// 每轮编制完成后调用，结果写入 compose_gates 字段持久化并在 UI 以红/黄横幅呈现。
// 铁律：本地扫描/校验类函数保持纯函数、零 AI 调用，可脱离浏览器单测。
// ---------------------------------------------------------------------------

import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { ParseReport, NumberedScoringItem } from "./bidTypes"
import { isDemoScoreTitle, isNonChapterScoringItem, numberScoringItems, sectionText, STAR_CLAUSE_SECTION, BID_OUTLINE_REQ_KEY } from "./bidTypes"

// ==================== A1: 大纲重复章检测与合并建议 ====================

export interface DuplicateChapterGroup {
  /** 归一化后的同名/近似主题 */
  label: string
  /** 重复出现的章 node_id 列表 */
  nodeIds: string[]
  /** 建议保留的 node_id（优先带子章/正文的） */
  keepId: string
}

/** 标题归一化用于相似度比对：去编号前缀、去空白、转小写 */
function normTitle(t: string): string {
  return (t ?? "").replace(/^\d+[.、)）\s]*/, "").replace(/[\s()（）]+/g, "").toLowerCase()
}

/**
 * A1（安中医 2026BFAFZ50845）：检测大纲中同名/近似评分项的重复章。
 * 判据：归一化后标题包含关系（A包含B 或 B包含A）视为同主题。
 * 安中医实测：「项目团队配备」在融合章7和裸章10重复出现。
 */
export function detectDuplicateChapters(outline: OutlineNode[]): DuplicateChapterGroup[] {
  const top = outline ?? []
  const groups: DuplicateChapterGroup[] = []
  const used = new Set<string>()
  for (let i = 0; i < top.length; i++) {
    if (used.has(top[i].id)) continue
    const ni = normTitle(top[i].title)
    if (!ni) continue
    const siblings: OutlineNode[] = [top[i]]
    for (let j = i + 1; j < top.length; j++) {
      if (used.has(top[j].id)) continue
      const nj = normTitle(top[j].title)
      if (!nj) continue
      if (ni.includes(nj) || nj.includes(ni) || ni === nj) {
        siblings.push(top[j])
        used.add(top[j].id)
      }
    }
    if (siblings.length > 1) {
      used.add(top[i].id)
      // keep = 带子章的优先，否则按顺序保留第一个
      const keep = siblings.find((s) => s.children?.length) ?? siblings[0]
      groups.push({
        label: top[i].title,
        nodeIds: siblings.map((s) => s.id),
        keepId: keep.id,
      })
    }
  }
  return groups
}

// ==================== A2: gen_status 门禁 ====================

export interface GenStatusViolation {
  nodeId: string
  title: string
  gen_status: string
  reason: string
}

/**
 * A2（安中医 2026BFAFZ50845）：gen_status 失真检测——
 * 空章（content.trim()===""）标 done → 违规；
 * failed 但未写 genError → 违规。
 */
export function detectGenStatusViolations(chapters: Chapter[]): GenStatusViolation[] {
  const out: GenStatusViolation[] = []
  for (const ch of chapters ?? []) {
    const body = (ch.content ?? "").trim()
    if (ch.gen_status === "done" && !body) {
      out.push({ nodeId: ch.node_id, title: ch.title, gen_status: "done", reason: "正文为空但标记 done" })
    }
    if (ch.gen_status === "failed" && !(ch as Chapter & { genError?: unknown }).genError) {
      out.push({ nodeId: ch.node_id, title: ch.title, gen_status: "failed", reason: "失败未写 genError" })
    }
  }
  return out
}

// ==================== A3: ★响应保真门禁 ====================

export interface StarFidelityViolation {
  nodeId: string
  title: string
  /** 缺失的 ★条款编号 */
  missingClauses: number[]
}

/**
 * A3（安中医 2026BFAFZ50845）：★条款响应完整性检测——
 * star_clauses 分区中的 ★1~★N，每条须有至少一章正文包含该条款关键文本。
 * 简化判据：star_clauses 每条款取前 30 字作为 fingerprint，在各章 content 中查找（归一化后）。
 */
export function detectStarFidelityGaps(report: ParseReport | null, chapters: Chapter[]): StarFidelityViolation[] {
  const starText = sectionText(report, STAR_CLAUSE_SECTION.key)
  if (!starText.trim()) return []
  // 条款分隔：每个★条款以多行文本存储（正文+★N+注行），以空行或★标记行为分界
  // 提取每条款的实质正文行（非标记行、非注行）作为 fingerprint 来源
  const allLines = starText.split("\n")
  const clauses: string[] = []
  let buf: string[] = []
  for (const l of allLines) {
    const t = l.trim()
    if (/^★\d+/.test(t)) {
      // 标记行：flush 当前 buf（不含标记行），开始下一条
      if (buf.length) clauses.push(buf.join(""))
      buf = [] // 标记本身不作为 fingerprint
      continue
    }
    if (/^注\s*[：:]/.test(t)) continue // 注行跳过
    if (t) buf.push(t)
  }
  if (buf.length) clauses.push(buf.join(""))
  // 若未提取到分条款体，回退按★行计数
  const effectiveClauses = clauses.length > 0 ? clauses : allLines.filter((l) => /★\d+/.test(l))
  const normalizedChapters = (chapters ?? []).map((ch) => ({
    nodeId: ch.node_id,
    title: ch.title,
    normContent: (ch.content ?? "").replace(/\s+/g, ""),
  }))
  const missingClauses: number[] = []
  for (let i = 0; i < effectiveClauses.length; i++) {
    const fingerprint = effectiveClauses[i].replace(/★\d+\s*/, "").replace(/\s+/g, "").slice(0, 30)
    if (fingerprint.length < 5) continue
    const found = normalizedChapters.some((ch) => ch.normContent.includes(fingerprint))
    if (!found) missingClauses.push(i + 1)
  }
  if (!missingClauses.length) return []
  // 归责到负责响应的章（标题含 "响应" / "参数" / "技术"）
  const respChapters = normalizedChapters.filter((ch) => /响应|参数|技术/.test(ch.title))
  return respChapters.length
    ? [{ nodeId: respChapters[0].nodeId, title: respChapters[0].title, missingClauses }]
    : [{ nodeId: "__all__", title: "全文", missingClauses }]
}

// ==================== A4: 规定目录强制落点 ====================

/** 目录项类别：商务固定格式 / 技术标必须承载 / 无明确归属 */
export type CatalogItemKind = "biz_fixed" | "tech_required" | "neutral"

export interface CatalogGap {
  /** 规定目录条目 */
  item: string
  /** 大纲中是否有对应章节 */
  found: boolean
  /** 该目录项属于哪一侧（决定仅技术模式下算不算缺） */
  kind: CatalogItemKind
}

/** 商务固定格式（第一篇，投标人线下填写／商务分册承载，技术标不承载） */
const BIZ_FIXED_ITEM_RE =
  /开标一览|投标函|报价表|分项报价|资格声明|授权书|授权委托|法定代表人|中小企业声明|残疾人福利|诚信(履约|投标)承诺|业绩承诺函|商务响应表|投标保证金|投标响应|其他材料/

/** 技术标必须承载（服务方案／人员／承诺／响应表／证明材料——不单独成章，评标专家按目录就翻不到） */
const TECH_REQUIRED_ITEM_RE = /人员配备|项目团队|服务方案|服务承诺|技术响应|技术偏离|响应表|证明材料/

export function classifyCatalogItem(name: string): CatalogItemKind {
  const n = (name ?? "").replace(/\s+/g, "")
  if (!n) return "neutral"
  // 先判商务：像「投标响应表（商务响应表、其他材料）」这类同时沾边的，按商务固定格式处理
  if (BIZ_FIXED_ITEM_RE.test(n)) return "biz_fixed"
  if (TECH_REQUIRED_ITEM_RE.test(n)) return "tech_required"
  return "neutral"
}

/**
 * 目录原文 → 条目。剥掉三种编号：中文序号（一／十一／（一））、阿拉伯多级号（6.1／1.）、括号号（（1））。
 *
 * 为什么必须剥：原实现只剥 `^\d+[.、)）]`，对「一 开标一览表」这类中文序号完全无效 →
 * 真实库三个项目实测 **16/16 项全部判缺**（见 2026-10-22 复核），A4 于是常年全红，
 * 「目录没对齐」这件真事被淹没在噪音里，用户和系统都不知道到底差哪几条。
 */
export function parseCatalogItems(catalogText: string): string[] {
  return (catalogText ?? "")
    .split(/[\n;；]+/)
    .map((raw) =>
      raw
        // 括号序号：（一）／（1）——括号本身即分隔，后面不需要再跟分隔符
        .replace(/^\s*[（(][一二三四五六七八九十百]+[)）][、.．\s]*/, "")
        .replace(/^\s*[（(]\d+(?:\s*[.．]\s*\d+)*[)）][、.．\s]*/, "")
        // 中文裸序号：一、／十一.  —— 后面必须跟分隔符，防「一体化平台」被误剥
        .replace(/^\s*[一二三四五六七八九十百]+[、.．\s]+/, "")
        // 阿拉伯多级号：6.1／1.
        .replace(/^\s*\d+(?:\s*[.．]\s*\d+)*[、.．\s]+/, "")
        .replace(/[：:].*$/, "")
        .trim(),
    )
    .filter((s) => s.length >= 2 && s.length <= 30)
}

/** 目录项在大纲里的落点下标（逐字包含 + 语义等价两条路） */
function catalogItemLandingIdx(item: string, norms: string[]): number[] {
  const n = normTitle(item)
  if (!n) return []
  const hit: number[] = []
  norms.forEach((t, i) => {
    if (t.includes(n) || (n.length >= 3 && t.length >= 3 && n.includes(t))) hit.push(i)
  })
  if (hit.length) return hit
  const alias = (re: RegExp): number[] => {
    const out: number[] = []
    norms.forEach((t, i) => {
      if (re.test(t)) out.push(i)
    })
    return out
  }
  // 语义等价：评委按目录找的是「这一部分在不在」，不是标题逐字相同。
  // 但只认「目录项本身的名字」，不认宽泛关键词——实测「业务连续性承诺与保障」会把
  // 「服务承诺」判成已承载，「★…证明材料清单」会把「其他相关证明材料」判成已承载，
  // 都是假绿。宁可多报一条，也不能让缺失的目录章静默过关。
  if (/人员配备|项目团队/.test(n)) return alias(/团队|人员配备/)
  // 「服务方案」在招标文件里是一整个部分，技术标按评分项拆成多章即可视为已承载
  if (/服务方案/.test(n)) {
    const m = alias(/方案|实施|培训|售后|应急/)
    return m.length >= 3 ? m : []
  }
  if (/服务承诺/.test(n)) return alias(/服务承诺/)
  if (/证明材料/.test(n)) return alias(/证明材料|材料索引/)
  if (/响应表|偏离/.test(n)) return alias(/响应表|偏离表/)
  return []
}

/** 大纲全部节点的标题 + 归一化 + 所属顶层章标题（目录落点与索引表共用） */
function collectTitles(nodes: OutlineNode[]): { title: string; norm: string; chapter: string }[] {
  const out: { title: string; norm: string; chapter: string }[] = []
  const walk = (list: OutlineNode[], chapter: string) => {
    for (const n of list ?? []) {
      const title = String(n.title ?? "")
      out.push({ title, norm: normTitle(title), chapter: chapter || title })
      if (n.children?.length) walk(n.children, chapter || title)
    }
  }
  walk(nodes ?? [], "")
  return out
}

/**
 * A4（安中医 2026BFAFZ50845）：bid_outline_req 规定目录逐项在大纲中有落点。
 *
 * `scope` 决定口径：仅技术模式（scope=tech）下，商务固定格式项（开标一览表/投标函/报价表…）
 * 由商务分册线下承载，不算技术标缺章；否则每份技术标都会背着 11 条永远补不上的红字。
 */
export function detectCatalogGaps(
  report: ParseReport | null,
  outline: OutlineNode[],
  opts?: { scope?: "biz" | "tech" | "both" },
): CatalogGap[] {
  return buildCatalogIndex(report, outline, opts).map(({ item, found, kind }) => ({ item, found, kind }))
}

export type CatalogIndexRow = {
  /** 目录项（已剥序号） */
  item: string
  kind: CatalogItemKind
  found: boolean
  /** 承载该目录项的顶层章标题（去重；可能多项 = 整组承载） */
  chapters: string[]
}

/**
 * 招标目录 → 本册章节的对照表（纯函数、零 AI）。
 *
 * 用途有两个，判据完全同源：
 *  ① 编制门禁 A4 判「有没有落点」（detectCatalogGaps 只是它的投影）；
 *  ② 导出时生成《投标文件目录对照表》——技术标不按招标目录另起章（评标按评分表找章），
 *     但评委按目录翻不到也会丢分，用一张对照表同时满足两种找法。
 */
export function buildCatalogIndex(
  report: ParseReport | null,
  outline: OutlineNode[],
  opts?: { scope?: "biz" | "tech" | "both" },
): CatalogIndexRow[] {
  const catalogText = sectionText(report, BID_OUTLINE_REQ_KEY).trim()
  if (!catalogText) return [] // 无目录要求 → 不检查
  const items = parseCatalogItems(catalogText)
  if (!items.length) return []
  const nodes = collectTitles(outline ?? [])
  const norms = nodes.map((n) => n.norm)
  const rows: CatalogIndexRow[] = items.map((item) => {
    const idx = catalogItemLandingIdx(item, norms)
    const chapters: string[] = []
    for (const i of idx) {
      const c = nodes[i]?.chapter ?? ""
      if (c && !chapters.includes(c)) chapters.push(c)
    }
    return { item, kind: classifyCatalogItem(item), found: idx.length > 0, chapters }
  })
  const scope = opts?.scope ?? "both"
  if (scope === "tech") return rows.filter((r) => r.kind !== "biz_fixed")
  if (scope === "biz") return rows.filter((r) => r.kind !== "tech_required")
  return rows
}

// ==================== A5: 数字一致性冲突 ====================

export interface NumberConflict {
  /** 冲突的指标关键词 */
  topic: string
  /** 冲突值列表 */
  values: string[]
  /** 出现的章标题 */
  chapters: string[]
}

/**
 * A5（安中医 2026BFAFZ50845）：编制后数字一致性自检——
 * 同一指标关键词（如"可用性"）在多个章中出现不同数值（99.5% vs 99.9%）视为冲突。
 * 简化实现：按常见 SLA/质保 指标词扫描，检测同 topic 多值。
 */
export function detectNumberConflicts(chapters: Chapter[]): NumberConflict[] {
  const TOPIC_PATTERNS = [
    /可用性[：:\s]*([\d.]+\s*%)/g,
    /响应时间[：:\s]*(\d+\s*(?:小时|分钟|h|min))/gi,
    /质保[期限][：:\s]*(\d+\s*年)/g,
    /保留[期限][：:\s]*(\d+\s*(?:年|月|天))/g,
  ]
  const topicMap = new Map<string, Map<string, Set<string>>>()
  for (const ch of chapters ?? []) {
    const body = ch.content ?? ""
    for (const re of TOPIC_PATTERNS) {
      let m: RegExpExecArray | null
      re.lastIndex = 0
      while ((m = re.exec(body)) !== null) {
        const topic = body.slice(Math.max(0, m.index - 5), m.index).replace(/[\d.\s]/g, "").trim()
        if (!topic) continue
        if (!topicMap.has(topic)) topicMap.set(topic, new Map())
        const byVal = topicMap.get(topic)!
        const val = m[1].trim()
        if (!byVal.has(val)) byVal.set(val, new Set())
        byVal.get(val)!.add(ch.title)
      }
    }
  }
  const conflicts: NumberConflict[] = []
  for (const [topic, byVal] of topicMap) {
    if (byVal.size > 1) {
      conflicts.push({
        topic,
        values: [...byVal.keys()],
        chapters: [...new Set(Array.from(byVal.values()).flatMap((s) => Array.from(s)))],
      })
    }
  }
  return conflicts
}

// ==================== A6: 评分落点全覆盖 ====================

export interface ScoringLandingGap {
  /** 评分项编号+标题 */
  itemId: string
  itemTitle: string
  score: number
  /** 是否有非空落点章 */
  hasLanding: boolean
}

/**
 * A6（安中医 2026BFAFZ50845）：评分项逐项有非空落点章。
 * 判据：每个评分项标题归一化后，至少一章（gen_status=done 且 content 非空）标题/正文包含它。
 */
export function detectScoringLandingGaps(
  report: ParseReport | null,
  chapters: Chapter[],
): ScoringLandingGap[] {
  // 2026-10-23（真实项目实测）：A6 原来把**所有**评分项都要求有技术章，于是
  //   · 商务评分项（价格分/商务分）——落点在商务分册，永远不会有技术章 → 每个项目恒假阻断；
  //   · 资信类（业绩/团队/证书）——落点在证明材料；
  //   · 演示项——现场演示计分（用户已裁定不进大纲）。
  // 这三类都排除，A6 只判「方案类技术评分项」有没有正文落点。
  const items = numberScoringItems(report).filter(
    (it) => it.category === "tech" && !isNonChapterScoringItem(it.item) && !isDemoScoreTitle(it.item),
  )
  if (!items.length) return []
  const nonEmptyChapters = (chapters ?? []).filter((ch) => (ch.content ?? "").trim().length > 50)
  const normalizedContents = nonEmptyChapters.map((ch) => ({
    normTitle: normTitle(ch.title),
    normBody: (ch.content ?? "").replace(/\s+/g, "").slice(0, 3000),
  }))
  return items.map((item: NumberedScoringItem) => {
    const t = normTitle(item.item)
    const found = normalizedContents.some(
      (ch) => ch.normTitle.includes(t) || (t.length > 4 && ch.normBody.includes(t.replace(/[\s()（）]/g, ""))),
    )
    return { itemId: item.id, itemTitle: item.item, score: item.score, hasLanding: found }
  })
}

// ==================== B1: 标书检查与工作台一致性（R-032） ====================

export interface ConsistencyIssue {
  /** 来源模块 */
  source: "bid_check" | "bid_workspace"
  /** 矛盾描述 */
  description: string
}

/**
 * R-032（第四节地图·模块2）：同一项目在「标书工作台·废标检查」和「标书检查中枢」
 * 两处结论不得矛盾。判据：
 *  - 工作台 void_items 有 N 条废标条款 → BidCheck L2 响应规则不得报"废标条款缺失"（反向亦然）；
 *  - 工作台 star_clauses 有 M 条★ → BidCheck 实质性条款引用检查不得判"无★条款"。
 * 本函数接收两侧结果做交叉比对，输出矛盾清单。
 * 纯函数、零 AI、可脱离浏览器单测。
 */
export function checkConsistency(
  workspaceVoidCount: number,
  workspaceStarCount: number,
  bidCheckResults: { code: string; title?: string; status: string; hits?: unknown[] }[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  // L2 响应层检查项（code 含 "void" / "star" / "response"）
  const voidRelated = bidCheckResults.filter((r) => /void|废标|无效/i.test(r.code + r.title))
  const starRelated = bidCheckResults.filter((r) => /star|★|实质/i.test(r.code + r.title))
  // 工作台有废标条款但检查判 pass 且无 hit → 可能规则数据源未同步
  if (workspaceVoidCount > 0 && voidRelated.some((r) => r.status === "unconfigured")) {
    issues.push({
      source: "bid_check",
      description: `工作台已解析到 ${workspaceVoidCount} 条废标条款，但检查中枢对应项标记为「未配置」——数据源可能未同步`,
    })
  }
  if (workspaceStarCount > 0 && starRelated.some((r) => r.status === "unconfigured")) {
    issues.push({
      source: "bid_check",
      description: `工作台已扫描到 ${workspaceStarCount} 条★条款，但检查中枢实质性响应项标记为「未配置」`,
    })
  }
  return issues
}

// ==================== B2: 残句治理有效性自检（R-032） ====================

/**
 * R-032（第四节地图·模块1）：残句治理有效性验证（纯函数）。
 * 检查大纲顶层章标题是否存在明显残句特征（以逗号/顿号结尾、长度<3、含未闭合括号），
 * 若有则说明残句治理（clauseOutlineAlignment fragmentTitles）存在遗漏。
 */
export function detectResidualFragments(outline: OutlineNode[]): { title: string; reason: string }[] {
  const out: { title: string; reason: string }[] = []
  for (const n of outline ?? []) {
    const t = (n.title ?? "").trim()
    if (!t) continue
    if (t.length < 3 && !/^\d+$/.test(t)) {
      out.push({ title: t, reason: `标题过短（${t.length} 字），疑似残句` })
    } else if (/[,，、；;]$/.test(t)) {
      out.push({ title: t.slice(-20), reason: "标题以标点结尾，疑似截断残句" })
    } else if (/(（[^）]*$)|\([^)]*$/.test(t)) {
      out.push({ title: t.slice(-30), reason: "含未闭合括号" })
    }
  }
  return out
}

// ==================== 汇总门禁接口 ====================

export interface ComposeGateResult {
  round: string
  timestamp: string
  A1_duplicateChapters: DuplicateChapterGroup[]
  A2_genStatusViolations: GenStatusViolation[]
  A3_starFidelityGaps: StarFidelityViolation[]
  A4_catalogGaps: CatalogGap[]
  A5_numberConflicts: NumberConflict[]
  A6_scoringLandingGaps: ScoringLandingGap[]
  /** S0 阻断项数（A2空章+A3★缺失+A4目录缺项+A6评分缺落点） */
  blockingCount: number
}

/**
 * R-031 编制门禁汇总调用（纯函数、零 AI）：
 * 对当前项目的 outline/chapters/parse_report 执行 A1-A6 全量检查，返回结构化结果。
 * blockingCount > 0 时 UI 应展示红幅阻断导出/归档（S0 不过夜）。
 */
export function runComposeGates(  outline: OutlineNode[],
  chapters: Chapter[],
  report: ParseReport | null,
  scope: "biz" | "tech" | "both" = "both",
): ComposeGateResult {
  const A1 = detectDuplicateChapters(outline)
  const A2 = detectGenStatusViolations(chapters)
  const A3 = detectStarFidelityGaps(report, chapters)
  const A4 = detectCatalogGaps(report, outline, { scope })
  const A5 = detectNumberConflicts(chapters)
  const A6 = detectScoringLandingGaps(report, chapters)
  const blocking =
    A2.filter((v) => v.reason.includes("为空但标记 done")).length +
    A3.reduce((a, g) => a + g.missingClauses.length, 0) +
    // 2026-10-22：只把「技术标必须承载」的目录项算阻断。商务固定格式（开标一览表/投标函…）
    // 由商务分册线下承载，把它们也算成缺章会让每份技术标永远卡在闸门上。
    A4.filter((g) => !g.found && g.kind === "tech_required").length +
    A6.filter((g) => !g.hasLanding).length
  return {
    round: "R-031",
    timestamp: new Date().toISOString(),
    A1_duplicateChapters: A1,
    A2_genStatusViolations: A2,
    A3_starFidelityGaps: A3,
    A4_catalogGaps: A4,
    A5_numberConflicts: A5,
    A6_scoringLandingGaps: A6,
    blockingCount: blocking,
  }
}

/**
 * 2026-10-22（用户口径：废标项/评分落点不能只靠生成后 toast）：
 * 编制门禁 A1-A6 的**阻断级**问题原本只在批量生成结束后弹一条 toast，导出与交卷都不看它——
 * 也就是说「知道有问题」和「能不能交卷」之间没有接线。本函数把同一判据暴露给交卷闸门，
 * 让阻断级问题变成「闸门未满足 → 必须修复或填备注强制放行留痕」。
 */
export function composeGateBlockingReason(rec: {
  bid_outline?: OutlineNode[] | null
  bid_chapters?: Chapter[] | null
  parse_report?: ParseReport | null
  gen_options?: { scope?: string; include_biz?: boolean } | null
} | null): string {
  if (!rec) return ""
  const scope: "biz" | "tech" | "both" =
    rec.gen_options?.scope === "biz" || rec.gen_options?.scope === "tech" || rec.gen_options?.scope === "both"
      ? rec.gen_options.scope
      : rec.gen_options?.include_biz === false
        ? "tech"
        : "both"
  const r = runComposeGates(rec.bid_outline ?? [], rec.bid_chapters ?? [], rec.parse_report ?? null, scope)
  if (r.blockingCount <= 0) return ""
  const parts: string[] = []
  if (r.A3_starFidelityGaps.length)
    parts.push(`★响应缺失 ${r.A3_starFidelityGaps.reduce((a, g) => a + g.missingClauses.length, 0)} 条`)
  const catalogMiss = r.A4_catalogGaps.filter((g) => !g.found).length
  if (catalogMiss) parts.push(`规定目录缺落点 ${catalogMiss} 项`)
  const scoringMiss = r.A6_scoringLandingGaps.filter((g) => !g.hasLanding).length
  if (scoringMiss) parts.push(`评分无落点 ${scoringMiss} 项`)
  const emptyDone = r.A2_genStatusViolations.filter((v) => v.reason.includes("为空但标记 done")).length
  if (emptyDone) parts.push(`空章标完成 ${emptyDone} 个`)
  return `编制门禁 ${r.blockingCount} 项阻断级问题待处置（${parts.join("、")}；修复后重跑编制门禁，或填备注强制放行留痕）`
}
