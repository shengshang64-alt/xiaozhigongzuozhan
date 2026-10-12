/**
 * 参数匹配四类研判（规范《医疗信息化投标全流程规范（整合版）V1.0》第 4.1 节）
 * —— 纯规则、零 AI：把「招标技术参数 → 自有产品匹配状态」归入四类，
 * 依 ★/▲ 实质性/重点标注自动推导应对策略与红线冲突，聚合成投/不投决策提示。
 * 载体：标书工作台 · 第 2 步 AI 解析报告扩展视图（ParseReportPanel）。
 */

/** 四类匹配状态：完全满足 / 部分不满足 / 替代方案 / 完全不满足 */
export type ParamMatchType = "full" | "partial" | "alternative" | "none"

export interface ParamMatchMeta {
  /** 展示序号 01-04 */
  code: string
  label: string
  /** 规范定义原文口径 */
  definition: string
  /** 应对策略（规范 4.1「应对策略」列，逐条） */
  strategies: string[]
}

/** 四类元数据：定义与应对策略严格取自规范 4.1 表格 */
export const PARAM_MATCH: Record<ParamMatchType, ParamMatchMeta> = {
  full: {
    code: "01",
    label: "完全满足",
    definition: "现有产品或方案可直接匹配，无需额外定制开发，即拿即用",
    strategies: [
      "可正常投标，逐条标注「完全满足」",
      "配齐资质、检测报告、案例材料",
      "★条款重点突出",
      "强调原生功能",
    ],
  },
  partial: {
    code: "02",
    label: "部分不满足",
    definition: "核心功能达标，仅在非关键细节存在差异，简单配置调整或微小定制即可适配",
    strategies: [
      "可正常投标",
      "差异不能为★实质性条款",
      "论证不影响核心业务",
      "找产研部门配置微调适配",
    ],
  },
  alternative: {
    code: "03",
    label: "替代方案",
    definition: "不直接匹配原参数，但具备功能等效甚至更优的替代方案",
    strategies: [
      "可正常投标",
      "★条款不接受替代",
      "明确等效方案",
      "论证效果等同或更优，附报告与案例",
    ],
  },
  none: {
    code: "04",
    label: "完全不满足",
    definition: "现有技术体系无法支撑，短期难以通过开发或外购解决",
    strategies: [
      "★条款建议放弃投标",
      "非实质性条款评估风险",
      "必要时移交公司层面或与采购方沟通",
      "综合决策是否继续",
    ],
  },
}

/** 四类展示顺序 */
export const PARAM_MATCH_ORDER: ParamMatchType[] = ["full", "partial", "alternative", "none"]

/** 一条待研判参数行 */
export interface ParamRow {
  /** 稳定键：面板选择持久化到 report.param_match_choices 用 */
  key: string
  /** 参数原文（保留 ★/▲ 标记） */
  param: string
  /** ★ 实质性条款 */
  substantive: boolean
  /** ▲ 重点/加分条款（非实质性但关键） */
  keyMark: boolean
  /** 人工研判结果；null = 待研判 */
  matchType: ParamMatchType | null
}

/** 单条研判结论 */
export interface ParamVerdict {
  /** ok 可正常响应 / caution 需论证或补材料 / danger ★ 红线冲突，影响投标决策 */
  level: "ok" | "caution" | "danger"
  /** 逐条应对策略提示 */
  guidance: string[]
  /** ★/▲ 与匹配状态冲突时的红线提示（无冲突为 null） */
  conflict: string | null
}

/** 行首 ★/▲ 标记判定（允许编号前缀），与解析报告展示口径一致 */
const MARKER_RE = /^\s*(?:\d+[.、)）]\s*)?([★☆▲△])/

