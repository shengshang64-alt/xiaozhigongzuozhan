// ---------------------------------------------------------------------------
// R-026（R253）评分项 JSON Schema 结构化存储
//
// 背景：T14 整文通道已让 tech_score/biz_score 走 JSON 契约（见 prompts/wholeParse
// TECH_SCORE_TASK/BIZ_SCORE_TASK），但落库前 flattenScoring 把结构化对象摊平成行式
// 文本、丢弃结构，下游 extractScoringFromText 只能按行正则回读（分值/出处易错位）。
// 本模块在不改摊平链路（下游零改动、老文本报告继续可用）的前提下，把 JSON 原对象
// 保留为 ParseSection.structured：numberScoringItems 优先按结构读取，并对「原文声明
// 总分 vs 评分项合计」做 schema 级自检；老报告无 structured 时按 needs_reparse 提示
// 整文重解析以启用结构化。
//
// 注意：ScoringBlockJSON 与 wholeParse 的 tech_score/biz_score JSON items 字段严格对齐
// （name/score/criteria/source），仅 bidTypes 侧按结构类型读取、不 import 本模块，避免环依赖。
// ---------------------------------------------------------------------------

import type { ScoringItem } from "./bidTypes"

/** 单个评分项的结构化表示（对齐 wholeParse tech_score/biz_score items 字段） */
export type ScoringItemJSON = {
  name: string
  score: number
  criteria: string
  source: string
}

/** 评分块结构化表示（tech_score / biz_score 各一，存入 ParseSection.structured） */
export type ScoringBlockJSON = {
  kind: "scoring"
  /** 原文声明的总分构成原句；无则空串 */
  score_composition: string
  /** 从 score_composition 解析出的声明总分；未声明/解析不出为 null */
  declared_total: number | null
  items: ScoringItemJSON[]
}

const missing = (s: string): boolean => !s || /没有提及|未提及|暂无|^[-—\s]*$/.test(s.trim())

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

/** 从「总分 N 分（技术 N 分…）」声明句解析声明总分；解析不出返回 null */
export function parseDeclaredTotal(comp: string): number | null {
  const t = comp.trim()
  if (missing(t)) return null
  const m = t.match(/总分[^0-9]{0,6}(\d+(?:\.\d+)?)/) ?? t.match(/(\d+(?:\.\d+)?)\s*分/)
  return m ? Number(m[1]) : null
}

/**
 * 从整文 JSON 原对象构建评分块；非评分项 key / 无有效 items 返回 undefined。
 * score 只取首个数字（对齐 wholeParse flattenScoring 的 scoreNumber 口径）。
 */
export function buildScoringStructured(key: string, obj: unknown): ScoringBlockJSON | undefined {
  if (key !== "tech_score" && key !== "biz_score") return undefined
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined
  const rec = obj as Record<string, unknown>
  const rawItems = Array.isArray(rec.items) ? rec.items : []
  const items: ScoringItemJSON[] = []
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue
    const r = it as Record<string, unknown>
    const name = str(r.name).trim()
    if (missing(name)) continue
    const scoreM = str(r.score).match(/\d+(?:\.\d+)?/)
    const criteria = [str(r.criteria), str(r.criteria_or_formula)]
      .map((s) => s.trim())
      .filter((s) => s && !missing(s))
      .join("；")
    const source = str(r.source).trim()
    items.push({ name, score: scoreM ? Number(scoreM[0]) : 0, criteria, source: missing(source) ? "" : source })
  }
  if (!items.length) return undefined
  const compRaw = str(rec.score_composition).trim()
  const score_composition = missing(compRaw) ? "" : compRaw
  return { kind: "scoring", score_composition, declared_total: parseDeclaredTotal(score_composition), items }
}

/** 结构化 → 下游 ScoringItem[]（criteria 合并出处，与 extractScoringFromText 行文本口径一致） */

// ---------------------------------------------------------------------------
// R55：信息卡类解析项的结构化保留（对标易标「结构化项=固定字段、叙述项=自由文本」两条契约）
//
// 背景：整文通道的 JSON 项**本来就是扁平固定字段**（bid_deposit → {amount, payment_method,
// account, deadline, refund_conditions}），落库前被 flattenFieldMap 摊平成「字段名：值」文本、
// 丢掉结构，于是每个下游都要按行正则再猜一遍（factSources / tenderMeta / deadline 抽取各写一套）。
// 本块把原对象按同一张标签表留成 fields：**展示直接两列呈现，下游按标签取值，正则只留兜底**。
//
// 单一真源：PARSE_FIELD_LABELS 同时驱动 ① 摊平文本（wholeParse.flattenFieldMap）② 结构化字段，
// 两边标签永不漂移。
// ---------------------------------------------------------------------------

/** 一条「标签 → 值」（标签取中文标签表；bid_nodes 这类动态列表标签取原文节点名） */
export type ParseFieldKV = { label: string; value: string }

