// ---------------------------------------------------------------------------
// R47（B20）商务模板自动识别 —— 编排层
//
// 商务同事给的标书模板 docx 里同时含四类信息：①样式（几级标题/字体/字号）②排版（边距/行距/
// 表格/页眉页脚/页码/目录/编号）③内容（章节目录、每章要写什么）④要求（模板明写的「须包含 /
// 应列明」与 ★/▲ 实质性条款）。本模块把两条既有识别链路合起来跑一遍，产出 TemplateProfile
// （落 format_settings.templateProfile，零新 collection、零 PocketBase schema 变更）：
//   · formatSpec.ts（强链路）：任意字体 / pt / twips + R46 文字级抽样兜底 → 页面 / 正文 / 标题原始值
//   · bidDocxFormatExtract.ts（补链路）：页眉页脚 / 页码域 / 目录域 / 封面 / 要求行 / 表格 / 编号
// 用户诉求的「结合招标文件去完善」= 给招标原文时，用本地规则（零 AI）把模板要求行与评分点 /
// ★ 条款对一遍，命中数与漏项数写进 alignment 供界面复核。
// 刻意不新增第三条 docx 解析链路：两条链路的字段优先级为「强链路定样式/页面，补链路补 extras」。
// ---------------------------------------------------------------------------

import {
  DEFAULT_FORMAT_SETTINGS,
  normalizeTemplateProfile,
  type FormatSettings,
  type TemplateHeadingProfile,
  type TemplateProfile,
  type TemplateRequirement,
} from "./bidTypes"
import {
  extractDocxFormat,
  extractedToFields,
  type ExtractedFormat,
  type FormatField,
} from "./bidDocxFormatExtract"
import { extractStarParagraphs } from "./starClauseFidelity"
import { scanScoreItems } from "./scoreItemsScan"
import type { FormatSpec } from "@/pages/FormatTool/formatSpec"

/** 识别入参：给出招标原文时才做「模板要求 ↔ 评分点 / ★ 条款」对齐 */
export type TemplateProfileOpts = {
  tenderText?: string
}

/** 一次识别的全部产出：落库画像 + 可勾选的格式项（供预览弹窗）+ 原始提取结果 */
export type TemplateProfileBundle = {
  profile: TemplateProfile
  fields: FormatField[]
  ext: ExtractedFormat
}

/** buildTemplateProfile 只需要格式规范里的这两块（其余字段与本模块无关，收窄便于单测给 fixture） */
export type TemplateSpecFacts = Pick<FormatSpec, "headings" | "body">

/** 模板要求行与招标评分点 / ★ 条款的相似度判为「同一条」的阈值 */
const MATCH_THRESHOLD = 0.34

// ---------------- 中文近似匹配（本地规则，零 AI） ----------------

/** 归一：去空白与常见中英标点/排版符号（两端同口径，保证 bigram 可比） */
function norm(s: string): string {
  return (s ?? "").replace(/[\s，。、；：（）()【】「」『』“”‘’"'·…\-—_*#,.;:!?/\\]/g, "")
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2))
  return out
}

/** 相似度 0-1：互相包含=1；否则取「较短一侧的 bigram 命中率」（长条款里含短要求也判得出） */
export function textSimilarity(a: string, b: string): number {
  const A = norm(a)
  const B = norm(b)
  if (!A || !B) return 0
  if (A === B || A.includes(B) || B.includes(A)) return 1
  const ba = bigrams(A)
  const bb = bigrams(B)
  if (!ba.size || !bb.size) return 0
  let hit = 0
  for (const g of ba) if (bb.has(g)) hit++
  return hit / Math.min(ba.size, bb.size)
}

/** 要求行归类：★/▲ 命中（或与招标 ★ 条款同一条）=star；排版口径关键词=format；其余=content */
export function classifyRequirement(text: string, starClauses: string[] = []): TemplateRequirement["kind"] {
  if (/[★☆▲△]/.test(text)) return "star"
  if (starClauses.some((s) => textSimilarity(text, s) >= MATCH_THRESHOLD)) return "star"
  if (/格式|排版|字体|字号|页边距|行距|页码|页眉|页脚|目录|装订|封面|编号|模板/.test(text)) return "format"
  return "content"
}

/**
 * 模板要求行 ↔ 招标评分点 / ★ 条款对齐（本地规则，零 AI）。
 * matched 为空 = 模板多写的条目（须人工判断是不是本项目要响应的）；alignment.unmatched =
 * 招标有、模板没写对应要求行的条目数（提示可能漏项）。
 */