/** 依匹配类型 + 实质性标注推导应对策略与红线冲突（规范 4.1） */
export function judgeParam(row: ParamRow): ParamVerdict {
  const t = row.matchType
  if (!t) {
    return { level: "caution", guidance: ["待研判：请选择本条参数的匹配类型（01-04）"], conflict: null }
  }
  const meta = PARAM_MATCH[t]
  const guidance = meta.strategies.slice()
  let conflict: string | null = null
  let level: ParamVerdict["level"] = "ok"
  if (t === "full") {
    level = "ok"
  } else if (t === "partial") {
    if (row.substantive) {
      level = "danger"
      conflict = "★实质性条款判定为「部分不满足」：★条款不允许负偏离，须论证为完全响应，否则构成实质性不响应（废标风险）"
    } else {
      level = "caution"
      if (row.keyMark) guidance.push("▲重点条款存在差异，务必在偏离表论证不影响核心业务")
    }
  } else if (t === "alternative") {
    if (row.substantive) {
      level = "danger"
      conflict = "★条款不接受替代方案：对实质性条款以替代响应即视为未实质响应"
    } else {
      level = "caution"
      guidance.push("明确等效方案并论证等同或更优，附检测报告与案例佐证")
    }
  } else {
    // none
    if (row.substantive) {
      level = "danger"
      conflict = "★实质性条款完全不满足：依据规范 4.1，建议放弃投标（作为投/不投核心决策输入）"
    } else {
      level = "caution"
      conflict = "非实质性条款完全不满足：评估风险，偏离表如实说明，必要时移交公司层面或与采购方沟通"
    }
  }
  return { level, guidance, conflict }
}

/** 汇总研判：各类型计数 + 待研判数 + 综合决策（规范 4.1「量化匹配度结论后再决策」） */
export interface ParamSummary {
  total: number
  typed: number
  untyped: number
  byType: Record<ParamMatchType, number>
  /** ★ 被判 partial/alternative（须重点论证的敞口数） */
  starOpen: number
  /** ★ 被判 none（一票否决级风险） */
  starReject: number
  overall: "bid" | "caution" | "reject" | "pending"
  message: string
}

export function summarizeParams(rows: ParamRow[]): ParamSummary {
  const byType: Record<ParamMatchType, number> = { full: 0, partial: 0, alternative: 0, none: 0 }
  let typed = 0
  let starOpen = 0
  let starReject = 0
  for (const r of rows) {
    if (!r.matchType) continue
    typed++
    byType[r.matchType]++
    if (r.substantive) {
      if (r.matchType === "none") starReject++
      else if (r.matchType === "partial" || r.matchType === "alternative") starOpen++
    }
  }
  const total = rows.length
  const untyped = total - typed
  let overall: ParamSummary["overall"] = "bid"
  let message = "已研判项均为★完全满足/无实质性负偏离，可正常投标"
  if (starReject > 0) {
    overall = "reject"
    message = `存在 ${starReject} 项★实质性条款完全不满足，依据规范 4.1 建议放弃投标或移交公司层面决策`
  } else if (starOpen > 0) {
    overall = "caution"
    message = `存在 ${starOpen} 项★条款判定为部分不满足/替代，须重点论证完全响应或等效，谨慎投标`
  } else if (untyped > 0) {
    overall = "pending"
    message = `尚有 ${untyped} 项参数待研判，形成量化匹配度结论后再决策`
  }
  return { total, typed, untyped, byType, starOpen, starReject, overall, message }
}

/** 从文本（解析报告技术分区或招标原文）提取候选参数行并识别 ★/▲ 标注 */
export function extractParamCandidates(text: string, cap = 200): ParamRow[] {
  const out: ParamRow[] = []
  if (!text) return out
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (raw.length < 4) continue
    // 仅收含标注或明显为参数/指标的行，避免噪声；无标注行不进入（保证零误报）
    const mm = raw.match(MARKER_RE)
    if (!mm) continue
    const substantive = mm[1] === "★"
    const keyMark = mm[1] === "▲" || mm[1] === "△"
    const key = `L${i + 1}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, param: raw, substantive, keyMark, matchType: null })
    if (out.length >= cap) break
  }
  return out
}

/** 用持久化的选择回填候选行（面板：report.param_match_choices[key] → matchType） */
export function applyChoices(rows: ParamRow[], choices: Record<string, string> | undefined): ParamRow[] {
  if (!choices) return rows
  return rows.map((r) => {
    const v = choices[r.key]
    return v && (v === "full" || v === "partial" || v === "alternative" || v === "none")
      ? { ...r, matchType: v as ParamMatchType }
      : r
  })
}
