// ---------------------------------------------------------------------------
// R235 切片（bidkit-plan-slice3 底稿增量合并引擎）
// 用户 P0 需求 R-001 的决策内核：把商务同事已写好的底稿（docx 解析出的结构化章节）与投标
// 大纲逐节点做三段式匹配（精确标题 → 归一/相似 → 未命中），据此产出「合并计划」：
//  哪些沿用底稿原文不动（商务/架构章）、哪些以底稿为参考重写（技术章）、哪些大纲要求但底稿
//  缺失需自动生成、哪些需补偏离表、哪些是底稿多出来要原样保留追加的章节。
// 纯函数、零副作用、零 DOM、零 schema、不依赖网关与提示词：UI 接线与 PocketBase 落库留后续切片，
// 先把最易出错的匹配与合并口径钉死并单测锁住。底稿解析复用 package.json 已有的 mammoth
// （不新增依赖），本模块只负责「已转成 HTML/纯文本之后的结构化 + 匹配」，故可脱离浏览器单测。
// Author: loop-R235
// ---------------------------------------------------------------------------

export interface DraftChapter {
  title: string
  content: string
  /** 源标题层级（1=h1、2=h2…），缺省按顶层章处理 */
  level?: number
}

export type OutlineKind = "business" | "technical" | "architecture" | "deviation" | "other"

export interface OutlineTarget {
  id: string
  title: string
  /** 该节点期望内容类型，决定命中 / 未命中后的动作；缺省按 other 处理 */
  kind?: OutlineKind
}

export type MergeAction =
  | "keep-draft"
  | "draft-as-reference"
  | "generate-missing"
  | "append-deviation"
  | "draft-extra"

export type MatchStage = "exact" | "fuzzy" | "none"

export interface DraftMatch {
  index: number | null
  stage: MatchStage
  confidence: number
}

export interface MergePlanItem {
  outlineId: string
  outlineTitle: string
  kind: OutlineKind
  matchedDraftIndex: number | null
  matchedDraftTitle: string | null
  stage: MatchStage
  confidence: number
  action: MergeAction
}

export interface DraftMergePlan {
  items: MergePlanItem[]
  /** 底稿里未被任何大纲节点认领的章下标，按原样保留追加 */
  extras: number[]
  stats: {
    total: number
    keep: number
    reference: number
    generate: number
    deviation: number
    extra: number
  }
}

// 模糊命中阈值：低于此相似度宁可判「未命中 → 自动生成」也不虚配，避免把无关章错并。
const FUZZY_THRESHOLD = 0.6

/**
 * 归一标题：去空白（含全角空格 \u3000）、逐层剥离开头编号、去掉标点，仅留中日韩汉字 / 字母 / 数字。
 * 覆盖常见编号形态：阿拉伯数字 + 分隔符、括号编号、中文数字、第…章/节/篇/部、带圈数字。
 */
export function normalizeTitle(raw: string): string {
  let s = (raw ?? "").trim().toLowerCase()
  const prefix =
    /^[\s\u3000]*(?:[0-9]+[.、)．,，]|[（(][0-9]+[）)]|[①-⑳]+|[一二三四五六七八九十百]+[、.．]|[第][0-9一二三四五六七八九十百]+[章节篇部]|[（(][一二三四五六七八九十]+[）)])/
  let prev: string
  do {
    prev = s
    s = s.replace(prefix, "")
  } while (s !== prev)
  s = s
    .replace(/[\s\u3000]/g, "")
    .replace(new RegExp("[^\\u4e00-\\u9fa5a-z0-9]", "g"), "")
  return s
}

function bigrams(s: string): string[] {
  if (s.length <= 1) return s ? [s] : []
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s[i] + s[i + 1])
  return out
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const uni = sa.size + sb.size - inter
  return uni ? inter / uni : 0
}

/** 标题相似度：归一后精确为 1，包含关系给 0.85，否则二元组 Jaccard。纯函数。 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85
  return jaccard(bigrams(na), bigrams(nb))
}

/**
 * 把一个大纲标题匹配到底稿章：先看是否有归一相等的精确命中（立即返回），否则取相似分最高者，
 * 达阈值记 fuzzy，否则 none。exclude 里的下标已被别的节点认领，跳过（保证一章只并一处）。
 */