export function alignRequirements(
  lines: string[],
  scoreItems: string[],
  starClauses: string[],
  limit = 40,
): { requirements: TemplateRequirement[]; alignment: TemplateProfile["alignment"] } {
  const requirements: TemplateRequirement[] = []
  const seen = new Set<string>()
  for (const raw of lines.slice(0, 200)) {
    const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 200)
    if (!text || seen.has(text)) continue
    seen.add(text)
    const matched = [...scoreItems, ...starClauses]
      .filter((s) => textSimilarity(text, s) >= MATCH_THRESHOLD)
      .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 8)
    requirements.push({ text, kind: classifyRequirement(text, starClauses), matched })
    if (requirements.length >= limit) break
  }
  const cover = (target: string) => requirements.some((r) => textSimilarity(r.text, target) >= MATCH_THRESHOLD)
  const hitScore = scoreItems.filter(cover).length
  const hitStar = starClauses.filter(cover).length
  return {
    requirements,
    alignment: {
      scoreItemCount: scoreItems.length,
      starClauseCount: starClauses.length,
      matched: hitScore + hitStar,
      unmatched: scoreItems.length - hitScore + (starClauses.length - hitStar),
    },
  }
}

// ---------------- 画像组装（纯函数，可直接单测） ----------------

/** 六级标题画像：样式表有=style；模板只定义了更高级别=sampled（按上一级推定）；都没有=missing */
function headingProfiles(spec: TemplateSpecFacts, heading: FormatSettings["heading"]): TemplateHeadingProfile[] {
  const byLevel = new Map<number, FormatSpec["headings"][number]>()
  for (const h of spec.headings) if (!byLevel.has(h.level)) byLevel.set(h.level, h)
  const out: TemplateHeadingProfile[] = []
  for (let lvl = 1; lvl <= 6; lvl++) {
    const mapped = heading[lvl - 1] ?? DEFAULT_FORMAT_SETTINGS.heading[lvl - 1]
    const hs = byLevel.get(lvl)
    if (hs) {
      out.push({
        level: lvl,
        source: "style",
        font: hs.fontEastAsia || hs.fontAscii || "",
        sizePt: hs.sizePt || 0,
        size: mapped.size,
        align: mapped.align,
      })
      continue
    }
    const lower = [...byLevel.keys()].filter((k) => k < lvl).sort((a, b) => b - a)[0] ?? 0
    const inh = lower ? byLevel.get(lower) : undefined
    out.push({
      level: lvl,
      source: inh ? "sampled" : "missing",
      font: inh ? inh.fontEastAsia || inh.fontAscii || "" : "",
      sizePt: inh ? inh.sizePt || 0 : 0,
      size: mapped.size,
      align: mapped.align,
    })
  }
  return out
}

/** 模板匹配失败时的空规范（页面/字体走本项目缺省，不影响补链路的 extras） */
export function emptySpecFacts(): TemplateSpecFacts {
  return {
    headings: [],
    body: {
      fontEastAsia: "",
      fontAscii: "",
      sizePt: 0,
      bold: false,
      align: "",
      lineSpacing: "",
      firstLineChars: 0,
      colorRgb: "",
      styleId: "",
      styleName: "",
    },
  }
}

/**
 * 组装 TemplateProfile（纯函数）。patch 只写「模板明确表达了的东西」：纸样/边距/六级标题/正文
 * 一律写（识别链路的缺省即本项目缺省，写与不写等价）；目录/页码/表格/编号只在检出时才写，
 * 避免把本项目的默认行为改坏。暗标 sealed 一组字段绝不在此覆盖。
 */
