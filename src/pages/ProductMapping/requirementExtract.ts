import { normalizeCustomerLine } from "@/pages/SolutionStudio/checklistTypes"
import type { RatingGroupKey } from "@/pages/SolutionStudio/checklistTypes"
import {
  RATING_COMBO_PRESETS,
  type RatingComboPreset,
  type RatingSelection,
} from "@/pages/SolutionStudio/ratingTags"
import {
  extractCustomerTable,
  gridWidth,
  guessHeaderRow,
  guessNameCols,
  type SheetGrid,
} from "./uploadWizard"

// ---------------------------------------------------------------------------
// 建设要求 / 评级文件 / 招标正文 → 预览条目（纯函数，离线规则，不调模型）
//
// 抽出的行项交给既有「选择清单 → 对照 → 结果」；评级口径复用 t139 组合公式，
// 组合列（五级四甲等）是病历档 OR 互联互通档的并集，不得写成智慧管理。
// ---------------------------------------------------------------------------

export type RequirementItem = {
  norm: string
  raw: string
  cells?: string[]
  /** table / list / section 仅用于预览说明，对照流程不依赖 */
  source?: "table" | "list" | "section"
}

export type RequirementKind = "system_list" | "rating" | "tender_req" | "mixed" | "unknown"

export type DetectedRating = {
  selection: RatingSelection
  combos: RatingComboPreset[]
  labels: string[]
}

export type RequirementExtractPreview = {
  kind: RequirementKind
  fileName: string
  items: RequirementItem[]
  rating: DetectedRating
  sectionHits: { title: string; count: number }[]
  warnings: string[]
  /** 招标建设内容摘要，确认对照后作为可选 AI 上下文，不自动调用模型 */
  context: string
}

const CN_NUM: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
}

const COMBO_BY_KEY = Object.fromEntries(RATING_COMBO_PRESETS.map((p) => [p.key, p])) as Record<
  RatingComboPreset["key"],
  RatingComboPreset
>

/** 先匹配组合词，避免「五级四甲」被拆成智慧服务五级或智慧管理 */
const COMBO_RE: { key: RatingComboPreset["key"]; re: RegExp }[] = [
  { key: "l6-5b", re: /六级五乙/g },
  { key: "l6-4a", re: /六级四甲/g },
  { key: "l5-4a", re: /五级四甲/g },
  { key: "l5-4b", re: /五级四乙/g },
]

const EMR_RE = /(?:电子)?病历(?:系统)?(?:应用水平)?(?:等级(?:评价|评审)?)?(?:建设)?(?:达到|达|评|为|按|按照)?\s*([四五六七4-7])\s*级/g
const HPC_RE =
  /互联互通(?:标准化成熟度)?(?:测评|评价)?(?:建设)?(?:达到|达|评|为|按|按照)?\s*(四级甲等|四级乙等|五级甲等|五级乙等|四甲|四乙|五甲|五乙)/g
/** 必须带「智慧服务」前缀，避免「三级医院」「五级四甲」误入 */
const SS_RE = /智慧服务(?:分级评价)?(?:建设)?(?:达到|达|评|为|按|按照)?\s*([一二三四五1-5])\s*级/g
/** 必须带「智慧管理」前缀；组合列不得落入 sm */
const SM_RE = /智慧管理(?:分级评价)?(?:建设)?(?:达到|达|评|为|按|按照)?\s*([一二三1-3])\s*级/g

const SECTION_TITLE_RE =
  /(?:功能需求|建设内容|系统清单|建设清单|信息化建设要求|建设任务|模块清单|采购清单|技术需求|功能要求|系统建设清单|采购需求)/

const ITEM_PREFIX_RE =
  /^(?:[\d０-９]{1,3}\s*[.、．:：)]|[(（]\s*[\d０-９]{1,3}\s*[)）]|[①-⑳]|[一二三四五六七八九十]+[、.．]|[-—*•·])\s*/