export function matchOutlineToDraft(
  title: string,
  drafts: DraftChapter[],
  exclude?: Set<number>,
): DraftMatch {
  const normT = normalizeTitle(title)
  let best = -1
  let bestScore = 0
  for (let i = 0; i < drafts.length; i++) {
    if (exclude && exclude.has(i)) continue
    const normD = normalizeTitle(drafts[i].title)
    if (normT && normD && normT === normD) return { index: i, stage: "exact", confidence: 1 }
    const sc = titleSimilarity(title, drafts[i].title)
    if (sc > bestScore) {
      bestScore = sc
      best = i
    }
  }
  if (best >= 0 && bestScore >= FUZZY_THRESHOLD) {
    return { index: best, stage: "fuzzy", confidence: Math.round(bestScore * 100) / 100 }
  }
  return { index: null, stage: "none", confidence: 0 }
}

/**
 * 依据大纲节点类型与匹配结果决定动作：未命中时偏离表节点补表、其余自动生成；
 * 命中时技术 / 偏离章以底稿为参考重写，商务 / 架构 / 其它一律原文保留不动（保守，绝不误删既有成果）。
 */
export function decideAction(kind: OutlineKind, m: DraftMatch): MergeAction {
  if (m.stage === "none") {
    return kind === "deviation" ? "append-deviation" : "generate-missing"
  }
  if (kind === "technical" || kind === "deviation") return "draft-as-reference"
  return "keep-draft"
}

/**
 * 生成合并计划：按大纲顺序逐个匹配（先到先得、已认领不复用），统计各动作数量，
 * 并收集底稿中未被认领的章（extras，后续切片里原样追加到成稿）。
 */
export function buildMergePlan(outline: OutlineTarget[], drafts: DraftChapter[]): DraftMergePlan {
  const used = new Set<number>()
  const items: MergePlanItem[] = []
  for (const o of outline) {
    const kind: OutlineKind = o.kind ?? "other"
    const m = matchOutlineToDraft(o.title, drafts, used)
    const action = decideAction(kind, m)
    const consumed = action !== "generate-missing" && action !== "append-deviation"
    if (m.index != null && consumed) used.add(m.index)
    items.push({
      outlineId: o.id,
      outlineTitle: o.title,
      kind,
      matchedDraftIndex: m.index,
      matchedDraftTitle: m.index != null ? drafts[m.index].title : null,
      stage: m.stage,
      confidence: m.confidence,
      action,
    })
  }
  const extras = drafts.map((_, i) => i).filter((i) => !used.has(i))
  const stats = {
    total: items.length,
    keep: 0,
    reference: 0,
    generate: 0,
    deviation: 0,
    extra: extras.length,
  }
  for (const it of items) {
    if (it.action === "keep-draft") stats.keep++
    else if (it.action === "draft-as-reference") stats.reference++
    else if (it.action === "generate-missing") stats.generate++
    else if (it.action === "append-deviation") stats.deviation++
  }
  return { items, extras, stats }
}

function stripTags(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()
}

/**
 * 把 mammoth（或任意工具）转出的 HTML 拆成结构化底稿章：以 h1 / h2 为章边界，取标题与正文（去标签）。
 * 纯字符串正则处理，不依赖 DOM。无标题时整段作为单章返回；空输入返回空数组。
 */
export function parseDraftHtml(html: string): DraftChapter[] {
  const src = (html ?? "").trim()
  if (!src) return []
  const heads: { level: number; title: string; start: number; end: number }[] = []
  const re = /<h([1-2])[^>]*>([\s\S]*?)<\/h\1>/gi
  let mm: RegExpExecArray | null
  while ((mm = re.exec(src))) {
    heads.push({ level: Number(mm[1]), title: stripTags(mm[2]), start: mm.index, end: re.lastIndex })
  }
  if (!heads.length) {
    const text = stripTags(src)
    return text ? [{ title: "", content: text }] : []
  }
  const chapters: DraftChapter[] = []
  for (let i = 0; i < heads.length; i++) {
    const from = heads[i].end
    const to = i + 1 < heads.length ? heads[i + 1].start : src.length
    chapters.push({
      title: heads[i].title,
      level: heads[i].level,
      content: stripTags(src.slice(from, to)),
    })
  }
  return chapters
}
