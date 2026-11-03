// ---------------------------------------------------------------------------
// 2026-10-25（A1/A2）：章表 ↔ 大纲对账 + 写→落库→重读巡检
//
// 背景（真实库 32 项目实测，2026-10-25）：
//  ① A1 孤儿章：`alignChaptersWithOutline` 的口径是**只增不删**（bidTypes.ts「已生成正文的章绝不被动」），
//     于是「重新生成大纲 → 确认 → 章表新增一批」时，旧大纲的章全部留在 bid_chapters 里。
//     实测 d3c35o7axkw34wo：大纲 16 节点 / 章表 31 章，15 章不在大纲里，主题成对重复；
//     `pickExportChapters` 只按 scope 与「有无正文」筛，不按大纲筛 → 这些章原样进 Word。
//  ② A2 假成功：同项目 6 章 `gen_status=done` 但正文 364–592 字，而 `section_stats` 记录
//     28,342–37,226 字「已生成」——统计与正文脱钩（chapterCompletion.ts 已记过反方向的同类态）。
//
// 本模块零 AI、纯函数、只判定不修复：
//  - 不删章、不改正文、不写库（红线：不删用户既有产物）；
//  - 判定结论交交卷清单与导出卡出提示，出口由用户自己走。
// ---------------------------------------------------------------------------

/** 空壳阈值：正文短于此值且无统计时，按「尚未生成」处理（由既有「技术章正文」项负责）。 */
export const SHELL_CONTENT_MAX = 600
/** 假成功的统计下限：section_stats 合计大于此值，说明分节确实生成过大段内容。 */
export const FAKE_DONE_STATS_MIN = 20000
/** 正文显著短于统计的最小差额（避免小章噪声）。 */
export const DRIFT_MIN_CHARS = 3000
/** 正文显著短于统计的相对阈值（差额 > 统计 × 该比例才报）。 */
export const DRIFT_RATIO = 0.25
/** 一对一匹配的相似度下限（精确=1、包含=0.9、其余取字符集 Jaccard）。 */
export const MATCH_SIMILARITY = 0.62
/** 判定「与已用大纲节点重复」的相似度下限。 */
export const DUPLICATE_SIMILARITY = 0.5
/** 包含判定的最短子串长度（防止「培训方案」这类四字内标题被过短字符串吃掉）。 */
export const CONTAINMENT_MIN_LEN = 4

export type OutlineLike = { id?: string; title?: string | null }
export type ChapterLike = {
  title?: string | null
  content?: string | null
  gen_status?: string | null
  part?: string | null
  section_stats?: { chars?: number }[] | null
}

export type OrphanChapter = { title: string; chars: number }

export type ChapterReconcile = {
  outlineCount: number
  chapterCount: number
  /** 一对一匹配后剩余、找不到对应大纲节点的章 */
  orphans: OrphanChapter[]
  /** orphans 中与某个已被占用的节点高度相似的那些——这些是「同一主题的第二份章」，导出即重复章 */
  duplicated: OrphanChapter[]
  /** 与任何大纲节点都不相似的增补章（如「项目理解与需求分析」），只提示不阻断 */
  extra: OrphanChapter[]
  /** 有重复章即阻断导出 */
  blocking: boolean
  summary: string
}

export type FakeDoneChapter = { title: string; contentChars: number; statsChars: number }
export type StatsDriftChapter = { title: string; contentChars: number; statsChars: number; gap: number }

export type ChapterIntegrity = {
  /** gen_status=done 但正文几乎为空、统计却显示生成过大段内容 */
  fakeDone: FakeDoneChapter[]
  /** 正文显著短于 section_stats 合计（统计未随覆写回滚） */
  statsDrift: StatsDriftChapter[]
  blocking: boolean
  summary: string
}