const SYS_HINT_RE = /系统|平台|模块|子系统|中心|门户|软件|引擎/

const NOISE_RE =
  /^(第\s*\d+\s*页|目录$|附件$|附录$|签署$|盖章$|招标文件示范文本|政府采购项目公开招标文件)/

const RATING_ONLY_RE =
  /^(?:本院|本项目|医院|按照|依据|参照|对标)?.{0,12}(?:电子病历|互联互通|智慧服务|智慧管理|五级四甲|五级四乙|六级四甲|六级五乙).{0,24}(?:建设|开展|达标|评审|测评|目标|要求)/

const MAX_ITEMS = 400
const MAX_ITEM_CHARS = 200

function uniquePush<T>(arr: T[], x: T, keyOf: (v: T) => string): void {
  const k = keyOf(x)
  if (!k || arr.some((y) => keyOf(y) === k)) return
  arr.push(x)
}

function addLevel(sel: RatingSelection, group: RatingGroupKey, level: string): void {
  if (!level) return
  const cur = sel[group] ?? []
  if (!cur.includes(level)) sel[group] = [...cur, level]
}

function toDigit(raw: string, map: Record<string, string>): string {
  return map[raw] ?? raw
}

function compact(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim()
}

function maskComboSpans(text: string): string {
  // 挖掉组合词，避免后续原子规则把「五级四甲」拆成「五级」
  return text.replace(/[五六]级[四五][甲乙]/g, "　　　　")
}

export function detectRatingGoals(text: string): DetectedRating {
  const selection: RatingSelection = {}
  const comboKeys = new Set<RatingComboPreset["key"]>()
  const src = text ?? ""

  for (const { key, re } of COMBO_RE) {
    re.lastIndex = 0
    if (re.test(src)) comboKeys.add(key)
  }

  const scanned = maskComboSpans(src)

  EMR_RE.lastIndex = 0
  for (const m of scanned.matchAll(EMR_RE)) {
    const lv = toDigit(m[1], CN_NUM)
    if (lv) addLevel(selection, "emr", lv)
  }
  HPC_RE.lastIndex = 0
  const hpcMap: Record<string, string> = {
    四级甲等: "4A",
    四甲: "4A",
    四级乙等: "4B",
    四乙: "4B",
    五级甲等: "5A",
    五甲: "5A",
    五级乙等: "5B",
    五乙: "5B",
  }
  for (const m of scanned.matchAll(HPC_RE)) {
    const lv = hpcMap[m[1]]
    if (lv) addLevel(selection, "hpc", lv)
  }
  SS_RE.lastIndex = 0
  for (const m of scanned.matchAll(SS_RE)) {
    const lv = toDigit(m[1], CN_NUM)
    if (lv) addLevel(selection, "ss", lv)
  }
  SM_RE.lastIndex = 0
  for (const m of scanned.matchAll(SM_RE)) {
    const lv = toDigit(m[1], CN_NUM)
    if (lv) addLevel(selection, "sm", lv)
  }

  for (const key of comboKeys) {
    const p = COMBO_BY_KEY[key]
    addLevel(selection, "emr", p.emr)
    addLevel(selection, "hpc", p.hpc)
  }

  // 文档分别写了病历档与互通档时，也标出对应组合预设（公式并集，不是智慧管理）
  for (const p of RATING_COMBO_PRESETS) {
    if ((selection.emr ?? []).includes(p.emr) && (selection.hpc ?? []).includes(p.hpc)) {
      comboKeys.add(p.key)
    }
  }

  const combos = RATING_COMBO_PRESETS.filter((p) => comboKeys.has(p.key))
  const labels: string[] = []
  for (const p of combos) {
    labels.push(`${p.label}（病历${p.emr}级 ∪ 互联互通${p.hpc === "4A" ? "四甲" : p.hpc === "4B" ? "四乙" : p.hpc === "5B" ? "五乙" : p.hpc}）`)
  }
  const comboCovered = new Set<string>()
  for (const p of combos) {
    comboCovered.add(`emr:${p.emr}`)
    comboCovered.add(`hpc:${p.hpc}`)
  }
  const atomicLabel = (group: RatingGroupKey, v: string): string => {
    if (group === "emr") return `电子病历${v}级`
    if (group === "hpc") {
      const map: Record<string, string> = { "4A": "互联互通四甲", "4B": "互联互通四乙", "5A": "互联互通五甲", "5B": "互联互通五乙" }
      return map[v] ?? `互联互通${v}`
    }
    if (group === "ss") return `智慧服务${v}级`
    return `智慧管理${v}级`
  }
  for (const g of ["emr", "hpc", "ss", "sm"] as RatingGroupKey[]) {
    for (const v of selection[g] ?? []) {
      if (comboCovered.has(`${g}:${v}`)) continue
      labels.push(atomicLabel(g, v))
    }
  }

  return { selection, combos, labels }
}

