import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 类型（字段名与 PocketBase collection 100% 一致，snake_case）
// ---------------------------------------------------------------------------

export type OppStage = "lead" | "contact" | "needs" | "solution" | "bidding" | "won" | "lost"

export const STAGE_LABEL: Record<OppStage, string> = {
  lead: "线索",
  contact: "接触",
  needs: "需求确认",
  solution: "方案阶段",
  bidding: "投标",
  won: "中标",
  lost: "失单",
}

export const PIPELINE_STAGES: OppStage[] = ["lead", "contact", "needs", "solution", "bidding"]

export function isTerminalStage(stage: string): boolean {
  return stage === "won" || stage === "lost"
}

export const HOSPITAL_TYPES = ["综合医院", "中医院", "妇幼保健院", "专科医院", "基层医疗", "其他"] as const

export const RECORD_TYPES = ["电话", "拜访", "微信", "邮件", "其他"] as const

export interface ContactInfo {
  name: string
  title: string
  phone: string
}

export interface CustomerRow {
  id: string
  rh_user_id: string
  hospital_name: string
  hospital_type: string
  level: string
  region: string
  address: string
  website: string
  outpatient_daily: number
  outpatient_yearly: number
  beds_total: number
  beds_icu: number
  beds_or: number
  key_departments: string[]
  contacts: ContactInfo[]
  notes: string
  ai_generated_fields: string[]
  last_follow_at: string
  created: string
  updated: string
}

export interface OpportunityRow {
  id: string
  rh_user_id: string
  customer_id: string
  customer_name: string
  opp_name: string
  stage: OppStage | ""
  expected_amount: number
  expected_close_date: string
  // 循环8 C5：下次跟进时间（YYYY-MM-DD，可空串；后端 opportunities.next_follow_date 已就绪）
  next_follow_date: string
  next_action: string
  ref_type: string
  ref_id: string
  ref_name: string
  lost_reason: string
  notes: string
  created: string
  updated: string
}

export interface FollowRecordRow {
  id: string
  rh_user_id: string
  customer_id: string
  opportunity_id: string
  record_type: string
  content: string
  stage_change: string
  created: string
}

export interface RefOption {
  ref_type: "solution" | "bid"
  ref_id: string
  ref_name: string
}

export function refOptionKey(r: RefOption): string {
  return `${r.ref_type}:${r.ref_id}`
}

// ---------------------------------------------------------------------------
// 第二轮改造：承接投标结果回流（只读展示，字段与 bid_projects collection 一致）
// ---------------------------------------------------------------------------

export interface BidProjectLinkRow {
  id: string
  project_name: string
  hospital: string
  stage: string
  opportunity_id: string
  bid_result: string
  bid_amount: number | null
  lost_reason: string
  result_synced_at: string
  updated: string
}

export const BID_STAGE_LABEL: Record<string, string> = {
  pending_parse: "待解析",
  composing: "编制中",
  checking: "检查中",
  evaluated: "已评标",
  archived: "已归档",
}

export const BID_RESULT_LABEL: Record<string, string> = {
  won: "中标",
  lost: "失单",
  pending: "待定",
  "": "未登记",
}

/** 投标结果徽标样式（won=primary / lost=destructive / pending=muted / 未登记=outline） */
export const BID_RESULT_BADGE: Record<string, string> = {
  won: "bg-primary/10 text-primary",
  lost: "bg-destructive/10 text-destructive",
  pending: "bg-muted text-muted-foreground",
  "": "border border-border text-muted-foreground",
}

export function bidResultBadgeClass(result: string): string {
  return BID_RESULT_BADGE[result] ?? BID_RESULT_BADGE[""]
}

export function bidResultLabel(result: string): string {
  return BID_RESULT_LABEL[result] ?? "未登记"
}

/** 客户详情「全链路资产」条目 */
export type ChainAssetKind = "solution" | "bid" | "quote"

export interface ChainAssetItem {
  kind: ChainAssetKind
  id: string
  name: string
  statusLabel: string
  updated: string
  route: string
}

export const CHAIN_KIND_LABEL: Record<ChainAssetKind, string> = {
  solution: "方案",
  bid: "投标",
  quote: "报价",
}

export interface SolutionLiteRow {
  id: string
  solution_name: string
  hospital: string
  doc_status: string
  updated: string
}