// 半角与全角空白(U+3000)、常用中英标点与括号一律剥除；只做「去掉噪声」，不做同义词改写
const TITLE_NOISE_RE = /[\s\u3000·、，,。.；;：:（）()《》〈〉【】[\]{}"'“”‘’—–\-_/\\|~!！?？+*#]/g
const CHAPTER_NO_RE = /^第[0-9零一二三四五六七八九十百千]+[章节篇部分]\s*/

/** 标题归一：剥「第N章」、剥标点与空白、全角数字转半角后比较（不做同义词替换，避免过度合并）。 */
export function normalizeChapterTitle(raw: string | null | undefined): string {
  const s = String(raw ?? "")
  return s
    .replace(CHAPTER_NO_RE, "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(TITLE_NOISE_RE, "")
    .trim()
}

function charSet(s: string): Set<string> {
  return new Set(Array.from(s))
}

/** 字符集 Jaccard（中文标题不含空格，按字比较比按词稳）。 */
export function titleJaccard(a: string, b: string): number {
  if (!a || !b) return 0
  const sa = charSet(a)
  const sb = charSet(b)
  let inter = 0
  for (const ch of sa) if (sb.has(ch)) inter++
  const union = sa.size + sb.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * 标题相似度：精确 1、包含 0.9、其余 Jaccard。
 * 包含判定带最短长度门槛——短标题被长标题整段包含时视为同一主题
 * （真实例：「售后服务运维保障」⊂「售后服务运维保障与质保期外运维及新增接口服务方案」）。
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeChapterTitle(a)
  const nb = normalizeChapterTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const short = na.length <= nb.length ? na : nb
  const long = na.length <= nb.length ? nb : na
  if (short.length >= CONTAINMENT_MIN_LEN && long.includes(short)) return 0.9
  return titleJaccard(na, nb)
}

const statsSum = (c: ChapterLike): number =>
  (c.section_stats ?? []).reduce((a, s) => a + Math.max(0, Number(s?.chars) || 0), 0)
const contentLen = (c: ChapterLike): number => String(c?.content ?? "").length

/**
 * A1：章表 ↔ 大纲一对一匹配，找出孤儿章并区分「重复」与「增补」。
 *
 * 一对一 + 贪心按相似度降序分配，是为了让「精确同名」优先占位：
 * 真实例中「总体建设方案与统分结合架构设计」与「总体技术解决方案与统分结合架构设计」Jaccard 0.68，
 * 若先到先得，后者会把节点占走、把本该匹配的同名章判成孤儿。先分配高分对即可避免。
 */
export function reconcileChaptersWithOutline(
  outline: OutlineLike[] | null | undefined,
  chapters: ChapterLike[] | null | undefined,
): ChapterReconcile {
  const nodes = (outline ?? []).filter((n) => normalizeChapterTitle(n?.title))
  const chs = (chapters ?? []).filter((c) => normalizeChapterTitle(c?.title))
  const outlineCount = nodes.length
  const chapterCount = chs.length
  const empty = (summary: string): ChapterReconcile => ({
    outlineCount,
    chapterCount,
    orphans: [],
    duplicated: [],
    extra: [],
    blocking: false,
    summary,
  })
  if (!outlineCount || !chapterCount) return empty("尚无大纲或章表，无需对账")

  // 候选对按相似度降序贪心分配（一对一）
  const pairs: { ni: number; ci: number; sim: number }[] = []
  for (let ni = 0; ni < nodes.length; ni++) {
    for (let ci = 0; ci < chs.length; ci++) {
      const sim = titleSimilarity(nodes[ni].title ?? "", chs[ci].title ?? "")
      if (sim >= MATCH_SIMILARITY) pairs.push({ ni, ci, sim })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim)

  const nodeTaken = new Array(nodes.length).fill(false)
  const chapterTaken = new Array(chs.length).fill(false)
  const usedNodes: number[] = []
  for (const p of pairs) {
    if (nodeTaken[p.ni] || chapterTaken[p.ci]) continue
    nodeTaken[p.ni] = true
    chapterTaken[p.ci] = true
    usedNodes.push(p.ni)
  }

  const orphans: OrphanChapter[] = []
  for (let ci = 0; ci < chs.length; ci++) {
    if (chapterTaken[ci]) continue
    orphans.push({ title: String(chs[ci].title ?? "").trim(), chars: contentLen(chs[ci]) })
  }

  // 孤儿是否与「已被占用的」节点重复——重复才阻断导出（会多出一份同主题章）
  const duplicated: OrphanChapter[] = []
  const extra: OrphanChapter[] = []
  for (const o of orphans) {
    let best = 0
    for (const ni of usedNodes) best = Math.max(best, titleSimilarity(nodes[ni].title ?? "", o.title))
    if (best >= DUPLICATE_SIMILARITY) duplicated.push(o)
    else extra.push(o)
  }

  const names = (list: OrphanChapter[], n: number) =>
    list
      .slice(0, n)
      .map((x) => x.title)
      .join("、")

  const summary = duplicated.length
    ? `章表 ${chapterCount} 章 / 大纲 ${outlineCount} 节点：${duplicated.length} 章与现有章重复（${names(duplicated, 3)}${duplicated.length > 3 ? " 等" : ""}）——导出会多出一份同主题章`
    : extra.length
      ? `章表 ${chapterCount} 章 / 大纲 ${outlineCount} 节点：${extra.length} 章不在大纲内，属增补章（${names(extra, 3)}${extra.length > 3 ? " 等" : ""}），不阻断导出`
      : `章表 ${chapterCount} 章与大纲 ${outlineCount} 节点一一对应`

  return {
    outlineCount,
    chapterCount,
    orphans,
    duplicated,
    extra,
    blocking: duplicated.length > 0,
    summary,
  }
}

/**
 * A2：单章落库一致性。两个方向都要看：
 *  - 统计大、正文几乎没有 → 分节确实生成过，但正文丢了（假成功，阻断）；
 *  - 统计大、正文明显更短 → 统计未随「整章覆写」回滚（长期不一致，提示）。
 * 正文比统计**长**是已知且预期的（R179 整章补足只更新 content），不报。
 */
export function checkChapterIntegrity(chapters: ChapterLike[] | null | undefined): ChapterIntegrity {
  const chs = chapters ?? []
  const fakeDone: FakeDoneChapter[] = []
  const statsDrift: StatsDriftChapter[] = []

  for (const c of chs) {
    const wrapped = (c?.content ?? "").trim()
    const statsChars = statsSum(c)
    const contentChars = wrapped.length
    const title = String(c?.title ?? "").trim() || "（未命名章）"
    if (statsChars <= 0) continue

    // 假成功：状态是完成、统计说明生成过大段，正文却接近空
    if (String(c?.gen_status ?? "") === "done" && statsChars >= FAKE_DONE_STATS_MIN && contentChars < SHELL_CONTENT_MAX) {
      fakeDone.push({ title, contentChars, statsChars })
      continue
    }
    // 统计漂移：正文显著短于统计（正文为 0 的交给上面的假成功或既有空章项，不重复报）
    if (contentChars > 0) {
      const gap = statsChars - contentChars
      if (gap >= DRIFT_MIN_CHARS && gap > statsChars * DRIFT_RATIO) {
        statsDrift.push({ title, contentChars, statsChars, gap })
      }
    }
  }

  const fakeNames = fakeDone.slice(0, 3).map((x) => x.title).join("、")
  const driftNames = statsDrift.slice(0, 3).map((x) => x.title).join("、")
  const parts: string[] = []
  if (fakeDone.length) {
    parts.push(
      `${fakeDone.length} 章标为「已生成」但正文不足 ${SHELL_CONTENT_MAX} 字，统计却记录 ${fakeDone[0].statsChars.toLocaleString()} 字以上已生成（${fakeNames}${fakeDone.length > 3 ? " 等" : ""}）——分节产物没拼回正文`,
    )
  }
  if (statsDrift.length) {
    parts.push(`${statsDrift.length} 章正文短于统计 ${DRIFT_MIN_CHARS} 字以上（${driftNames}${statsDrift.length > 3 ? " 等" : ""}），可能是整章覆写后统计未回滚`)
  }
  return {
    fakeDone,
    statsDrift,
    blocking: fakeDone.length > 0,
    summary: parts.length ? parts.join("；") : "章正文与分节统计一致",
  }
}