export function ratingSelectionIsActive(sel: RatingSelection | undefined): boolean {
  if (!sel) return false
  return (["emr", "hpc", "ss", "sm"] as RatingGroupKey[]).some((k) => (sel[k] ?? []).length > 0)
}

function isNoiseLine(line: string): boolean {
  const t = compact(line)
  if (t.length < 2) return true
  if (NOISE_RE.test(t)) return true
  if (/^第\s*\d+\s*页\s*共\s*\d+\s*页/.test(t)) return true
  return false
}

const HEADING_SKIP_RE = /^(评级目标|建设目标|其他说明|项目概况|编制说明|附件|目录)$/

function isRatingOnlyLine(line: string): boolean {
  const t = compact(line)
  const body = t.replace(ITEM_PREFIX_RE, "").trim()
  if (HEADING_SKIP_RE.test(body)) return true
  if (body.length <= 12 && /目标|说明|概况$/.test(body) && !SYS_HINT_RE.test(body)) return true
  if (!RATING_ONLY_RE.test(t) && !/(?:五级四甲|五级四乙|六级四甲|六级五乙)/.test(t)) return false
  // 含系统/模块名的编号条目仍保留
  if (SYS_HINT_RE.test(t) && ITEM_PREFIX_RE.test(t)) return false
  if (/^(?:一|二|三|四|五|六|七|八|九|十)[、.．]/.test(t) && SECTION_TITLE_RE.test(t)) return false
  // 「评级目标：五级四甲」这类不算模块条目
  if (!SYS_HINT_RE.test(t) || /评级|等次|达标|测评目标/.test(t)) return true
  return false
}

function pushItem(out: RequirementItem[], raw: string, source: RequirementItem["source"], seen: Set<string>): void {
  const cleaned = compact(raw).replace(ITEM_PREFIX_RE, "").trim()
  if (!cleaned || cleaned.length > MAX_ITEM_CHARS) {
    if (cleaned.length > MAX_ITEM_CHARS) {
      const cut = cleaned.slice(0, MAX_ITEM_CHARS)
      const norm = normalizeCustomerLine(cut)
      if (norm.length >= 2 && !seen.has(norm)) {
        seen.add(norm)
        out.push({ norm, raw: cut, source })
      }
    }
    return
  }
  if (isNoiseLine(cleaned) || isRatingOnlyLine(cleaned)) return
  if (SECTION_TITLE_RE.test(cleaned) && cleaned.length < 24 && !SYS_HINT_RE.test(cleaned.replace(SECTION_TITLE_RE, ""))) return
  const norm = normalizeCustomerLine(cleaned)
  if (norm.length < 2) return
  if (seen.has(norm)) return
  seen.add(norm)
  out.push({ norm, raw: cleaned, source })
}

/**
 * 从正文拆行项：编号列表、项目符号，以及「功能需求/建设内容」等小节下的条目。
 * 不调模型；拆不出时返回空数组，由调用方提示用户改用粘贴或 Excel。
 */
