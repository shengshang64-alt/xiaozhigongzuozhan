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
  /** 2026-10-22：从 score_composition 解析出的技术/商务/价格权重（分值或百分比）；解析不出为 null */
  weights: ScoreWeights | null
  items: ScoringItemJSON[]
}

/** 得分地图的权重拆分：技术 / 商务 / 价格，各自的分值或百分比数字 */
export type ScoreWeights = {
  tech: number | null
  biz: number | null
  price: number | null
  /** 原文用的是百分比口径（如「技术 90% 价格 10%」）而非分值 */
  percent: boolean
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
 * 2026-10-22（用户口径：先绘「得分地图」）：从总分构成原句拆技术/商务/价格权重。
 *
 * 为什么需要：解析层只保留了「总分构成」整句，下游无从判断「胜负在哪」——安中医
 * 2026BFAFZ50845 实测技术资信 90 分 / 价格 10 分，价格基本拉不开差距，资源该压技术标；
 * 这一判断必须由结构化权重支撑，而不是让模型每次重读原句。
 *
 * 口径：只认原文明写的数字，不做推算；同一维度按「分」优先于「%」；三项全空返回 null。
 */
export function parseScoreWeights(comp: string): ScoreWeights | null {
  const t = (comp ?? "").trim()
  if (missing(t)) return null
  const pick = (word: RegExp): { v: number; percent: boolean } | null => {
    const m = t.match(new RegExp(`${word.source}[^0-9%]{0,10}(\\d+(?:\\.\\d+)?)\\s*(分|%)`))
    return m ? { v: Number(m[1]), percent: m[2] === "%" } : null
  }
  const tech = pick(/技术(?:资信|部分|标)?/)
  const biz = pick(/商务(?:部分|标)?/)
  const price = pick(/价格(?:分|部分|标)?/)
  if (!tech && !biz && !price) return null
  const units = [tech, biz, price].filter(Boolean) as { percent: boolean }[]
  return {
    tech: tech?.v ?? null,
    biz: biz?.v ?? null,
    price: price?.v ?? null,
    // 全部命中项都是百分比才按百分比口径展示（混写时按分值展示更稳）
    percent: units.length > 0 && units.every((u) => u.percent),
  }
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
  return {
    kind: "scoring",
    score_composition,
    declared_total: parseDeclaredTotal(score_composition),
    weights: parseScoreWeights(score_composition),
    items,
  }
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
    // 2026-10-22（商务账）：付款节点、驻场人数、质保期外报价口径原先没有字段，
    // 商务风险只能靠 AI 在正文里自由发挥；拆成三张信息卡后可在解析报告直接核对。
    payment_terms: "付款方式与节点",
    onsite_requirement: "驻场要求",
    out_of_warranty_price: "质保期外报价口径",
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

/**
 * schema 级自检：评分项合计 vs 声明分；偏差返回人话提示，一致/无声明返回 null。
 *
 * 2026-10-22（真实项目实测）：原实现拿**每个分区**的合计去比**全局总分**——
 * 安中医 2026BFAFZ50845 因此报出两条假警：「技术 90 ≠ 100」「商务 10 ≠ 90」，
 * 而 90（技术）+ 10（价格）= 100 本来就是对的。传入 key 后按分区口径比：
 * 技术分区对 `技术 N 分`，商务分区对 `商务 N 分 + 价格 N 分`；拿不到分项权重时回退总分。
 */
export function selfCheckScoringTotal(b: ScoringBlockJSON, key?: string): string | null {
  if (b.declared_total == null) return null
  const sum = b.items.reduce((acc, it) => acc + it.score, 0)
  if (sum <= 0) return null
  const w = b.weights
  let target = b.declared_total
  let label = "招标文件声明总分"
  if (key === "tech_score" && w?.tech != null) {
    target = w.tech
    label = "技术分区声明分"
  } else if (key === "biz_score" && (w?.biz != null || w?.price != null)) {
    target = (w.biz ?? 0) + (w.price ?? 0)
    label = "商务+价格分区声明分"
  }
  if (Math.abs(sum - target) > 0.01) {
    return `评分项合计 ${sum} 分 ≠ ${label} ${target} 分，请复核评分表是否漏行/错值`
  }
  return null
}

// ---------------------------------------------------------------------------
// 2026-10-22（用户反馈：采购清单应按表格体现）
//
// 采购清单原文是「序号 | 子系统名称 | 数量 | 单位 | 备注」的表格，解析后落库成
// 「名称：X｜规格型号：Y｜数量：Z｜备注：W」的行文本（见 wholeParse.flattenPurchaseList）。
// 面板原来把这些行渲染成一行一张卡片——217 行的项目根本没法扫读，也看不出列之间的关系。
// 这里把行文本还原成表：列按招标原表来，全空的列（如本项目没有规格型号）自动隐藏。
// ---------------------------------------------------------------------------

/** 采购清单行文本 → 表格数据；不足两行有效数据时返回 null（交回普通行渲染） */
export function buildPurchaseListRows(lines: string[]): { columns: string[]; rows: string[][] } | null {
  const rows: string[][] = []
  let seq = 0
  for (const raw of lines ?? []) {
    const line = String(raw ?? "").trim()
    if (!line || !line.includes("：")) continue
    const map = new Map<string, string>()
    for (const seg of line.split("｜")) {
      const i = seg.indexOf("：")
      if (i > 0) map.set(seg.slice(0, i).trim(), seg.slice(i + 1).trim())
      else if (!map.has("名称")) map.set("名称", seg.trim())
    }
    const name = map.get("名称") ?? ""
    if (!name) continue
    seq += 1
    const qtyRaw = map.get("数量") ?? ""
    // 「1套」「3 套」「1 项」→ 数量与单位分列；纯数字也兜住
    const m = qtyRaw.match(/^([\d.]+)\s*(.*)$/)
    const note = map.get("备注") ?? ""
    rows.push([
      String(seq),
      name,
      map.get("规格型号") ?? "",
      m ? m[1] : qtyRaw,
      m ? m[2] : "",
      note,
    ])
  }
  if (rows.length < 2) return null
  const columns = ["序号", "名称", "规格型号/关键参数", "数量", "单位", "备注"]
  // 全空的列不展示（本项目招标原表就没有规格型号列，硬留一列空白反而难读）
  const keep = columns.map((_, ci) => ci < 2 || rows.some((r) => (r[ci] ?? "").trim().length > 0))
  return {
    columns: columns.filter((_, ci) => keep[ci]),
    rows: rows.map((r) => r.filter((_, ci) => keep[ci])),
  }
}
