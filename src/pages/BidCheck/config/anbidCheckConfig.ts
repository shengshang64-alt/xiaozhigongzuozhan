// ---------------------------------------------------------------------------
// 暗标检查配置（anbidCheckConfig）——可配置化，售前改配置即调整规则、无需改代码（AGENTS §6）。
//
// 每个项目的暗标要求不同：身份词库、暗标格式标准、页数上限都必须配置化。
// 单一真源：同一份配置同时喂「检测」与「页面展示」。
// 读取来源 localStorage（键见 STORAGE_KEY），异常/SSR/无 window 时回落默认（测试安全）。
//
// ⚠️ 默认值刻意「留空即不判」：暗标格式标准（字体/字号/行距/边距/颜色/页数上限）默认全部 null，
//    未配置时规则层标「⚠️ 标准未配置」而非瞎判——待招标文件暗标条款回填后即生效，绝不编造。
// ---------------------------------------------------------------------------

import type { PageMargins } from "../bidCheckTypes"

export const ANBID_CHECK_STORAGE_KEY = "bid_anbid_check_config"

/** 暗标格式标准（全部可空；null=未配置→对应检查项标 unconfigured 不瞎判） */
export type AnbidFormatStandard = {
  /** 要求正文字体（如「宋体」）；null=未配置 */
  bodyFont: string | null
  /** 要求正文字号（如「小四」「12pt」）；null=未配置 */
  bodySize: string | null
  /** 要求行距（如「1.5倍」「固定28磅」）；null=未配置 */
  lineSpacing: string | null
  /** 要求页面四边距（cm）；null=未配置 */
  margins: PageMargins | null
  /** 是否允许页码：true 必须编页码 / false 禁止页码 / null 未配置 */
  allowPageNumber: boolean | null
  /** 是否允许彩色：false=要求全黑白 / true=允许 / null 未配置 */
  allowColor: boolean | null
  /** 暗标是否需单独成册：true 必须 / false 不必 / null 未配置 */
  requireSeparateBooklet: boolean | null
  /** 页数上限（null=未配置） */
  maxPages: number | null
  /** 是否允许项目符号编号（bullet）：false=要求用 1. 2. 3. 数字编号 / true=允许 / null 未配置 */
  allowBulletNumbering: boolean | null
}

/** 暗标检查完整配置 */
export type AnbidCheckConfig = {
  /** A1 公司名 / 简称 / 曾用名（默认空：不编造具体公司） */
  identityWords: string[]
  /** A2 品牌 / 产品 / 平台 / 商标名 */
  brandProductWords: string[]
  /** A3 人名（法人 / 投标代表 / 项目经理 / 技术负责人） */
  personNames: string[]
  /** A8 案例线索词（与医院名同现即判案例泄露） */
  caseClueWords: string[]
  /** F1/F2 第一人称（暗标语境本身即风险，默认可扫） */
  firstPersonTerms: string[]
  /** F3 荣誉 / 资质自述线索 */
  honorPhrases: string[]
  /** E1/A1 反向排除：项目名本身允许出现，命中这些串不误报为公司身份 */
  excludeTerms: string[]
  /** C/E 类暗标格式与交付形态标准 */
  formatStandard: AnbidFormatStandard
  /** 暗标违规是否即废标（true→门禁硬提示；默认 false=警告 + 二次确认可继续） */
  sealedViolationIsFatal: boolean
}

/** 默认第一人称（暗标普遍禁则，可被配置覆盖） */
const DEFAULT_FIRST_PERSON = ["我司", "本公司", "我方", "我公司", "我单位", "我们"]
/** 默认荣誉/资质自述线索 */
const DEFAULT_HONOR = ["荣获", "获得", "本公司成立", "公司成立于", "拥有XX资质", "资质等级", "获奖"]
/** 默认案例线索词（与医院名相邻即判案例泄露） */
const DEFAULT_CASE_CLUE = ["上线", "部署于", "服务于", "承建", "已在", "落地", "标杆", "成功案例"]

/** 默认配置：词库除通用项外留空；格式标准全 null（未配置不瞎判） */
export const DEFAULT_ANBID_CONFIG: AnbidCheckConfig = {
  identityWords: [],
  brandProductWords: [],
  personNames: [],
  caseClueWords: [...DEFAULT_CASE_CLUE],
  firstPersonTerms: [...DEFAULT_FIRST_PERSON],
  honorPhrases: [...DEFAULT_HONOR],
  excludeTerms: [],
  formatStandard: {
    bodyFont: null,
    bodySize: null,
    lineSpacing: null,
    margins: null,
    allowPageNumber: null,
    allowColor: null,
    requireSeparateBooklet: null,
    maxPages: null,
    allowBulletNumbering: null,
  },
  sealedViolationIsFatal: false,
}