export function splitRequirementLines(text: string): RequirementItem[] {
  const lines = (text ?? "").split(/\r?\n/).map((l) => compact(l)).filter((l) => l.length > 0)
  const out: RequirementItem[] = []
  const seen = new Set<string>()
  let inWantedSection = false

  for (const line of lines) {
    if (isNoiseLine(line)) continue
    const isHeading =
      /^(?:第[一二三四五六七八九十0-9]+[章节部分]|[一二三四五六七八九十]+[、.．]|[（(]?[0-9]+[)）.、])\s*/.test(line) &&
      SECTION_TITLE_RE.test(line)
    if (isHeading || (SECTION_TITLE_RE.test(line) && line.length <= 30)) {
      inWantedSection = true
      continue
    }
    // 下一个同级大标题离开小节
    if (/^(?:第[一二三四五六七八九十0-9]+[章节部分]|[一二三四五六七八九十]+[、.．])/.test(line) && !SECTION_TITLE_RE.test(line) && !ITEM_PREFIX_RE.test(line.replace(/^[一二三四五六七八九十]+[、.．]\s*/, "1、"))) {
      if (!ITEM_PREFIX_RE.test(line) && line.length < 30 && !SYS_HINT_RE.test(line)) {
        inWantedSection = false
      }
    }

    const numbered = ITEM_PREFIX_RE.test(line)
    if (numbered) {
      pushItem(out, line, inWantedSection ? "section" : "list", seen)
      continue
    }
    // 短行且带系统/模块后缀，视为清单条目
    if (SYS_HINT_RE.test(line) && line.length <= 40 && !/[:：]/.test(line) && !isRatingOnlyLine(line)) {
      pushItem(out, line, "list", seen)
    }
  }
  return out.slice(0, MAX_ITEMS)
}

/** 把已还原的表格抽成条目（复用 Excel 向导的表头/名称列猜测） */
export function itemsFromTables(tables: string[][][]): RequirementItem[] {
  const out: RequirementItem[] = []
  const seen = new Set<string>()
  for (const rows of tables) {
    if (!rows?.length) continue
    const grid: SheetGrid = { name: "table", rows }
    const headerRow = guessHeaderRow(rows)
    const width = gridWidth(rows)
    const nameCols = guessNameCols(rows, headerRow, width)
    const parsed = extractCustomerTable(grid, { sheetName: "table", headerRow, nameCols })
    for (const it of parsed.items) {
      if (seen.has(it.norm)) continue
      seen.add(it.norm)
      out.push({ norm: it.norm, raw: it.raw, cells: it.cells, source: "table" })
    }
  }
  return out.slice(0, MAX_ITEMS)
}

