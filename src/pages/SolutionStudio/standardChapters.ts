import { lineSimilarity, type ChecklistLine } from "./checklistTypes"
import { checklistToOutlineSkeleton } from "./checklistToOutline"
import type { OutlineNode } from "./solutionTypes"

// ---------------------------------------------------------------------------
// 按已确认建设清单模块，把已审核知识原子等素材整理成标准章节草稿（纯函数、零模型）。
// 只合并源材料，不编造没有依据的段落；素材不足明确标为缺项。
// ---------------------------------------------------------------------------

export type ChapterSourceKind = "atom" | "doc" | "solution"

export type ChapterSource = {
  kind: ChapterSourceKind
  id: string
  title: string
  docName: string
  quote: string
  body: string
  anchor?: string
}

export type ModuleCoverage = "ok" | "thin" | "missing"

export type ModuleChapterDraft = {
  moduleKey: string
  moduleTitle: string
  productName: string
  moduleName: string
  status: ModuleCoverage
  body: string
  sources: ChapterSource[]
  gapReason?: string
}

export type StandardChapterPreview = {
  title: string
  typeKey: string
  outline: OutlineNode[]
  modules: ModuleChapterDraft[]
  stats: { ok: number; thin: number; missing: number; truncated: number }
  warnings: string[]
}

export const MAX_STANDARD_MODULES = 40
export const MAX_CHAPTER_CHARS = 2400
const DEDUPE_SIM = 0.88
const THIN_MIN_SOURCES = 2
const THIN_MIN_CHARS = 40

export function compactText(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim()
}

/** 展示用：掩盖机构全名，避免预览里直接露出医院名 */
export function maskInstitutionName(s: string): string {
  return (s ?? "")
    .replace(/[\u4e00-\u9fff]{1,20}(?:\u4eba\u6c11\u533b\u9662|\u4e2d\u533b\u9662|\u4e2d\u5fc3\u533b\u9662|\u533b\u9662|\u536b\u751f\u9662|\u5987\u5e7c\u4fdd\u5065\u9662|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]\u9662)/g, "\u67d0\u533b\u9662")
    .replace(/[\u4e00-\u9fff]{1,20}\u5b66\u9662/g, "\u67d0\u5b66\u9662")
}

export function moduleKeyOf(line: Pick<ChecklistLine, "product_name" | "module_name" | "line_id">): string {
  const p = compactText(line.product_name)
  const m = compactText(line.module_name)
  if (p && m && p !== m) return `${p}::${m}`
  return p || m || line.line_id
}

export function moduleTitleOf(line: Pick<ChecklistLine, "product_name" | "module_name">): string {
  const p = compactText(line.product_name)
  const m = compactText(line.module_name)
  if (p && m && p !== m) return `${p} / ${m}`
  return p || m || "未命名模块"
}

export function moduleQueryOf(line: Pick<ChecklistLine, "product_name" | "module_name" | "module_func">): string {
  const parts = [line.product_name, line.module_name, line.module_func]
    .map((x) => compactText(x))
    .filter(Boolean)
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    uniq.push(p)
  }
  return uniq.join(" ")
}