/** 解析多行/逗号分隔文本 → 去空白去重保序数组 */
export function parseWordList(raw: string | null | undefined): string[] {
  const parts = (raw ?? "").split(/[,，、；;\n]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const k = p.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** 词表 → 编辑框文本（一行一词） */
export function wordListToText(list: string[]): string {
  return (list ?? []).join("\n")
}

function normStandard(raw: unknown): AnbidFormatStandard {
  const r = (raw ?? {}) as Record<string, unknown>
  const strOrNull = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : ""
    return s ? s : null
  }
  const tri = (v: unknown): boolean | null => (v === true || v === false ? (v as boolean) : null)
  const m = r.margins as Record<string, unknown> | null | undefined
  let margins: PageMargins | null = null
  if (m && typeof m === "object") {
    const num = (v: unknown): number | null => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 && n < 100 ? n : null
    }
    const top = num(m.top)
    const right = num(m.right)
    const bottom = num(m.bottom)
    const left = num(m.left)
    if (top && right && bottom && left) margins = { top, right, bottom, left }
  }
  const maxPagesRaw = Number(r.maxPages)
  return {
    bodyFont: strOrNull(r.bodyFont),
    bodySize: strOrNull(r.bodySize),
    lineSpacing: strOrNull(r.lineSpacing),
    margins,
    allowPageNumber: tri(r.allowPageNumber),
    allowColor: tri(r.allowColor),
    requireSeparateBooklet: tri(r.requireSeparateBooklet),
    maxPages: Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 && maxPagesRaw < 100000 ? Math.floor(maxPagesRaw) : null,
    allowBulletNumbering: tri(r.allowBulletNumbering),
  }
}

function normList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  const out = parseWordList(raw.map((x) => String(x ?? "")).join("\n"))
  return out
}

/** 反序列化容错：非法/缺字段回落默认；空词表尊重用户「全清空」意图（不回退默认，firstPerson/honor/case 除外） */
export function normalizeAnbidConfig(raw: unknown): AnbidCheckConfig {
  if (!raw || typeof raw !== "object") return structuredCloneDefault()
  const r = raw as Record<string, unknown>
  return {
    identityWords: normList(r.identityWords, []),
    brandProductWords: normList(r.brandProductWords, []),
    personNames: normList(r.personNames, []),
    caseClueWords: normList(r.caseClueWords, DEFAULT_CASE_CLUE),
    firstPersonTerms: normList(r.firstPersonTerms, DEFAULT_FIRST_PERSON),
    honorPhrases: normList(r.honorPhrases, DEFAULT_HONOR),
    excludeTerms: normList(r.excludeTerms, []),
    formatStandard: normStandard(r.formatStandard),
    sealedViolationIsFatal: r.sealedViolationIsFatal === true,
  }
}

function structuredCloneDefault(): AnbidCheckConfig {
  return {
    identityWords: [],
    brandProductWords: [],
    personNames: [],
    caseClueWords: [...DEFAULT_CASE_CLUE],
    firstPersonTerms: [...DEFAULT_FIRST_PERSON],
    honorPhrases: [...DEFAULT_HONOR],
    excludeTerms: [],
    formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard },
    sealedViolationIsFatal: false,
  }
}

/** 读取生效配置：localStorage → 容错；无 window / 异常 → 默认 */
export function readAnbidCheckConfig(): AnbidCheckConfig {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(ANBID_CHECK_STORAGE_KEY)
      if (raw) return normalizeAnbidConfig(JSON.parse(raw))
    }
  } catch {
    /* 配置损坏回落默认，保证检查器不因配置异常崩溃 */
  }
  return structuredCloneDefault()
}

/** 写回配置（patch 浅合并到当前生效配置）；返回写回后的完整配置 */
export function writeAnbidCheckConfig(patch: Partial<AnbidCheckConfig>): AnbidCheckConfig {
  const cur = readAnbidCheckConfig()
  const next = normalizeAnbidConfig({ ...cur, ...patch })
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(ANBID_CHECK_STORAGE_KEY, JSON.stringify(next))
    }
  } catch {
    /* 存储不可用时静默：内存态仍生效，下次读取回落默认 */
  }
  return next
}