function mergeItems(primary: RequirementItem[], extra: RequirementItem[]): RequirementItem[] {
  const seen = new Set(primary.map((x) => x.norm))
  const out = [...primary]
  for (const it of extra) {
    if (seen.has(it.norm)) continue
    seen.add(it.norm)
    out.push(it)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function detectKind(text: string, items: RequirementItem[], rating: DetectedRating): RequirementKind {
  const hasRating = rating.labels.length > 0
  const hasList = items.length > 0
  const tenderish = /功能需求|建设内容|招标|采购需求|技术需求/.test(text)
  const listish = /系统清单|建设清单|模块清单|信息化建设/.test(text) || items.some((i) => i.source === "table" || (i.source === "list" && SYS_HINT_RE.test(i.raw)))
  if (hasRating && hasList) return "mixed"
  if (hasRating && !hasList) return "rating"
  if (tenderish && hasList) return "tender_req"
  if (listish && hasList) return "system_list"
  if (hasList) return "system_list"
  return "unknown"
}

function sectionHitsOf(text: string, items: RequirementItem[]): { title: string; count: number }[] {
  const hits: { title: string; count: number }[] = []
  const titles = ["系统清单", "建设清单", "功能需求", "建设内容", "采购清单", "技术需求", "信息化建设要求"]
  for (const title of titles) {
    if (!text.includes(title)) continue
    // 粗算：该标题之后、下一标题之前的条目数不好精确，用包含该词的条目或全部 list 数作提示
    const count = items.filter((i) => i.raw.includes(title) || i.source === "section" || i.source === "list").length
    uniquePush(hits, { title, count: Math.max(1, count) }, (x) => x.title)
  }
  if (items.some((i) => i.source === "table")) {
    uniquePush(hits, { title: "文档表格", count: items.filter((i) => i.source === "table").length }, (x) => x.title)
  }
  return hits
}

export type RequirementExtractInput = {
  text: string
  tables?: string[][][]
  fileName?: string
  /** 预先拆好的行（如招标采购清单），与正文抽取合并 */
  extraItems?: Array<{ norm?: string; raw: string; cells?: string[] }>
  context?: string
}

export function buildRequirementPreview(input: RequirementExtractInput): RequirementExtractPreview {
  const text = input.text ?? ""
  const fileName = input.fileName || "未命名材料"
  const rating = detectRatingGoals(text)
  const fromTables = itemsFromTables(input.tables ?? [])
  const fromText = splitRequirementLines(text)
  let items = mergeItems(fromTables, fromText)
  if (input.extraItems?.length) {
    const extra: RequirementItem[] = []
    const seen = new Set<string>()
    for (const raw of input.extraItems) {
      const line = compact(raw.raw)
      const norm = raw.norm || normalizeCustomerLine(line)
      if (norm.length < 2 || seen.has(norm)) continue
      seen.add(norm)
      extra.push({ norm, raw: line, cells: raw.cells, source: "list" })
    }
    items = mergeItems(items, extra)
  }
  const kind = detectKind(text, items, rating)
  const warnings: string[] = []
  if (!items.length && rating.labels.length) {
    warnings.push("未抽出模块清单，将按已识别的评级公式筛选公司标准库，请确认后再进入结果页。")
  }
  if (!items.length && !rating.labels.length) {
    warnings.push("未能抽出条目或评级目标。可改用粘贴文本、上传 Excel，或检查文件是否为可复制文本的 Word/PDF。")
  }
  if (rating.combos.length) {
    warnings.push("评级组合按并集筛选（如五级四甲 = 病历五级或互联互通四甲），不会写成智慧管理。")
  }
  const context = (input.context ?? text).trim()
  return {
    kind,
    fileName,
    items,
    rating,
    sectionHits: sectionHitsOf(text, items),
    warnings,
    context: context.length > 4000 ? context.slice(0, 4000) : context,
  }
}

/** 招标解析报告里「功能需求 / 建设内容」等叙述性分区 → 行项（离线规则） */
export function bidRequirementLinesFromReport(
  report: { sections?: { key?: string; title?: string; content?: string }[] } | null | undefined,
): { items: RequirementItem[]; context: string; rating: DetectedRating } {
  const sections = report?.sections ?? []
  const wanted = sections.filter((s) => {
    const key = String(s.key ?? "")
    const title = String(s.title ?? "")
    return (
      key === "delivery_req" ||
      key === "project_info" ||
      /功能需求|建设内容|技术需求|功能要求|建设任务/.test(title)
    )
  })
  const context = wanted
    .map((s) => String(s.content ?? "").trim())
    .filter(Boolean)
    .join("\n")
  const preview = buildRequirementPreview({ text: context, fileName: "招标功能需求" })
  return { items: preview.items, context, rating: preview.rating }
}

export function kindLabel(kind: RequirementKind): string {
  switch (kind) {
    case "rating":
      return "评级要求"
    case "system_list":
      return "系统清单"
    case "tender_req":
      return "招标建设内容"
    case "mixed":
      return "评级 + 清单"
    default:
      return "未识别"
  }
}