export function checkedChecklistLines(lines: ChecklistLine[] | undefined | null): ChecklistLine[] {
  const out: ChecklistLine[] = []
  const seen = new Set<string>()
  for (const l of lines ?? []) {
    if (l.checked === false) continue
    const key = moduleKeyOf(l)
    if (!compactText(l.product_name) && !compactText(l.module_name)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out
}

export function fingerprintSource(s: ChapterSource): string {
  const raw = compactText(s.body || s.quote || s.title).toLowerCase()
  return raw.slice(0, 120)
}

/** 按原文/锚点去重，保留先出现且信息更完整的一条 */
export function dedupeSources(sources: ChapterSource[]): ChapterSource[] {
  const out: ChapterSource[] = []
  const anchorSeen = new Set<string>()
  for (const s of sources ?? []) {
    const body = compactText(s.body || s.quote)
    if (body.length < 8) continue
    const anchorKey = s.anchor ? `${s.docName}#${s.anchor}` : ""
    if (anchorKey && anchorSeen.has(anchorKey)) continue
    const fp = fingerprintSource({ ...s, body })
    const dup = out.find((x) => {
      if (anchorKey && x.anchor && `${x.docName}#${x.anchor}` === anchorKey) return true
      const other = fingerprintSource(x)
      if (fp === other) return true
      return lineSimilarity(fp, other) >= DEDUPE_SIM
    })
    if (dup) continue
    if (anchorKey) anchorSeen.add(anchorKey)
    out.push({ ...s, body, quote: compactText(s.quote) })
  }
  return out
}

export function classifyCoverage(sources: ChapterSource[]): ModuleCoverage {
  if (!sources.length) return "missing"
  const chars = sources.reduce((n, s) => n + compactText(s.body || s.quote).length, 0)
  if (sources.length < THIN_MIN_SOURCES || chars < THIN_MIN_CHARS) return "thin"
  return "ok"
}

export function mergeSourcesToBody(title: string, sources: ChapterSource[], maxChars = MAX_CHAPTER_CHARS): string {
  if (!sources.length) return ""
  const parts: string[] = [`【${title}】`]
  let used = parts[0].length
  sources.forEach((s, i) => {
    const text = maskInstitutionName(compactText(s.body || s.quote))
    if (!text) return
    const block = `（来源 ${i + 1}）${text}`
    if (used + block.length + 1 > maxChars) {
      const room = maxChars - used - 8
      if (room > 40) {
        parts.push(block.slice(0, room) + "…")
        used = maxChars
      }
      return
    }
    parts.push(block)
    used += block.length + 1
  })
  const foot = sources
    .map((s, i) => {
      const doc = maskInstitutionName(s.docName || s.title || s.id)
      const anchor = s.anchor ? ` · ${s.anchor}` : ""
      return `[${i + 1}] ${doc}${anchor}`
    })
    .join("\n")
  if (foot) parts.push(`资料来源：\n${foot}`)
  return parts.join("\n\n")
}


const GENERIC_TOKENS = new Set(["系统", "模块", "平台", "软件", "功能", "建设", "方案", "产品", "服务", "管理"])

/** 去掉与模块名明显无关的检索噪声，避免把不相关原子当成已整理正文 */
export function filterRelevantSources(title: string, query: string, sources: ChapterSource[]): ChapterSource[] {
  const raw = `${title} ${query}`
    .split(/[\s/：:：]+/)
    .map((s) => compactText(s))
  const expanded: string[] = []
  for (const s of raw) {
    if (!s) continue
    expanded.push(s)
    const stripped = s.replace(/(系统|平台|模块|软件|子系统)$/u, "")
    if (stripped && stripped !== s) expanded.push(stripped)
  }
  const needles = Array.from(new Set(expanded.filter((s) => s.length >= 3 && !GENERIC_TOKENS.has(s))))
  if (!needles.length) return sources
  const hits = sources ?? []
  const relevant = hits.filter((s) => {
    const blob = `${s.title} ${s.body} ${s.quote} ${s.docName}`
    if (needles.some((n) => blob.includes(n) || s.title.includes(n))) return true
    return lineSimilarity(compactText(title), compactText(s.title)) >= 0.5
  })
  // 只要有一条对得上模块名，就保留该次检索的整组（同查询下的相邻片段）；全都不相关则全部丢弃，避免把噪声写成正文。
  return relevant.length ? hits : []
}

export function draftFromSources(
  line: Pick<ChecklistLine, "line_id" | "product_name" | "module_name">,
  sources: ChapterSource[],
): ModuleChapterDraft {
  const cleaned = dedupeSources(filterRelevantSources(moduleTitleOf(line), moduleQueryOf(line), sources))
  const status = classifyCoverage(cleaned)
  const title = moduleTitleOf(line)
  const draft: ModuleChapterDraft = {
    moduleKey: moduleKeyOf(line),
    moduleTitle: title,
    productName: compactText(line.product_name),
    moduleName: compactText(line.module_name),
    status,
    body: status === "missing" ? "" : mergeSourcesToBody(title, cleaned),
    sources: cleaned,
  }
  if (status === "missing") {
    draft.gapReason = "知识库中未找到已审核的相关素材，未编造正文。"
  } else if (status === "thin") {
    draft.gapReason = "相关素材偏少，仅整理已有片段，未用模型补写。"
  }
  return draft
}

export function buildStandardChapterPreview(opts: {
  lines: ChecklistLine[]
  moduleSources: Record<string, ChapterSource[]>
  typeKey?: string
  title?: string
  maxModules?: number
}): StandardChapterPreview {
  const typeKey = opts.typeKey || "standard"
  const max = opts.maxModules ?? MAX_STANDARD_MODULES
  const all = checkedChecklistLines(opts.lines)
  const truncated = Math.max(0, all.length - max)
  const picked = all.slice(0, max)
  const modules = picked.map((line) => draftFromSources(line, opts.moduleSources[moduleKeyOf(line)] ?? []))
  const stats = {
    ok: modules.filter((m) => m.status === "ok").length,
    thin: modules.filter((m) => m.status === "thin").length,
    missing: modules.filter((m) => m.status === "missing").length,
    truncated,
  }
  const warnings: string[] = []
  if (!picked.length) warnings.push("当前没有已勾选的建设模块，请先确认清单。")
  if (truncated) warnings.push(`已勾选 ${all.length} 个模块，本次预览前 ${max} 个，其余请分批整理。`)
  if (stats.missing) warnings.push(`${stats.missing} 个模块缺少已审核素材，已标为缺项，不会用模型充数。`)
  if (stats.thin) warnings.push(`${stats.thin} 个模块素材偏少，正文仅含已有片段。`)
  const outline = checklistToOutlineSkeleton(
    modules.map((m) => m.moduleTitle),
    typeKey,
  )
  return {
    title: opts.title || "标准章节预览",
    typeKey,
    outline,
    modules,
    stats,
    warnings,
  }
}

/** 把有素材的模块草稿拼进「系统章」正文骨架；缺项只保留标题和缺项说明，不编造。 */
export function systemsChapterBodyFromPreview(preview: StandardChapterPreview): string {
  const parts: string[] = []
  for (const m of preview.modules) {
    if (m.status === "missing") {
      parts.push(`【${m.moduleTitle}】\n（缺项）${m.gapReason ?? "暂无已审核素材"}`)
      continue
    }
    if (m.body) parts.push(m.body)
  }
  return parts.join("\n\n")
}

export function linesFromSystemNames(names: string[]): ChecklistLine[] {
  const out: ChecklistLine[] = []
  const seen = new Set<string>()
  for (const raw of names ?? []) {
    const product_name = compactText(raw)
    if (!product_name || seen.has(product_name)) continue
    seen.add(product_name)
    out.push({
      line_id: `sys:${product_name}`,
      category: "",
      product_line: "",
      product_name,
      module_name: "",
      module_func: "",
      unit: "套",
      qty: 1,
      unit_price: 0,
      source: "company",
      rating_hits: [],
      remark: "",
      product_id: "",
      checked: true,
    })
  }
  return out
}