/** 字段块结构化表示（信息卡类解析项，存入 ParseSection.structured） */
export type FieldsBlockJSON = {
  kind: "fields"
  fields: ParseFieldKV[]
}

/**
 * 信息卡类解析项的字段标签表（field → 中文标签）。
 * 与 wholeParse 的 JSON 契约键名一一对应；**新增/改名只能在这里改**，摊平文本与结构化字段同源。
 * 不含 tech_score/biz_score（走 ScoringBlockJSON）与纯逐条项（void_items 等，本质是条款列表）。
 */
export const PARSE_FIELD_LABELS: Record<string, Record<string, string>> = {
  project_info: { project_background: "项目背景", construction_content: "建设内容概况", duration: "工期要求", funding: "资金来源" },
  purchaser_info: { purchaser_name: "采购人名称", contact_person: "联系人", contact_phone: "联系电话", address: "地址" },
  agency_info: { agency_name: "代理机构名称", contact_person: "联系人", contact_phone: "联系电话", email: "邮箱", address: "地址" },
  bid_deposit: { amount: "保证金金额", payment_method: "缴纳形式", account: "收款账户", deadline: "缴纳截止", refund_conditions: "退还条件" },
  bid_open_req: { time_place: "时间地点", requirements: "参与要求", invalid_bid_rules: "无效标认定", process: "开标流程" },
  eval_req: { committee: "评标委员会", method: "评标方法", principles: "评标原则", others: "其他说明" },
  contract_terms: {
    award_notice: "中标公示",
    signing_deadline: "签订时限",
    performance_bond: "履约保证金",
    termination: "解除与终止",
    warranty_linkage: "质保衔接",
    disputes: "争议解决",
  },
  compilation_basis: { standards: "编制依据" },
  delivery_req: {
    implementation_period: "实施周期",
    delivery_scope: "交付范围",
    delivery_location: "交付地点",
    acceptance: "验收要求",
    warranty: "质保期",
    after_sales: "售后服务",
    response_time: "响应时限",
    training: "培训要求",
    tech_requirements: "技术需求要点",
  },
  response_req: {
    composition: "响应文件组成",
    format_requirements: "格式与签章要求",
    signature_seal: "签字盖章",
    binding_copies: "装订份数",
    deadline: "递交截止",
    submission_method: "递交方式",
  },
}

/**
 * 从整文 JSON 原对象构建字段块；非字段类 key / 无有效字段返回 undefined。
 * 数组字段（如发货范围）取元素逐条成对，空值与「没有提及」一律不建行——保持与摊平文本同口径。
 */
export function buildFieldsStructured(key: string, obj: unknown): FieldsBlockJSON | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined
  const rec = obj as Record<string, unknown>
  const fields: ParseFieldKV[] = []

  // bid_nodes 是动态列表（节点名自定），标签取原文节点名，值取时间
  if (key === "bid_nodes") {
    const nodes = Array.isArray(rec.nodes) ? rec.nodes : []
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue
      const r = n as Record<string, unknown>
      const label = str(r.node).trim()
      const value = str(r.time).trim()
      if (missing(label) || missing(value)) continue
      fields.push({ label, value })
    }
    return fields.length ? { kind: "fields", fields } : undefined
  }

  const labels = PARSE_FIELD_LABELS[key]
  if (!labels) return undefined
  for (const [field, label] of Object.entries(labels)) {
    const v = rec[field]
    if (Array.isArray(v)) {
      const items = v.map((x) => str(x).trim()).filter((s) => s && !missing(s))
      items.forEach((s) => fields.push({ label, value: s }))
      continue
    }
    const s = str(v).trim()
    if (!missing(s)) fields.push({ label, value: s })
  }
  return fields.length ? { kind: "fields", fields } : undefined
}

/**
 * 整文 JSON 原对象 → 结构化（唯一入口，替代原先只认评分项的调用）。
 * 评分项 → ScoringBlockJSON；信息卡类 → FieldsBlockJSON；其余（纯逐条项）→ undefined。
 */
export function buildParseStructured(key: string, obj: unknown): ScoringBlockJSON | FieldsBlockJSON | undefined {
  return buildScoringStructured(key, obj) ?? buildFieldsStructured(key, obj)
}export function scoringItemsFromStructured(b: ScoringBlockJSON): ScoringItem[] {
  return b.items.map((it) => ({
    item: it.name,
    score: it.score,
    criteria: `${it.criteria}${it.source ? `（出处：${it.source}）` : ""}`,
  }))
}

/** schema 级自检：评分项合计 vs 原文声明总分；偏差返回人话提示，一致/无声明返回 null */
export function selfCheckScoringTotal(b: ScoringBlockJSON): string | null {
  if (b.declared_total == null) return null
  const sum = b.items.reduce((acc, it) => acc + it.score, 0)
  if (sum <= 0) return null
  if (Math.abs(sum - b.declared_total) > 0.01) {
    return `评分项合计 ${sum} 分 ≠ 招标文件声明总分 ${b.declared_total} 分，请复核评分表是否漏行/错值`
  }
  return null
}
