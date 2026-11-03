// ---------------------------------------------------------------------------
// runCheck —— 检查编排：把 DocContext 喂给各规则层，汇成一份 BidCheckResult。
//
// 已接入五级：L1 格式 / L2 响应（二期）/ L3 内容（四期）/ L4 查重（三期）/ L5 暗标合规；各层按 config 层级开关启用。
// ⚠️ 只标不改：本函数只调用只读规则，产出结果对象，绝不改动 ctx 或原文件。
// ---------------------------------------------------------------------------

import { stripAuditAnnotations, type BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import {
  summarize,
  type BidCheckMode,
  type BidCheckResult,
  type CheckCoverage,
  type CheckItem,
  type CheckLevel,
  type DocContext,
} from "./bidCheckTypes"
import { emptyMeta, paragraphsFromChapters } from "./engine/docxInspect"
import { runFormatChecks } from "./rules/format"
import { runAnbidChecks } from "./rules/anbid"
import { runResponseChecks } from "./rules/response"
import { runDedupChecks } from "./rules/dedup"
import { runContentChecks } from "./rules/content"
import type { CheckConfig } from "./config/checkConfig"
import type { AnbidCheckConfig } from "./config/anbidCheckConfig"

/**
 * 检查前正文清洗（R284）：逐行剥掉 bid_chapters 正文里的分析态批注
 * （（原文事实…）/（响应 cXX）/（出处…）等），令「标书检查中枢」所见 = Word 预览 = 导出成稿，
 * 并避免重复套话被 L4 跨章查重误判。保留 part/underlength 等结构化字段。
 * ⚠️ 只作用于本次检查的内存副本，不回写数据库、不改原文件（延续「只标不改」）。
 */
function cleanBidChapters(chapters: BidProjectRecord["bid_chapters"]): NonNullable<BidProjectRecord["bid_chapters"]> {
  return (chapters ?? []).map((c) => ({
    ...c,
    title: stripAuditAnnotations(c.title ?? ""),
    content: (c.content ?? "").split(/\r?\n/).map((line) => stripAuditAnnotations(line)).join("\n"),
  }))
}

/** 从「选择的标书项目」构建 DocContext（正文来自 bid_chapters；无文件包，L5-B 节点项标 skipped） */
export function buildDocContextFromProject(rec: BidProjectRecord): DocContext {
  const chapters = cleanBidChapters(rec.bid_chapters)
    .map((c) => ({ title: (c.title ?? "").trim() || "（无题）", content: c.content ?? "" }))
    .filter((c) => c.content.trim())
  const fullText = chapters.map((c) => `${c.title}\n${c.content}`).join("\n")
  const { paragraphs, chapterOf } = paragraphsFromChapters(chapters)
  return {
    sourceName: (rec.project_name ?? "").trim() || "未命名项目",
    inputKind: "project",
    hasPackage: false,
    chapters,
    paragraphs,
    chapterOf,
    fullText,
    meta: emptyMeta(),
  }
}

/** 项目是否声明暗标（FormatSettings.sealed）——用于进入页面时的模式初值建议 */
export function projectSealed(rec: BidProjectRecord): boolean {
  return rec.format_settings?.sealed === true
}

/** 项目自带身份词（逗号/顿号分隔）→ 数组，供暗标词库合并 */
export function projectIdentityWords(rec: BidProjectRecord): string[] {
  return (rec.identity_words ?? "")
    .split(/[,，、；;\n]+/)
    .map((w) => w.trim())
    .filter(Boolean)
}

/** 生效层级：暗标严格模式取 sealedLevels，普通模式取 normalLevels */
export function activeLevels(cfg: CheckConfig, mode: BidCheckMode): CheckLevel[] {
  return mode === "sealed" ? cfg.sealedLevels : cfg.normalLevels
}

/**
 * 主检查入口（纯函数，可测）。
 * @param extraIdentityWords 额外并入的身份词（如来自所选项目），只影响本次检查、不写回配置
 */
export function runCheck(
  ctx: DocContext,
  mode: BidCheckMode,
  cfg: CheckConfig,
  anbid: AnbidCheckConfig,
  extraIdentityWords: string[] = [],
  project: BidProjectRecord | null = null,
): BidCheckResult {
  const levels = activeLevels(cfg, mode)
  const effAnbid: AnbidCheckConfig = extraIdentityWords.length
    ? { ...anbid, identityWords: [...new Set([...anbid.identityWords, ...extraIdentityWords])] }
    : anbid

  // R284：L2/L3/L4 直读 bid_chapters 原文，改用剥批注后的内存副本，与 ctx（L1/L5/定位/展示）同口径
  const cleanProject = project ? { ...project, bid_chapters: cleanBidChapters(project.bid_chapters) } : project
  const items: CheckItem[] = []
  if (levels.includes("L1")) items.push(...runFormatChecks(ctx, cfg, effAnbid, mode))
  // L2 响应（二期 r261 接入）：复用 complianceCoverage + scoreCoverageCheckup 本地核对，只报不拦。
  if (levels.includes("L2")) items.push(...runResponseChecks(cleanProject))
  // L3 内容（四期 r261 接入）：本地核对章节正文单薄/空缺（阈值取预留配置项 thinChapterMinChars）+ 成稿偏短标记（Chapter.underlength），只报不拦。
  if (levels.includes("L3")) items.push(...runContentChecks(cleanProject, cfg))
  // L4 查重（三期 r261 接入）：复用 findIntraDupPairs 本地跨章互查，只报不拦。
  if (levels.includes("L4")) items.push(...runDedupChecks(cleanProject, cfg))
  if (levels.includes("L5")) items.push(...runAnbidChecks(ctx, effAnbid, mode === "sealed"))

  // R262 三栏界面：为正文类命中补充定位锚点（派生层，不改规则判定逻辑）
  resolvePositions(ctx, items)
  // 开发态自校验（验收 #17）：定位错位必须暴露，生产构建不产生开销
  if (import.meta.env?.DEV) assertPositions(ctx, items)

  return {
    mode,
    sourceName: ctx.sourceName,
    inputKind: ctx.inputKind,
    hasPackage: ctx.hasPackage,
    items,
    summary: summarize(items),
    coverage: computeCoverage(project, ctx),
    generatedAt: formatNow(),
    chapters: ctx.chapters,
    paragraphs: ctx.paragraphs,
    chapterOf: ctx.chapterOf,
  }
}

/**
 * 2026-10-24（P0-5）：计算本次检查的覆盖范围。
 * 口径：只看**技术章**（商务骨架章本来就不生成正文，不算未覆盖）；
 * 正文字数 <50 视为"没有实质正文"（与 L3 单薄章判定同量级），不计入已检查。
 */
export function computeCoverage(project: BidProjectRecord | null, ctx: DocContext): CheckCoverage {
  if (!project) {
    return {
      expectedChapters: 0,
      checkedChapters: ctx.chapters.length,
      complete: true,
      note: `按上传文件全文检查（${ctx.chapters.length} 章）`,
    }
  }
  const tech = (project.bid_chapters ?? []).filter((c) => c.part !== "biz")
  const withText = tech.filter((c) => (c.content ?? "").trim().length >= 50)
  const expected = tech.length
  // 2026-10-28（DS-R04）：项目形态下 expected===0 **不等于**「覆盖完整」。
  // 实测缺陷：库里 17 个项目的 bid_chapters 是空数组（未上传/未生成的归档件），
  // 旧口径把它们判成 complete=true，界面顶栏显示「可直接导出」、问题清单「未发现问题（或均已通过）」，
  // 而正文实际为空——等于对一份空标书盖了合格章。任何有内容的技术标必然有技术章，
  // 0 个技术章意味着「没有可检查的内容」，只能判不可用，不能判通过。
  // 上传文件形态（project===null）在上方已单独返回，不受此处影响。
  const complete = expected > 0 && withText.length >= expected
  return {
    expectedChapters: expected,
    checkedChapters: withText.length,
    complete,
    note:
      expected === 0
        ? "该项目还没有任何技术章正文（0 个技术章），本次检查没有可检查的内容——本结论不能作为交卷依据"
        : complete
          ? `已覆盖全部 ${expected} 个技术章`
          : `已检查 ${withText.length}/${expected} 章（${expected - withText.length} 章无正文或正文过短，不在检查范围内）——本结论不能作为交卷依据`,
  }
}

/** 归一化：去所有空白，供命中片段 ↔ 段落全文的宽松匹配 */
function normalizeText(s: string): string {
  return (s || "").replace(/\s+/g, "")
}

/**
 * 派生定位层（R262）：把正文类命中（location 为章标题/正文/全文）解析到 ctx.paragraphs 的下标。
 * ⚠️ 只补锚点、不改判定；paragraphText 直接复制实际段落文本，令 #17 断言 by-construction 成立。
 * chapterIndex 由 chapterOf[paragraphIndex] 换算，绝不用 chapters[i].content 的 indexOf 反查（重复句会错位）。
 * 导出仅供单测（co-located regression），业务侧只通过 runCheck 间接使用。
 */
export function resolvePositions(ctx: DocContext, items: CheckItem[]): void {
  const paras = ctx.paragraphs
  const { chapters, chapterOf } = ctx
  if (!paras.length) return

  const norm = paras.map((p) => normalizeText(p.text))
  const titleToIdx = new Map<string, number>()
  chapters.forEach((c, i) => {
    if (!titleToIdx.has(c.title)) titleToIdx.set(c.title, i)
  })

  const isBodyLocation = (loc: string): boolean =>
    loc === "正文" || loc === "（正文）" || loc === "全文" || titleToIdx.has(loc)

  for (const it of items) {
    for (const h of it.hits) {
      if (h.paragraphIndex != null) continue // 已解析
      if (!isBodyLocation(h.location)) continue // 元数据/节点/文件形态类不做正文定位
      // 摘录片段可能带前/后省略号（clip 窗口截断），两端都剥掉再匹配
      const frag = normalizeText(h.text).replace(/^[.…]+|[.…]+$/g, "")
      if (frag.length < 2) continue

      const hintIdx = titleToIdx.get(h.location)
      // 整段失败时退化为前缀/后缀子串匹配（clip 80 字窗口可能跨段落拼接）
      const candidates = frag.length > 32 ? [frag, frag.slice(0, 32), frag.slice(-32)] : [frag]
      let best = -1
      for (const c of candidates) {
        best = findPara(norm, c, hintIdx, chapterOf)
        if (best >= 0) break
      }
      if (best < 0) continue

      const p = paras[best]
      h.paragraphIndex = best
      h.paragraphText = p.text
      h.chapterIndex = chapterOf[best]
      h.chapterTitle = chapters[h.chapterIndex]?.title
      h.lineNo = best + 1
      h.sectionHint = nearestSection(paras, chapterOf, best, h.chapterIndex)
    }
  }
}

/** 片段与段落的双向包含判定（片段命中段落，或极短整段被片段包含） */
function matchPara(frag: string, paraNorm: string): boolean {
  if (!frag || !paraNorm) return false
  if (paraNorm.includes(frag)) return true
  if (paraNorm.length >= 6 && frag.includes(paraNorm)) return true
  return false
}

/** 在段落集中找片段：章 hint 优先，再全局兜底；返回下标或 -1 */
function findPara(norm: string[], frag: string, hintIdx: number | undefined, chapterOf: number[]): number {
  if (hintIdx != null) {
    for (let i = 0; i < norm.length; i += 1) {
      if (chapterOf[i] === hintIdx && matchPara(frag, norm[i])) return i
    }
  }
  for (let i = 0; i < norm.length; i += 1) {
    if (matchPara(frag, norm[i])) return i
  }
  return -1
}

/** 反向找最近的小节标题（非本章主标题的标题段），找不到留空 */
function nearestSection(paras: DocContext["paragraphs"], chapterOf: number[], from: number, chapterIndex: number | undefined): string | undefined {
  const chapterTitle = chapterIndex != null ? chapterIndex : -1
  for (let i = from; i >= 0; i -= 1) {
    if (chapterOf[i] !== chapterTitle) break
    const p = paras[i]
    if (p.heading && p.text.trim() && i !== from) return p.text.trim()
  }
  return undefined
}

/** 开发态定位自校验：任何 paragraphText 与实段落不一致即告警（验收 #17） */
function assertPositions(ctx: DocContext, items: CheckItem[]): void {
  for (const it of items) {
    for (const h of it.hits) {
      if (h.paragraphIndex == null) continue
      if (ctx.paragraphs[h.paragraphIndex]?.text !== h.paragraphText) {
        console.warn("[bid-check] 定位错位", h)
      }
    }
  }
}

function formatNow(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