export function buildTemplateProfile(args: {
  fileName: string
  now?: string
  spec: TemplateSpecFacts
  settings: FormatSettings
  specNotes?: string[]
  ext: ExtractedFormat
  opts?: TemplateProfileOpts
}): TemplateProfile {
  const d = DEFAULT_FORMAT_SETTINGS
  const { ext, settings } = args
  const headings = headingProfiles(args.spec, settings.heading)

  const table = {
    border: ext.table?.border || d.table.border,
    contentFont: ext.table?.contentFont || d.table.contentFont,
  }

  const patch: TemplateProfile["patch"] = {
    paper: settings.paper,
    margins: settings.margins,
    heading: settings.heading,
    body: settings.body,
  }
  if (ext.table) patch.table = table
  if (ext.header || ext.footer) {
    patch.headerFooter = true
    patch.pageNumber = ext.pageNumber === true
  }
  if (ext.toc) patch.toc = true
  if (ext.titleNumbering) patch.titleNumbering = ext.titleNumbering

  const tenderText = args.opts?.tenderText ?? ""
  const scoreItems = tenderText ? scanScoreItems(tenderText).items.map((i) => i.name).filter(Boolean) : []
  const starClauses = tenderText ? extractStarParagraphs(tenderText) : []
  const { requirements, alignment } = alignRequirements(ext.requirements ?? [], scoreItems, starClauses)

  const notes: string[] = [...(args.specNotes ?? [])]
  const missing = headings.filter((h) => h.source === "missing").map((h) => h.level)
  if (missing.length) {
    notes.push(`模板未定义 ${missing.join(" / ")} 级标题样式，这几级导出按本项目缺省（黑体三号左对齐）落地，需要可手动改`)
  }
  const inherited = headings.filter((h) => h.source === "sampled").map((h) => h.level)
  if (inherited.length) notes.push(`${inherited.join(" / ")} 级标题模板没单独定义，已按最近的上一级标题格式推定`)
  if (!ext.table) notes.push("模板未识别到表格样式，表格按本项目缺省（0.5pt 边框 / 宋体五号）")
  if (!ext.header && !ext.footer) notes.push("模板没有页眉页脚")
  if ((ext.header || ext.footer) && ext.pageNumber !== true) {
    notes.push("模板页眉页脚里没有 PAGE 页码域，已按模板设为不输出页码")
  }
  if (ext.cover) notes.push("模板首页是封面页（含项目名称 / 编号 / 投标人），封面文字仍按本项目既有排版生成")
  if (requirements.length) notes.push(`模板正文检出 ${requirements.length} 条「须包含 / 应列明 / 格式要求」式要求，已写入大纲与正文写作注入`)
  if (tenderText) {
    notes.push(
      `与招标文件对齐：评分点 ${alignment.scoreItemCount} 项命中 ${alignment.matched} 条模板要求${alignment.starClauseCount ? `，★/▲ 条款 ${alignment.starClauseCount} 条一并比对` : ""}；` +
        (alignment.unmatched > 0
          ? `还有 ${alignment.unmatched} 条评分点 / ★ 条款在模板里没有对应要求行，请人工确认是否漏项`
          : "未发现模板未覆盖的评分点"),
    )
  } else {
    notes.push("未提供招标原文，模板要求未做对齐（回到项目后重跑识别即可对齐）")
  }

  return {
    version: 1,
    sourceFileName: args.fileName,
    extractedAt: args.now ?? new Date().toISOString(),
    page: { paper: settings.paper, margins: { ...settings.margins } },
    body: {
      font: args.spec.body.fontEastAsia || args.spec.body.fontAscii || settings.body.font,
      sizePt: args.spec.body.sizePt || 0,
      size: settings.body.size,
      lineSpacing: settings.body.lineSpacing,
      firstIndent: settings.body.firstIndent,
    },
    headings,
    table,
    header: ext.header ?? "",
    footer: ext.footer ?? "",
    pageNumber: ext.pageNumber === true,
    toc: ext.toc === true,
    cover: ext.cover === true,
    titleNumbering: ext.titleNumbering ?? d.titleNumbering,
    requirements,
    alignment,
    patch,
    notes,
  }
}

// ---------------- 识别入口 ----------------

/**
 * 识别一份模板 docx（一次解析，同时产出落库画像与可勾选格式项）。
 * 强链路（formatSpec）失败不影响补链路：页面/字体/标题退回本项目缺省并在 notes 说明。
 */
export async function extractTemplateProfileBundle(
  file: File,
  opts: TemplateProfileOpts = {},
): Promise<TemplateProfileBundle> {
  const ext = await extractDocxFormat(file)
  const fields = extractedToFields(ext)
  let spec: TemplateSpecFacts = emptySpecFacts()
  let settings: FormatSettings = { ...DEFAULT_FORMAT_SETTINGS }
  // 无初值：try 与 catch 两条路径都会赋值（规避 no-useless-assignment）
  let specNotes: string[]
  try {
    const { extractFormatSpecFromFile, specToFormatSettings } = await import("@/pages/FormatTool/formatSpec")
    const raw = await extractFormatSpecFromFile(file)
    const bridged = specToFormatSettings(raw)
    spec = raw
    settings = bridged.settings
    specNotes = bridged.notes
  } catch (e) {
    specNotes = [e instanceof Error ? e.message : "格式规范识别失败，页面 / 字体 / 标题按本项目缺省落地"]
  }
  return {
    profile: buildTemplateProfile({ fileName: file.name, spec, settings, specNotes, ext, opts }),
    fields,
    ext,
  }
}

/** 只取画像（不需要勾选清单时用） */
export async function extractTemplateProfile(file: File, opts: TemplateProfileOpts = {}): Promise<TemplateProfile> {
  return (await extractTemplateProfileBundle(file, opts)).profile
}

// ---------------- 消费侧读取小工具 ----------------

/** 从项目 format_settings 取模板画像（非法/缺失 → null，老项目行为不变） */
export function templateProfileOf(settings: FormatSettings | null | undefined): TemplateProfile | null {
  return normalizeTemplateProfile(settings?.templateProfile ?? null)
}

/** 写作注入用的模板要求行（排版口径的 format 类不进正文提示词，它们已进格式 patch） */
export function templateRequirementLines(profile: TemplateProfile | null, limit = 20): string[] {
  if (!profile) return []
  return profile.requirements
    .filter((r) => r.kind !== "format")
    .map((r) => r.text)
    .slice(0, limit)
}