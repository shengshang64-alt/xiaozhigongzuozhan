import type { RatingGroupKey, RatingTags } from "./checklistTypes"

// ---------------------------------------------------------------------------
// 评级标签归一与组合预设（单一真源）
//
// 公司库存的是 ONE-LINK 列头原文（「病历五级」「互联互通四甲」），建设清单路径 A
// 与产品映射筛选用的是标准码（emr:5 / hpc:4A）。两边必须走同一套归一，否则
// 选「电子病历 5 级」会勾不到任何模块。
//
// 组合列（五级四甲等）是「病历档 OR 互联互通档」的并集，不是智慧管理。
// 筛选真源是下面的公式；不要把组合列写入或读成 sm。
// ---------------------------------------------------------------------------

/** 组合预设：一键等于选中对应的病历档 + 互联互通档，筛选用并集 */
export type RatingComboPreset = {
  key: "l5-4b" | "l5-4a" | "l6-4a" | "l6-5b"
  label: string
  emr: string
  hpc: string
}

export const RATING_COMBO_PRESETS: RatingComboPreset[] = [
  { key: "l5-4b", label: "五级四乙", emr: "5", hpc: "4B" },
  { key: "l5-4a", label: "五级四甲", emr: "5", hpc: "4A" },
  { key: "l6-4a", label: "六级四甲", emr: "6", hpc: "4A" },
  { key: "l6-5b", label: "六级五乙", emr: "6", hpc: "5B" },
]

const LEVEL_ALIASES: Record<RatingGroupKey, Record<string, string>> = {
  emr: {
    病历四级: "4",
    电子病历四级: "4",
    四: "4",
    "4": "4",
    病历五级: "5",
    电子病历五级: "5",
    五: "5",
    "5": "5",
    病历六级: "6",
    电子病历六级: "6",
    六: "6",
    "6": "6",
    病历七级: "7",
    电子病历七级: "7",
    七: "7",
    "7": "7",
  },
  hpc: {
    互联互通四级乙等: "4B",
    互联互通四乙: "4B",
    四级乙等: "4B",
    四乙: "4B",
    "4B": "4B",
    互联互通四级甲等: "4A",
    互联互通四甲: "4A",
    四级甲等: "4A",
    四甲: "4A",
    "4A": "4A",
    互联互通五级乙等: "5B",
    互联互通五乙: "5B",
    五级乙等: "5B",
    五乙: "5B",
    "5B": "5B",
    互联互通五级甲等: "5A",
    互联互通五甲: "5A",
    五级甲等: "5A",
    五甲: "5A",
    "5A": "5A",
  },
  ss: {
    智慧服务一级: "1",
    一级: "1",
    "1": "1",
    智慧服务二级: "2",
    二级: "2",
    "2": "2",
    智慧服务三级: "3",
    三级: "3",
    "3": "3",
    智慧服务四级: "4",
    四级: "4",
    "4": "4",
    智慧服务五级: "5",
    五级: "5",
    "5": "5",
  },
  sm: {
    // 智慧管理仅认本体系档位；「五级四甲」等组合列不得映射到 sm
    智慧管理一级: "1",
    一级: "1",
    "1": "1",
    智慧管理二级: "2",
    二级: "2",
    "2": "2",
    智慧管理三级: "3",
    三级: "3",
    "3": "3",
  },
}

/** 把档位值（标准码或导入原文）折叠成规范码；无法识别时原样返回（去空白） */
export function normalizeLevel(group: RatingGroupKey, value: string): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const alias = LEVEL_ALIASES[group]
  if (alias[raw]) return alias[raw]
  const stripped = raw.replace(/^(电子病历|病历|互联互通|智慧服务|智慧管理)/, "")
  if (stripped && alias[stripped]) return alias[stripped]
  return raw.replace(/\s+/g, "")
}

export type RatingSelection = Partial<Record<RatingGroupKey, string[]>>

export function isComboPresetActive(sel: RatingSelection, preset: RatingComboPreset): boolean {
  return (sel.emr ?? []).includes(preset.emr) && (sel.hpc ?? []).includes(preset.hpc)
}

export function toggleComboPreset(sel: RatingSelection, preset: RatingComboPreset): RatingSelection {
  const active = isComboPresetActive(sel, preset)
  const addOrRemove = (arr: string[] | undefined, v: string, add: boolean): string[] | undefined => {
    const cur = arr ?? []
    const next = add ? (cur.includes(v) ? cur : [...cur, v]) : cur.filter((x) => x !== v)
    return next.length ? next : undefined
  }
  const out: RatingSelection = { ...sel }
  const emr = addOrRemove(out.emr, preset.emr, !active)
  const hpc = addOrRemove(out.hpc, preset.hpc, !active)
  if (emr) out.emr = emr
  else delete out.emr
  if (hpc) out.hpc = hpc
  else delete out.hpc
  return out
}

export function comboTargetCodes(preset: RatingComboPreset): string[] {
  return [`emr:${preset.emr}`, `hpc:${preset.hpc}`]
}

export function isComboTargetsActive(targets: string[], preset: RatingComboPreset): boolean {
  return comboTargetCodes(preset).every((c) => targets.includes(c))
}

export function toggleComboTargets(targets: string[], preset: RatingComboPreset): string[] {
  const codes = comboTargetCodes(preset)
  const active = codes.every((c) => targets.includes(c))
  if (active) return targets.filter((c) => !codes.includes(c))
  const out = [...targets]
  for (const c of codes) if (!out.includes(c)) out.push(c)
  return out
}

/**
 * 产品评级标签是否命中任一目标码（如 emr:5），返回命中的目标码列表。
 * 标签原文与标准码都走 normalizeLevel；跨体系是并集（任一目标命中即收录）。
 */
export function tagsHitNormalized(tags: RatingTags | undefined, targets: string[]): string[] {
  const hits: string[] = []
  for (const code of targets ?? []) {
    const [groupKey, level] = code.split(":") as [RatingGroupKey | undefined, string | undefined]
    if (!groupKey || !level) continue
    if (!["emr", "hpc", "ss", "sm"].includes(groupKey)) continue
    const list = tags?.[groupKey]
    if (!list?.length) continue
    if (list.includes("*")) {
      hits.push(code)
      continue
    }
    const want = normalizeLevel(groupKey, level)
    if (list.some((v) => normalizeLevel(groupKey, v) === want)) hits.push(code)
  }
  return hits
}
