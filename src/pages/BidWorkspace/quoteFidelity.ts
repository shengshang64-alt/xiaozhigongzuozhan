// ---------------------------------------------------------------------------
// r286（bid-l2-verbatim-compare 切片1 · 零折扣铁律2「改写」）· 引文级改写核对，本地零 AI
// R277 starQuoteFidelityHits 只核 ★/▲ 实质性条款的引用面；正文其它位置（评分办法/服务
// 要求/参数句）用 “”/「」 直接引用招标原文时，照抄途中被改写（丢字、换词、概括）目前
// 没有任何核对覆盖——即引文级空档。本模块提取「疑似引自招标原文」的引号：引号前 24 字内
// 有引述提示词，或引号自身以 ★/▲ 起头，归一长度达标者按 normalizeFidelity（与 R277 同一
// 把尺子）对照 tender_text 逐字核对，未见逐字命中 -> warn。
// 只报不拦：引号内未必真是招标原文（自拟承诺标题/通用口号会误报），命中只供人逐条核对，
// 故不进质量闸黑名单（GATE_FATAL_RULES）；tender_text 缺失/过短视为「无基准」静默跳过，
// 不判无基线的东西。与 scripts/bid-l2-verbatim-scan.mjs 口径同源（JS 复刻），改动需同步。
// r287（bid-l2-verbatim-compare 切片2·整改回注）：再加两个纯函数——
// quoteRewriteFixTargets 把命中按 section_stats 确定性切片定位到（章, 小节）
// （无小节统计的整章 blob 章跳过，指引整章处理）；buildQuoteFixDirective 拼
// 「逐字照录或删除引号改间接转述」的最小改动重写指令，经 runRegenerateSection
// 通道回注。核对口径与切片1 共用 iterRewriteQuotes 单一真源；只报不拦维持——
// 回注只在用户点击并经费用确认后发生，扫描定位全程本地零 AI。
// ---------------------------------------------------------------------------
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import { sliceSectionPieces, type FormatCheckHit } from "./bidTypes"
import { normalizeFidelity } from "./starClauseFidelity"

/** 直接引语提取：“…” / 「…」，不跨段，引号内 6-200 字 */
const QUOTE_RE = /[“「]([^”」\n]{6,200})[」”]/g

/** 引述意图提示：引号前须可见「引用招标文件」类提示词；纯装饰性引号不参与核对 */
const CUE_RE = /(要求|规定|明确|原文|招标文件|采购文件|技术规范|评分办法|评标办法|条款|须知)/

/** 参与核对的最小归一长度：短于此的是通用短语，样本不足易误报 */
const MIN_NORM_LEN = 14

/** 基准最小归一长度：低于此视为 tender_text 未有效解析，无基准不判 */
const MIN_TENDER_NORM = 40

/** 命中上限：改写再多也只报前 16 条，避免挤爆体检报告其它项 */
const MAX_HITS = 16

/**
 * 改写引语扫描单一真源（r287 抽口，切片1 报告与切片2 回注共用）：按 QUOTE_RE 提取引号，
 * 引述提示词/★▲起头 + 归一长度达标 + 招标原文逐字未见 才产出；【待填写】占位不核对。
 */
function* iterRewriteQuotes(body: string, tenderNorm: string): Generator<{ inner: string; norm: string }> {
  for (const m of body.matchAll(QUOTE_RE)) {
    const inner = m[1] ?? ""
    if (!inner || inner.includes("【待填写】")) continue
    const norm = normalizeFidelity(inner)
    if (norm.length < MIN_NORM_LEN) continue
    const marked = /^[★☆▲△]/.test(inner.trim())
    const at = m.index ?? 0
    const before = body.slice(Math.max(0, at - 24), at)
    if (!marked && !CUE_RE.test(before)) continue
    if (tenderNorm.includes(norm)) continue
    yield { inner, norm }
  }
}

/**
 * 引文级改写核对：对引用「有引述意图且招标原文逐字未见」的引号报 warn。
 * 去重按归一化引文（同一改写形态跨章只记一次）；无基准（tender 缺失/过短）返回空。
 */
