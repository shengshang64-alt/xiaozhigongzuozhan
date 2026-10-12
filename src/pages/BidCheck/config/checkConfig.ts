// ---------------------------------------------------------------------------
// 检查项开关 / 阈值 / 严重度配置（checkConfig）——配置化非硬编码（AGENTS §6）。
// 与 anbidCheckConfig 并列：anbid 管暗标专属（词库 + 格式标准），本文件管通用开关与阈值。
// ---------------------------------------------------------------------------

import type { CheckLevel } from "../bidCheckTypes"

export const CHECK_CONFIG_STORAGE_KEY = "bid_check_config"

export type CheckConfig = {
  /** 普通模式启用的层级（默认 L1~L4，不跑 L5） */
  normalLevels: CheckLevel[]
  /** 暗标严格模式启用的层级（默认 L1~L5 全开） */
  sealedLevels: CheckLevel[]
  /**
   * L1 本地格式禁则 key 勾选（值对齐 BidWorkspace FORMAT_CHECK_KEYS；用 string[] 避免跨模块类型耦合）。
   * 空数组=用户全关。默认给「零误报 + 与暗标强相关」的一档。
   */
  formatKeys: string[]
  /** L4 跨章节重复检测是否启用（默认开） */
  dupCrossChapterEnabled: boolean
  /** L4 重复判定最小连续字数（默认 40，防短句误报） */
  dupMinRun: number
  /** L3 章节「无实质内容」字数下限（默认 50） */
  thinChapterMinChars: number
}

/** 默认 L1 勾选：措辞/装饰/暗标身份/连续空行/半角标点/超链接/水印（彩色/加粗/下划线留暗标模式追加） */
const DEFAULT_FORMAT_KEYS = [
  "identity_leak",
  "wording_scan",
  "decoration_leftover",
  "no_empty_line_consecutive",
  "no_half_width_punct",
  "no_hyperlink",
  "no_watermark",
]

export const DEFAULT_CHECK_CONFIG: CheckConfig = {
  normalLevels: ["L1", "L2", "L3", "L4"],
  sealedLevels: ["L1", "L2", "L3", "L4", "L5"],
  formatKeys: [...DEFAULT_FORMAT_KEYS],
  dupCrossChapterEnabled: true,
  dupMinRun: 40,
  thinChapterMinChars: 50,
}

const LEVELS: CheckLevel[] = ["L1", "L2", "L3", "L4", "L5"]

function normLevels(raw: unknown, fallback: CheckLevel[]): CheckLevel[] {
  if (!Array.isArray(raw)) return [...fallback]
  const picked = new Set(raw.map((x) => String(x)).filter((x): x is CheckLevel => (LEVELS as string[]).includes(x)))
  const out = LEVELS.filter((l) => picked.has(l))
  return out.length ? out : [...fallback]
}

export function normalizeCheckConfig(raw: unknown): CheckConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CHECK_CONFIG }
  const r = raw as Record<string, unknown>
  const formatKeys = Array.isArray(r.formatKeys)
    ? r.formatKeys.map((x) => String(x)).filter((x) => x.trim())
    : [...DEFAULT_CHECK_CONFIG.formatKeys]
  const dupMinRun = Number(r.dupMinRun)
  const thinMin = Number(r.thinChapterMinChars)
  return {
    normalLevels: normLevels(r.normalLevels, DEFAULT_CHECK_CONFIG.normalLevels),
    sealedLevels: normLevels(r.sealedLevels, DEFAULT_CHECK_CONFIG.sealedLevels),
    formatKeys,
    dupCrossChapterEnabled: r.dupCrossChapterEnabled !== false,
    dupMinRun: Number.isFinite(dupMinRun) && dupMinRun >= 10 && dupMinRun <= 500 ? Math.floor(dupMinRun) : DEFAULT_CHECK_CONFIG.dupMinRun,
    thinChapterMinChars: Number.isFinite(thinMin) && thinMin >= 0 && thinMin <= 500 ? Math.floor(thinMin) : DEFAULT_CHECK_CONFIG.thinChapterMinChars,
  }
}

export function readCheckConfig(): CheckConfig {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(CHECK_CONFIG_STORAGE_KEY)
      if (raw) return normalizeCheckConfig(JSON.parse(raw))
    }
  } catch {
    /* 回落默认 */
  }
  return { ...DEFAULT_CHECK_CONFIG }
}

export function writeCheckConfig(patch: Partial<CheckConfig>): CheckConfig {
  const cur = readCheckConfig()
  const next = normalizeCheckConfig({ ...cur, ...patch })
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(CHECK_CONFIG_STORAGE_KEY, JSON.stringify(next))
    }
  } catch {
    /* 内存态仍生效 */
  }
  return next
}