export interface QuoteLiteRow {
  id: string
  quote_name: string
  ref_name: string
  updated: string
}

// ---------------------------------------------------------------------------
// 客户表单草稿（数字字段用字符串承接输入，保存时转换）
// ---------------------------------------------------------------------------

export interface CustomerDraft {
  hospital_name: string
  hospital_type: string
  level: string
  region: string
  address: string
  website: string
  outpatient_daily: string
  outpatient_yearly: string
  beds_total: string
  beds_icu: string
  beds_or: string
  key_departments_text: string
  notes: string
}

export const EMPTY_CUSTOMER_DRAFT: CustomerDraft = {
  hospital_name: "",
  hospital_type: "",
  level: "",
  region: "",
  address: "",
  website: "",
  outpatient_daily: "",
  outpatient_yearly: "",
  beds_total: "",
  beds_icu: "",
  beds_or: "",
  key_departments_text: "",
  notes: "",
}

export const DRAFT_NUMBER_KEYS = [
  "outpatient_daily",
  "outpatient_yearly",
  "beds_total",
  "beds_icu",
  "beds_or",
] as const

export function rowToDraft(row: CustomerRow): CustomerDraft {
  const num = (n: number) => (typeof n === "number" && n > 0 ? String(n) : "")
  return {
    hospital_name: row.hospital_name ?? "",
    hospital_type: row.hospital_type ?? "",
    level: row.level ?? "",
    region: row.region ?? "",
    address: row.address ?? "",
    website: row.website ?? "",
    outpatient_daily: num(row.outpatient_daily),
    outpatient_yearly: num(row.outpatient_yearly),
    beds_total: num(row.beds_total),
    beds_icu: num(row.beds_icu),
    beds_or: num(row.beds_or),
    key_departments_text: (row.key_departments ?? []).join("、"),
    notes: row.notes ?? "",
  }
}