export function quoteRewriteHits(tenderText: string, chapters: Chapter[]): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const tenderNorm = normalizeFidelity(tenderText ?? "")
  if (tenderNorm.length < MIN_TENDER_NORM) return hits
  const seen = new Set<string>()
  for (const c of chapters ?? []) {
    const body = c?.content ?? ""
    if (!body) continue
    const label = (c.title ?? "").trim().slice(0, 30) || "（未命名）"
    for (const { inner, norm } of iterRewriteQuotes(body, tenderNorm)) {
      if (hits.length >= MAX_HITS) return hits
      if (seen.has(norm)) continue
      seen.add(norm)
      const pos = tenderNorm.indexOf(norm.slice(0, 12))
      const ctx = pos >= 0 ? `，原文该处为「${tenderNorm.slice(pos, pos + 34)}…」` : ""
      hits.push({
        chapter: label,
        rule: "quote_rewrite",
        quote: `引文「${inner.trim().slice(0, 26)}…」招标原文逐字未见（疑改写/概括，实质性引用须照录）${ctx}`.slice(0, 130),
        level: "warn",
      })
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// r287 切片2（整改回注）：体检命中 -> 定位到小节 -> 最小改动重写指令。
// 与切片1 报告的差异是刻意的：报告跨章去重只记一条（避免挤爆面板），回注则每处都改
// ——同一改写形态散落多处时只修一处等于没修清零。整章 blob（无 section_stats）无法
// 按小节粒度整改，静默跳过由调用方指引整章处理（口径同 R103 整章级叶）。
// ---------------------------------------------------------------------------

/** 一处小节的整改项：sectionIdx 对齐 chapter.sections；quotes=疑改写引语（带原文定位提示） */
export type QuoteFixGroup = {
  chapterId: string
  chapterTitle: string
  items: { sectionIdx: number; quotes: { text: string; ctx: string }[] }[]
}

/** 单小节一次重写最多消化的引语条数（再多模型顾此失彼，剩余的留给下一轮或人工） */
const MAX_QUOTES_PER_SECTION = 8

/** 一轮整改最多重写的小节数：每小节一次 LLM 调用，一次费用确认的总量必须可控 */
const MAX_FIX_SECTIONS = 12

/**
 * 把引文级改写命中定位到（章, 小节）：按 section_stats 确定性切片，引语落在哪片改哪片。
 * 无基准（tender 缺失/过短）返回空；切片定位不到的引语（跨节边界）静默跳过。
 */
export function quoteRewriteFixTargets(tenderText: string, chapters: Chapter[]): QuoteFixGroup[] {
  const groups: QuoteFixGroup[] = []
  const tenderNorm = normalizeFidelity(tenderText ?? "")
  if (tenderNorm.length < MIN_TENDER_NORM) return groups
  let sectionCount = 0
  for (const c of chapters ?? []) {
    const body = c?.content ?? ""
    if (!body) continue
    const stats = c.section_stats
    if (!stats?.length) continue
    const pieces = sliceSectionPieces(body, stats)
    const byIdx = new Map<number, { text: string; ctx: string }[]>()
    const seenInSection = new Set<string>()
    for (const { inner, norm } of iterRewriteQuotes(body, tenderNorm)) {
      // 全片段匹配：同一段引语可能原样散落在本章多个小节（模板复制产物），每处都要整改
      const idxs: number[] = []
      pieces.forEach((p, i) => {
        if ((p ?? "").includes(inner)) idxs.push(i)
      })
      if (!idxs.length) continue
      const pos = tenderNorm.indexOf(norm.slice(0, 12))
      const ctx = pos >= 0 ? `${tenderNorm.slice(pos, pos + 34)}…` : ""
      for (const idx of idxs) {
        const dedupKey = `${idx}#${norm}`
        if (seenInSection.has(dedupKey)) continue
        seenInSection.add(dedupKey)
        const bucket = byIdx.get(idx)
        if (bucket) {
          if (bucket.length < MAX_QUOTES_PER_SECTION) bucket.push({ text: inner.trim(), ctx })
        } else {
          byIdx.set(idx, [{ text: inner.trim(), ctx }])
        }
      }
    }
    if (!byIdx.size) continue
    // 全局封顶：本章小节数会让总量越界时整章放弃（宁可一轮少改，不让一次确认费用失控）
    if (sectionCount + byIdx.size > MAX_FIX_SECTIONS) break
    sectionCount += byIdx.size
    groups.push({
      chapterId: c.node_id ?? "",
      chapterTitle: (c.title ?? "").trim().slice(0, 30) || "（未命名）",
      items: [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map(([sectionIdx, quotes]) => ({ sectionIdx, quotes })),
    })
  }
  return groups
}

/** 小节重写整改指令：逐条列疑改写引语与招标原文定位，限定最小改动（只动引语与所在句） */
export function buildQuoteFixDirective(quotes: { text: string; ctx?: string }[]): string {
  if (!quotes.length) return ""
  const lines = quotes.map((q, i) => `${i + 1}.「${q.text.slice(0, 60)}」${q.ctx ? `（招标原文该处为「${q.ctx}」）` : ""}`)
  return (
    `引文改写整改（L2 逐字审计命中）：本小节下列直接引语在招标原文中逐字未见，疑被改写或概括，必须逐处修正——` +
    `${lines.join("；")}。` +
    `修正方式二选一：能对照招标原文的改为逐字照录（仅允许把「要求/需/应」等要求类字眼转为投标人自述人称）；` +
    `对照不上一律删除引号改为间接转述。除上述引语及其所在句外，本小节其余内容、结构、事实口径保持不变，禁止顺手扩写。`
  )
}
