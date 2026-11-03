import { factTopicOf } from "./bidTypes"

// ---------------------------------------------------------------------------
// P0-2 事实来源优先级（R48）
//
// 问题（WorkBuddy 审查文档 P0-2，源码取证见 prompts/factSettings.ts 旧 4/7 条）：
//   ① 旧第 4 条要求把「招标要求工期不超过 90 天」改写成「本项目工期：90 天」这类已定承诺句——
//      把还没拍板的取值当成既定事实，金额/工期/质保一旦写错就是对外交付级风险；
//   ② 旧第 7 条要求「同一主题优先采用历史标书范本数值」——范本口径会盖掉本项目招标要求。
//
// 本模块只做确定性的事（零 AI、零 schema、不动已保存数据）：
//   1) 给出事实来源分层与判定口径（提示词与代码同源，由测试锁死）；
//   2) 规范化「AI 生成的事实草稿」：需商务拍板主题上的「已定承诺形态」取值一律补【需人工确认】，
//      招标原文的比较口径（不超过/不少于…）保持原样——它是硬约束，不是我方承诺。
//
// 边界：规范化只作用于「AI 输出 → 编辑态」这一步。用户手工编辑的行与已保存的
// global_facts 一字不改（人工确认过的口径不得被系统静默改写）。
// ---------------------------------------------------------------------------

/** 未拍板取值的统一标记：与既有 prompt / 解析 / 核对面板同源，含此标记的行不参与任何自动基准 */
export const FACT_CONFIRM_MARK = "【需人工确认】"

/**
 * 需商务拍板才能对外承诺的主题：这些主题上的数字＝对采购人的承诺（工期/质保/响应时限/报价…），
 * 模型不得自行落定。刻意不含「预算金额 / 最高限价 / 控制价」——那是招标方给定的约束值而非我方承诺，
 * 被标记会让 priceCeilingFromFacts 失去报价天花板（见 bidTypes.ts:4360 与既有单测）。
 */
export const FACT_COMMITMENT_TOPIC_RE =
  /(工期|交货期|交付期|项目周期|服务期|运维期|质保期|质保年限|质保时长|响应时间|响应时限|到场时间|故障响应|解决时限|驻场人数|驻场|人员配置|项目团队|实施人员|投标报价|报价|投标总价|总价|付款方式|付款比例)/

/**
 * 招标原文的比较口径：出现在取值开头即说明该行是招标硬约束（上限/下限），不是我方已定承诺。
 * 这类行保持原样——正文按「不超过 90 天」响应是安全表述，落成「本项目承诺 90 天」才需要人工拍板。
 */
export const TENDER_CONSTRAINT_VALUE_RE =
  /^(?:不超过|不得超过|不大于|不高于|不低于|不少于|不小于|至少|不多于|高于|低于|以上|以内|≤|≥|<=|>=|<|>)/

/** 事实行来源分层：招标硬约束 / 待商务拍板 / 已确认事实（历史范本值必须带确认标记后才允许出现） */
export type FactSourceTier = "constraint" | "pending" | "settled"

function splitFactLine(line: string): { topic: string; value: string } {
  const i = line.search(/[：:=]/)
  if (i < 0) return { topic: line.trim(), value: "" }
  return { topic: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }
}

export type FactNormalizeResult = {
  /** 规范化后的行（未改动时与入参逐字一致） */
  line: string
  tier: FactSourceTier
  /** 本次是否补写了【需人工确认】 */
  changed: boolean
}

/**
 * 规范化单条事实行：
 *  - 已带【需人工确认】→ pending，原样返回（幂等）；
 *  - 需拍板主题 + 取值非比较口径 → 补【需人工确认】→ pending；
 *  - 需拍板主题 + 取值是比较口径（不超过/不少于…）→ constraint，原样返回；
 *  - 其余 → settled，原样返回。
 */
export function normalizeFactSourceLine(line: string): FactNormalizeResult {
  const t = (line ?? "").trim()
  if (!t) return { line: t, tier: "settled", changed: false }
  if (t.includes(FACT_CONFIRM_MARK)) return { line: t, tier: "pending", changed: false }
  const topic = factTopicOf(t)
  const { value } = splitFactLine(t)
  if (!FACT_COMMITMENT_TOPIC_RE.test(topic)) return { line: t, tier: "settled", changed: false }
  if (TENDER_CONSTRAINT_VALUE_RE.test(value)) return { line: t, tier: "constraint", changed: false }
  return { line: `${t} ${FACT_CONFIRM_MARK}`, tier: "pending", changed: true }
}

/** 事实行来源分层（判定口径与 normalizeFactSourceLine 同源，只读不写） */
export function factSourceTierOf(line: string): FactSourceTier {
  return normalizeFactSourceLine(line).tier
}

/** 批量规范化 AI 生成的事实草稿；marked = 本次新补【需人工确认】的行（供提示文案使用） */
export function normalizeFactSourceLines(lines: string[]): { lines: string[]; marked: string[] } {
  const out: string[] = []
  const marked: string[] = []
  for (const raw of lines ?? []) {
    const r = normalizeFactSourceLine(raw)
    out.push(r.line)
    if (r.changed) marked.push(r.line)
  }
  return { lines: out, marked }
}