export function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function splitDepartmentList(text: string): string[] {
  return text
    .split(/[、,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
}

// ---------------------------------------------------------------------------
// AI 档案匹配 / 文本提取（严格 JSON 输出 + 容错解析）
// ---------------------------------------------------------------------------

export interface AiProfileResult {
  level: string | null
  hospital_type: string | null
  region: string | null
  address: string | null
  website: string | null
  outpatient_daily: number | null
  outpatient_yearly: number | null
  beds_total: number | null
  beds_icu: number | null
  beds_or: number | null
  key_departments: string[] | null
}

const PROFILE_JSON_SPEC = `{"level":"医院等级，如 三级甲等 / 二级甲等，不确定填 null","hospital_type":"综合医院 / 中医院 / 妇幼保健院 / 专科医院 / 基层医疗 / 其他 之一，不确定填 null","region":"所在省市，如 江苏省苏州市，不确定填 null","address":"医院地址，不确定填 null","website":"官网地址，不确定填 null","outpatient_daily":日门诊量数字或null,"outpatient_yearly":年门诊量数字或null,"beds_total":开放床位数数字或null,"beds_icu":ICU床位数数字或null,"beds_or":手术间数数字或null,"key_departments":["重点科室名，最多8个"]或null}`

const PROFILE_SYSTEM_PROMPT = `你是医疗信息化行业的资深售前顾问，熟悉全国各级医院的公开信息。用户给你医院名称或一段医院介绍文字，你输出该医院的结构化档案，只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown 围栏之外的内容。JSON 结构：${PROFILE_JSON_SPEC}
硬性要求：
1. 只依据你可靠掌握的公开信息填写，凡是不能确定的字段一律填 null，严禁编造精确数字；
2. 门诊量、床位数只填整数，不要带单位；数量级都没把握就填 null；
3. key_departments 填该医院公认的国家临床重点专科或特色科室，没有把握填 null；
4. 所有文本字段用简体中文。`

export function buildProfileMessages(hospitalName: string): LlmMessage[] {
  return [
    { role: "system", content: PROFILE_SYSTEM_PROMPT },
    { role: "user", content: `医院名称：${hospitalName}` },
  ]
}

export function buildExtractMessages(rawText: string): LlmMessage[] {
  return [
    { role: "system", content: PROFILE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `请从下面这段文字里提取医院档案信息（文字里明确提到的才填，没提到的一律填 null）：\n\n${rawText.slice(0, 4000)}`,
    },
  ]
}

export function parseProfileJson(text: string): AiProfileResult | null {
  const raw = stripToJson(text, "{", "}")
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const str = (v: unknown): string | null => {
      if (v === null || v === undefined) return null
      const s = String(v).trim()
      return s && s.toLowerCase() !== "null" ? s.slice(0, 200) : null
    }
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null
    }
    const deps = Array.isArray(obj.key_departments)
      ? obj.key_departments.map((d) => String(d).trim()).filter(Boolean).slice(0, 8)
      : null
    return {
      level: str(obj.level),
      hospital_type: str(obj.hospital_type),
      region: str(obj.region),
      address: str(obj.address),
      website: str(obj.website),
      outpatient_daily: num(obj.outpatient_daily),
      outpatient_yearly: num(obj.outpatient_yearly),
      beds_total: num(obj.beds_total),
      beds_icu: num(obj.beds_icu),
      beds_or: num(obj.beds_or),
      key_departments: deps && deps.length > 0 ? deps : null,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// AI 跟进建议（2-4 条数组）
// ---------------------------------------------------------------------------

export function buildSuggestionMessages(
  customer: CustomerRow,
  opp: OpportunityRow,
  records: FollowRecordRow[],
): LlmMessage[] {
  const recent = records.slice(0, 6).map((r) => `- [${fmtDate(r.created)}] ${r.record_type}${r.stage_change ? `（${r.stage_change}）` : ""}：${r.content}`).join("\n")
  const profile = [
    `医院名称：${customer.hospital_name}`,
    customer.level ? `等级：${customer.level}` : "",
    customer.hospital_type ? `类型：${customer.hospital_type}` : "",
    customer.region ? `地区：${customer.region}` : "",
    customer.beds_total ? `开放床位：${customer.beds_total}` : "",
    customer.outpatient_daily ? `日门诊量：${customer.outpatient_daily}` : "",
    customer.key_departments?.length ? `重点科室：${customer.key_departments.join("、")}` : "",
  ].filter(Boolean).join("\n")
  const oppInfo = [
    `商机名称：${opp.opp_name}`,
    `当前阶段：${opp.stage ? STAGE_LABEL[opp.stage] : "未知"}`,
    opp.expected_amount ? `预计金额：${fmtAmount(opp.expected_amount)}` : "",
    opp.expected_close_date ? `预计成交时间：${opp.expected_close_date}` : "",
    opp.next_action ? `已记录的下一步动作：${opp.next_action}` : "",
    opp.lost_reason ? `失单原因：${opp.lost_reason}` : "",
  ].filter(Boolean).join("\n")
  return [
    {
      role: "system",
      content:
        "你是医疗信息化行业的资深售前顾问。根据客户医院档案、商机当前阶段与最近的跟进记录，给出 2-4 条具体可执行的下一步跟进建议。只输出一个 JSON 对象，不要输出任何其他文字。JSON 结构：{\"suggestions\":[\"建议1\",\"建议2\"]}。要求：每条不超过 60 字，结合医院规模与商机阶段说清做什么、找谁、达成什么目标，不要空话套话，简体中文。",
    },
    {
      role: "user",
      content: `【客户档案】\n${profile}\n\n【商机】\n${oppInfo}\n\n【最近跟进记录】\n${recent || "（暂无跟进记录）"}`,
    },
  ]
}

export function parseSuggestionsJson(text: string): string[] | null {
  const raw = stripToJson(text, "{", "}")
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as { suggestions?: unknown }
    if (!Array.isArray(obj.suggestions)) return null
    const list = obj.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
    return list.length > 0 ? list : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

export function stripToJson(text: string, open: string, close: string): string | null {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf(open)
  const end = raw.lastIndexOf(close)
  if (start < 0 || end <= start) return null
  return raw.slice(start, end + 1)
}

export function fmtDateTime(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDate(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtAmount(n: number): string {
  if (!n || n <= 0) return ""
  if (n >= 10000) {
    const w = n / 10000
    return `${Number.isInteger(w) ? w : w.toFixed(1)} 万元`
  }
  return `${n} 元`
}

export function fmtMetric(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "待补充"
  if (n >= 10000) {
    const w = n / 10000
    return `${Number.isInteger(w) ? w : w.toFixed(1)} 万`
  }
  return String(n)
}

export function nowIso(): string {
  return new Date().toISOString()
}
