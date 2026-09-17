import type { LlmMessage } from "@/lib/llm"
import type { Chapter, FigureSpec, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import { makeUid, outlineToText } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// 标书工作页：领域类型、常量、LLM prompt 构造与本地查重粗筛（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type BidStage = "pending_parse" | "composing" | "checking" | "evaluated" | "archived"

export const STAGE_LABEL: Record<BidStage, string> = {
  pending_parse: "待解析",
  composing: "编制中",
  checking: "检查中",
  evaluated: "已评标",
  archived: "已归档",
}

export const STAGE_KEYS: BidStage[] = ["pending_parse", "composing", "checking", "evaluated", "archived"]

// ------------------------------ 解析配置与解析报告（sections 结构） ------------------------------

export type ParseScope = "key" | "full"

export type ParseSectionDef = { key: string; title: string; guide: string }

/** 关键项 6 项：必选不可取消 */
export const PARSE_KEY_SECTIONS: ParseSectionDef[] = [
  {
    key: "overview",
    title: "项目概述",
    // 用户反馈轮（2026-09-18）：项目概述=完整项目画像六维度（用户口径：只要识别项目概述，提取这六类）
    guide:
      "项目概述按六个维度提取，每行一条「字段名：内容」：项目基本信息（名称/招标编号/采购人）、背景目的（建设背景与采购目的一句话）、规模预算（建设规模/投资/预算金额，保留原文表述）、时间安排（工期/投标截止/开标/关键节点）、实施内容（建设内容与范围要点）、技术特点（核心系统与关键技术要求要点）",
  },
  {
    key: "tech_score",
    title: "技术评分要求",
    guide: "评分办法中技术部分逐项分值表，每行一条「评分项名（分值 分）：评分标准摘要（档位与给分条件）」，分值必须与原文一致",
  },
  {
    key: "project_info",
    title: "项目信息",
    guide: "项目背景、建设内容、工期要求、资金来源等基础信息，每行一条",
  },
  {
    key: "purchaser_info",
    title: "甲方信息",
    guide: "采购人名称、联系人与联系方式、地址等，每行一条「字段名：内容」",
  },
  {
    key: "delivery_req",
    title: "交货和服务要求",
    guide: "技术需求与交货/服务要求（建设内容、功能要求、性能指标、交货期、质保与运维），每行一条",
  },
  {
    key: "response_req",
    title: "响应文件要求",
    guide: "投标（响应）文件的组成、格式、签字盖章、装订与递交等实质性要求，每行一条",
  },
]

/** 其他项 13 项：完整解析模式下自由勾选 */
export const PARSE_EXTRA_SECTIONS: ParseSectionDef[] = [
  { key: "purchase_list", title: "采购清单", guide: "采购货物/服务清单（名称、数量、关键参数），每行一条" },
  { key: "agency_info", title: "代理机构信息", guide: "采购代理机构名称、联系人、联系方式、地址，每行一条" },
  // 循环 2 批 2-3：原 key_nodes 升级为 bid_nodes（guide 要求逐条保留时间原文；旧 key 走 PARSE_KEY_ALIASES 兼容）
  { key: "bid_nodes", title: "投标关键节点", guide: "报名、答疑、保证金缴纳、投标文件递交截止、开标、质疑/异议截止、公示等关键时间节点，逐条保留招标文件的时间原文表述，每行一条「节点：时间」" },
  // 循环 2 批 2-3：原 bid_bond 升级为 bid_deposit（补账户与退还条件口径）
  { key: "bid_deposit", title: "投标保证金", guide: "投标保证金金额、缴纳形式（转账/支票/保函等）、收款账户、缴纳截止时间、退还条件与时限，每行一条" },
  { key: "qualification", title: "资格性审查", guide: "投标人资格要求（营业执照、行业资质、业绩、认证证书、信用等），每行一条，强制要求加「[强制]」前缀" },
  { key: "compliance", title: "符合性检查", guide: "符合性审查要点（资格与格式之外的无效投标审查项），每行一条" },
  { key: "bid_open_req", title: "开标要求", guide: "开标流程、场地、纪律与解密要求，每行一条" },
  { key: "eval_req", title: "评标要求", guide: "评标方法、评标程序与评标委员会组成要求，每行一条" },
  { key: "biz_score", title: "商务评分要求", guide: "评分办法中商务部分逐项分值表，每行一条「评分项名（分值 分）：评分标准摘要」" },
  { key: "void_items", title: "无效标与废标项", guide: "废标/无效投标条款原文摘录（未密封、未盖公章、报价超预算、资质不符、串通投标认定等），每行一条" },
  // 循环 2 批 2-3：原 contract_award + contract_end 合并升级为 contract_terms（补质保衔接口径）
  { key: "contract_terms", title: "合同关键条款", guide: "合同授予条件、签订时限与履约保证金、合同解除与终止条款、质保期与缺陷责任期衔接，每行一条" },
  // 第十七轮 17A：招标规定的投标文件目录（大纲章结构遵循依据）
  { key: "bid_outline_req", title: "投标文件目录要求", guide: "招标文件中对投标文件/技术标目录结构的规定（章节名录原文），每行一条目录项，保留原编号与层级" },
  // 第十七轮 17B：编制依据与规范编号清单（规范库补选与正文注入依据）
  { key: "compilation_basis", title: "编制依据与规范", guide: "招标文件中要求或提及的编制依据、标准规范清单（国家标准/行业标准/技术文件/法律法规的编号与名称），每行一条「编号 名称」，保留原文编号格式" },
]

/** 第十二轮改造 2：★/▲ 重点条款（本地扫描产出，不走 LLM 解析、不计入 requestedKeys） */
export const STAR_CLAUSE_SECTION: ParseSectionDef = {
  key: "star_clauses",
  title: "★/▲ 重点条款",
  guide: "招标文件中带 ★/▲ 标记的实质性响应条款原文",
}

export const PARSE_ALL_SECTIONS: ParseSectionDef[] = [...PARSE_KEY_SECTIONS, ...PARSE_EXTRA_SECTIONS, STAR_CLAUSE_SECTION]

export function parseSectionDef(key: string): ParseSectionDef | undefined {
  return PARSE_ALL_SECTIONS.find((d) => d.key === key)
}

/**
 * 循环 2 批 2-3：解析项 key 旧→新别名映射——key_nodes/bid_bond/contract_award/contract_end
 * 升级为 bid_nodes/bid_deposit/contract_terms 后，老项目保存的解析配置与存量报告经此兼容，
 * 行为与现状一致（旧 key 报告照常展示，旧配置重解析时自动映射到新 key）。
 */
export const PARSE_KEY_ALIASES: Record<string, string> = {
  key_nodes: "bid_nodes",
  bid_bond: "bid_deposit",
  contract_award: "contract_terms",
  contract_end: "contract_terms",
}

/** 旧 key 的中文标题回退（存量报告 section 自带 title 时优先用自带值） */
const LEGACY_SECTION_TITLES: Record<string, string> = {
  key_nodes: "投标关键节点",
  bid_bond: "投标保证金",
  contract_award: "合同授予与签订",
  contract_end: "合同解除和终止",
}

/** 配置里的 extra_keys 归一：旧 key 映射到新 key 并去重（保存/回显/请求三处共用同一口径） */
export function normalizeExtraKeys(keys: string[] | null | undefined): string[] {
  const out: string[] = []
  for (const k of keys ?? []) {
    const mapped = PARSE_KEY_ALIASES[k] ?? k
    if (!out.includes(mapped)) out.push(mapped)
  }
  return out
}

export function parseSectionTitle(key: string): string {
  return parseSectionDef(key)?.title ?? LEGACY_SECTION_TITLES[key] ?? key
}

export type ParseSectionStatus = "ok" | "failed" | "pending"

export const PARSE_STATUS_LABEL: Record<ParseSectionStatus, string> = {
  ok: "成功",
  failed: "失败",
  pending: "未解析",
}

export type ParseSection = {
  key: string
  title: string
  content: string
  human_edited?: boolean
  /** 解析状态；旧数据无此字段时按「有内容=ok」兼容 */
  status?: ParseSectionStatus
  /** 一句摘要，供解析报告左栏列表展示 */
  snippet?: string
}

export type ParseReport = {
  scope: ParseScope
  sections: ParseSection[]
  /** 循环 8 A5：分段解析失败段提示（≤20 条、每条 ≤100 字），随报告落库供刷新后恢复失败横幅；正常解析不写此键 */
  warnings?: string[]
}

export function sectionStatus(s: ParseSection): ParseSectionStatus {
  if (s.status === "ok" || s.status === "failed" || s.status === "pending") return s.status
  return s.content.trim() ? "ok" : "pending"
}

/** 由内容生成一句摘要（取首个非空行，超长截断） */
export function makeSnippet(content: string): string {
  const line = content.split(/\n+/).map((l) => l.trim()).find((l) => l.length > 0) ?? ""
  return line.length > 42 ? `${line.slice(0, 42)}…` : line
}

export function sectionSnippet(s: ParseSection): string {
  const own = (s.snippet ?? "").trim()
  return own || makeSnippet(s.content)
}

/** 替换或补入一个解析项（保持定义顺序），单项重解析合并用 */
export function upsertParseSection(report: ParseReport, next: ParseSection): ParseReport {
  const exists = report.sections.some((s) => s.key === next.key)
  const sections = exists ? report.sections.map((s) => (s.key === next.key ? { ...s, ...next } : s)) : [...report.sections, next]
  const order = new Map(PARSE_ALL_SECTIONS.map((d, i) => [d.key, i]))
  sections.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  return { ...report, sections }
}

/** 只改某项状态（重解析失败时保留旧内容）；项不存在则补空项 */
export function markParseSectionStatus(report: ParseReport, key: string, status: ParseSectionStatus): ParseReport {
  if (!report.sections.some((s) => s.key === key)) {
    return upsertParseSection(report, { key, title: parseSectionTitle(key), content: "", status, snippet: "" })
  }
  return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, status } : s)) }
}

/** 循环 8 A5：单项重解析成功后清除失败横幅 warnings（无 warnings 时原样返回，不产生键膨胀） */
export function clearParseWarnings(report: ParseReport): ParseReport {
  if (!report.warnings?.length) return report
  return { scope: report.scope, sections: report.sections }
}

/** 循环 8 A5：warnings 落库前容错（只留非空字符串、每条 ≤100 字、≤20 条；空清单返回 undefined 不写键） */
export function sanitizeParseWarnings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = (raw as unknown[])
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim().slice(0, 100))
    .slice(0, 20)
  return out.length ? out : undefined
}

export type ParseConfig = {
  scope: ParseScope
  extra_keys: string[]
  /** 第十二轮改造 2：★/▲ 重点条款本地扫描开关；缺省视为 true（旧配置兼容） */
  star_clauses?: boolean
}

export function defaultParseConfig(): ParseConfig {
  return { scope: "key", extra_keys: [], star_clauses: true }
}

/** 重点条款扫描是否开启：未配置 / 旧配置（无 star_clauses 字段）一律视为开启 */
export function starClausesEnabled(cfg: ParseConfig | null | undefined): boolean {
  return (cfg ?? defaultParseConfig()).star_clauses !== false
}

/** 本次解析实际要输出的项：关键项档=6 项；完整档=关键项+勾选项（未勾任何项=全部其他项） */
export function requestedKeys(cfg: ParseConfig | null | undefined): string[] {
  const keyKeys = PARSE_KEY_SECTIONS.map((d) => d.key)
  const conf = cfg ?? defaultParseConfig()
  if (conf.scope !== "full") return keyKeys
  const valid = new Set(PARSE_EXTRA_SECTIONS.map((d) => d.key))
  // 循环 2 批 2-3：旧 key 配置经别名归一后照常生效（老项目缺省走现状）
  const chosen = normalizeExtraKeys(conf.extra_keys).filter((k) => valid.has(k))
  return [...keyKeys, ...(chosen.length ? chosen : PARSE_EXTRA_SECTIONS.map((d) => d.key))]
}

export function parseConfigCount(cfg: ParseConfig | null | undefined): number {
  return requestedKeys(cfg).length
}

// ------------------------------ 第十二轮改造 2：★/▲ 重点条款本地扫描（零 AI 费用） ------------------------------

export const STAR_CLAUSE_LIMIT = 200

const STAR_MARK_RE = /[★☆▲△]/

/**
 * 从招标文件原文本地扫描 ★/▲ 标记条款（纯函数，零 AI 调用）：
 * 逐行扫描，命中行 = 含 ★☆▲△ 任一标记；连续命中行合并为一条条款；去重；
 * 每条保留原标记与原文字；上限 200 条，超出时末行追加「…另有 N 条未列出」。
 */
export function extractStarClauses(text: string): string[] {
  const clauses: string[] = []
  const seen = new Set<string>()
  let buf: string[] = []
  const flush = () => {
    if (!buf.length) return
    const clause = buf.join("\n").trim()
    buf = []
    if (!clause) return
    const dedupeKey = clause.replace(/\s+/g, "").slice(0, 60)
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    clauses.push(clause)
  }
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line && STAR_MARK_RE.test(line)) buf.push(line)
    else flush()
  }
  flush()
  if (clauses.length > STAR_CLAUSE_LIMIT) {
    const omitted = clauses.length - STAR_CLAUSE_LIMIT
    return [...clauses.slice(0, STAR_CLAUSE_LIMIT), `…另有 ${omitted} 条未列出`]
  }
  return clauses
}

/** 扫描结果实际条款条数（末行为截断提示时按上限计） */
export function starClauseCount(lines: string[]): number {
  const last = lines[lines.length - 1] ?? ""
  return last.startsWith("…另有") ? STAR_CLAUSE_LIMIT : lines.length
}

/** 扫描结果 → parse_report 的 star_clauses 节；无命中返回 null（不落空节） */
export function starClauseSectionFrom(lines: string[]): ParseSection | null {
  if (!lines.length) return null
  return {
    key: STAR_CLAUSE_SECTION.key,
    title: STAR_CLAUSE_SECTION.title,
    content: lines.join("\n"),
    status: "ok",
    snippet: `共 ${starClauseCount(lines)} 条`,
  }
}

/**
 * 废标检查 / 交卷体检 prompt 联动注入段：报告里有重点条款节则返回上下文段（截断 6000 字），
 * 否则返回空串（调用方不追加）。既有 LLM 调用与费用确认不变。
 */
export function starClausesPromptBlock(report: ParseReport | null): string {
  const text = sectionText(report, STAR_CLAUSE_SECTION.key)
  if (!text.trim()) return ""
  return `以下为招标文件 ★/▲ 重点条款（实质性响应条款，须逐条核对投标文件是否响应，未响应视为 critical）：\n${clipText(text, 6000)}`
}

// ------------------------------ 第十七轮 17A：招标规定目录本地核验（零 AI 费用） ------------------------------

/** 第十七轮 17A：「投标文件目录要求」解析项 key（大纲遵循与本地核验共用） */
export const BID_OUTLINE_REQ_KEY = "bid_outline_req"

/** 匹配归一化：去编号前缀后仅保留文字与数字（去标点、去空格） */
function normalizeOutlineReqText(s: string): string {
  return stripEnumerator(s ?? "").replace(/[^\p{L}\p{N}]+/gu, "")
}

/**
 * 顶层技术章标题与招标规定目录行的匹配率（纯函数，零 AI 调用）：
 * 规定目录按行拆分并归一化（去编号/标点/空格，丢弃 <2 字行）；
 * 某行与任一技术章标题互含（标题含目录行，或目录行含标题）即视为匹配；
 * 返回匹配行数占比 0-1；无有效目录行返回 null（调用方跳过核验）。
 */
export function outlineReqMatchRate(outlineReqText: string, techTitles: string[]): number | null {
  const lines = (outlineReqText ?? "")
    .split(/\r?\n+/)
    .map((l) => normalizeOutlineReqText(l.trim()))
    .filter((l) => l.length >= 2)
  if (!lines.length) return null
  const titles = (techTitles ?? []).map((t) => normalizeOutlineReqText(t.trim())).filter((t) => t.length >= 2)
  if (!titles.length) return 0
  const matched = lines.filter((line) => titles.some((t) => t.includes(line) || line.includes(t))).length
  return matched / lines.length
}

// ------------------------------ 第十七轮 17B：编制依据与规范库（零 AI 费用） ------------------------------

/** 第十七轮 17B：「编制依据与规范」解析项 key（解析提取 ∪ 规范库补选合并清单共用） */
export const COMPILATION_BASIS_KEY = "compilation_basis"

/** 规范条目类别（规范库补选筛选 tab 与分组撰写样式共用） */
export type StandardCategory = "强制性国家标准" | "推荐性国家标准" | "行业标准" | "指导性技术文件" | "通用依据"

export const STANDARD_CATEGORIES: StandardCategory[] = [
  "强制性国家标准",
  "推荐性国家标准",
  "行业标准",
  "指导性技术文件",
  "通用依据",
]

/** 规范条目（MEDICAL_STANDARDS 库行与 bid_projects.compilation_basis_extra json 列行同构） */
export type StandardItem = { code: string; name: string; category: StandardCategory }

/** 类别分色徽标（shadcn token 类；解析报告面板与规范库补选对话框共用） */
export const BASIS_CATEGORY_BADGE: Record<StandardCategory, string> = {
  强制性国家标准: "bg-destructive/10 text-destructive",
  推荐性国家标准: "bg-primary/10 text-primary",
  行业标准: "bg-secondary text-secondary-foreground",
  指导性技术文件: "bg-muted text-muted-foreground",
  通用依据: "bg-accent text-accent-foreground",
}

/**
 * 医疗信息化标书常用编制依据规范库（37 条，编号均可公开核验、禁止编造；
 * 无正式标准编号的条目 code 留空，去重时按名称）。
 */
export const MEDICAL_STANDARDS: StandardItem[] = [
  // 强制性国家标准
  { code: "GB 50174-2017", name: "数据中心设计规范", category: "强制性国家标准" },
  { code: "GB 50311-2016", name: "综合布线系统工程设计规范", category: "强制性国家标准" },
  { code: "GB 17859-1999", name: "计算机信息系统安全保护等级划分准则", category: "强制性国家标准" },
  { code: "GB 35114-2017", name: "公共安全视频监控联网信息安全技术要求", category: "强制性国家标准" },
  { code: "GB 50348-2018", name: "安全防范工程技术标准", category: "强制性国家标准" },
  // 推荐性国家标准
  { code: "GB/T 22239-2019", name: "信息安全技术 网络安全等级保护基本要求", category: "推荐性国家标准" },
  { code: "GB/T 22240-2020", name: "信息安全技术 网络安全等级保护定级指南", category: "推荐性国家标准" },
  { code: "GB/T 25070-2019", name: "信息安全技术 网络安全等级保护安全设计技术要求", category: "推荐性国家标准" },
  { code: "GB/T 28448-2019", name: "信息安全技术 网络安全等级保护测评要求", category: "推荐性国家标准" },
  { code: "GB/T 20984-2022", name: "信息安全技术 信息安全风险评估方法", category: "推荐性国家标准" },
  { code: "GB/T 35273-2020", name: "信息安全技术 个人信息安全规范", category: "推荐性国家标准" },
  { code: "GB/T 39725-2020", name: "信息安全技术 健康医疗数据安全指南", category: "推荐性国家标准" },
  { code: "GB/T 38667-2020", name: "信息技术 大数据 数据分类指南", category: "推荐性国家标准" },
  { code: "GB/T 39786-2021", name: "信息安全技术 信息系统密码应用基本要求", category: "推荐性国家标准" },
  { code: "GB/T 28699-2012", name: "卫生信息数据交换标准 HL7 版本3（参考信息模型）", category: "推荐性国家标准" },
  { code: "GB/T 51314-2018", name: "数据中心基础设施运行维护标准", category: "推荐性国家标准" },
  { code: "GB/T 8567-2006", name: "计算机软件文档编制规范", category: "推荐性国家标准" },
  { code: "GB/T 9385-2008", name: "计算机软件需求规格说明规范", category: "推荐性国家标准" },
  { code: "GB/T 25000.51-2016", name: "系统与软件工程 系统与软件质量要求和评价（SQuaRE）第51部分：就绪可用软件产品质量要求与测试细则", category: "推荐性国家标准" },
  // 行业标准
  { code: "WS 445-2014", name: "电子病历基本架构与数据标准", category: "行业标准" },
  { code: "WS/T 500-2016", name: "电子病历共享文档规范（第1-53部分）", category: "行业标准" },
  { code: "WS/T 501-2016", name: "电子病历标准符合性测试方法", category: "行业标准" },
  { code: "WS/T 529-2016", name: "电子病历系统应用水平评价标准", category: "行业标准" },
  { code: "WS 363-2011", name: "卫生信息数据元目录", category: "行业标准" },
  { code: "WS 364-2011", name: "卫生信息数据元值域代码", category: "行业标准" },
  { code: "WS/T 448-2014", name: "基于电子病历的医院信息平台技术规范", category: "行业标准" },
  { code: "GM/T 0054-2018", name: "信息系统密码应用基本要求", category: "行业标准" },
  // 指导性技术文件
  { code: "", name: "医院信息互联互通标准化成熟度测评方案（国家卫生健康委统计信息中心）", category: "指导性技术文件" },
  { code: "国卫办医函〔2018〕1079号", name: "电子病历系统应用水平分级评价管理办法（试行）", category: "指导性技术文件" },
  // 通用依据（法律法规与国际通行标准、信创要求）
  { code: "", name: "中华人民共和国网络安全法", category: "通用依据" },
  { code: "", name: "中华人民共和国数据安全法", category: "通用依据" },
  { code: "", name: "中华人民共和国个人信息保护法", category: "通用依据" },
  { code: "HL7 v2.x", name: "卫生信息交换标准 HL7 第2版（国际）", category: "通用依据" },
  { code: "FHIR R4", name: "快速医疗互操作资源 FHIR 第4版（国际）", category: "通用依据" },
  { code: "DICOM 3.0", name: "医学数字成像与通信标准（国际）", category: "通用依据" },
  { code: "IHE TF", name: "IHE 医疗企业集成技术框架（国际）", category: "通用依据" },
  { code: "", name: "信息技术应用创新 国产软硬件适配要求（通用依据）", category: "通用依据" },
]

/** 第十七轮 17B：编制依据撰写样式三值（bid_projects.basis_style text 列；未设置默认 table） */
export type BasisStyle = "table" | "group" | "numbered"

export const BASIS_STYLE_OPTIONS: { value: BasisStyle; label: string; desc: string }[] = [
  { value: "table", label: "统一表格", desc: "序号/名称/编号/类型 一张表" },
  { value: "group", label: "分组表格", desc: "按类型分组、每组一张表" },
  { value: "numbered", label: "编号行", desc: "纯文本按类型 1.x 编号行" },
]

/** 正文 prompt 注入形态：规则句全部章携带；listText 仅目标章非空（章级判断在调用处做，节级继承） */
export type CompilationBasisPrompt = { style: BasisStyle; listText?: string }

/** basis_style 列反序列化容错（存量缺列/空串/非法值 → ""=未设置，消费侧默认 table） */
export function normalizeBasisStyle(raw: unknown): BasisStyle | "" {
  const s = String(raw ?? "").trim()
  return s === "table" || s === "group" || s === "numbered" ? s : ""
}

/** compilation_basis_extra json 列反序列化容错（存量缺列/形状不符 → null=未补选；行级非法跳过） */
export function normalizeBasisExtra(raw: unknown): StandardItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: StandardItem[] = []
  for (const it of raw) {
    const r = (it ?? {}) as Record<string, unknown>
    const name = String(r.name ?? "").trim()
    if (!name) continue
    const cat = String(r.category ?? "").trim() as StandardCategory
    items.push({
      code: String(r.code ?? "").trim(),
      name,
      category: STANDARD_CATEGORIES.includes(cat) ? cat : "通用依据",
    })
  }
  return items
}

/** 去重键：有编号按编号（归一去空格、大写），无编号按名称（归一去空格） */
export function basisItemKey(item: StandardItem): string {
  const code = (item.code ?? "").replace(/\s+/g, "").toUpperCase()
  return code || (item.name ?? "").replace(/\s+/g, "")
}

/** 从解析行抽取标准编号（GB/WS/GM 等前缀或国际标准短名；抽不到返回空串） */
const BASIS_CODE_RE =
  /((?:GB|WS|GM|YD|HJ|QX)(?:\/[TZ])?[\s]*\d+(?:\.\d+)*(?:[-—]\d{4})?|HL7\s*v?[\dx.]+|FHIR\s*R\d|DICOM(?:\s*[\d.]+)?|IHE(?:\s*TF)?)/i

/** 编号前缀 → 类别（GB/T、GB/Z 推荐性；GB 强制性；WS/GM/YD 等行业标准；其余通用依据） */
function categoryFromCode(code: string): StandardCategory {
  const c = (code ?? "").replace(/\s+/g, "").toUpperCase()
  if (!c) return "通用依据"
  if (c.startsWith("GB/T") || c.startsWith("GB/Z")) return "推荐性国家标准"
  if (c.startsWith("GB")) return "强制性国家标准"
  if (/^(WS|GM|YD|HJ|QX)/.test(c)) return "行业标准"
  return "通用依据"
}

/** 编号归一（去空格、大写），库内对照用 */
function normalizeStdCode(code: string): string {
  return (code ?? "").replace(/\s+/g, "").toUpperCase()
}

/**
 * 解析节文本 → 规范条目清单（纯函数，零 AI 调用）：
 * 每行一条；抽取编号后先对照 MEDICAL_STANDARDS 库（同编号取库内标准名与类别），
 * 库外条目名称取去掉编号后的行文本（抽不到编号则 code 留空、名称保留行原文）；按 basisItemKey 去重。
 */
export function parseBasisLines(text: string): StandardItem[] {
  const out: StandardItem[] = []
  const seen = new Set<string>()
  for (const rawLine of (text ?? "").split(/\r?\n+/)) {
    const line = stripEnumerator(rawLine.trim()).trim()
    if (!line || line.length < 3) continue
    const m = line.match(BASIS_CODE_RE)
    const code = m ? m[1].replace(/\s+/g, " ").trim() : ""
    const libHit = code
      ? MEDICAL_STANDARDS.find((s) => s.code && normalizeStdCode(s.code) === normalizeStdCode(code))
      : undefined
    let item: StandardItem
    if (libHit) {
      item = { ...libHit }
    } else {
      let name = line
      if (m) {
        name =
          line
            .replace(m[1], "")
            .replace(/^[《\s:：,，、\-—]+/, "")
            .replace(/[》\s:：,，、]+$/, "")
            .trim() || line
      }
      item = { code, name, category: categoryFromCode(code) }
    }
    const key = basisItemKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** 展示与注入用合并清单：解析提取行 ∪ 规范库补选 extra（按 code 去重、无 code 按 name 去重；解析行在前） */
export function mergeBasisItems(parsed: StandardItem[], extra: StandardItem[] | null): StandardItem[] {
  const out: StandardItem[] = []
  const seen = new Set<string>()
  for (const it of [...(parsed ?? []), ...(extra ?? [])]) {
    const key = basisItemKey(it)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

/** 注入正文 prompt 的清单文本（编号行形式；上限 120 条防 token 失控） */
export function basisListText(items: StandardItem[]): string {
  return (items ?? [])
    .slice(0, 120)
    .map((it, i) => `${i + 1}. ${it.code ? `${it.code} ` : ""}《${it.name}》（${it.category}）`)
    .join("\n")
}

/** 撰写样式规则句（table 统一表格 / group 按类型分组表格 / numbered 纯文本按类型 1.x 编号行） */
export function basisStyleRule(style: BasisStyle): string {
  if (style === "group")
    return "编制依据按类型分组列示（强制性国家标准/推荐性国家标准/行业标准/指导性技术文件/通用依据各成一组），每组一个表格：序号、名称、编号（用纯文本表格行表达：每行一行文本、列间用两个全角空格分隔、首行为表头，禁止 markdown 表格符号）"
  if (style === "numbered")
    return "编制依据用纯文本编号行列示：按类型分组编号（形如 1.1、1.2…），每行「编号 《名称》（类型）」，禁止表格"
  return "编制依据以统一表格呈现：列为序号、名称、编号、类型（用纯文本表格行表达：每行一行文本、列间用两个全角空格分隔、首行为表头，禁止 markdown 表格符号）"
}

/** 清单文本注入的目标章标题匹配（编制依据/标准/规范）；全大纲匹配不到时调用方回退首个技术章 */
export const BASIS_CHAPTER_TITLE_RE = /编制依据|标准|规范/

// ------------------------------ 旧格式 parse_report 兼容映射 ------------------------------

function toContentText(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) return v.map((x) => toContentText(x)).filter((s) => s.trim()).join("\n")
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${toContentText(val)}`)
      .filter((s) => !s.endsWith(": "))
      .join("\n")
  }
  return String(v)
}

function section(key: string, content: string): ParseSection | null {
  const text = content.trim()
  if (!text) return null
  return { key, title: parseSectionTitle(key), content: text }
}

// ------------------------------ 用户反馈轮项 1：解析内容共享清洗（字段去重 + 脏值黑名单 + 未明确归并） ------------------------------

/** 脏值黑名单（字段值 trim + 小写后完全命中即整行丢弃） */
const PARSE_DIRTY_VALUES = new Set(["投标文件", "招标文件", "响应文件", "无", "暂无", "n/a", "不详"])
/** 未明确类说明行：值命中即从正文移除，字段名归并进末尾「原文未提及」汇总行 */
const PARSE_UNCLEAR_RE = /未明确|未提及|未写明|没有明确|未提供|不明确/
/** 字段名含这些词且值为 ≤2 位纯数字时按脏值处理（分块解析丢失编号/名称/日期的残行） */
const PARSE_NUMERIC_DIRTY_NAME_RE = /编号|名称|监理|时间|日期/
/** 「原文未提及」汇总行字段名上限（超出截断加「等」） */
const PARSE_UNCLEAR_MAX_FIELDS = 20

/**
 * 解析章节内容清洗（共享纯函数，mergeChunkReports / sanitizeParseSections / normalizeParseReport 读路径三处共用）：
 * 1. 字段名归一去重（取「：」前文本，全角/半角冒号归一）：同名字段只保留首个有效值——首现是脏值/未明确行时
 *    被丢弃、后现有效值自然顶上；无冒号的说明行不参与字段去重，仅丢弃空白归一后完全相同的重复行；
 * 2. 脏值黑名单：值为 投标文件/招标文件/响应文件/无/暂无/N\\/A/不详 的行整行丢弃；
 *    字段名含 编号/名称/监理/时间/日期 且值为 ≤2 位纯数字的行同样丢弃；
 * 3. 未明确行归并：值命中 未明确/未提及/未写明/没有明确/未提供/不明确 的行从正文移除，
 *    字段名收集后在章节末尾追加一行「原文未提及：A、B、C」（≤20 个，超出截断加「等」；无此类行不追加；
 *    已有有效值的字段不进汇总）；
 * 4. 行序保持原序。
 */
export function cleanParseSectionContent(content: string): string {
  const src = (content ?? "").trim()
  if (!src) return ""
  const outLines: string[] = []
  const seenPlain = new Set<string>()
  const seenField = new Set<string>()
  const validField = new Set<string>()
  const unclearFields: string[] = []
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    // URL 行不按字段解析（半角冒号是协议分隔符）
    if (/^https?:\/\//i.test(line)) {
      const urlNorm = line.replace(/\s+/g, "")
      if (!seenPlain.has(urlNorm)) {
        seenPlain.add(urlNorm)
        outLines.push(line)
      }
      continue
    }
    const idxFull = line.indexOf("：")
    const idxHalf = line.indexOf(":")
    const colon = idxFull < 0 ? idxHalf : idxHalf < 0 ? idxFull : Math.min(idxFull, idxHalf)
    if (colon <= 0) {
      // 无字段名的说明行：空白归一后去重，保留原行与原序
      const norm = line.replace(/\s+/g, "")
      if (seenPlain.has(norm)) continue
      seenPlain.add(norm)
      outLines.push(line)
      continue
    }
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    const nameKey = name.replace(/\s+/g, "")
    if (!nameKey || !value) continue
    if (PARSE_UNCLEAR_RE.test(value)) {
      if (!unclearFields.some((f) => f.replace(/\s+/g, "") === nameKey)) unclearFields.push(name)
      continue
    }
    // 说明型行（字段名含未提及/未明确，值是顿号枚举清单）：拆开归并进汇总行，原行丢弃
    if (PARSE_UNCLEAR_RE.test(name)) {
      for (const piece of value.split(/[、，,;]/)) {
        const p = piece.trim()
        if (!p) continue
        if (!unclearFields.some((f) => f.replace(/\s+/g, "") === p.replace(/\s+/g, ""))) unclearFields.push(p)
      }
      continue
    }
    if (PARSE_DIRTY_VALUES.has(value.toLowerCase())) continue
    if (PARSE_NUMERIC_DIRTY_NAME_RE.test(name) && /^\d{1,2}$/.test(value)) continue
    if (seenField.has(nameKey)) continue
    seenField.add(nameKey)
    validField.add(nameKey)
    outLines.push(line)
  }
  const rest = unclearFields.filter((f) => !validField.has(f.replace(/\s+/g, "")))
  if (rest.length) {
    const shown = rest.slice(0, PARSE_UNCLEAR_MAX_FIELDS).join("、")
    outLines.push(`原文未提及：${shown}${rest.length > PARSE_UNCLEAR_MAX_FIELDS ? "等" : ""}`)
  }
  return outLines.join("\n")
}

/**
 * 用户反馈轮：解析报告重复部分不展示——跨 section 行级去重：
 * 按 sections 顺序遍历，归一化（去空白）后相同的行只保留在首个出现的 section，后续 section 删除该行。
 * 豁免：star_clauses（原文摘录重复于其他项是其价值）、human_edited（尊重手改，既不删也不作去重源）；
 * 「原文未提及：…」汇总行不参与去重（各 section 缺失口径不同）。
 */
export function dedupeAcrossSections(report: ParseReport): ParseReport {
  const seen = new Set<string>()
  const sections = report.sections.map((s) => {
    if (s.key === STAR_CLAUSE_SECTION.key || s.human_edited || !s.content.trim()) return s
    const kept: string[] = []
    for (const line of s.content.split("\n")) {
      const t = line.trim()
      if (!t) continue
      if (t.startsWith("原文未提及：")) {
        kept.push(t)
        continue
      }
      const norm = t.replace(/\s+/g, "")
      if (seen.has(norm)) continue
      seen.add(norm)
      kept.push(t)
    }
    const content = kept.join("\n")
    if (content === s.content.trim()) return s
    return {
      ...s,
      content,
      snippet: makeSnippet(content),
      status: content.trim() ? s.status : ("pending" as ParseSectionStatus),
    }
  })
  return { ...report, sections }
}

/**
 * 读取 parse_report 的统一入口：
 * - 新格式 {scope, sections:[{key,title,content,human_edited}]} 直接规整；
 * - 旧格式（overview/scoring_items/qualifications/void_clauses/tech_requirements/timeline 固定字段）
 *   映射到对应 sections，scope 记为 full；
 * - 空值返回 null。
 */
export function normalizeParseReport(raw: unknown): ParseReport | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  if (Array.isArray(rec.sections)) {
    const sections: ParseSection[] = []
    for (const it of rec.sections as unknown[]) {
      const r = (it ?? {}) as Record<string, unknown>
      const key = asString(r.key).trim()
      const rawContent = asString(r.content ?? r.text).trim()
      if (!key) continue
      // 用户反馈轮项 1：读路径统一清洗（存量脏数据打开即清洗）；人工手改过的 section 跳过、尊重手改
      const humanEdited = r.human_edited === true
      const content = humanEdited ? rawContent : cleanParseSectionContent(rawContent)
      const stRaw = asString(r.status).trim()
      const status: ParseSectionStatus =
        stRaw === "ok" || stRaw === "failed" || stRaw === "pending"
          ? stRaw === "ok" && !content
            ? "pending"
            : stRaw
          : content
            ? "ok"
            : "pending"
      // 旧数据无 status 且无内容 = 无效行；新数据允许保留 pending/failed 空项供单独重解析；
      // 清洗后内容变空（rawContent 非空）保留为 pending 供重解析，不整项丢弃
      if (!content && stRaw !== "failed" && stRaw !== "pending" && !rawContent) continue
      sections.push({
        key,
        title: asString(r.title).trim() || parseSectionTitle(key),
        content,
        human_edited: humanEdited,
        status,
        snippet: asString(r.snippet).trim() || undefined,
      })
    }
    // 循环 8 A5：保留失败段 warnings（容错过滤，空清单不写键，老数据无此字段不受影响）
    const warnings = sanitizeParseWarnings(rec.warnings)
    // 用户反馈轮：读路径跨 section 去重（存量报告打开即收敛重复行）
    return dedupeAcrossSections({ scope: rec.scope === "full" ? "full" : "key", sections, ...(warnings ? { warnings } : {}) })
  }
  const isLegacy = ["overview", "scoring_items", "qualifications", "void_clauses", "tech_requirements", "timeline"].some(
    (k) => k in rec,
  )
  if (!isLegacy) return null
  const ov = (rec.overview ?? {}) as Record<string, unknown>
  const sections: ParseSection[] = []
  const push = (s: ParseSection | null) => {
    if (s) sections.push(s)
  }
  push(
    section(
      "overview",
      [
        ov.project_name ? `项目名称：${asString(ov.project_name)}` : "",
        ov.tender_no ? `招标编号：${asString(ov.tender_no)}` : "",
        ov.budget ? `预算金额：${asString(ov.budget)}` : "",
        ov.bid_deadline ? `投标截止：${asString(ov.bid_deadline)}` : "",
        ov.bid_open_time ? `开标时间：${asString(ov.bid_open_time)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  )
  push(
    section(
      "purchaser_info",
      [ov.purchaser ? `采购人：${asString(ov.purchaser)}` : "", ov.agency ? `代理机构：${asString(ov.agency)}` : ""]
        .filter(Boolean)
        .join("\n"),
    ),
  )
  push(
    section(
      "tech_score",
      asArray(rec.scoring_items)
        .map((it, i) => {
          const r = (it ?? {}) as Record<string, unknown>
          const item = asString(r.item).trim()
          if (!item) return ""
          const criteria = asString(r.criteria).trim()
          return `${i + 1}. ${item}（${asNumber(r.score)} 分）${criteria ? `：${criteria}` : ""}`
        })
        .filter(Boolean)
        .join("\n"),
    ),
  )
  push(
    section(
      "qualification",
      asArray(rec.qualifications)
        .map((it) => {
          const r = (it ?? {}) as Record<string, unknown>
          const req = asString(r.requirement).trim()
          return req ? `${r.mandatory === false ? "" : "[强制] "}${req}` : ""
        })
        .filter(Boolean)
        .join("\n"),
    ),
  )
  push(section("void_items", asArray(rec.void_clauses).map((c) => asString(c).trim()).filter(Boolean).join("\n")))
  push(
    section(
      "delivery_req",
      asArray(rec.tech_requirements)
        .map((t, i) => {
          const text = asString(t).trim()
          return text ? `${i + 1}. ${text}` : ""
        })
        .filter(Boolean)
        .join("\n"),
    ),
  )
  push(
    section(
      "bid_nodes",
      asArray(rec.timeline)
        .map((it) => {
          const r = (it ?? {}) as Record<string, unknown>
          const ev = asString(r.event).trim()
          return ev ? `${ev}：${asString(r.time)}` : ""
        })
        .filter(Boolean)
        .join("\n"),
    ),
  )
  if (!sections.length) return null
  return dedupeAcrossSections({ scope: "full", sections })
}

/** 把 LLM 返回的解析 JSON 规整成 sections（只保留本次勾选且非空的项，按定义顺序） */
export function sanitizeParseSections(raw: unknown, keys: string[]): ParseReport {
  let rec: Record<string, unknown> = {}
  if (raw && typeof raw === "object") {
    rec = raw as Record<string, unknown>
    if (Array.isArray(rec.sections)) {
      const flat: Record<string, unknown> = {}
      for (const it of rec.sections as unknown[]) {
        const r = (it ?? {}) as Record<string, unknown>
        const key = asString(r.key).trim()
        if (key) flat[key] = r.content ?? r.text
      }
      rec = flat
    }
  }
  const sections: ParseSection[] = []
  for (const key of keys) {
    // 用户反馈轮项 1：落库即清洗（字段去重 + 脏值黑名单 + 未明确归并），单块路径与 mergeChunkReports 同口径
    const text = cleanParseSectionContent(toContentText(rec[key]).trim())
    if (text) {
      sections.push({ key, title: parseSectionTitle(key), content: text, status: "ok", snippet: makeSnippet(text) })
    } else {
      // 勾了但没提取到内容的项保留为「未解析」，可在报告里单独重解析
      sections.push({ key, title: parseSectionTitle(key), content: "", status: "pending", snippet: "" })
    }
  }
  // 用户反馈轮：单块路径落库前跨 section 去重（与 mergeChunkReports 同口径）
  return dedupeAcrossSections({ scope: "full", sections })
}

// ------------------------------ sections 取值 helper（下游一律按 key 取） ------------------------------

export function sectionText(report: ParseReport | null, key: string): string {
  if (!report) return ""
  return report.sections.find((s) => s.key === key)?.content ?? ""
}

/** 循环 2 批 2-3：按 key 优先级取第一个非空项文本（新 key 优先、旧 key 兜底，存量报告兼容） */
export function sectionTextAny(report: ParseReport | null, keys: string[]): string {
  for (const k of keys) {
    const t = sectionText(report, k)
    if (t.trim()) return t
  }
  return ""
}

/** 评分办法全文 = 技术评分 + 商务评分 */
export function combinedScoringText(report: ParseReport | null): string {
  return [sectionText(report, "tech_score"), sectionText(report, "biz_score")].filter((s) => s.trim()).join("\n")
}

export function hasAnySection(report: ParseReport | null, keys: string[]): boolean {
  return keys.some((k) => sectionText(report, k).trim().length > 0)
}

/** 下游依赖的解析项缺失时给出中文标题清单（用于提示 + 跳转） */
export function missingSectionTitles(report: ParseReport | null, keys: string[]): string[] {
  return keys.filter((k) => !sectionText(report, k).trim()).map((k) => parseSectionTitle(k))
}

export type ScoringItem = { item: string; score: number; criteria: string }

/** 从评分办法文本行里恢复评分项（兼容「项名（N 分）：标准」与「项名：N 分」两种行格式） */
export function extractScoringFromText(text: string): ScoringItem[] {
  const out: ScoringItem[] = []
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim().replace(/^\d+[.、]\s*/, "")
    if (!line) continue
    const m1 = line.match(/^(.+?)[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]\s*[：:]?\s*(.*)$/)
    if (m1) {
      out.push({ item: m1[1].trim(), score: Number(m1[2]), criteria: (m1[3] ?? "").trim() })
      continue
    }
    const m2 = line.match(/^(.+?)[：:]\s*(\d+(?:\.\d+)?)\s*分\s*$/)
    if (m2) out.push({ item: m2[1].trim(), score: Number(m2[2]), criteria: "" })
  }
  return out
}

export function scoringItemsFromReport(report: ParseReport | null): ScoringItem[] {
  return extractScoringFromText(combinedScoringText(report))
}

// ------------------------------ 招标要求条款抽取（本地零 AI 调用） ------------------------------

export type RequirementClause = { id: string; text: string; source: string }

/** 拆分维度：按系统（一级章节/系统分组，一行一条）/ 按二级标题（再按分号拆）/ 按三级标题（再按句号拆到最小条款） */
export type ClauseGranularity = "system" | "l2" | "l3"

export const CLAUSE_GRANULARITY_LABEL: Record<ClauseGranularity, string> = {
  system: "按系统",
  l2: "按二级标题",
  l3: "按三级标题",
}

export const CLAUSE_GRANULARITY_HINT: Record<ClauseGranularity, string> = {
  system: "按招标技术部分一级章节 / 系统分组，一行一条，颗粒度粗、行数少",
  l2: "在系统分组基础上再按分号拆分，颗粒度适中",
  l3: "拆到最小要求条款（分号 + 句号都拆），颗粒度最细、逐条核对最严格",
}

/** 条款抽取的来源解析项（技术评分要求 / 响应文件要求 / 交货和服务要求等实施类要求） */
const CLAUSE_SOURCE_KEYS = ["delivery_req", "tech_score", "response_req"]

const MIN_CLAUSE_LEN = 8

/** 去掉行首编号（①/1./(1)/一、/（一）等） */
function stripEnumerator(s: string): string {
  return s
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/, "")
    .replace(/^\(\s*[0-9一二三四五六七八九十]+\s*\)\s*/, "")
    .replace(/^（\s*[0-9一二三四五六七八九十]+\s*）\s*/, "")
    .replace(/^[0-9]+(\.[0-9]+)*[.、．]?\s*/, "")
    .replace(/^[一二三四五六七八九十]+\s*[、.．]\s*/, "")
    .trim()
}

function cleanClause(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[，、；;：:，]+$/g, "").trim()
}

/** 行内「系统名：要求」形态时取系统名作分组来源 */
function systemNameOfLine(line: string): string {
  const m = line.match(/^([^：:，。；]{2,20}(?:系统|平台|中心|模块|部分|子系统|数据库|网络|服务))[：:]/)
  return m ? m[1].trim() : ""
}

/**
 * 从解析报告中本地抽取招标要求条款（零 AI 调用）：
 * 取技术需求 / 技术评分 / 响应文件要求解析项文本，先按行与编号切分，
 * 再按拆分维度决定是否继续按分号 / 句号细拆；每条 ≥8 字，去重，上限 limit 条。
 * 每条 {id, text, source}，source 为来源章节（系统名或解析项标题），偏离表按它分组。
 */
export function extractRequirementClauses(
  report: ParseReport | null,
  opts?: { limit?: number; granularity?: ClauseGranularity },
): RequirementClause[] {
  const limit = Math.max(1, opts?.limit ?? 60)
  const granularity = opts?.granularity ?? "l3"
  const out: RequirementClause[] = []
  const seen = new Set<string>()
  let seq = 0
  for (const key of CLAUSE_SOURCE_KEYS) {
    const text = sectionText(report, key)
    if (!text.trim()) continue
    const fallbackSource = parseSectionTitle(key)
    for (const rawLine of text.split(/\n+/)) {
      const line = stripEnumerator(rawLine.trim())
      if (!line) continue
      const systemName = systemNameOfLine(line)
      const source = systemName || fallbackSource
      // 一级切分：编号 / 行；二级：分号；三级：再按句号拆到最小条款
      let pieces: string[] = [line]
      if (granularity === "l2" || granularity === "l3") {
        pieces = pieces.flatMap((p) => p.split(/[；;]/))
      }
      if (granularity === "l3") {
        pieces = pieces.flatMap((p) => p.split(/[。]/))
      }
      for (const piece of pieces) {
        const t = cleanClause(stripEnumerator(piece))
        if (t.replace(/[，、：:（）()]/g, "").length < MIN_CLAUSE_LEN) continue
        const dedupeKey = t.slice(0, 40)
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        seq += 1
        out.push({ id: `c${seq}`, text: t, source })
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

// ------------------------------ 全局事实表（第五轮改造 4，本地抽取零 AI 调用） ------------------------------

/** 事实抽取的来源解析项（项目概述 / 项目信息 / 甲方 / 代理 / 交货服务 / 关键节点 / 保证金 / 合同条款；含旧 key 兼容存量报告） */
const FACT_SOURCE_KEYS = [
  "overview",
  "project_info",
  "purchaser_info",
  "agency_info",
  "delivery_req",
  "bid_nodes",
  "bid_deposit",
  "contract_terms",
  "key_nodes",
  "bid_bond",
  "contract_award",
]

/** 只有键名命中这些关键事实词才入表，避免把普通要求行误当事实 */
const FACT_KEY_PATTERN =
  /(项目名称|项目名|编号|采购人|甲方|招标人|代理|预算|金额|工期|交货|交付|质保|运维期|服务期|地点|地址|时间|截止|开标|保证金|联系人|电话|联系方式|资金来源)/

/** 全局事实块的统一前言（第十六轮 B1：字段版与本地抽取版共用同一包装格式，注入点无感知） */
const GLOBAL_FACTS_PREAMBLE =
  "【全局事实】以下项目事实以招标文件为准，正文中出现项目名称、招标编号、采购人、预算金额、工期、质保期、地点、时间节点等必须与之一致，禁止编造不同数值："

/** 第十六轮 B1：本地抽取键值事实行（k=v，≤800 字），无报告或无可抽事实时返回空数组 */
function extractGlobalFactLines(report: ParseReport | null): string[] {
  if (!report) return []
  const facts: string[] = []
  const seen = new Set<string>()
  let total = 0
  for (const key of FACT_SOURCE_KEYS) {
    const text = sectionText(report, key)
    if (!text.trim()) continue
    for (const rawLine of text.split(/\n+/)) {
      const line = stripEnumerator(rawLine.trim())
      const m = line.match(/^([^：:]{2,14})[：:]\s*(.+)$/)
      if (!m) continue
      const k = m[1].trim()
      const v = (m[2].trim().split(/[；;]/)[0] ?? "").trim()
      if (!k || !v || v.length > 60 || v.length < 2) continue
      if (!FACT_KEY_PATTERN.test(k)) continue
      if (seen.has(k)) continue
      const entry = `${k}=${v}`
      if (total + entry.length > 800) continue
      seen.add(k)
      total += entry.length + 1
      facts.push(entry)
    }
  }
  return facts
}

/** 事实行清单 → 统一前言包装的注入文本块（空清单返回空串） */
export function wrapGlobalFactsBlock(lines: string[]): string {
  const rows = lines.map((l) => l.trim()).filter(Boolean)
  if (!rows.length) return ""
  return `${GLOBAL_FACTS_PREAMBLE}\n${rows.join("\n")}`
}

/**
 * 第十六轮 B1 改造 1.1：全局事实统一取值——global_facts 字段非空（人工编辑版）优先，
 * 包装成与本地抽取完全一致的注入格式；字段为空回退本地抽取。所有既有注入点
 * （大纲/章/节/续写/改写/偏离表/答辩等）经 effectiveGlobalFacts 自动生效。
 */
export function effectiveGlobalFacts(rec: {
  global_facts?: string | null
  parse_report: ParseReport | null
}): string {
  const manual = (rec.global_facts ?? "").trim()
  if (manual) return wrapGlobalFactsBlock(manual.split(/\n+/))
  return wrapGlobalFactsBlock(extractGlobalFactLines(rec.parse_report))
}

/** 事实面板展示用的当前生效事实行（人工编辑版=字段行，自动版=本地抽取行） */
export function effectiveGlobalFactsLines(rec: {
  global_facts?: string | null
  parse_report: ParseReport | null
} | null): string[] {
  if (!rec) return []
  const manual = (rec.global_facts ?? "").trim()
  if (manual) return manual.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  return extractGlobalFactLines(rec.parse_report)
}

/**
 * 第五轮改造 4：从 parse_report 结构化节本地抽取键值事实（≤800 字），
 * 拼成「【全局事实】k=v」文本块注入大纲/正文/续写/偏离表 prompt，
 * 要求项目名、编号、工期等全文一致、禁止编造。无可抽事实时返回空串。
 * （第十六轮 B1 起项目内注入统一走 effectiveGlobalFacts，本函数保留为纯本地抽取口径）
 */
export function buildGlobalFacts(report: ParseReport | null): string {
  return wrapGlobalFactsBlock(extractGlobalFactLines(report))
}

// ------------------------------ 标题 / 条款相似度（本地核验与条款归章） ------------------------------

function normalizeForMatch(s: string): string {
  return (s ?? "").replace(/[\s，。、；：""''（）()《》【】\-.·!?！？]/g, "")
}

/** 最长公共子串长度（条款与标题匹配的本地相似度度量） */
export function commonSubstringLen(aRaw: string, bRaw: string): number {
  const a = normalizeForMatch(aRaw)
  const b = normalizeForMatch(bRaw)
  if (!a || !b) return 0
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length)
  let best = 0
  const prev = new Array<number>(b.length + 1).fill(0)
  const cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0
      if (cur[j] > best) best = cur[j]
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = cur[j]
      cur[j] = 0
    }
  }
  return best
}

/** 条款文本与节点标题是否算「已响应」：互相包含或公共子串 ≥4 字 */
export function clauseMatchesTitle(clauseText: string, title: string): boolean {
  if (!title.trim()) return false
  return commonSubstringLen(clauseText, title) >= 4
}

/** 收集大纲全部叶子节点标题 */
export function collectLeafTitles(nodes: OutlineNode[]): string[] {
  const out: string[] = []
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if ((n.children ?? []).length) walk(n.children)
      else out.push(n.title)
    }
  }
  walk(nodes ?? [])
  return out
}

/** 条款 → 章节归属：按条款文本与章标题+小节标题相似度归章（用于正文 prompt 注入本章须响应条款） */
export function assignClausesToChapters(clauses: RequirementClause[], chapters: { title: string; sections?: string[] }[]): RequirementClause[][] {
  const per: RequirementClause[][] = chapters.map(() => [])
  for (const cl of clauses) {
    let bestIdx = -1
    let bestScore = 3
    chapters.forEach((c, i) => {
      const score = Math.max(commonSubstringLen(cl.text, c.title), ...(c.sections ?? []).map((s) => commonSubstringLen(cl.text, s)), 0)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    })
    // 没有明显归属的条款挂到含「需求/方案/实施」关键词的章，兜底挂第一章，保证每条条款都有落点
    if (bestIdx < 0) {
      bestIdx = chapters.findIndex((c) => /需求|方案|实施|技术/.test(c.title))
      if (bestIdx < 0) bestIdx = 0
    }
    if (bestIdx >= 0 && per[bestIdx].length < 15) per[bestIdx].push(cl)
  }
  return per
}

/** 由条款文本提炼可作大纲标题的短语（≤20 字，不带标点收尾） */
export function clauseToNodeTitle(text: string): string {
  let t = cleanClause(text)
  t = t.split(/[，。；;：:（(]/)[0] ?? t
  t = t.replace(/要求|需|应|须/g, (m, idx: number) => (idx > 12 ? "" : m))
  if (t.length > 20) t = t.slice(0, 20)
  return t || "招标要求响应"
}

/** 把一条未响应条款补入大纲：按标题相似度挂到最相关技术章下（商务骨架章不承担条款覆盖）；无匹配则新建章节 */
export function insertClauseIntoOutline(nodes: OutlineNode[], clause: RequirementClause): OutlineNode[] {
  const child: OutlineNode = { id: makeUid(), title: clauseToNodeTitle(clause.text), children: [] }
  let bestId = ""
  let bestScore = 3
  const walk = (list: OutlineNode[], depth: number) => {
    for (const n of list) {
      // 第十三轮改造 2：条款落点只对技术章要求，跳过商务章子树
      if (depth === 0 && isBizPart(n)) continue
      const score = commonSubstringLen(clause.text, n.title)
      if (score > bestScore) {
        bestScore = score
        bestId = n.id
      }
      walk(n.children ?? [], depth + 1)
    }
  }
  walk(nodes, 0)
  if (!bestId) return [...nodes, child]
  const addUnder = (list: OutlineNode[]): OutlineNode[] =>
    list.map((n) =>
      n.id === bestId
        ? { ...n, children: [...(n.children ?? []), child] }
        : { ...n, children: addUnder(n.children ?? []) },
    )
  return addUnder(nodes)
}

// ------------------------------ 技术偏离表（条款级响应映射） ------------------------------

export type ResponseLevel = "full" | "partial" | "deviation" | ""

export const RESPONSE_LEVEL_LABEL: Record<Exclude<ResponseLevel, "">, string> = {
  full: "完全响应",
  partial: "部分响应",
  deviation: "偏离",
}

export type DeviationRow = {
  clause_id: string
  clause_text: string
  source: string
  response_node: string
  response_level: ResponseLevel
  response_summary: string
  bid_ref: string
}

export type DeviationTable = {
  split_dim: ClauseGranularity
  rows: DeviationRow[]
  generated_at: string
}

export type DeviationStats = { total: number; full: number; partial: number; deviation: number }

export function deviationStats(table: DeviationTable | null): DeviationStats {
  const rows = table?.rows ?? []
  return {
    total: rows.length,
    full: rows.filter((r) => r.response_level === "full").length,
    partial: rows.filter((r) => r.response_level === "partial").length,
    deviation: rows.filter((r) => r.response_level === "deviation").length,
  }
}

/**
 * 读取 response_map 字段的统一入口（容错存量数据）：
 * - 新格式 {split_dim, rows:[DeviationRow]} 直接规整；
 * - 旧「评分办法 ↔ 响应章节」数组（scoring_item 行）映射为未判定级别的行，不崩不丢；
 * - 空值返回 null。
 */
export function normalizeDeviationTable(raw: unknown): DeviationTable | null {
  if (!raw) return null
  const rowsRaw = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown>)?.rows) ? ((raw as Record<string, unknown>).rows as unknown[]) : null
  if (!rowsRaw) return null
  const dimRaw = Array.isArray(raw) ? "" : String((raw as Record<string, unknown>)?.split_dim ?? "")
  const splitDim: ClauseGranularity = dimRaw === "l2" || dimRaw === "l3" ? dimRaw : "system"
  const rows: DeviationRow[] = []
  for (const it of rowsRaw) {
    const r = (it ?? {}) as Record<string, unknown>
    // 新格式行
    const clauseText = asString(r.clause_text ?? r.clause).trim()
    if (clauseText) {
      const lvlRaw = asString(r.response_level).trim()
      const level: ResponseLevel =
        lvlRaw === "full" || lvlRaw === "完全响应"
          ? "full"
          : lvlRaw === "partial" || lvlRaw === "部分响应"
            ? "partial"
            : lvlRaw === "deviation" || lvlRaw === "偏离"
              ? "deviation"
              : ""
      rows.push({
        clause_id: asString(r.clause_id).trim(),
        clause_text: clauseText,
        source: asString(r.source).trim() || "招标技术要求",
        response_node: asString(r.response_node ?? r.node).trim(),
        response_level: level,
        response_summary: asString(r.response_summary ?? r.summary).trim(),
        bid_ref: asString(r.bid_ref ?? r.ref).trim(),
      })
      continue
    }
    // 旧格式行（评分办法对照表）：字段缺失也容错保留
    const legacyItem = asString(r.scoring_item ?? r.item).trim()
    if (!legacyItem) continue
    rows.push({
      clause_id: "",
      clause_text: legacyItem,
      source: "评分办法（旧版对照）",
      response_node: asString(r.chapter_title ?? r.chapter).trim(),
      response_level: "",
      response_summary: asString(r.response_summary ?? r.summary).trim(),
      bid_ref: asString(r.chapter_title ?? r.chapter).trim(),
    })
  }
  if (!rows.length) return null
  return {
    split_dim: splitDim,
    rows,
    generated_at: Array.isArray(raw) ? "" : asString((raw as Record<string, unknown>)?.generated_at),
  }
}

export type DupVerdict = "high" | "medium" | "low" | ""

export const DUP_VERDICT_LABEL: Record<Exclude<DupVerdict, "">, string> = {
  high: "高度相似，须改写",
  medium: "中度相似，建议改写",
  low: "轻度相似，可保留",
}

export type DupPair = {
  target_node_id: string
  target_chapter: string
  target_text: string
  source_project: string
  source_chapter: string
  source_text: string
  similarity: number
  ai_verdict: DupVerdict
  ai_note: string
}

export type IntraDupPair = {
  a_node_id: string
  a_chapter: string
  a_text: string
  b_node_id: string
  b_chapter: string
  b_text: string
  similarity: number
}

export type DupReport = {
  pairs: DupPair[]
  scanned_projects: number
  suspect_count: number
  checked_at: string
  /** 第七轮改造 4：本标书章间重复分组（零 AI 本地互查）；老数据无该字段时前端按空数组容错 */
  intra_pairs?: IntraDupPair[]
}

/** 第九轮改造 2：合规核销矩阵——严重度四档徽标用 danger/warning/neutral，合规态用 success */
export type SeverityLevel = "critical" | "major" | "minor"

export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  critical: "重大",
  major: "较大",
  minor: "轻微",
}

export function asSeverity(v: unknown, fallback: SeverityLevel = "critical"): SeverityLevel {
  const s = String(v ?? "").trim()
  return s === "critical" || s === "major" || s === "minor" ? s : fallback
}

/** 核销状态：待核销 / 已处理（跳章整改后回来核销）/ 已跳过（须填原因留痕） */
export type ReviewStatus = "pending" | "addressed" | "skipped"

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "待核销",
  addressed: "已处理",
  skipped: "已跳过",
}

export function asReviewStatus(v: unknown, fallback: ReviewStatus = "pending"): ReviewStatus {
  const s = String(v ?? "").trim()
  return s === "pending" || s === "addressed" || s === "skipped" ? s : fallback
}

/** 第九轮改造 2：废标判定从三态 verdict 升级为合规状态 status（旧数据由 normalizeVoidCheck 映射） */
export type VoidStatus = "compliant" | "partial" | "non_compliant"

export const VOID_STATUS_LABEL: Record<VoidStatus, string> = {
  compliant: "合规",
  partial: "部分合规",
  non_compliant: "不合规",
}

export function asVoidStatus(v: unknown, fallback: VoidStatus = "partial"): VoidStatus {
  const s = String(v ?? "").trim()
  return s === "compliant" || s === "partial" || s === "non_compliant" ? s : fallback
}

/** 旧 verdict 三态 → 新 status 映射（pass→compliant / risk→partial / missing→non_compliant） */
function legacyVerdictToStatus(v: unknown): VoidStatus | "" {
  const s = String(v ?? "").trim()
  if (s === "pass" || s === "通过") return "compliant"
  if (s === "risk" || s === "有风险") return "partial"
  if (s === "missing" || s === "缺失") return "non_compliant"
  return ""
}

export type VoidItem = {
  id: string
  clause: string
  /** 招标文件中该条款的位置描述（≤30 字） */
  source_location: string
  response: string
  /** 投标响应所在章节位置（≤30 字，可点击跳章） */
  response_location: string
  status: VoidStatus
  severity: SeverityLevel
  suggestion: string
  /** 支撑判定的投标原文摘录（≤120 字，防误报证据） */
  evidence: string
  reason: string
  manual_checked: boolean
  manual_status: VoidStatus | ""
  review_status: ReviewStatus
  skip_reason: string
}

export type VoidCheck = { items: VoidItem[]; checked_at: string }

/** 人工改判优先于 AI 判定 */
export function effectiveVoidStatus(item: VoidItem): VoidStatus {
  return item.manual_checked && item.manual_status ? item.manual_status : item.status
}

export type AiReviewItem = {
  scoring_item: string
  max_score: number
  ai_score: number
  reason: string
  suggestion: string
}

/** 第九轮改造 3：格式规范路输出条目 */
export type FormatIssue = {
  issue: string
  severity: SeverityLevel
  location: string
  suggestion: string
}

/** 第九轮改造 3：商务要素路输出条目（关键商务值一致性核对） */
export type CommercialCheck = {
  key: string
  tender_value: string
  bid_value: string
  consistent: boolean
  note: string
}

export type AiReview = {
  items: AiReviewItem[]
  total_score: number
  summary: string
  reviewed_at: string
  /** 第九轮改造 3：格式规范路结果；旧报告容错为空数组（自动归技术路） */
  format_issues: FormatIssue[]
  /** 第九轮改造 3：商务要素路结果；旧报告容错为空数组 */
  commercial_checks: CommercialCheck[]
}

export type ManualReviewItem = {
  scoring_item: string
  max_score: number
  manual_score: number
  comment: string
}

export type ManualReview = { items: ManualReviewItem[]; total_score: number }

// ------------------------------ 项目记录（字段与 PB collection 完全一致） ------------------------------

/** 第四轮改造：投标结果（won=中标 / lost=失单 / pending=待定 / 空=未登记） */
export type BidResult = "won" | "lost" | "pending" | ""

export const BID_RESULT_LABEL: Record<Exclude<BidResult, "">, string> = {
  won: "中标",
  lost: "失单",
  pending: "待定",
}

// ------------------------------ 第十三轮改造 3：技术章生成增强开关（随项目持久化） ------------------------------

/** gen_options 列结构：clause_response=逐条应答强化 / material_boost=素材优先注入（默认均关）；
 * 循环 7 A4：intra_dup_threshold=章间互查相似度阈值（0.2-0.6，缺省 0.35；搭 gen_options json 列持久化，零 collection 变更）；
 * 用户反馈轮项 3：include_biz=大纲是否包含商务标骨架章（缺省/非法 → true，默认包含） */
export type GenOptions = {
  clause_response: boolean
  material_boost: boolean
  intra_dup_threshold?: number
  include_biz?: boolean
}

/** 循环 7 A4：章间互查阈值缺省值（与 findIntraDupPairs 默认参数一致） */
export const INTRA_DUP_THRESHOLD_DEFAULT = 0.35

export function defaultGenOptions(): GenOptions {
  return { clause_response: false, material_boost: false, include_biz: true }
}

/** 容错解析 gen_options json（存量项目缺列 / 脏值 → 全 false；阈值越界 / 非数 → 缺省；include_biz 缺省/非法 → true） */
export function normalizeGenOptions(raw: unknown): GenOptions {
  const base = defaultGenOptions()
  if (!raw || typeof raw !== "object") return base
  const rec = raw as Record<string, unknown>
  const th = rec.intra_dup_threshold
  return {
    clause_response: rec.clause_response === true,
    material_boost: rec.material_boost === true,
    intra_dup_threshold:
      typeof th === "number" && Number.isFinite(th) && th >= 0.2 && th <= 0.6 ? th : undefined,
    include_biz: rec.include_biz !== false,
  }
}

// ------------------------------ 第十三轮改造 1/4：商务/技术章归属判定 ------------------------------

/** 章 / 大纲顶层节点是否商务骨架章（无 part 一律按技术章，存量项目零行为变化） */
export function isBizPart(item: { part?: string } | null | undefined): boolean {
  return item?.part === "biz"
}

/** 过滤出技术部分顶层章（大纲叶子统计 / 条款覆盖 / 预算 / 闸门均只按技术章计算） */
export function techOutlineNodes(nodes: OutlineNode[]): OutlineNode[] {
  return (nodes ?? []).filter((n) => !isBizPart(n))
}

/** 过滤出技术章（章节清单口径） */
export function techChapters(chapters: Chapter[]): Chapter[] {
  return (chapters ?? []).filter((c) => !isBizPart(c))
}

// ------------------------------ 第十七轮 17C：格式配置与格式规则检查（零 AI 费用） ------------------------------

/** 正文字体四选项（面板选项与导出映射共用） */
export type FormatFont = "宋体" | "黑体" | "仿宋" | "楷体"

export const FORMAT_FONT_OPTIONS: FormatFont[] = ["宋体", "黑体", "仿宋", "楷体"]

/** 中文字号初号—小五（面板选项；导出映射半点值） */
export type FormatFontSize =
  | "初号"
  | "小初"
  | "一号"
  | "小一"
  | "二号"
  | "小二"
  | "三号"
  | "小三"
  | "四号"
  | "小四"
  | "五号"
  | "小五"

export const FORMAT_SIZE_OPTIONS: FormatFontSize[] = [
  "初号",
  "小初",
  "一号",
  "小一",
  "二号",
  "小二",
  "三号",
  "小三",
  "四号",
  "小四",
  "五号",
  "小五",
]

/** 段落对齐（左/中/右/两端） */
export type FormatAlign = "left" | "center" | "right" | "justify"

export const FORMAT_ALIGN_OPTIONS: { value: FormatAlign; label: string }[] = [
  { value: "left", label: "左对齐" },
  { value: "center", label: "居中" },
  { value: "right", label: "右对齐" },
  { value: "justify", label: "两端对齐" },
]

/** 单级标题格式（字体 + 字号 + 对齐） */
export type HeadingFormat = { font: FormatFont; size: FormatFontSize; align: FormatAlign }

/** 行距档位：单倍 / 1.5倍 / 2倍 / 固定值（固定值存「固定值N磅」字符串） */
export const LINE_SPACING_OPTIONS = ["单倍", "1.5倍", "2倍", "固定值"]

/** 正文格式：字体/字号/首行缩进（字符数）/对齐/行距 */
export type BodyFormat = {
  font: FormatFont
  size: FormatFontSize
  firstIndent: number
  align: FormatAlign
  lineSpacing: string
}

/** 表格格式：边框粗细（如 "0.5pt"）+ 内容字体（「宋体五号」式组合串） */
export type TableFormat = { border: string; contentFont: string }

/** 标题编号样式：数字层级 1.1.1 / 章—节式（当前导出默认）/ 无编号 */
export type TitleNumbering = "1.1.1" | "chapter" | "none"

export const TITLE_NUMBERING_OPTIONS: { value: TitleNumbering; label: string; example: string }[] = [
  { value: "1.1.1", label: "数字层级 1 / 1.1 / 1.1.1", example: "1 项目概述 ／ 1.1 项目背景 ／ 1.1.1 建设现状" },
  { value: "chapter", label: "章—节式（当前导出默认）", example: "第1章 项目概述 ／ 1.1 项目背景" },
  { value: "none", label: "无编号", example: "项目概述 ／ 项目背景" },
]

export type FormatPaper = "A4" | "A3" | "16K"

export const PAPER_OPTIONS: { value: FormatPaper; label: string }[] = [
  { value: "A4", label: "A4（21×29.7cm）" },
  { value: "A3", label: "A3（29.7×42cm）" },
  { value: "16K", label: "16 开（18.5×26cm）" },
]

/** bid_projects.format_settings json 列结构（null=未单独配置，导出走现状默认） */
export type FormatSettings = {
  paper: FormatPaper
  /** 页边距（cm） */
  margins: { top: number; bottom: number; left: number; right: number }
  /** 六级标题格式（索引 0=一级标题） */
  heading: HeadingFormat[]
  body: BodyFormat
  table: TableFormat
  /** 生成目录 */
  toc: boolean
  /** 输出页码 */
  pageNumber: boolean
  /** 页眉页脚 */
  headerFooter: boolean
  titleNumbering: TitleNumbering
  /** 暗标开关：true 时导出加暗标声明占位页且不输出页码 */
  sealed: boolean
  /** 暗标页数（null=未填） */
  sealedPages: number | null
}

/** 面板缺省值（format_settings=null 时按此展示；任一改动即生成完整配置落库） */
export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  paper: "A4",
  margins: { top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 },
  heading: [0, 1, 2, 3, 4, 5].map(() => ({ font: "黑体", size: "三号", align: "left" })),
  body: { font: "仿宋", size: "四号", firstIndent: 2, align: "justify", lineSpacing: "1.5倍" },
  table: { border: "0.5pt", contentFont: "宋体五号" },
  toc: true,
  pageNumber: true,
  headerFooter: false,
  titleNumbering: "1.1.1",
  sealed: false,
  sealedPages: null,
}

/** 行距值解析「固定值N磅」；非固定值返回 null */
export function parseFixedLineSpacing(lineSpacing: string): number | null {
  const m = /^固定值(\d+(?:\.\d+)?)磅$/.exec(lineSpacing ?? "")
  return m ? Number(m[1]) : null
}

/** 固定值行距磅数 → 存储串（9-50 磅夹紧） */
export function fixedLineSpacingValue(pt: number): string {
  return `固定值${Math.min(50, Math.max(9, Math.round(pt)))}磅`
}

/** 「宋体五号」组合串 → 字体 + 字号（拆不出时回退宋体/五号） */
export function splitContentFont(value: string): { font: FormatFont; size: FormatFontSize } {
  const v = value ?? ""
  const font = FORMAT_FONT_OPTIONS.find((f) => v.startsWith(f)) ?? "宋体"
  const size = FORMAT_SIZE_OPTIONS.find((s) => v.endsWith(s)) ?? "五号"
  return { font, size }
}

function asFormatFont(v: unknown, fallback: FormatFont): FormatFont {
  const s = String(v ?? "")
  return (FORMAT_FONT_OPTIONS as string[]).includes(s) ? (s as FormatFont) : fallback
}

function asFormatSize(v: unknown, fallback: FormatFontSize): FormatFontSize {
  const s = String(v ?? "")
  return (FORMAT_SIZE_OPTIONS as string[]).includes(s) ? (s as FormatFontSize) : fallback
}

function asFormatAlign(v: unknown, fallback: FormatAlign): FormatAlign {
  const s = String(v ?? "")
  return s === "left" || s === "center" || s === "right" || s === "justify" ? s : fallback
}

function cmOf(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(10, Math.max(0.5, Math.round(n * 100) / 100)) : fallback
}

/** format_settings json 列反序列化容错（非对象→null=走现状默认；字段级非法回落缺省值；heading 固定六级） */
export function normalizeFormatSettings(raw: unknown): FormatSettings | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const d = DEFAULT_FORMAT_SETTINGS
  const mRaw = (rec.margins && typeof rec.margins === "object" ? rec.margins : {}) as Record<string, unknown>
  const headingRaw = Array.isArray(rec.heading) ? rec.heading : []
  const heading: HeadingFormat[] = d.heading.map((fb, i) => {
    const h = (headingRaw[i] ?? {}) as Record<string, unknown>
    return {
      font: asFormatFont(h.font, fb.font),
      size: asFormatSize(h.size, fb.size),
      align: asFormatAlign(h.align, fb.align),
    }
  })
  const bodyRaw = (rec.body && typeof rec.body === "object" ? rec.body : {}) as Record<string, unknown>
  const lsRaw = String(bodyRaw.lineSpacing ?? "")
  const lineSpacing =
    lsRaw === "单倍" || lsRaw === "1.5倍" || lsRaw === "2倍" || parseFixedLineSpacing(lsRaw) !== null
      ? lsRaw
      : d.body.lineSpacing
  const indentRaw = Number(bodyRaw.firstIndent)
  const tableRaw = (rec.table && typeof rec.table === "object" ? rec.table : {}) as Record<string, unknown>
  const paperRaw = String(rec.paper ?? "")
  const numberingRaw = String(rec.titleNumbering ?? "")
  const sealedPagesRaw = Number(rec.sealedPages)
  const sealed = rec.sealed === true
  return {
    paper: paperRaw === "A4" || paperRaw === "A3" || paperRaw === "16K" ? paperRaw : d.paper,
    margins: {
      top: cmOf(mRaw.top, d.margins.top),
      bottom: cmOf(mRaw.bottom, d.margins.bottom),
      left: cmOf(mRaw.left, d.margins.left),
      right: cmOf(mRaw.right, d.margins.right),
    },
    heading,
    body: {
      font: asFormatFont(bodyRaw.font, d.body.font),
      size: asFormatSize(bodyRaw.size, d.body.size),
      firstIndent: Number.isFinite(indentRaw) ? Math.min(4, Math.max(0, Math.round(indentRaw * 10) / 10)) : d.body.firstIndent,
      align: asFormatAlign(bodyRaw.align, d.body.align),
      lineSpacing,
    },
    table: {
      border: String(tableRaw.border ?? "").trim().slice(0, 12) || d.table.border,
      contentFont: String(tableRaw.contentFont ?? "").trim().slice(0, 12) || d.table.contentFont,
    },
    toc: typeof rec.toc === "boolean" ? rec.toc : d.toc,
    pageNumber: typeof rec.pageNumber === "boolean" ? rec.pageNumber : d.pageNumber,
    headerFooter: typeof rec.headerFooter === "boolean" ? rec.headerFooter : d.headerFooter,
    titleNumbering:
      numberingRaw === "1.1.1" || numberingRaw === "chapter" || numberingRaw === "none"
        ? (numberingRaw as TitleNumbering)
        : d.titleNumbering,
    sealed,
    sealedPages: sealed && Number.isFinite(sealedPagesRaw) && sealedPagesRaw > 0 ? Math.min(9999, Math.round(sealedPagesRaw)) : null,
  }
}

/** 格式规则检查禁则 key（bid_projects.format_check_items json 列；默认全开） */
export type FormatCheckKey =
  | "no_color_content"
  | "no_color_image"
  | "no_table_shading"
  | "no_color_border"
  | "no_hyperlink"
  | "no_watermark"
  | "no_bold"
  | "no_underline"
  | "no_empty_line_consecutive"
  | "no_half_width_punct"
  | "no_blank_page"
  /** 循环 2 批 1-4：暗标身份泄露检查（sealed 或身份词非空时才实际扫描） */
  | "identity_leak"
  /** 循环 2 批 1-5：措辞本地检查（连续重复句/叠字/括号混用/中英空格，零 AI 零误报设计） */
  | "wording_scan"

export const FORMAT_CHECK_KEYS: FormatCheckKey[] = [
  "no_color_content",
  "no_color_image",
  "no_table_shading",
  "no_color_border",
  "no_hyperlink",
  "no_watermark",
  "no_bold",
  "no_underline",
  "no_empty_line_consecutive",
  "no_half_width_punct",
  "no_blank_page",
  "identity_leak",
  "wording_scan",
]

export const FORMAT_CHECK_LABEL: Record<FormatCheckKey, string> = {
  no_color_content: "正文不出现彩色文字",
  no_color_image: "不出现彩色图片",
  no_table_shading: "表格不加底纹",
  no_color_border: "不加彩色边框",
  no_hyperlink: "不出现超链接网址",
  no_watermark: "不出现水印词（样稿/草稿/仅供内部）",
  no_bold: "不出现加粗标记（** 或 __）",
  no_underline: "不出现下划线标记（<u>）",
  no_empty_line_consecutive: "不出现连续空行（超过 2 行）",
  no_half_width_punct: "正文少用半角标点（,;:!?）",
  no_blank_page: "不出现空白页标记",
  identity_leak: "暗标身份脱敏（身份词与公司名模式不出现）",
  wording_scan: "措辞检查（连续重复句/叠字/括号混用）",
}

/** 交叉警告规则（暗标页数 × 目标页数联动生成，不在禁则勾选清单内）；number_conflict 为循环 8 A4 本地数字口径核对 */
export type FormatCheckRule = FormatCheckKey | "sealed_pages_cross" | "number_conflict"

export const FORMAT_RULE_LABEL: Record<FormatCheckRule, string> = {
  ...FORMAT_CHECK_LABEL,
  sealed_pages_cross: "暗标页数与目标页数交叉核对",
  number_conflict: "数字口径一致性（事实表 × 正文）",
}

export type FormatCheckHit = { chapter: string; rule: FormatCheckRule; quote: string; level: "warn" | "info" }

export type FormatCheckReport = { hits: FormatCheckHit[]; checked_at: string }

/** format_check_items json 列容错（null/非数组→全开；数组→只保留合法 key，空数组=用户全关） */
export function normalizeFormatCheckItems(raw: unknown): FormatCheckKey[] {
  if (!Array.isArray(raw)) return [...FORMAT_CHECK_KEYS]
  const picked = new Set(raw.map((k) => String(k)).filter((k) => (FORMAT_CHECK_KEYS as string[]).includes(k)))
  return FORMAT_CHECK_KEYS.filter((k) => picked.has(k))
}

/** format_report 容错（null/损坏→null；规则白名单过滤，未知 rule 丢弃） */
export function normalizeFormatCheckReport(raw: unknown): FormatCheckReport | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const hits = asArray(rec.hits)
    .map((h) => {
      const r = (h ?? {}) as Record<string, unknown>
      const rule = String(r.rule ?? "")
      if (!Object.prototype.hasOwnProperty.call(FORMAT_RULE_LABEL, rule)) return null
      return {
        chapter: asString(r.chapter).slice(0, 60),
        rule: rule as FormatCheckRule,
        quote: asString(r.quote).slice(0, 80),
        level: r.level === "info" ? ("info" as const) : ("warn" as const),
      }
    })
    .filter((x): x is FormatCheckHit => !!x)
  return { hits, checked_at: asString(rec.checked_at) }
}

/**
 * 逐规则扫描正则（误报控制：只匹配明确的标记词/标记符号——彩色类只认「彩色文字/标红/底纹」
 * 等排版指令式词组，不认「红色预警」这类正常业务词；加粗/下划线只认成对标记）
 */
const FORMAT_SCAN_RE: Partial<Record<FormatCheckKey, RegExp>> = {
  no_hyperlink: /https?:\/\/[^\s，。；、)）\]】]+/,
  no_bold: /\*\*[^*\n]{1,60}\*\*|__[^_\n]{1,60}__/,
  no_underline: /<u>[\s\S]{0,60}?<\/u>/,
  no_watermark: /样稿|草稿|仅供内部/,
  no_color_content: /彩色文字|字体颜色|文字颜色|标红|红色标注|变色标注/,
  no_color_image: /彩色图片|彩色插图|彩色照片|彩图/,
  no_table_shading: /底纹|表格底色|单元格背景|底色填充/,
  no_color_border: /彩色边框|边框颜色|彩色框线/,
  no_blank_page: /\f|〔空白页〕|\[空白页\]|【空白页】/,
}

/** 命中摘录：匹配位置前 12 字 + 匹配内容（截 40 字）+ 后 8 字 */
function quoteAround(line: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 12)
  const end = Math.min(line.length, idx + Math.min(len, 40) + 8)
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`
}

/** 半角标点密度统计的正文行判定：编号/标题/含 URL 行不计（编号点与冒号式标题不算正文，URL 已由超链接规则管） */
function isPunctDensityBodyLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/https?:\/\//.test(t)) return false
  if (/^#{1,6}\s/.test(t)) return false
  if (/^第[一二三四五六七八九十百\d]+[章节条]/.test(t)) return false
  if (/^[（(【]?[一二三四五六七八九十]+[)）】]/.test(t)) return false
  if (/^\d+(\.\d+)*[\s、.．]/.test(t)) return false
  return true
}

/**
 * 循环 2 批 1-4：暗标身份词拆分——逗号/顿号/分号/换行分隔，单词 2-40 字，≤30 个
 * （bid_projects.identity_words text 列；空串=未设置，只按通用公司名模式检查）
 */
export function splitIdentityWords(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of (raw ?? "").split(/[,，、;；\n]+/)) {
    const w = part.trim()
    if (w.length < 2 || w.length > 40 || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 30) break
  }
  return out
}

/**
 * 循环 2 批 1-4：sealed=true 时生成「暗标身份脱敏」规则条（注入章/节生成 prompt）；
 * 非暗标返回空串（调用方静默不注入，老项目行为与现状一致）。
 */
export function sealedIdentityBlock(sealed: boolean, identityWords: string): string {
  if (!sealed) return ""
  const words = splitIdentityWords(identityWords)
  return [
    "本项目为暗标评审，正文身份脱敏是废标级硬要求：禁止出现任何投标人名称、公司名、品牌名、人名、署名、印章字样与落款日期时间；",
    "指代投标人一律使用「我公司」，人员只写岗位角色（如「项目经理」「技术负责人」「驻场工程师」），不写姓名；",
    words.length ? `下列身份词严禁出现在正文中：${words.join("、")}。` : "",
  ]
    .filter(Boolean)
    .join("")
}

/** 通用公司名身份泄露模式（identity_leak 规则用；三个词形互不包含，须并列） */
const IDENTITY_GENERIC_RE = /有限公司|有限责任公司|集团/

/** 叠字检查模式（循环 2 批 1-5：的的/了了/是是/和和/与与；排除「的的确确」合法成语防误报） */
const WORDING_REDUPLE_RE = /的的(?!确)|了了|是是|和和|与与/

/** 中英/中数相接缺空格模式（仅 hint 级提示） */
const WORDING_CJK_LATIN_RE = /[一-龥][A-Za-z0-9]|[A-Za-z0-9][一-龥]/

/**
 * 第十七轮 17C：本地格式规则检查（纯函数，零 AI 费用）——
 * 按勾选禁则逐章扫描正文；每章每规则最多记 2 条命中（防长文刷屏）；
 * 连续空行 >2 命中；半角标点为密度型规则：正文 ≥200 字、命中 ≥8 处且密度 >2% 才触发（误报控制）；
 * 暗标页数 × target_pages 交叉警告由调用方追加（需项目级目标页数）。
 * 循环 2 批 1-4/1-5：新增 identity_leak（暗标开启或身份词非空才扫描：身份词命中 + 通用公司名模式命中）
 * 与 wording_scan（连续重复行 ≥15 字 / 叠字 / 全半角括号混用为 warn，中英间缺空格仅 info）两条本地规则。
 */
export function formatCheckReport(
  chapters: Chapter[],
  items: FormatCheckKey[],
  formatSettings: FormatSettings | null,
  identityWords?: string,
): FormatCheckReport {
  const enabled = new Set<FormatCheckKey>(items ?? [])
  const hits: FormatCheckHit[] = []
  const hitCount = new Map<string, number>()
  const push = (chapter: string, rule: FormatCheckRule, quote: string, level: "warn" | "info", sub = "") => {
    const k = `${chapter}#${rule}${sub ? `#${sub}` : ""}`
    if ((hitCount.get(k) ?? 0) >= 2) return
    hitCount.set(k, (hitCount.get(k) ?? 0) + 1)
    hits.push({ chapter, rule, quote: quote.slice(0, 80), level })
  }
  const scanRules = (Object.keys(FORMAT_SCAN_RE) as FormatCheckKey[]).filter((k) => enabled.has(k))
  const wantEmptyLines = enabled.has("no_empty_line_consecutive")
  const wantPunct = enabled.has("no_half_width_punct")
  // 循环 2 批 1-4：identity_leak 仅在暗标开启或身份词非空时实际扫描（其余场景勾选也不产出命中）
  const identityList = splitIdentityWords(identityWords ?? "")
  const wantIdentity =
    enabled.has("identity_leak") && (formatSettings?.sealed === true || identityList.length > 0)
  // 循环 2 批 1-5：措辞本地检查（零 AI、零误报设计：不查易错别字词典，只查确定性模式）
  const wantWording = enabled.has("wording_scan")
  ;(chapters ?? []).forEach((c, ci) => {
    const content = c.content ?? ""
    if (!content.trim()) return
    const title = (c.title ?? "").trim() || `第${ci + 1}章`
    const lines = content.split(/\r?\n/)
    for (const rule of scanRules) {
      const re = FORMAT_SCAN_RE[rule]
      if (!re) continue
      for (const line of lines) {
        const m = re.exec(line)
        if (m) push(title, rule, quoteAround(line, m.index, m[0].length), "warn")
      }
    }
    if (wantEmptyLines) {
      let run = 0
      const flushRun = () => {
        if (run > 2) push(title, "no_empty_line_consecutive", `连续 ${run} 个空行`, "info")
        run = 0
      }
      for (const line of lines) {
        if (!line.trim()) run += 1
        else flushRun()
      }
      flushRun()
    }
    if (wantPunct) {
      const bodyText = lines.filter((l) => isPunctDensityBodyLine(l)).join("")
      if (bodyText.length >= 200) {
        const cnt = (bodyText.match(/[,;:!?]/g) ?? []).length
        if (cnt >= 8 && cnt / bodyText.length > 0.02) {
          push(
            title,
            "no_half_width_punct",
            `半角标点 ${cnt} 处，密度 ${((cnt / bodyText.length) * 100).toFixed(1)}%`,
            "info",
          )
        }
      }
    }
    if (wantIdentity) {
      // 身份词逐词命中（warn）
      for (const w of identityList) {
        for (const line of lines) {
          const idx = line.indexOf(w)
          if (idx >= 0) push(title, "identity_leak", quoteAround(line, idx, w.length), "warn", "word")
        }
      }
      // 通用公司名模式命中（warn）
      for (const line of lines) {
        const m = IDENTITY_GENERIC_RE.exec(line)
        if (m) push(title, "identity_leak", quoteAround(line, m.index, m[0].length), "warn", "generic")
      }
    }
    if (wantWording) {
      // ① 连续重复句：相邻两行 trim 后完全相同且 ≥15 字（warn）
      let prevLine = ""
      for (const line of lines) {
        const t = line.trim()
        if (t && t === prevLine && t.length >= 15) {
          push(title, "wording_scan", `连续重复行：「${t.slice(0, 30)}…」`, "warn", "dup")
        }
        if (t) prevLine = t
      }
      // ② 叠字：的的/了了/是是/和和/与与（warn；排除「的的确确」）
      for (const line of lines) {
        const m = WORDING_REDUPLE_RE.exec(line)
        if (m) push(title, "wording_scan", quoteAround(line, m.index, m[0].length), "warn", "reduple")
      }
      // ③ 全半角括号混用：同章既含半角 ( 又含全角 （（warn，每章至多一条）
      if (content.includes("(") && content.includes("（")) {
        push(title, "wording_scan", "本章同时出现半角 ( 与全角 （ 括号，建议统一为全角", "warn", "bracket")
      }
      // ④ 中英/中数间缺空格：仅 info 级提示（每章独立计数，不挤占 warn 名额）
      for (const line of lines) {
        const m = WORDING_CJK_LATIN_RE.exec(line)
        if (m) push(title, "wording_scan", quoteAround(line, m.index, m[0].length), "info", "cjk")
      }
    }
  })
  return { hits, checked_at: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// 循环 8 A4：本地零 AI 数字口径冲突检查器（事实表数值 × 各章正文数值）
// ---------------------------------------------------------------------------

/** 数值+单位提取（单位归一见 normalizeNumUnit）；冒号时间式（8:30）因单位表不含冒号天然不命中 */
const NUM_UNIT_RE = /(\d+(?:\.\d+)?)\s*(个工作日|个?工作日|日历天|天|个月|年|小时|人|台|套|%|万元|元)/g

/** 比较语境词（数字前 4 字内出现即跳过该数字——「不超过 30 天」这类区间承诺是最大误报源） */
const NUM_COMPARISON_RE = /不超过|不少于|不低于|不高于|≥|≤|以上|以下|至少|最多|之内|以内/

/** 编号类行（招标/项目/标书编号同行的数字是标识符不是口径值，整行跳过提取） */
const NUM_ID_LINE_RE = /招标编号|项目编号|标书编号|采购项目编号|文件编号/

/** 单位归一：日历天→天、个月→月、（个）工作日→工作日；万元 vs 元、天 vs 月不做换算（跨单位不比较） */
function normalizeNumUnit(unit: string): string {
  if (unit === "日历天") return "天"
  if (unit === "个月") return "月"
  if (unit === "个工作日" || unit === "工作日") return "工作日"
  return unit
}

type NumRef = { value: number; unit: string; index: number; raw: string }

/**
 * 从一行文本提取参与比对的（值,单位）清单，内置误报控制：
 * ① 日期排除：「2026年9月」年值后接月日、或 1900-2100 整数年（纪年）不提取；
 * ② 时间排除：数字紧跟「:」前缀（如 8:30 的 30）不提取；
 * ③ 比较语境排除：数字前 4 字含「不超过/以上/至少…」等区间词不提取；
 * ④ 编号行由调用方按整行排除（NUM_ID_LINE_RE）。
 */
function extractNumRefs(line: string): NumRef[] {
  const out: NumRef[] = []
  const re = new RegExp(NUM_UNIT_RE.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const value = Number(m[1])
    if (!Number.isFinite(value)) continue
    const unit = normalizeNumUnit(m[2])
    const idx = m.index
    const before = line.slice(Math.max(0, idx - 4), idx)
    const beforeAll = line.slice(0, idx)
    const after = line.slice(idx + m[0].length)
    // ③ 比较语境（最大误报源）
    if (NUM_COMPARISON_RE.test(before)) continue
    // ② 时间式：数字紧贴冒号之后（「8:30分钟」形态的尾数）
    if (/[:：]\s*$/.test(beforeAll)) continue
    // ① 日期：年值后接「N月」或本身是 1900-2100 的整数纪年
    if (unit === "年" && (/^\s*\d{1,2}\s*月/.test(after) || (Number.isInteger(value) && value >= 1900 && value <= 2100))) continue
    out.push({ value, unit, index: idx, raw: m[0] })
  }
  return out
}

/**
 * 数字口径冲突检查（纯函数、零 AI、零后端）：
 * 基准 = 全局事实行（含「【需人工确认】」的行跳过）口径部分提取的（topic → 单位 → 值集）；
 * 扫描 = 每章正文只扫「含 topic 的行 ±1 行」窗口，且跳过编号/标题/章节号行（isPunctDensityBodyLine）与编号类行；
 * 判定 = 同 topic 同单位出现不同数值 → warn（跨单位不换算不比较）；
 * 去重 = 每章每 topic ≤2 条命中，总命中 ≤30 条（防长文刷屏），与 formatCheckReport 既有 push 骨架同口径。
 */
export function numberConflictHits(factLines: string[], chapters: Chapter[]): FormatCheckHit[] {
  // 基准表：topic → unit → values
  const baseline = new Map<string, Map<string, number[]>>()
  for (const rawLine of factLines ?? []) {
    const line = (rawLine ?? "").trim()
    if (!line || line.includes("【需人工确认】")) continue
    const topic = factTopicOf(line)
    if (!topic) continue
    // 只取口径部分（首个冒号/等号之后），主题名里的数字不进基准
    const head = line.match(/^[^：:=]{2,20}[：:=]/)
    const body = head ? line.slice(head[0].length) : line
    for (const n of extractNumRefs(body)) {
      let unitMap = baseline.get(topic)
      if (!unitMap) {
        unitMap = new Map<string, number[]>()
        baseline.set(topic, unitMap)
      }
      const vals = unitMap.get(n.unit) ?? []
      if (!vals.includes(n.value)) vals.push(n.value)
      unitMap.set(n.unit, vals)
    }
  }
  const hits: FormatCheckHit[] = []
  if (!baseline.size) return hits
  const topics = [...baseline.keys()]
  const perKey = new Map<string, number>()
  const seenExact = new Set<string>()
  outer: for (let ci = 0; ci < (chapters ?? []).length; ci++) {
    const c = chapters[ci]
    const content = c.content ?? ""
    if (!content.trim()) continue
    const title = (c.title ?? "").trim() || `第${ci + 1}章`
    const lines = content.split(/\r?\n/)
    for (let li = 0; li < lines.length; li++) {
      const anchor = lines[li]
      const hitTopics = topics.filter((tp) => tp.length >= 2 && anchor.includes(tp))
      if (!hitTopics.length) continue
      for (let w = Math.max(0, li - 1); w <= Math.min(lines.length - 1, li + 1); w++) {
        const wl = lines[w]
        if (!wl.trim()) continue
        // 编号/标题/章节号行（复用半角标点密度同款正文行判定）与编号类行整行跳过
        if (!isPunctDensityBodyLine(wl) || NUM_ID_LINE_RE.test(wl)) continue
        for (const n of extractNumRefs(wl)) {
          for (const tp of hitTopics) {
            const vals = baseline.get(tp)?.get(n.unit)
            if (!vals || !vals.length) continue // 跨单位不比较
            if (vals.includes(n.value)) continue
            const exact = `${title}|${tp}|${w}|${n.index}|${n.value}`
            if (seenExact.has(exact)) continue
            seenExact.add(exact)
            const key = `${title}#number_conflict#${tp}`
            if ((perKey.get(key) ?? 0) >= 2) continue
            perKey.set(key, (perKey.get(key) ?? 0) + 1)
            const factSide = vals.map((v) => `${v}${n.unit}`).join("/")
            hits.push({
              chapter: title,
              rule: "number_conflict",
              quote: `${quoteAround(wl, n.index, n.raw.length)}（事实口径「${tp}」为 ${factSide}）`.slice(0, 80),
              level: "warn",
            })
            if (hits.length >= 30) break outer
          }
        }
      }
    }
  }
  return hits
}

export type BidProjectRecord = {
  id: string
  rh_user_id: string
  project_name: string
  tender_no: string
  hospital: string
  bid_open_date: string
  stage: BidStage
  tender_text: string
  parse_report: ParseReport | null
  parse_config: ParseConfig | null
  bid_outline: OutlineNode[]
  bid_chapters: Chapter[]
  response_map: DeviationTable | null
  dup_report: DupReport | null
  void_check: VoidCheck | null
  ai_review: AiReview | null
  manual_review: ManualReview | null
  opportunity_id: string
  bid_result: BidResult
  bid_amount: number | null
  lost_reason: string
  result_synced_at: string
  /** 第五轮改造 1：生成设置持久化字段（与 PB 列名一致，老项目缺列时由 normalizeRecord 容错） */
  target_pages: number | null
  outline_level: number
  figures_enabled: boolean
  clause_granularity: ClauseGranularity
  section_words: number | null
  /** 第十三轮改造 3：技术章生成增强开关（json 列，存量项目缺列时由 normalizeGenOptions 容错为全 false） */
  gen_options: GenOptions
  /** 第十六轮 B1 改造 1.1：全局事实设定（text 列，一行一条；空串=回退本地自动抽取；存量项目缺列容错为 ""） */
  global_facts: string
  /** 第十六轮 B2 改造 2.1：预编排结果（json 列；存量项目缺列容错为 null=未编排，正文生成走旧逻辑） */
  orchestration: BidOrchestration | null
  /** 第十六轮 B2 改造 2.1：全文配图上限（number 列，0-20；null=默认 6；figures_enabled 仍是配图总开关） */
  max_figures: number | null
  /** 第十七轮 17B：编制依据规范库补选（json 列，StandardItem 数组；存量项目缺列容错为 null=未补选） */
  compilation_basis_extra: StandardItem[] | null
  /** 第十七轮 17B：编制依据撰写样式（text 列三值 table/group/numbered；""=未设置，消费侧默认 table） */
  basis_style: BasisStyle | ""
  /** 第十七轮 17C：格式配置（json 列；null=未单独配置，导出走现状默认） */
  format_settings: FormatSettings | null
  /** 第十七轮 17C：格式规则检查项（json 列，禁则 key 数组；存量 null 视为全开） */
  format_check_items: FormatCheckKey[]
  /** 第十七轮 17D：历史标书范本全文（text 列；空串=未导入，大纲生成不注入范本目录结构；存量项目缺列容错为 ""） */
  ref_template_text: string
  /** 第十七轮 17D：团队写作资料全文（text 列；空串=未导入，正文生成不注入资料段；存量项目缺列容错为 ""） */
  ref_materials_text: string
  /** 循环 2 批 1-4：自家身份词（text 列，逗号分隔；空串=未设置；暗标脱敏与 identity_leak 检查共用；存量项目缺列容错为 ""） */
  identity_words: string
  /** 第六轮改造：讲标与答辩（存量项目缺列时由 normalizeBidDefense 容错为空结构） */
  bid_defense: BidDefense
  /** 第七轮改造 5：交卷体检（实质响应覆盖审计）；存量项目缺列时容错为 null */
  submission_check: SubmissionCheck | null
  /** 第九轮改造 1：交卷闸门（确认留痕）；存量项目缺列时容错为 {gates:[]} */
  stage_gates: StageGates
  /** 第十一轮改造 1：归档分组与回收站软删（deleted_at 空串=未删）；存量项目缺列时容错 */
  archived: boolean
  deleted_at: string
  created: string
  updated: string
}

/** 回流到客户管理跟进时间线的自动记录文案 */
export function resultFollowContent(
  projectName: string,
  result: "won" | "lost",
  amount: number | null,
  lostReason: string,
): string {
  if (result === "won") {
    return `投标结果登记：${projectName} 中标${amount && amount > 0 ? `，金额 ${amount} 万元` : ""}`
  }
  return `投标结果登记：${projectName} 失单${lostReason.trim() ? `，原因：${lostReason.trim()}` : ""}`
}

export function emptyProjectPatch(): Partial<BidProjectRecord> {
  return {}
}

export function deriveStage(rec: Partial<BidProjectRecord> & { stage?: BidStage }): BidStage {
  if (rec.stage === "archived") return "archived"
  if (rec.ai_review) return "evaluated"
  if (rec.dup_report || rec.void_check) return "checking"
  if ((rec.bid_chapters?.length ?? 0) > 0 || (rec.bid_outline?.length ?? 0) > 0) return "composing"
  return "pending_parse"
}

// ------------------------------ 第九轮改造 1：交卷闸门（确认留痕，不拦导航只拦导出） ------------------------------

export type GateKind = "parse" | "outline" | "compose" | "check" | "eval"

export const GATE_KINDS: GateKind[] = ["parse", "outline", "compose", "check", "eval"]

export const GATE_LABEL: Record<GateKind, string> = {
  parse: "招标解析",
  outline: "大纲确认",
  compose: "正文编制",
  check: "检查体检",
  eval: "模拟评标",
}

export type GateRecord = {
  gate: GateKind
  confirmed_at: string
  notes: string
  /** 条件未满足时强制放行（必填备注留痕） */
  forced: boolean
}

export type StageGates = { gates: GateRecord[] }

export function emptyStageGates(): StageGates {
  return { gates: [] }
}

/** 存量记录容错读取（缺列 / 损坏 → 空闸门集，老项目打开不崩） */
export function normalizeStageGates(raw: unknown): StageGates {
  if (!raw || typeof raw !== "object") return emptyStageGates()
  const rec = raw as Record<string, unknown>
  const gates: GateRecord[] = []
  for (const it of asArray(rec.gates)) {
    const r = (it ?? {}) as Record<string, unknown>
    const g = String(r.gate ?? "").trim()
    if (g !== "parse" && g !== "outline" && g !== "compose" && g !== "check" && g !== "eval") continue
    if (gates.some((x) => x.gate === g)) continue
    gates.push({
      gate: g as GateKind,
      confirmed_at: String(r.confirmed_at ?? ""),
      notes: String(r.notes ?? "").slice(0, 200),
      forced: r.forced === true,
    })
  }
  return { gates }
}

export function findGateRecord(gates: StageGates | null | undefined, kind: GateKind): GateRecord | null {
  return gates?.gates.find((g) => g.gate === kind) ?? null
}

export function gatesAllConfirmed(gates: StageGates | null | undefined): boolean {
  return GATE_KINDS.every((k) => !!findGateRecord(gates, k))
}

export function gatesUnconfirmedCount(gates: StageGates | null | undefined): number {
  return GATE_KINDS.filter((k) => !findGateRecord(gates, k)).length
}

export type GateCondition = { met: boolean; missing: string }

/** 五闸门确认条件：满足才可「直接确认」，未满足只能「强制放行」（必填备注） */
export function gateCondition(rec: Partial<BidProjectRecord> | null, kind: GateKind): GateCondition {
  if (!rec) return { met: false, missing: "尚未打开项目" }
  if (kind === "parse") {
    return rec.parse_report
      ? { met: true, missing: "" }
      : { met: false, missing: "还没有 AI 解析报告" }
  }
  if (kind === "outline") {
    return (rec.bid_outline?.length ?? 0) > 0
      ? { met: true, missing: "" }
      : { met: false, missing: "还没有确认过投标文件大纲" }
  }
  if (kind === "compose") {
    // 第十三轮改造 4：正文完成闸门只算技术章（商务骨架章不生成正文，不参与闸门判定）
    const chapters = techChapters(rec.bid_chapters ?? [])
    if (!chapters.length) return { met: false, missing: "还没有任何技术章节" }
    const empty = chapters.filter((c) => !(c.content ?? "").trim()).length
    return empty === 0
      ? { met: true, missing: "" }
      : { met: false, missing: `还有 ${empty} 个技术章节没有正文` }
  }
  if (kind === "check") {
    const lacks: string[] = []
    if (!rec.dup_report) lacks.push("查重报告")
    if (!rec.void_check) lacks.push("废标检查")
    // 第十七轮 17C：仅含格式规则检查的报告（items 空）不算完成交卷体检
    if (!rec.submission_check?.items?.length) lacks.push("交卷体检")
    return lacks.length ? { met: false, missing: `还缺：${lacks.join("、")}` } : { met: true, missing: "" }
  }
  return rec.ai_review ? { met: true, missing: "" } : { met: false, missing: "还没有模拟评标报告" }
}

/** 流水线步骤 → 闸门映射（步骤图标右上角小勾徽标用；该步对应闸门已确认即显示） */
export const STEP_GATE_MAP: Record<number, GateKind> = { 2: "parse", 3: "compose", 4: "check", 5: "check", 6: "eval" }

export function stepGateConfirmed(step: number, gates: StageGates | null | undefined): boolean {
  const kind = STEP_GATE_MAP[step]
  return kind ? !!findGateRecord(gates, kind) : false
}

export const PIPELINE_STEPS: { step: number; label: string; short: string }[] = [
  { step: 1, label: "招标文件", short: "上传或粘贴招标文件" },
  { step: 2, label: "AI 解析报告", short: "评分办法 / 资质 / 废标条款" },
  { step: 3, label: "投标文件编制", short: "大纲、逐章正文与响应对照" },
  { step: 4, label: "标书查重", short: "与历史标书对比相似段落" },
  { step: 5, label: "废标项检查", short: "逐条比对废标条款响应" },
  { step: 6, label: "模拟评标", short: "AI 评分 + 人工打分对比" },
  { step: 7, label: "归档导出", short: "导出全套投标文档" },
]

// ------------------------------ 第十一轮改造 3：步骤准入按产物放行 ------------------------------

/**
 * 步骤准入条件（按产物，不要求当前环节全部完成）：
 * 解析报告存在→可进大纲/编制；≥1 章有正文→可进检查；检查报告存在→可进评标；归档步骤不拦。
 * 返回空串=放行；返回文案=缺少的产物说明（点击步骤时 toast 提示）。
 */
export function stepEntryMissing(step: number, proj: Partial<BidProjectRecord> | null): string {
  if (!proj) return ""
  if (step === 2) {
    return (proj.tender_text ?? "").trim() ? "" : "请先在第 1 步导入招标文件文本，才能进入 AI 解析"
  }
  if (step === 3) {
    return proj.parse_report ? "" : "还没有 AI 解析报告，解析报告就绪后即可进入大纲与编制"
  }
  if (step === 4 || step === 5) {
    return (proj.bid_chapters ?? []).some((c) => (c.content ?? "").trim())
      ? ""
      : "至少 1 个章节有正文后才能进入检查环节"
  }
  if (step === 6) {
    return proj.dup_report || proj.void_check
      ? ""
      : "查重或废标检查报告就绪后即可进入模拟评标"
  }
  return ""
}

// ------------------------------ 第十一轮改造 2：招标隐式页数上限 ------------------------------

/** 从隐式硬约束清单里抽取页数上限（如「总页数不得超过 80 页」）；没有则 null */
export function extractPageCap(constraints: string[]): number | null {
  for (const c of constraints) {
    if (!c.includes("页")) continue
    if (!/(不得超过|不超过|不多于|以内|上限|≤)/.test(c)) continue
    const m = c.match(/(\d+)\s*页/)
    if (!m) continue
    const n = Number(m[1])
    if (n > 0 && n <= 9999) return n
  }
  return null
}

/** 有效目标页数：用户设置（缺省按招标文本估算）再受招标页数上限硬封顶 */
export function effectiveTargetPages(rec: Partial<BidProjectRecord> | null): number {
  if (!rec) return 0
  const base = rec.target_pages ?? estimatePagesFromText(rec.tender_text ?? "")
  const cap = extractPageCap(extractImplicitConstraints(rec.tender_text ?? ""))
  return cap && base > cap ? cap : base
}

// ------------------------------ 第十一轮改造 4：阶段工作记录快照 ------------------------------

export type SnapshotStage = "parse" | "outline" | "chapter" | "check" | "eval" | "reset"

export const SNAPSHOT_STAGES: SnapshotStage[] = ["parse", "outline", "chapter", "check", "eval", "reset"]

export const SNAPSHOT_STAGE_LABEL: Record<SnapshotStage, string> = {
  parse: "招标解析",
  outline: "大纲",
  chapter: "章节正文",
  check: "检查体检",
  eval: "模拟评标",
  reset: "全量备份",
}

/** 快照徽标四色（badge-info 不存在，chapter 落 neutral） */
export const SNAPSHOT_STAGE_BADGE: Record<SnapshotStage, "neutral" | "success" | "warning"> = {
  parse: "neutral",
  outline: "neutral",
  chapter: "neutral",
  check: "success",
  eval: "success",
  reset: "warning",
}

export type StageSnapshotRow = {
  id: string
  rh_user_id: string
  project_id: string
  stage: string
  label: string
  payload: Record<string, unknown> | null
  created: string
  updated: string
}

/** 每项目保留最近 60 条快照（写入时若超，删除最旧的非 reset 条） */
export const SNAPSHOT_RETAIN = 60

/** 单条快照里的正文字段截断长度，防记录膨胀 */
export const SNAPSHOT_CONTENT_MAX = 20000

// ------------------------------ JSON 容错解析 ------------------------------

/** 剥代码围栏并截取首个 { / [ 到匹配的末个 } / ]，解析成 JSON */
/**
 * 第十六轮 A：弱模型 JSON 本地修复兜底——截断/漏闭合括号/尾逗号/字符串未闭合的候选串
 * 做栈扫描补全后再解析（参考开源标书智能体「提示词只提高首次成功率、稳定性靠工作流」思路的本地一环）。
 */
function repairJsonCandidate(s: string): string {
  let out = s
  // 尾逗号清理（} 或 ] 前的逗号）
  out = out.replace(/,(\s*[}\]])/g, "$1")
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of out) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") stack.pop()
  }
  if (inStr) out += '"'
  out = out.replace(/,(\s*[}\]])/g, "$1").replace(/,\s*$/, "")
  while (stack.length) {
    const open = stack.pop()
    out += open === "{" ? "}" : "]"
  }
  return out
}

export function extractJsonLoose(text: string): unknown {
  let t = text.trim()
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const objStart = t.indexOf("{")
  const arrStart = t.indexOf("[")
  let candidate = ""
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
    candidate = t.slice(arrStart, t.lastIndexOf("]") + 1)
  } else if (objStart >= 0) {
    candidate = t.slice(objStart, t.lastIndexOf("}") + 1)
  }
  if (!candidate) {
    // 完全没有闭合括号时（弱模型输出被截断）：从首个 { 或 [ 起取到末尾尝试修复
    const openIdx = objStart >= 0 ? objStart : arrStart
    if (openIdx < 0) throw new Error("AI 返回内容不是有效 JSON，请重试")
    candidate = t.slice(openIdx)
  }
  try {
    return JSON.parse(candidate)
  } catch {
    return JSON.parse(repairJsonCandidate(candidate))
  }
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v)
}

function asNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** AI 大纲输出的条款覆盖映射（clause_id → 大纲叶子节点标题） */
export type OutlineCoverageItem = { clause_id: string; node_title: string }

export function sanitizeOutlineCoverage(raw: unknown, clauses: RequirementClause[]): OutlineCoverageItem[] {
  const arr = asArray(Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.coverage)
  const valid = new Set(clauses.map((c) => c.id))
  const out: OutlineCoverageItem[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const clauseId = asString(r.clause_id ?? r.id).trim()
    const nodeTitle = asString(r.node_title ?? r.title).trim()
    if (!clauseId || !nodeTitle) continue
    if (valid.size && !valid.has(clauseId)) continue
    out.push({ clause_id: clauseId, node_title: nodeTitle })
  }
  return out
}

/** 偏离表 AI 映射结果规整：每行 {clause_id, response_node, response_level, response_summary, bid_ref}；AI 漏掉的条款补「偏离」行保证清单完整 */
export function sanitizeDeviationRows(raw: unknown, clauses: RequirementClause[]): DeviationRow[] {
  const arr = asArray(Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.rows)
  const byId = new Map(clauses.map((c) => [c.id, c]))
  const rows: DeviationRow[] = []
  const handled = new Set<string>()
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const idRaw = asString(r.clause_id ?? r.id).trim()
    const idxNum = Number(idRaw)
    const clauseId = byId.has(idRaw) ? idRaw : Number.isFinite(idxNum) && byId.has(`c${idxNum}`) ? `c${idxNum}` : ""
    const clause = clauseId ? byId.get(clauseId) : undefined
    if (!clause) continue
    const lvlRaw = asString(r.response_level ?? r.level).trim()
    const level: ResponseLevel =
      lvlRaw === "full" || lvlRaw === "完全响应"
        ? "full"
        : lvlRaw === "partial" || lvlRaw === "部分响应"
          ? "partial"
          : lvlRaw === "deviation" || lvlRaw === "偏离"
            ? "deviation"
            : "deviation"
    rows.push({
      clause_id: clause.id,
      clause_text: clause.text,
      source: clause.source,
      response_node: asString(r.response_node ?? r.node).trim() || "未找到响应",
      response_level: level,
      response_summary: asString(r.response_summary ?? r.summary).trim().slice(0, 200),
      bid_ref: asString(r.bid_ref ?? r.ref).trim(),
    })
    handled.add(clause.id)
  }
  for (const cl of clauses) {
    if (handled.has(cl.id)) continue
    rows.push({
      clause_id: cl.id,
      clause_text: cl.text,
      source: cl.source,
      response_node: "未找到响应",
      response_level: "deviation",
      response_summary: "AI 未在投标文件中定位到对应响应，请人工复核补充",
      bid_ref: "",
    })
  }
  // 按条款原始顺序排回，分组展示稳定
  const order = new Map(clauses.map((c, i) => [c.id, i]))
  rows.sort((a, b) => (order.get(a.clause_id) ?? 999) - (order.get(b.clause_id) ?? 999))
  return rows
}

export function sanitizeVoidCheck(raw: unknown, clauses: string[]): VoidCheck {
  const arr = asArray(Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items)
  const items: VoidItem[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const clause = asString(r.clause ?? r.text).trim()
    if (!clause) continue
    // 新契约读 status；旧契约 verdict 容错映射
    const status = asVoidStatus(r.status, legacyVerdictToStatus(r.verdict) || "partial")
    items.push({
      id: makeUid(),
      clause,
      source_location: asString(r.source_location).trim().slice(0, 40),
      response: asString(r.response ?? r.reply),
      response_location: asString(r.response_location).trim().slice(0, 40),
      status,
      // 废标条款默认 critical，仅 AI 明确判定为轻微程序性要求时降档
      severity: status === "compliant" ? asSeverity(r.severity, "minor") : asSeverity(r.severity, "critical"),
      suggestion: asString(r.suggestion).trim().slice(0, 80),
      evidence: asString(r.evidence).trim().slice(0, 140),
      reason: asString(r.reason),
      manual_checked: false,
      manual_status: "",
      review_status: "pending",
      skip_reason: "",
    })
  }
  // LLM 漏掉的条款补成「不合规」，保证清单完整
  for (const c of clauses) {
    const hit = items.some((i) => i.clause.includes(c.slice(0, 12)) || c.includes(i.clause.slice(0, 12)))
    if (!hit && c.trim()) {
      items.push({
        id: makeUid(),
        clause: c,
        source_location: "",
        response: "",
        response_location: "",
        status: "non_compliant",
        severity: "critical",
        suggestion: "在投标文件中补充对该条款的实质性响应",
        evidence: "",
        reason: "AI 未在投标文件中找到对应响应",
        manual_checked: false,
        manual_status: "",
        review_status: "pending",
        skip_reason: "",
      })
    }
  }
  return { items, checked_at: new Date().toISOString() }
}

/** 存量记录容错读取：旧 verdict/manual_verdict 数据映射到新 status 契约，老项目打开不崩 */
export function normalizeVoidCheck(raw: unknown): VoidCheck | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const items: VoidItem[] = []
  for (const it of asArray(rec.items)) {
    const r = (it ?? {}) as Record<string, unknown>
    const clause = asString(r.clause).trim()
    if (!clause) continue
    const status = asVoidStatus(r.status, legacyVerdictToStatus(r.verdict) || "partial")
    const msRaw = String(r.manual_status ?? "").trim()
    const manualStatus: VoidStatus | "" =
      msRaw === "compliant" || msRaw === "partial" || msRaw === "non_compliant"
        ? (msRaw as VoidStatus)
        : legacyVerdictToStatus(r.manual_verdict)
    const manualChecked = r.manual_checked === true
    items.push({
      id: asString(r.id).trim() || makeUid(),
      clause,
      source_location: asString(r.source_location).trim().slice(0, 40),
      response: asString(r.response),
      response_location: asString(r.response_location).trim().slice(0, 40),
      status,
      severity: asSeverity(r.severity, "critical"),
      suggestion: asString(r.suggestion).trim(),
      evidence: asString(r.evidence).trim(),
      reason: asString(r.reason),
      manual_checked: manualChecked,
      manual_status: manualChecked ? manualStatus : "",
      // 旧数据 manual_checked=true 的映射为已处理；review_status 缺省 pending
      review_status: asReviewStatus(r.review_status, manualChecked ? "addressed" : "pending"),
      skip_reason: asString(r.skip_reason),
    })
  }
  if (!items.length) return null
  return { items, checked_at: asString(rec.checked_at) }
}

export function sanitizeAiReview(raw: unknown, scoringItems: ScoringItem[]): AiReview {
  const rec = (raw ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(raw) ? raw : rec.items ?? rec.scores)
  const items: AiReviewItem[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const title = asString(r.scoring_item ?? r.item).trim()
    if (!title) continue
    const fb = scoringItems.find((s) => s.item === title)
    const maxScore = asNumber(r.max_score ?? fb?.score ?? 0)
    const aiScore = Math.min(asNumber(r.ai_score ?? r.score), maxScore || Number.MAX_SAFE_INTEGER)
    items.push({
      scoring_item: title,
      max_score: maxScore,
      ai_score: aiScore,
      reason: asString(r.reason ?? r.deduction_reason),
      suggestion: asString(r.suggestion ?? r.advice),
    })
  }
  // LLM 漏评的评分项补 0 分，提醒人工关注
  for (const s of scoringItems) {
    if (!items.some((i) => i.scoring_item === s.item)) {
      items.push({ scoring_item: s.item, max_score: s.score, ai_score: 0, reason: "AI 未覆盖该评分项，请人工复核", suggestion: "补充对应响应内容后重新评标" })
    }
  }
  const total = items.reduce((sum, i) => sum + (Number.isFinite(i.ai_score) ? i.ai_score : 0), 0)
  return {
    items,
    total_score: Math.round(total * 10) / 10,
    summary: asString(rec.summary ?? rec.comment),
    reviewed_at: new Date().toISOString(),
    // 技术路单独产出；格式/商务路由三路评标合并写入
    format_issues: [],
    commercial_checks: [],
  }
}

/** 存量记录容错读取：旧 ai_review 没有三路字段时补空数组（旧报告自动归技术路），老项目打开不崩 */
export function normalizeAiReview(raw: unknown): AiReview | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const items: AiReviewItem[] = []
  for (const it of asArray(rec.items)) {
    const r = (it ?? {}) as Record<string, unknown>
    const title = asString(r.scoring_item ?? r.item).trim()
    if (!title) continue
    items.push({
      scoring_item: title,
      max_score: asNumber(r.max_score),
      ai_score: asNumber(r.ai_score ?? r.score),
      reason: asString(r.reason),
      suggestion: asString(r.suggestion),
    })
  }
  if (!items.length && !asString(rec.summary).trim()) return null
  return {
    items,
    total_score: asNumber(rec.total_score),
    summary: asString(rec.summary),
    reviewed_at: asString(rec.reviewed_at),
    format_issues: sanitizeFormatIssues(rec.format_issues),
    commercial_checks: sanitizeCommercialChecks(rec.commercial_checks),
  }
}

/** 格式规范路 AI 输出容错：{format_issues:[...]} 或裸数组均可 */
export function sanitizeFormatIssues(raw: unknown): FormatIssue[] {
  const rec = (raw ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(raw) ? raw : rec.format_issues ?? rec.issues)
  const out: FormatIssue[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const issue = asString(r.issue ?? r.problem).trim()
    if (!issue) continue
    out.push({
      issue: issue.slice(0, 200),
      severity: asSeverity(r.severity, "major"),
      location: asString(r.location).trim().slice(0, 60),
      suggestion: asString(r.suggestion).trim().slice(0, 120),
    })
  }
  return out
}

/** 商务要素路 AI 输出容错：{commercial_checks:[...]} 或裸数组均可；「未找到」投标值一律判不一致 */
export function sanitizeCommercialChecks(raw: unknown): CommercialCheck[] {
  const rec = (raw ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(raw) ? raw : rec.commercial_checks ?? rec.checks)
  const out: CommercialCheck[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const key = asString(r.key ?? r.item).trim()
    if (!key) continue
    const bidValue = asString(r.bid_value).trim()
    const consistent = r.consistent === true && bidValue !== "" && !bidValue.includes("未找到")
    out.push({
      key: key.slice(0, 40),
      tender_value: asString(r.tender_value).trim().slice(0, 120),
      bid_value: bidValue.slice(0, 120) || "未找到",
      consistent,
      note: asString(r.note).trim().slice(0, 160),
    })
  }
  return out
}

// ------------------------------ 配图数据容错 ------------------------------

/** 泛化占位名模式：配图模块/步骤/区块名命中任一即视为未取自本章正文，前端兜底丢弃 */
const GENERIC_FIGURE_NAME_PATTERNS = [
  /^模块\s*[0-9一二三四五六七八九十A-Za-z]*$/,
  /^(系统|功能|业务)?模块\s*[0-9一二三四五六七八九十A-Za-z]*$/,
  /^子系统\s*[0-9一二三四五六七八九十A-Za-z]*$/,
  /^步骤\s*[0-9一二三四五六七八九十]+$/,
  /^第\s*[0-9一二三四五六七八九十]+\s*步$/,
  /^流程\s*[0-9一二三四五六七八九十]*$/,
  /^\d+$/,
  /^\d+(\.\d+)+$/,
  /^[A-Za-z]$/,
]

export function isGenericFigureName(name: string): boolean {
  const n = name.trim()
  if (!n) return true
  return GENERIC_FIGURE_NAME_PATTERNS.some((re) => re.test(n))
}

/** 规整 LLM 输出的 figures 数组（0-2 个，三种类型，缺字段或泛化占位名丢弃） */
export function sanitizeFigures(raw: unknown): FigureSpec[] {
  const out: FigureSpec[] = []
  for (const it of asArray(raw).slice(0, 2)) {
    const r = (it ?? {}) as Record<string, unknown>
    const type = asString(r.type).trim()
    const title = asString(r.title).trim() || "配图"
    if (type === "architecture") {
      const layers = asArray(r.layers)
        .map((l) => {
          const lr = (l ?? {}) as Record<string, unknown>
          return {
            name: asString(lr.name ?? lr.layer).trim() || "层级",
            modules: asArray(lr.modules)
              .map((m) => asString(typeof m === "string" ? m : (m as Record<string, unknown>)?.name).trim())
              .filter((m) => m && !isGenericFigureName(m)),
          }
        })
        .filter((l) => l.modules.length > 0)
      if (layers.length) out.push({ type: "architecture", title, layers })
    } else if (type === "flow") {
      const steps = asArray(r.steps).flatMap((s) => {
        const sr = (s ?? {}) as Record<string, unknown>
        const nm = asString(typeof s === "string" ? s : sr.name ?? sr.step).trim()
        if (!nm || isGenericFigureName(nm)) return []
        const desc = asString(sr.desc ?? sr.description).trim()
        return [{ name: nm, desc: desc || undefined }]
      })
      if (steps.length) {
        out.push({
          type: "flow",
          title,
          steps,
          branches: asArray(r.branches)
            .map((b) => asString(typeof b === "string" ? b : (b as Record<string, unknown>)?.name).trim())
            .filter(Boolean),
        })
      }
    } else if (type === "demo") {
      const main = asArray(r.main).flatMap((m) => {
        const mr = (m ?? {}) as Record<string, unknown>
        const blk = asString(typeof m === "string" ? m : mr.block ?? mr.name).trim()
        if (!blk || isGenericFigureName(blk)) return []
        const desc = asString(mr.desc).trim()
        return [{ block: blk, desc: desc || undefined }]
      })
      const sidebar = asArray(r.sidebar)
        .map((s) => asString(typeof s === "string" ? s : (s as Record<string, unknown>)?.name).trim())
        .filter((s) => s && !isGenericFigureName(s))
      if (main.length || sidebar.length) out.push({ type: "demo", title, sidebar, main })
    }
  }
  return out
}

/**
 * 第十轮修复 1：LLM 输出正文净化（纯函数）——
 * 剥 ``` 代码围栏整块；剥独立 JSON 块（行首花括号或方括号起平衡括号截取，能 parse 且为非散文结构才删）；
 * 剥 markdown 残留（行首井号标题、粗体与斜体与行内代码的包裹符、行首列表项目符、行首引用符）；
 * 连续 ≥3 换行折叠为 2；逐行 trim。【待填写】等合法占位不动。
 * 调用点仅限 LLM 输出解析（parseChapterOutput）与导出前（exportBidDocx），不进用户编辑链路。
 */
export function sanitizeChapterText(text: string): string {
  if (!text) return ""
  // 1) 剥成对 ``` 代码围栏（含 lang 行整块删除），再删残留的孤立围栏行
  let out = text.replace(/```[\s\S]*?```/g, "")
  // 2) 剥独立 JSON 块：行首为 { 或 [ 时做平衡括号截取，可 parse 且为数组/非散文键对象 → 删除该 span
  out = stripStandaloneJsonBlocks(out)
  // 3) 逐行剥 markdown 残留
  const lines = out.split("\n").map((rawLine) => {
    let line = rawLine.trim()
    if (/^\s*```/.test(line)) return "" // 未闭合围栏的孤立 ``` 行
    line = line.replace(/^#{1,6}\s+/, "")
    line = line.replace(/^>\s?/, "")
    line = line.replace(/^[-*+]\s+/, "")
    line = line.replace(/\*\*([^*]+)\*\*/g, "$1")
    line = line.replace(/\*([^*\n]+)\*/g, "$1")
    line = line.replace(/`([^`\n]+)`/g, "$1")
    return line.trim()
  })
  // 4) 连续 ≥3 换行折叠为 2，整体 trim
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** 结构化（非散文）JSON 常见键：命中任一即视为模型多输出的结构块，可整段剥除 */
const STRUCTURAL_JSON_KEYS = new Set([
  "type", "name", "title", "desc", "description", "branches", "moves", "children",
  "steps", "layers", "modules", "block", "sidebar", "main", "figures", "items",
  "nodes", "edges", "from", "to", "label", "key", "value", "id",
])

/** 从 start 处（text[start] 为 { 或 [）做字符串感知的平衡括号截取；不平衡返回 -1 */
function balancedJsonSpan(text: string, start: number): number {
  const open = text[start]
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return i + 1
    } else if ((open === "[" && c === "{") || (open === "{" && c === "[")) {
      // 嵌套异类括号交给 JSON.parse 校验，这里只做粗配平
      const inner = balancedJsonSpan(text, i)
      if (inner < 0) return -1
      i = inner - 1
    }
  }
  return -1
}

/** 判断已 parse 成功的 JSON 是否为「非散文结构块」（数组直接算；对象需命中结构键） */
function isStructuralJson(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return true
  if (parsed && typeof parsed === "object") {
    return Object.keys(parsed as Record<string, unknown>).some((k) => STRUCTURAL_JSON_KEYS.has(k))
  }
  return false
}

/** 逐行扫描行首 {/[，平衡截取 + JSON.parse，结构块整段删除；解析失败或像散文（含中文句号且无引号键）保留 */
function stripStandaloneJsonBlocks(text: string): string {
  const lines = text.split("\n")
  const keep: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].trimStart()[0]
    if (first !== "{" && first !== "[") {
      keep.push(lines[i])
      continue
    }
    // 从本行行首起跨行平衡截取
    const chunkStart = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0) + lines[i].indexOf(first)
    const end = balancedJsonSpan(text, chunkStart)
    if (end < 0) {
      keep.push(lines[i])
      continue
    }
    const span = text.slice(chunkStart, end)
    let parsed: unknown = null
    let ok = false
    try {
      parsed = JSON.parse(span)
      ok = true
    } catch {
      ok = false
    }
    if (!ok || !isStructuralJson(parsed) || (span.includes("。") && !span.includes('"'))) {
      keep.push(lines[i])
      continue
    }
    // 删除该 span 覆盖的所有行
    const spanLines = span.split("\n").length
    i += spanLines - 1
  }
  return keep.join("\n")
}

/**
 * 第十轮修复 2：从文本尾部回收最后一个平衡 [...] JSON 数组（元素为含 type/name/title 任一键的对象）
 * 作为 figures；成功返回 { arr, rest }（rest 为去掉数组后的剩余正文），失败返回 null。
 */
function extractTailJsonArray(text: string): { arr: unknown[]; rest: string } | null {
  const trimmed = (text ?? "").trimEnd()
  if (!trimmed.endsWith("]")) return null
  let attempts = 0
  for (let i = trimmed.lastIndexOf("["); i >= 0 && attempts < 12; i = trimmed.lastIndexOf("[", i - 1)) {
    attempts += 1
    if (trimmed[i + 1] !== "{" && trimmed[i + 1] !== "[") continue
    try {
      const parsed = JSON.parse(trimmed.slice(i))
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          (el) =>
            el &&
            typeof el === "object" &&
            !Array.isArray(el) &&
            ["type", "name", "title"].some((k) => k in (el as Record<string, unknown>)),
        )
      ) {
        return { arr: parsed, rest: trimmed.slice(0, i) }
      }
    } catch {
      // 该 [ 不是合法 JSON 起点，继续向前找
    }
  }
  return null
}

/** 正文生成结果解析：配图开关打开时尝试 {content, figures} JSON → 尾部独立 figures 数组回收 → 纯文本降级；任何分支 content 都过 sanitizeChapterText */
export function parseChapterOutput(text: string, figuresEnabled: boolean): { content: string; figures: FigureSpec[] } {
  if (!figuresEnabled) return { content: sanitizeChapterText(text), figures: [] }
  try {
    const rec = extractJsonLoose(text) as Record<string, unknown>
    if (rec && typeof rec === "object" && !Array.isArray(rec) && typeof rec.content === "string") {
      return { content: sanitizeChapterText(rec.content), figures: sanitizeFigures(rec.figures) }
    }
  } catch {
    // 不是 JSON 就当纯文本，继续走尾部数组回收
  }
  // 修复 2：正文 + 尾部独立 JSON 数组（未包裹在 {content,figures} 内）→ 数组回收为 figures，剩余文本作正文
  const tail = extractTailJsonArray(text)
  if (tail) return { content: sanitizeChapterText(tail.rest), figures: sanitizeFigures(tail.arr) }
  return { content: sanitizeChapterText(text), figures: [] }
}

// ------------------------------ 本地查重粗筛（n-gram + Jaccard，成本控制：只送可疑段落给 AI） ------------------------------

function normalizePara(s: string): string {
  return s.replace(/[\s　，。、；：""''（）()《》【】\-—_.,;:'"!?！？·]/g, "")
}

function shingles(s: string, n = 3): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n))
  return set
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

export function splitParagraphs(text: string, minLen = 50, max = 40): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= minLen)
    .slice(0, max)
}

export type DupTarget = { nodeId: string; chapter: string; text: string }
export type DupSource = { project: string; chapter: string; text: string }

/** 段落级粗筛：对每个目标段落找最相似来源段落，超过阈值即列为可疑对（不花钱） */
export function findSuspectPairs(targets: DupTarget[], sources: DupSource[], threshold = 0.3, limit = 10): DupPair[] {
  const sourceParas: { src: DupSource; para: string; sh: Set<string> }[] = []
  for (const src of sources) {
    for (const para of splitParagraphs(src.text)) {
      sourceParas.push({ src, para, sh: shingles(normalizePara(para)) })
    }
  }
  const pairs: DupPair[] = []
  for (const tgt of targets) {
    for (const para of splitParagraphs(tgt.text)) {
      const tsh = shingles(normalizePara(para))
      let best: { score: number; entry: (typeof sourceParas)[number] } | null = null
      for (const entry of sourceParas) {
        const score = jaccard(tsh, entry.sh)
        if (score >= threshold && (!best || score > best.score)) best = { score, entry }
      }
      if (best) {
        pairs.push({
          target_node_id: tgt.nodeId,
          target_chapter: tgt.chapter,
          target_text: para,
          source_project: best.entry.src.project,
          source_chapter: best.entry.src.chapter,
          source_text: best.entry.para,
          similarity: Math.round(best.score * 100) / 100,
          ai_verdict: "",
          ai_note: "",
        })
      }
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity)
  return pairs.slice(0, limit)
}

/**
 * 第七轮改造 4：同一标书内章间互查（零 AI、零费用）——
 * 复用 normalizePara/shingles/jaccard，跨章段落对相似度 ≥ threshold 即列可疑，按相似度倒序取前 limit 对。
 */
export function findIntraDupPairs(chapters: DupTarget[], threshold = 0.35, limit = 10): IntraDupPair[] {
  const paras: { ch: DupTarget; para: string; sh: Set<string> }[] = []
  for (const ch of chapters) {
    for (const para of splitParagraphs(ch.text)) paras.push({ ch, para, sh: shingles(normalizePara(para)) })
  }
  const pairs: IntraDupPair[] = []
  for (let x = 0; x < paras.length; x++) {
    for (let y = x + 1; y < paras.length; y++) {
      const A = paras[x]
      const B = paras[y]
      if (A.ch.nodeId === B.ch.nodeId) continue
      const score = jaccard(A.sh, B.sh)
      if (score < threshold) continue
      pairs.push({
        a_node_id: A.ch.nodeId,
        a_chapter: A.ch.chapter,
        a_text: A.para,
        b_node_id: B.ch.nodeId,
        b_chapter: B.ch.chapter,
        b_text: B.para,
        similarity: Math.round(score * 100) / 100,
      })
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity)
  return pairs.slice(0, limit)
}

// ------------------------------ 大纲级数与章节字数预算 ------------------------------

/** 按级数裁剪大纲深度（1=只留章，2=章—节，3=章—节—条）；第十三轮：保留顶层 part，商务章固定保留其一级小节不受级数裁剪 */
export function trimOutlineDepth(nodes: OutlineNode[], depth: number): OutlineNode[] {
  if (depth <= 0) return []
  return nodes.map((n) => ({
    id: n.id,
    title: n.title,
    ...(n.part ? { part: n.part } : {}),
    // 商务骨架章 children 本来就只有一级小节，级数硬约束只按技术章计算，这里原样保留
    children: isBizPart(n) ? (n.children ?? []) : depth > 1 ? trimOutlineDepth(n.children ?? [], depth - 1) : [],
  }))
}

/** 第五轮改造 2：由总页数反推大纲目标叶子数——总字数(页数×500)/每小节字数，clamp 12–400 */
export function leafTargetFromPages(pages: number, sectionWords = 800): number {
  const p = Math.max(1, Math.min(9999, Math.round(pages) || 1))
  const sw = Math.min(2000, Math.max(400, Math.round(sectionWords) || 800))
  return Math.min(400, Math.max(12, Math.round((p * 500) / sw)))
}

/** 大纲叶子节点（无子节点的末端节点）总数 */
export function outlineLeafCount(nodes: OutlineNode[]): number {
  let n = 0
  const walk = (list: OutlineNode[]) => {
    for (const x of list ?? []) {
      if ((x.children ?? []).length) walk(x.children ?? [])
      else n += 1
    }
  }
  walk(nodes ?? [])
  return n
}

/** 大纲最大深度（空树=0，只有章=1） */
export function outlineMaxDepth(nodes: OutlineNode[]): number {
  if (!nodes?.length) return 0
  return 1 + Math.max(0, ...nodes.map((n) => outlineMaxDepth(n.children ?? [])))
}

/**
 * 第五轮改造 2：大纲结构本地校验——返回问题清单（空数组=符合要求）。
 * level>0 时校验实际深度与层级形态（3 级每节≥1 条、2 级节 children 必空）；
 * 叶子总数偏离 leafTarget ±40% 以上视为规模不符。
 * 第十三轮改造 2：级数 / 叶子规模硬约束只按技术章（part!=="biz"）计算，商务骨架章不计入。
 */
export function validateOutlineShape(nodes: OutlineNode[], level: 0 | 1 | 2 | 3, leafTarget: number): string[] {
  const issues: string[] = []
  if (!nodes?.length) return ["大纲为空"]
  const techNodes = techOutlineNodes(nodes)
  if (!techNodes.length) return ["大纲缺少技术部分章节（顶层章全部被标为商务）"]
  const depth = outlineMaxDepth(techNodes)
  if (level > 0 && depth !== level) issues.push(`技术部分目录级数应为 ${level} 级，当前为 ${depth} 级`)
  if (level === 2 && techNodes.some((n) => (n.children ?? []).some((s) => (s.children ?? []).length > 0))) {
    issues.push("二级目录下技术章节的节节点不应再有三级子节点")
  }
  if (level === 3) {
    if (techNodes.some((n) => (n.children ?? []).length === 0)) issues.push("三级目录下每个技术章都必须有节")
    if (techNodes.some((n) => (n.children ?? []).some((s) => (s.children ?? []).length === 0))) {
      issues.push("三级目录下技术章的每个节都必须有至少 1 个条级节点")
    }
  }
  const leaves = outlineLeafCount(techNodes)
  if (leafTarget > 0) {
    const lo = Math.floor(leafTarget * 0.6)
    const hi = Math.ceil(leafTarget * 1.4)
    if (leaves < lo || leaves > hi) {
      issues.push(`技术部分叶子节点共 ${leaves} 个，偏离目标规模 ${leafTarget}（允许 ${lo}-${hi} 个，商务章不计入）`)
    }
  }
  return issues
}

/** 目标页数留空时：按招标文件文本体量估算（字数/500 向上取整，最少 10 页） */
export function estimatePagesFromText(text: string): number {
  const chars = (text ?? "").replace(/\s/g, "").length
  return Math.max(10, Math.ceil(chars / 500))
}

/** 第十轮修复 3：字数 → 页数换算（约 500 字/页，至少 1 页），生成后治理与页面信息条共用 */
export function estimatePagesFromChars(chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) / 500))
}

/**
 * 第十轮修复 3：超预算裁剪——text 不超 capChars 原样返回 {trimmed:false}；
 * 超出时在 cap 之前最后一个 "\n\n"（退而 "\n"）段落边界截断，都没有则硬切，返回 {text,trimmed:true}。
 */
export function trimToBudget(text: string, capChars: number): { text: string; trimmed: boolean } {
  const src = text ?? ""
  const cap = Math.max(0, Math.round(capChars))
  if (src.length <= cap) return { text: src, trimmed: false }
  const window = src.slice(0, cap)
  let cut = window.lastIndexOf("\n\n")
  if (cut <= 0) cut = window.lastIndexOf("\n") // 无段落边界退回单换行
  if (cut <= 0) cut = cap // 都没有则硬切
  return { text: src.slice(0, cut).trimEnd(), trimmed: true }
}

/**
 * 标书第十五轮改造 4：按 section_stats 把章正文确定性切片回各小节片段。
 * 切片依据：各片 chars + "\n\n" 2 字符连接符（与小节串行生成的拼接规则一致）。
 * 边界处理：
 * - 首片从位置 0 起切；chars=0 的片（生成时未产出、未进正文）返回空串且不消费连接符；
 * - 末片（最后一个 chars>0 的片）吸收到正文末尾——续写补足 / 字数治理的增量都并在这里；
 * - 正文被裁剪短于统计总和时按实际长度截断切片，缺失部分为空串，不抛错。
 */
export function sliceSectionPieces(content: string, stats: { title: string; chars: number }[]): string[] {
  const src = content ?? ""
  const list = stats ?? []
  let lastNonEmpty = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i]?.chars ?? 0) > 0) {
      lastNonEmpty = i
      break
    }
  }
  const pieces: string[] = []
  let pos = 0
  for (let i = 0; i < list.length; i++) {
    const len = Math.max(0, Math.round(list[i]?.chars ?? 0))
    if (len <= 0) {
      pieces.push("")
      continue
    }
    const end = i === lastNonEmpty ? src.length : Math.min(pos + len, src.length)
    pieces.push(src.slice(pos, end))
    pos = end
    if (i !== lastNonEmpty && src.startsWith("\n\n", pos)) pos += 2
  }
  return pieces
}

/** 标书第十五轮改造 4：切片替换某小节后重组正文（空片不占连接符，与串行生成跳过空片的拼接一致） */
export function rebuildSectionContent(pieces: string[]): string {
  return (pieces ?? []).filter((p) => p.length > 0).join("\n\n")
}

/**
 * 整份目标页数按章节权重（小节数 + 标题关键词）折算每章字数预算（约 500 字/页）；页数不设上限（1-9999 防呆）。
 * 第十三轮改造 4：商务骨架章不占预算不计字数（预算恒 0，权重不参与分配），预算全部分给技术章。
 */
export function chapterWordBudgets(chapters: { title: string; sections?: string[]; part?: string }[], targetPages: number): number[] {
  const pages = Math.max(1, Math.min(9999, Math.round(targetPages) || 1))
  const total = pages * 500
  const weights = chapters.map((c) => {
    if (isBizPart(c)) return 0
    const leaves = (c.sections ?? []).length
    const bonus = /方案|设计|实施|建设|技术|系统/.test(c.title) ? 2 : 0
    return 1 + leaves + bonus
  })
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  return weights.map((w) => (w <= 0 ? 0 : Math.max(400, Math.round((total * w) / sum))))
}

// ------------------------------ Prompt 构造 ------------------------------

export const MAX_TENDER_CHARS = 14000
const MAX_BID_CHARS = 12000

export function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n（后文因篇幅截断）` : text
}

// ---------------------------------------------------------------------------
// 第八轮改造：分段解析 / 原文检索注入 / 小节级生成
// ---------------------------------------------------------------------------

/**
 * 改造 1：超长招标文件分段——按段落边界（\n）切块，每块约 chunkSize 字，
 * 块间保留约 overlap 字重叠防止跨块信息断裂；单段超长（无换行）时硬切。
 * 文本不超 chunkSize 时返回单块（与现状单次调用行为一致）。
 */
export function chunkTenderText(text: string, chunkSize = 12000, overlap = 800): string[] {
  const src = (text ?? "").trim()
  if (!src) return []
  if (src.length <= chunkSize) return [src]
  // 段落列表：超长段落先硬切成 ≤chunkSize 的片段，再按字数累计成块
  const paras: string[] = []
  for (const rawPara of src.split("\n")) {
    const p = rawPara.trim()
    if (!p) continue
    if (p.length <= chunkSize) paras.push(p)
    else for (let i = 0; i < p.length; i += chunkSize) paras.push(p.slice(i, i + chunkSize))
  }
  const chunks: string[] = []
  let start = 0
  while (start < paras.length) {
    let end = start
    let len = 0
    while (end < paras.length && len + paras[end].length + 1 <= chunkSize) {
      len += paras[end].length + 1
      end += 1
    }
    if (end === start) end = start + 1 // 兜底推进，防死循环
    chunks.push(paras.slice(start, end).join("\n"))
    if (end >= paras.length) break
    // 从块尾回退约 overlap 字（对齐段落边界）作为下一块起点
    let next = end
    let back = 0
    while (next - 1 > start && back + paras[next - 1].length + 1 <= overlap) {
      next -= 1
      back += paras[next].length + 1
    }
    if (next >= end) next = end - 1 // 末段本身超过 overlap 时至少重叠一个段落
    start = Math.max(next, start + 1)
  }
  return chunks
}

/**
 * 改造 1：多块解析结果本地合并——同一 key 的多块文本按块序拼接 + 行级去重
 * （normalize 空白后相同行只留一次，重叠区自然去重），不做 AI 二次合并。
 * 用户反馈轮项 1：精确去重后统一过 cleanParseSectionContent（字段名归一去重 + 脏值黑名单 + 未明确行归并末尾一行）。
 */
export function mergeChunkReports(reports: ParseReport[], keys: string[], scope: ParseScope): ParseReport {
  const sections: ParseSection[] = keys.map((key) => {
    const parts = reports
      .map((r) => r.sections.find((s) => s.key === key)?.content ?? "")
      .filter((t) => t.trim())
    const seen = new Set<string>()
    const lines: string[] = []
    for (const line of parts.join("\n").split("\n")) {
      const t = line.trim()
      if (!t) continue
      const norm = t.replace(/\s+/g, "")
      if (seen.has(norm)) continue
      seen.add(norm)
      lines.push(t)
    }
    const content = cleanParseSectionContent(lines.join("\n"))
    return {
      key,
      title: parseSectionTitle(key),
      content,
      status: content.trim() ? ("ok" as ParseSectionStatus) : ("pending" as ParseSectionStatus),
      snippet: makeSnippet(content),
      human_edited: false,
    }
  })
  // 用户反馈轮：多块合并后跨 section 去重（同一条信息只留在首个出现的项）
  return dedupeAcrossSections({ scope, sections })
}

/** 改造 3：从章节正文提取已写小节标题行（「N.M 小节名」格式），续写/小节生成防重复用 */
export function writtenSectionTitles(content: string): string[] {
  const out: string[] = []
  for (const line of (content ?? "").split("\n")) {
    const t = line.trim()
    if (/^\d+\.\d+(\.\d+)?[\s、.．]*\S/.test(t) && t.length <= 60 && !out.includes(t)) out.push(t)
  }
  return out
}

export type TenderFragmentQuery = {
  /** 章标题 */
  title: string
  /** 小节名（小节级生成时只传当前小节，更聚焦） */
  sections: string[]
  /** 归到本章/本小节的招标要求条款文本 */
  clauses: string[]
}

const RETRIEVE_MIN_SCORE = 0.35

/**
 * 改造 2：招标原文片段检索（纯本地零 AI）——把 tender_text 按段落切分，
 * 对每段用 bigramOverlap 与查询词（章标题、小节名、条款文本）计算相关度，
 * 取 top 段落按原文顺序拼接至 maxChars；全部低于阈值或原文为空时返回空串（调用方静默降级）。
 * 第十三轮改造 3：maxParas 可调（素材优先注入开关开启时数量/字数上限约翻倍）。
 */
export function retrieveTenderFragments(tenderText: string, query: TenderFragmentQuery, maxChars = 4000, maxParas = 12): string {
  const text = (tenderText ?? "").trim()
  if (!text) return ""
  const keywords = [query.title, ...(query.sections ?? []), ...(query.clauses ?? [])]
    .map((k) => (k ?? "").trim())
    .filter((k) => k.length >= 2)
  if (!keywords.length) return ""
  const paras = splitParagraphs(text, 40, 2000)
  const scored = paras
    .map((p, i) => {
      let best = 0
      let hits = 0
      for (const k of keywords) {
        const w = bigramOverlap(k, p)
        if (w > best) best = w
        if (w >= 0.5) hits += 1
      }
      return { i, p, score: best + hits * 0.15 }
    })
    .filter((x) => x.score >= RETRIEVE_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.i - b.i)
  if (!scored.length) return ""
  const picked: { i: number; p: string }[] = []
  let total = 0
  for (const x of scored) {
    if (picked.length >= maxParas) break
    if (total + x.p.length > maxChars) continue
    picked.push({ i: x.i, p: x.p })
    total += x.p.length + 2
  }
  picked.sort((a, b) => a.i - b.i)
  return picked.map((x) => x.p).join("\n\n")
}

// ---------------------------------------------------------------------------
// 第十七轮 17D：范本与资料分离——历史范本目录结构本地抽取（纯本地零 AI）
// ---------------------------------------------------------------------------

/** 范本标题行模式：中文数字 / 阿拉伯数字 / 点号编号开头，标题主体 2-40 字的行 */
const TEMPLATE_HEADING_RE = /^[一二三四五六七八九十0-9\.、]+[、\.]?.{2,40}$/

/**
 * 第十七轮 17D：从历史标书范本全文抽取目录结构标题行（零 AI）——
 * 逐行用标题行模式匹配，去掉前导编号后仅保留标题本体，去重后最多 limit 行；
 * 文本为空或无命中返回空数组（调用方静默不注入，老项目行为不变）。
 */
export function extractTemplateOutlineLines(templateText: string, limit = 80): string[] {
  const text = (templateText ?? "").trim()
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split(/\n+/)) {
    if (out.length >= limit) break
    const line = rawLine.replace(/\s+/g, "").trim()
    if (!line || !TEMPLATE_HEADING_RE.test(line)) continue
    // 去掉前导编号（中文数字 / 阿拉伯数字 / 点号 / 顿号），只留标题本体
    const title = line.replace(/^[一二三四五六七八九十0-9\.、]+[、\.]?/, "").trim()
    if (title.length < 2 || title.length > 40 || seen.has(title)) continue
    seen.add(title)
    out.push(title)
  }
  return out
}

// ---------------------------------------------------------------------------
// 第七轮改造：文风硬条款 / 隐式硬约束 / 评分细则归章 / 相邻章摘要
// ---------------------------------------------------------------------------

/** 改造 1：写作风格硬条款——章节生成 / 续写 / 改写 prompt 统一注入（技能块注入位不受影响） */
export const BID_STYLE_RULES: string[] = [
  "确定性工程用语：禁止「我们建议 / 建议您 / 推荐采用 / 可以考虑」等试探性表述，一律用「本项目采用 / 实施方式为 / 具体措施如下」等确定性表述；",
  "反 AI 腔：语言正式规范但必须落地可执行，禁止堆砌奇怪连接词（首先其次再次最后连环套、总而言之），禁止宣传腔假大空（赋能、抓手、闭环堆词）；",
  "元话语禁令：禁止「待补充 / TODO / 需人工确认 / AI 生成 / 占位」等元话语进入正文（约定的占位值【待填写】除外）；",
  "排版惯例：禁止装饰符号（【】★◆■●✓✅→←等，勾选与指向用文字表达），禁止 Markdown 标题、斜体、加粗符号，小节标题用「N.M 名称」纯文本行；",
  "防编造占位：事实表里没有的具体值（金额 / 日期 / 人员 / 证书编号等）一律逐字写【待填写】，禁止改写成「待定 / TBD」，禁止编造数值。",
  // 第十六轮 A：同级互补与朴实文风（融合开源标书智能体正文提示词经验）
  "同级互补：只展开本章/本小节标题对应的独特主题，其他章标题已覆盖的内容（如进度计划章写过工期安排，质量保障章不再重写）一律不重复展开，保持内容独特性与互补性；",
  "朴实无华：这是技术方案不是宣传报告，直接陈述结论、参数与措施，不写开场白、不写拔高式总结、不做愿景铺陈；",
]

const IMPLICIT_CONSTRAINT_PATTERN = /(不得超过|不得少于|不低于|至少|必须包含|必须涵盖|视为|总页数|页数不|份数)/

/**
 * 改造 3：从招标文件全文本地抽取「隐式硬约束」（零 AI）——
 * 命中固定句式的行/句取 ≤60 字原文摘录，去重后最多 limit 条。
 */
export function extractImplicitConstraints(tenderText: string, limit = 40): string[] {
  const text = (tenderText ?? "").trim()
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  const lines = text.split(/\n+/)
  for (const rawLine of lines) {
    if (out.length >= limit) break
    for (const piece of rawLine.split(/[。；;]/)) {
      if (out.length >= limit) break
      const s = piece.replace(/\s+/g, "").trim()
      if (s.length < 8) continue
      const m = s.match(IMPLICIT_CONSTRAINT_PATTERN)
      if (!m || m.index === undefined) continue
      const start = Math.max(0, m.index - 15)
      const excerpt = s.slice(start, start + 60)
      if (seen.has(excerpt)) continue
      seen.add(excerpt)
      out.push(excerpt)
    }
  }
  return out
}

/** 改造 1：评分细则按章分配——评分项（含 criteria 评审标准原文）按标题/小节相似度归章，每章 ≤8 项 */
export function assignScoringToChapters(
  scoring: ScoringItem[],
  chapters: { title: string; sections?: string[] }[],
): ScoringItem[][] {
  const per: ScoringItem[][] = chapters.map(() => [])
  if (!scoring.length || !chapters.length) return per
  const MAX_PER_CHAPTER = 8
  for (const item of scoring) {
    if (!item.item.trim()) continue
    const ranked = chapters
      .map((c, i) => ({
        i,
        score: Math.max(
          commonSubstringLen(item.item, c.title),
          ...(c.sections ?? []).map((s) => commonSubstringLen(item.item, s)),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score)
    const hit = ranked.find((r) => r.score >= 4 && per[r.i].length < MAX_PER_CHAPTER)
    const fallback =
      ranked.find((r) => /方案|设计|实施|技术|服务|售后|培训|质量|保障/.test(chapters[r.i].title) && per[r.i].length < MAX_PER_CHAPTER) ??
      ranked.find((r) => per[r.i].length < MAX_PER_CHAPTER)
    const target = hit ?? fallback
    if (target) per[target.i].push(item)
  }
  return per
}

/** 评分细则的 prompt 行格式（项名 + 分值 + 评审标准原文） */
export function scoringDetailLines(scoring: ScoringItem[]): string {
  return scoring
    .map((s) => `- ${s.item}（${s.score} 分）：${s.criteria.trim() || "（评审标准细则未解析，按本章内容写出可得分的实质性响应）"}`)
    .join("\n")
}

/** 改造 1：相邻章上下文——取已生成的第 N-2、N-1 章「标题 + 前 300 字摘要」（旧→新序） */
export function prevChapterSummaries(chapters: Chapter[], idx: number, max = 300): { title: string; summary: string }[] {
  const out: { title: string; summary: string }[] = []
  for (const j of [idx - 2, idx - 1]) {
    const c = chapters[j]
    if (j < 0 || !c || !(c.content ?? "").trim()) continue
    out.push({
      title: `第${j + 1}章 ${c.title}`,
      summary: c.content.replace(/\s+/g, " ").trim().slice(0, max),
    })
  }
  return out
}

/** 解析 prompt 按勾选范围裁剪：只要求输出 requestedKeys 对应的 JSON 键；onlyKeys 用于单项重解析 */
export function buildTenderParseMessages(tenderText: string, cfg: ParseConfig, onlyKeys?: string[]): LlmMessage[] {
  const keys = onlyKeys && onlyKeys.length ? onlyKeys : requestedKeys(cfg)
  const specLines = keys
    .map((k) => {
      const d = parseSectionDef(k)
      return `- "${k}"（${d?.title ?? k}）：${d?.guide ?? ""}`
    })
    .join("\n")
  const system = [
    "你是一位深耕医疗信息化行业招投标十余年的资深标书专家，长期为医院 HIS、EMR、LIS、PACS、集成平台、数据中心、互联网医院等项目做投标决策与标书评审，熟悉《政府采购法》《招标投标法》及各地公共资源交易中心的评标规则。",
    "当前任务：从招标文件全文中提取结构化要点，供投标团队快速决策与编制投标文件。",
    `本次只输出以下解析项（未列出的项一律不要输出）：\n${specLines}`,
    "提取铁律：以招标文件原文为准，禁止编造；某项内容找不到时省略对应行；每项内容为纯文本多行，行内不使用 markdown 符号；",
    "要点化铁律（2026-09-16 用户要求只提重点）：每项内容必须是【要点清单】——一行一条要点，每条直接给出硬指标或结论（金额/限价/工期/天数/份数/比例/资质证照名称/标准等级/系统名称/人员数量），形如「预算金额：3500 万元」「免费质保期：验收合格起 5 年」「核心系统上线：开工通知后 30 日历天内」；",
    "禁止整段抄原文、禁止复述章节标题、禁止「本项目旨在…」式铺垫句；描述性内容（背景/技术特点/实施范围）压缩为「主题词：核心短语」式要点（如「一体化管理：两院系统兼容、数据统一」「信创适配：国产服务器/操作系统/数据库」）；单条要点 ≤60 字，每项 ≤25 条，宁缺毋滥；",
    "分块解析铁律：分段解析时，非首段只输出本段新出现的关键字段；已在首段或标题中可确定的字段禁止重复输出；本段找不到的字段直接省略对应行，禁止输出「未明确/未提及」类说明行（缺失汇总由系统统一生成）；",
    "输出严格 JSON，键为上述解析项 key，值为多行纯文本（换行用 \\n），禁止解释文字、禁止 markdown 代码围栏，格式示例：",
    `{${keys.map((k) => `"${k}": "……"`).join(", ")}}`,
  ].join("\n")
  const user = `【招标文件全文】\n${clipText(tenderText, MAX_TENDER_CHARS)}`
  // 第十六轮 A：多消息缓存序——全文稳定块独立成第一条 user，解析项任务差异置后
  return [
    { role: "system", content: system },
    { role: "user", content: user },
    { role: "user", content: "请按上述解析项提取并输出 JSON。" },
  ]
}

/** 大纲生成：注入评分办法 / 响应要求 / 商务条款 + 招标要求条款清单 + 全局事实表；级数与叶子规模（leafTarget ±20%）作硬约束 */
export function buildBidOutlineMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  fromDraft: boolean,
  level: 0 | 1 | 2 | 3,
  clauses?: RequirementClause[],
  opts?: {
    leafTarget?: number
    sectionWords?: number
    globalFacts?: string
    implicitConstraints?: string[]
    /** 第十七轮 17D：历史范本目录结构标题行（本地抽取产物；空数组/缺省=不注入，行为同现状） */
    refTemplateOutline?: string[]
    /** 用户反馈轮项 3：是否输出商务标骨架章（缺省 true；false 时商务段整体替换为「不输出任何商务章节」） */
    includeBiz?: boolean
  },
): LlmMessage[] {
  const includeBiz = opts?.includeBiz !== false
  const scoringText = combinedScoringText(report)
  const bizText = sectionText(report, "biz_score")
  const respText = sectionText(report, "response_req")
  const techText = sectionText(report, "delivery_req")
  const qualText = sectionText(report, "qualification")
  // 第十二轮遗留清偿：大纲编制接入 ★/▲ 重点条款（本地扫描产物，零新增 AI 调用）
  const starText = sectionText(report, STAR_CLAUSE_SECTION.key).trim()
  // 第十七轮 17A：招标规定的投标文件目录（既有解析项产物，零新增 AI 调用）
  const outlineReqText = sectionText(report, BID_OUTLINE_REQ_KEY).trim()
  // 循环 2 批 2-3：商务骨架章编排依据三段（解析项产物本地注入，零新增 AI 调用；旧 key 报告经别名兜底）
  const keyNodesText = sectionTextAny(report, ["bid_nodes", "key_nodes"]).trim()
  const depositText = sectionTextAny(report, ["bid_deposit", "bid_bond"]).trim()
  const contractText = [
    sectionTextAny(report, ["contract_terms"]),
    sectionTextAny(report, ["contract_award"]),
    sectionTextAny(report, ["contract_end"]),
  ]
    .filter((s) => s.trim())
    .join("\n")
    .trim()
  const clauseList = clauses ?? []
  const leafTarget = Math.max(0, Math.round(opts?.leafTarget ?? 0))
  const sectionWords = Math.min(2000, Math.max(400, Math.round(opts?.sectionWords ?? 800)))
  const leafLo = Math.max(1, Math.ceil(leafTarget * 0.8))
  const leafHi = Math.max(leafLo, Math.floor(leafTarget * 1.2))
  const implicitList = opts?.implicitConstraints ?? []
  const depthRule =
    level === 0
      ? "不预设目录级数：由你按招标文件评分办法与章节要求自行决定技术部分合理级数（最多三级），保证评分办法每一档都有章节落点（级数约束只针对技术章，商务骨架章固定为章+一级小节两级）。"
      : level === 1
        ? "级数硬约束（只按技术章计算）：技术章只有一级（章），技术章 children 一律为空数组，禁止出现二级或三级节点；商务骨架章可保留其一级小节。"
        : level === 2
          ? "级数硬约束（只按技术章计算）：技术章恰好两级（章—节），每个技术章下必须有节，节节点的 children 一律为空数组，禁止出现三级节点；商务骨架章固定为章+一级小节。"
          : "级数硬约束（只按技术章计算）：技术章恰好三级（章—节—条），每个技术章下必须有节，每节下必须至少有 1 个条级节点，条节点的 children 为空数组；商务骨架章仍只列一级小节、不展开三级。"
  const numbered: string[] = includeBiz
    ? [
        "大纲顶层章分「商务部分」与「技术部分」两组：商务章在前、技术章在后，每个顶层章对象必须带 part 字段标明归属（\"biz\"=商务章、\"tech\"=技术章），深层节点不带 part；",
        "商务部分输出 6-10 个骨架章（part=\"biz\"）：投标函及报价、法定代表人授权、资质与证照证明、财务审计报告、同类项目业绩、商务条款响应/偏离表、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删，下面给出【投标保证金】【合同关键条款】时商务部分还须有对应骨架章落点（保证金缴纳与退还、合同条款响应、质保衔接等）；商务章 children 只列一级小节名即可（不展开三级），这些章的正文由投标人线下填写、不生成正文；",
      ]
    : [
        "大纲顶层章全部为技术部分：每个顶层章对象必须带 part 字段（一律 \"tech\"），深层节点不带 part；",
        "本次不输出任何商务部分章节（part=\"biz\"），大纲仅含技术标章节；投标函、资质证照、商务偏离表等商务内容由投标人线下自行处理，禁止为其安排任何章节；",
      ]
  numbered.push(
    "技术部分（part=\"tech\"）为详细响应骨架，必须以评分办法为纲：逐条覆盖下面技术评分的评分点，每个重要评分项都要落到具体章或节标题；",
    "响应文件要求须逐条落实（组成、格式、签字盖章与装订要求对应专门章节或节）；",
    "技术部分常规骨架参考：项目理解与需求分析、总体建设方案、详细技术方案（按系统分章）、项目实施组织与进度计划、质量保障与测试验收、培训方案、售后服务与运维保障、应急预案；再按本招标文件增删；",
    "标题只写名称、不带编号、不以标点结尾；层级命名规范：一级=部分/章，二级=节，三级=条；",
    "节/条标题必须用具体响应式命名：主题词+落点词（设计/范围/保障/机制/流程等），形如「设备兼容性设计」「多模态数据处理范围」「知识更新机制」；禁止「概述/说明/介绍/相关内容/其他」式空泛标题；",
  )
  // 第十七轮 17A：招标已规定响应目录时，章结构遵循其顺序与层级（置于硬性要求前列）
  if (outlineReqText) {
    numbered.splice(
      1,
      0,
      `招标已规定响应目录（见下面【招标文件规定的投标文件目录】）：大纲章结构必须遵循其顺序与层级，禁止另起炉灶；标题文字可润色补全，规定目录未覆盖的内容可在末尾补充章节${
        includeBiz ? "，商务骨架章（part=\"biz\"）仍置于最前" : ""
      }；`,
    )
  }
  if (leafTarget > 0) {
    numbered.push(
      level > 0
        ? `规模硬要求（只按技术章计算，商务章叶子不计入）：技术部分叶子节点（无子节点的末端节点）总数必须落在 ${leafLo}-${leafHi} 个区间（目标 ${leafTarget} 个），每个叶子节点将承载约 ${sectionWords} 字正文，技术章的数量要与该规模匹配（不再局限 8-12 章）；不足时按系统/模块/阶段/保障维度拆章节拆小节补足叶子，超出时合并相近叶子；`
        : `规模参考（只按技术章计算）：整份文档体量反推的技术部分目标叶子节点数约 ${leafTarget} 个（每叶子承载约 ${sectionWords} 字），技术章叶子总数尽量落在 ${leafLo}-${leafHi} 个区间，级数仍由你按招标要求自定；`,
    )
  }
  if (implicitList.length) {
    numbered.push(
      `下面【招标隐式硬约束】共 ${implicitList.length} 条（如页数 / 份数 / 装订 / 格式等刚性要求），任何一条被违反都可能废标，大纲必须保证每条约束都有对应章节落点；`,
    )
  }
  if (starText) {
    numbered.push(
      "下面【★/▲ 重点条款】为招标文件带标记的实质性响应条款，任何一条未响应都可能直接废标：大纲必须让每条重点条款都有明确章节落点（如资质与证照证明、项目经理资历、售后服务承诺、技术需求逐条应答、原厂授权等对应专门章节或节），禁止只靠通用章节笼统带过；",
    )
  }
  if (clauseList.length) {
    numbered.push(
      `下面【招标要求条款清单】共 ${clauseList.length} 条，每条条款必须至少对应一个技术章（part="tech"）下的大纲叶子节点（无子节点的章/节/条），对应叶子节点的标题须包含该条款的核心词，禁止遗漏任何条款；商务骨架章不承担条款覆盖，coverage 的落点一律填技术章的叶子标题；`,
      '输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（顶层章必须带 part 字段；coverage 逐条给出条款在技术章里的落点叶子标题，clause_id 与清单一致）：{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[{"title":"节标题","children":[{"title":"条标题","children":[]}]}]}],"coverage":[{"clause_id":"c1","node_title":"对应叶子节点标题"}]}',
    )
  } else {
    numbered.push(
      '输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（顶层章必须带 part 字段）：{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[{"title":"节标题","children":[{"title":"条标题","children":[]}]}]}]}',
    )
  }
  const rules = [
    "你是一位深耕医疗信息化行业十余年的资深投标顾问，擅长按评分办法组织技术标结构，确保每一分都有对应响应章节。",
    `当前任务：为投标项目「${projectName}」（采购人：${hospital || "未填写"}）生成投标文件响应大纲${
      includeBiz ? "（商务部分骨架 + 技术部分详细大纲）" : "（仅技术部分详细大纲，不含任何商务章节）"
    }，${depthRule}`,
    fromDraft ? "本次在已有方案底稿基础上按招标文件要求调整结构，保留底稿中仍然适用的章节。" : "",
    "硬性要求：",
    ...numbered.map((t, i) => `${i + 1}. ${t}`),
  ]
  const system = rules.filter((x) => x !== "").join("\n")
  // 第十六轮 A：多消息缓存序——项目级稳定块前置（同项目多次重生成 identical），任务差异置后
  const stableParts = [
    `【技术评分办法（逐项分值）】\n${scoringText || "（未解析到技术评分）"}`,
    // 用户反馈轮项 3：不含商务章时商务评分办法与三段商务编排依据不再注入（避免误导模型输出商务章）
    ...(includeBiz ? [`【商务评分办法】\n${bizText || "（未解析到商务评分）"}`] : []),
    `【技术方案与响应要求】\n${[respText, techText].filter((s) => s.trim()).join("\n") || "（未解析到响应要求）"}`,
    `【资质要求】\n${qualText || "（无）"}`,
  ]
  // 循环 2 批 2-3：投标关键节点 / 投标保证金 / 合同关键条款三段（非空才注入，商务骨架章编排依据）
  if (includeBiz && keyNodesText) {
    stableParts.push(`【投标关键节点（商务骨架章编排依据，全文时间口径必须与之一致）】\n${clipText(keyNodesText, 2000)}`)
  }
  if (includeBiz && depositText) {
    stableParts.push(`【投标保证金（商务骨架章编排依据）】\n${clipText(depositText, 1500)}`)
  }
  if (includeBiz && contractText) {
    stableParts.push(`【合同关键条款（商务骨架章编排依据）】\n${clipText(contractText, 3000)}`)
  }
  if (opts?.globalFacts) stableParts.push(opts.globalFacts)
  if (implicitList.length) {
    stableParts.push(
      `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  if (starText) {
    stableParts.push(`【★/▲ 重点条款（实质性响应条款，大纲每条必须有章节落点）】\n${clipText(starText, 6000)}`)
  }
  // 第十七轮 17A：招标规定的投标文件目录（截断 4000 字，项目级稳定块，缓存序不变）
  if (outlineReqText) {
    stableParts.push(`【招标文件规定的投标文件目录（章结构必须遵循其顺序与层级）】\n${clipText(outlineReqText, 4000)}`)
  }
  // 第十七轮 17D：历史范本目录结构（本地抽取标题行，零 AI）——只参考章法与章节粒度，不照抄标题
  const refOutlineLines = (opts?.refTemplateOutline ?? []).slice(0, 80)
  if (refOutlineLines.length) {
    stableParts.push(
      `【历史范本目录结构（参考其章法与章节粒度，不照抄标题）】\n${refOutlineLines.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  const taskParts: string[] = []
  if (clauseList.length) {
    taskParts.push(
      `【招标要求条款清单（每条必须落到叶子节点并写进 coverage）】\n${clauseList.map((c) => `${c.id}. [${c.source}] ${c.text}`).join("\n")}`,
    )
  }
  taskParts.push(
    level === 0
      ? "请生成这份投标文件的响应大纲 JSON（商务部分骨架章在前、技术部分详细章在后，顶层章带 part 字段；技术部分级数按上述要求自行决定）。"
      : `请生成这份投标文件的 ${level} 级响应大纲 JSON（商务部分骨架章在前、技术部分详细章在后，顶层章带 part 字段；技术部分级数与叶子规模必须同时满足上述硬约束）。`,
  )
  return [
    { role: "system", content: system },
    { role: "user", content: stableParts.join("\n\n") },
    { role: "user", content: taskParts.join("\n\n") },
  ]
}

/** 第五轮改造 2：大纲本地校验不符时的一次「结构修复」调用（费用含在同一次生成确认内）；第十三轮：修复契约带 part，叶子规模只按技术章计算 */
export function buildOutlineFixMessages(
  nodes: OutlineNode[],
  level: 0 | 1 | 2 | 3,
  leafTarget: number,
  sectionWords: number,
  issues: string[],
): LlmMessage[] {
  const slim = (list: OutlineNode[], depth = 1): unknown =>
    list.map((n) => ({
      title: n.title,
      ...(depth === 1 ? { part: isBizPart(n) ? "biz" : "tech" } : {}),
      children: slim(n.children ?? [], depth + 1),
    }))
  const leafLo = Math.max(1, Math.ceil(leafTarget * 0.8))
  const leafHi = Math.max(leafLo, Math.floor(leafTarget * 1.2))
  const structureRule =
    level === 1
      ? "目标结构为一级（只按技术章计算）：技术章只保留章节点、children 为空数组；商务骨架章（part=\"biz\"）保留其一级小节。"
      : level === 2
        ? "目标结构为两级（只按技术章计算）：每个技术章下有节，节节点的 children 一律为空数组；商务骨架章固定为章+一级小节。"
        : level === 3
          ? "目标结构为三级（只按技术章计算）：每个技术章下有节，每节下至少 1 个条级节点，条节点的 children 为空数组；商务骨架章仍只列一级小节。"
          : "保持层级合理（最多三级），不强行增删级数；商务骨架章保持章+一级小节。"
  const system = [
    "你是资深投标顾问，负责修复投标文件响应大纲（商务部分骨架 + 技术部分详细大纲）的结构。给你现有大纲 JSON 与结构问题清单，请输出修复后的完整大纲 JSON。",
    "修复规则：",
    `1. 逐条解决结构问题：${issues.join("；")}；`,
    `2. ${structureRule}`,
    "3. 顶层章必须保留 part 字段（\"biz\"=商务骨架章、\"tech\"=技术章），商务章在前、技术章在后，禁止改变章的归属；",
    `4. 技术章叶子节点（无子节点的末端节点，商务章叶子不计入）总数必须落在 ${leafLo}-${leafHi} 个区间（目标 ${leafTarget} 个，每叶子承载约 ${sectionWords} 字正文）：不足时按系统/模块/阶段/保障维度合理拆分补足叶子，超出时合并相近叶子；`,
    "5. 尽量保留现有标题文字与层级归属，只做结构补足、拆分或合并，不重写无关内容；标题只写名称、不带编号、不以标点结尾；节/条标题必须用具体响应式命名（主题词+设计/范围/保障/机制/流程等落点词，形如「设备兼容性设计」「知识更新机制」），现有标题若为「概述/说明/介绍/相关内容/其他」式空泛命名必须改为具体响应式命名；",
    "6. 输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[{"title":"节标题","children":[{"title":"条标题","children":[]}]}]}]}',
  ].join("\n")
  const user = `【现有大纲 JSON】\n${JSON.stringify({ outline: slim(nodes ?? []) })}\n\n请输出修复后的完整大纲 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export type BidChapterPromptOpts = {
  wordBudget: number
  figures: boolean
  /** 本章须逐条响应的招标要求条款（按覆盖映射 + 标题相似度归章） */
  clauses?: RequirementClause[]
  /** 第五轮改造 4：全局事实表文本块（空串=无事实可注入） */
  globalFacts?: string
  /** 第七轮改造 1：分配到本章的评分细则（含评审标准原文），替换旧的全表评分项注入 */
  scoring?: ScoringItem[]
  /** 第七轮改造 1：相邻章上下文（第 N-2、N-1 章标题+前 300 字摘要） */
  prevSummaries?: { title: string; summary: string }[]
  /** 第七轮改造 3：招标隐式硬约束（本地抽取，零 AI） */
  implicitConstraints?: string[]
  /** 第八轮改造 2：招标原文相关段落（本地检索，零 AI；空串=不注入，静默降级） */
  tenderFragments?: string
  /** 第十三轮改造 3：逐条应答强化开关开启时注入的 ★/▲ 重点条款上下文段（空串/缺省=不注入） */
  starBlock?: string
  /** 第十三轮改造 3：素材优先注入开关开启时检索到的知识库素材段（注明来源文档；空串/缺省=不注入） */
  kbMaterial?: string
  /**
   * 第十六轮 B2 改造 2.2：本级（章/节）合并后的预编排结果（缺省=编排缺失或未覆盖本级，
   * 完全走现状 figures_enabled 逻辑；存在时 figure 选中→调用方强制 figures 开、未选中→强制关）
   */
  orchestration?: MergedOrchestration
  /**
   * 第十七轮 17B：编制依据注入——规则句全部章携带（style 决定列示样式）；
   * listText 仅目标章非空（标题匹配 /编制依据|标准|规范/，匹配不到回退首个技术章；
   * 章级判断在调用处做，节级继承章判断）；缺省=无编制依据，行为同现状
   */
  compilationBasis?: CompilationBasisPrompt
  /**
   * 第十七轮 17D：团队写作资料相关段（对 ref_materials_text 本地检索，≤3 段 ≤1200 字；
   * 空串/缺省=未导入资料或检索为空，静默不注入，老项目行为同现状）
   */
  refMaterials?: string
  /**
   * 循环 2 批 1-4：暗标身份脱敏规则条（sealedIdentityBlock 产出；空串/缺省=非暗标不注入，
   * 老项目行为同现状）
   */
  sealedIdentityRules?: string
  /**
   * 循环 2 批 2-1：编排定向事实块（buildDirectedFactsBlock 产出；非空时替代全量 globalFacts 注入，
   * 空串/缺省=保持全量注入，兼容未重编排的老项目）
   */
  directedFacts?: string
}

export function buildBidChapterMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  outline: OutlineNode[],
  chapters: Chapter[],
  chapterIndex: number,
  outlineToText: (nodes: OutlineNode[], prefix?: string) => string,
  opts: BidChapterPromptOpts,
): LlmMessage[] {
  const ch = chapters[chapterIndex]
  const chapterNo = chapterIndex + 1
  const sectionLines = (ch.sections ?? []).map((s, j) => `${chapterNo}.${j + 1} ${s}`).join("\n")
  const scoringDetail = scoringDetailLines(opts.scoring ?? [])
  const techText = sectionText(report, "delivery_req")
    .split(/\n+/)
    .slice(0, 20)
    .join("\n")
  const prevSummaries = opts.prevSummaries ?? []
  const implicitList = opts.implicitConstraints ?? []
  // 循环 2 批 2-1：编排定向事实块非空时替代全量全局事实注入（规则句与素材块同步切换口径）
  const directedOn = Boolean((opts.directedFacts ?? "").trim())
  const factsBlock = directedOn ? (opts.directedFacts ?? "").trim() : (opts.globalFacts ?? "")
  const factsLabel = directedOn ? "本章必守事实" : "全局事实"
  const rules = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，正在编写投标项目「${projectName}」（采购人：${hospital || "未填写"}）技术标的第${chapterNo}章「${ch.title}」。`,
    "写作铁律：",
    "1. 内容必须真实可落地、可直接用于正式投标文件：使用行业规范术语（HIS、EMR、LIS、PACS、集成平台、电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等），杜绝空话套话；",
    "2. 紧扣招标文件的评分办法与技术需求做实质性响应，涉及指标处给出量化承诺（并发用户数、响应时间、可用性 99.9%、驻场人数、到场时限等）；",
    scoringDetail
      ? `3. 本章须逐条响应的评分细则（项名 + 分值 + 评审标准原文）如下，写到对应内容时明确点出响应与承诺，并对齐评审标准中的给分档位：\n${scoringDetail}`
      : "3. 本章未分配到具体评分细则，请围绕招标技术需求写出实质性响应内容；",
    `4. 严格按给定小节组织正文：每个小节标题单独一行，格式「${chapterNo}.1 小节名」，小节下写 2-5 段、每段 3-6 句；`,
    `5. 本章字数预算约 ${opts.wordBudget} 字（整份目标页数按章节权重折算），在该篇幅内围绕招标参数与评分办法扩展；禁止自造招标未给的具体参数数字，拿不准的用「按招标文件要求响应」等规范表述；`,
  ]
  const clauseList = opts.clauses ?? []
  let ruleNo = 6
  if (prevSummaries.length) {
    rules.push(
      `${ruleNo}. 本章首段必须自然承接上一章的收尾内容（见下面【相邻章上下文】），语气与口径保持连贯；相邻章内容仅供语气衔接与避免重复，禁止照抄、复述或改写其中任何具体表述；`,
    )
    ruleNo += 1
  }
  if (implicitList.length) {
    rules.push(
      `${ruleNo}. 下面【招标隐式硬约束】任何一条被违反都可能废标，本章正文涉及相关内容时必须逐条满足；`,
    )
    ruleNo += 1
  }
  if (clauseList.length) {
    rules.push(
      `${ruleNo}. 下面【本章须响应的招标要求条款清单】共 ${clauseList.length} 条，本章正文必须逐条实质性响应：每条条款至少有一段对应内容并给出量化承诺或落地措施，小节标题行可在标题后标注所响应的条款序号（如「${chapterNo}.2 性能保障方案（响应 c3、c7）」），方便评标专家逐条查询；禁止遗漏任何条款、禁止泛泛带过；`,
    )
    ruleNo += 1
  }
  if (factsBlock) {
    rules.push(
      `${ruleNo}. 正文中出现项目名称、招标编号、采购人、预算金额、工期、质保期、地点、时间节点等事实信息时，必须与下面【${factsLabel}】一致，禁止编造不同数值；`,
    )
    ruleNo += 1
  }
  if (opts.tenderFragments) {
    rules.push(
      `${ruleNo}. 本章内容必须优先依据下面【招标原文相关段落】展开：技术参数、指标、配置与服务要求以原文为准，与原文冲突的表述一律以原文为准，禁止脱离原文空写套话；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：逐条应答强化（开关开启才注入，零新增 LLM 调用）
  if (opts.starBlock) {
    rules.push(
      `${ruleNo}. 本章内容须对所涉下面【★/▲ 重点条款】逐条正面应答：涉及到的每一条重点条款都要有明确应答结论（满足/优于），给出落地措施或量化承诺，禁止回避、禁止只写通用套话；与本章无关的条款不必展开；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：素材优先注入（知识库块级检索命中才注入，注明来源文档）
  if (opts.kbMaterial) {
    rules.push(
      `${ruleNo}. 下面【知识库参考素材】是团队沉淀的方案素材（已注明来源文档），可作为本章案例、数据与实施细节的支撑材料融入正文；与招标原文冲突的内容一律以招标原文为准，禁止整段照抄；`,
    )
    ruleNo += 1
  }
  // 第十七轮 17D：团队写作资料注入（检索命中才注入；可引用事实与口径，须注明来源，禁止整段照抄）
  if (opts.refMaterials) {
    rules.push(
      `${ruleNo}. 下面【团队写作资料】是自有的人员、案例、资质与制度材料：本章写到团队配置、同类业绩、资质能力、管理制度等内容时优先引用其中的事实与口径，引用处注明「来自自有资料」；禁止整段照抄，禁止编造资料里没有的人员与业绩；`,
    )
    ruleNo += 1
  }
  // 循环 2 批 1-4：暗标身份脱敏规则条（sealed=true 时注入，零新增 LLM 调用）
  if (opts.sealedIdentityRules) {
    rules.push(`${ruleNo}. ${opts.sealedIdentityRules}`)
    ruleNo += 1
  }
  // 第十七轮 17B：编制依据列示——规则句注入全部章；清单文本仅目标章携带（章级判断在调用处做）
  if (opts.compilationBasis) {
    rules.push(
      `${ruleNo}. 本章涉及编制依据（标准规范/技术依据）时按约定样式列示：${basisStyleRule(opts.compilationBasis.style)}${
        opts.compilationBasis.listText
          ? "；完整依据清单见下面【编制依据与规范清单】，列示时名称与编号必须以清单为准，禁止编造编号"
          : ""
      }；`,
    )
    ruleNo += 1
  }
  rules.push(`${ruleNo}. 写作风格硬条款（每条必须遵守）：`)
  for (const t of BID_STYLE_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  // 第十六轮 B2 改造 2.2：预编排结果注入写作规则（figure 选中时调用方已把 figures 开关强制打开，这里只注入内容约束）
  // 循环 2 批 2-1：写作焦点进规则句；编排图带图注时要求图元素支撑图注
  if (opts.orchestration?.writing_focus) {
    rules.push(
      `${ruleNo}. 本章写作焦点：${opts.orchestration.writing_focus}；正文须围绕该焦点组织重点内容，并对其中点名的评分点给出实质性响应；`,
    )
    ruleNo += 1
  }
  if (opts.orchestration?.figure) {
    const figCaption = (opts.orchestration.figure.caption ?? "").trim()
    rules.push(
      `${ruleNo}. 本章已编排一张${ORCHESTRATION_FIGURE_TYPE_LABEL[opts.orchestration.figure.type]}：《${opts.orchestration.figure.title}》${
        figCaption ? `，图注「${figCaption}」` : ""
      }，figures 数组必须输出该图且内容全部取自本章正文，图名与编排一致${figCaption ? "，图元素必须能支撑图注所述内容" : ""}；`,
    )
    ruleNo += 1
  }
  if (opts.orchestration?.table) {
    rules.push(
      `${ruleNo}. 本章宜含一个表格：${opts.orchestration.table.purpose}（用纯文本表格行表达，遵守排版惯例：每行一行文本、列间用两个全角空格分隔、首行为表头，禁止 markdown 表格符号）；`,
    )
    ruleNo += 1
  }
  if (opts.figures) {
    rules.push(
      `${ruleNo}. 可为本章附 0-2 个结构化配图数据（figures 数组，没有合适图型就输出空数组，不要硬凑）：architecture（架构图）{"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}；flow（流程图）{"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；demo（系统界面示意）{"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}；`,
      `${ruleNo + 1}. 配图内容必须直接取自本章将要撰写的实际内容：architecture 各层 modules 必须是本章正文提到的子系统/功能模块，flow 的 steps 必须是本章撰写的业务环节/操作步骤，demo 的 main 区块与 sidebar 菜单必须是正文出现的功能页面/界面区块，用词与正文一致；严禁「模块A」「步骤1」「系统模块」「功能模块二」等泛化占位词与纯序号命名；`,
      `${ruleNo + 2}. 输出严格 JSON，禁止解释文字、禁止代码围栏，格式：{"content":"本章纯文本正文（禁止 markdown 符号）","figures":[]}`,
    )
  } else {
    rules.push(`${ruleNo}. 直接输出纯文本正文：禁止 markdown 符号（#、*、-、反引号）、禁止输出本章以外内容、禁止开场白与总结语；`)
  }
  const system = rules.join("\n")
  // 第十六轮 A：多消息缓存序——稳定大块（同项目跨章 identical）作第一条 user，
  // 每章差异内容作第二条 user，便于模型服务端命中前缀缓存（稳定上下文前置、任务差异置后）
  const stableUser = [
    `【技术需求与交货服务要求】\n${techText || "（未解析）"}`,
    opts.starBlock ?? "",
    // 循环 2 批 2-1：定向事实启用时全量全局事实不再进稳定块（定向块属章差异内容，进 taskUser 保前缀缓存）
    directedOn ? "" : (opts.globalFacts ?? ""),
    `【全文大纲（仅供保持上下文一致，不要复述）】\n${outlineToText(outline ?? [])}`,
    implicitList.length
      ? `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  const taskUser = [
    factsBlock && directedOn ? factsBlock : "",
    opts.tenderFragments
      ? `【招标原文相关段落（本章写作的首要依据，参数、指标、要求以原文为准）】\n${opts.tenderFragments}`
      : "",
    opts.kbMaterial ? `【知识库参考素材（团队沉淀，注明来源文档，可融入本章支撑细节）】\n${opts.kbMaterial}` : "",
    // 第十七轮 17D：团队写作资料段（章差异内容进 taskUser，stableUser 跨章 identical 保前缀缓存）
    opts.refMaterials
      ? `【团队写作资料（自有人员/案例/资质/制度，可引用其事实与口径，注明来自自有资料，禁止整段照抄）】\n${opts.refMaterials}`
      : "",
    // 第十七轮 17B：清单文本仅目标章注入（stableUser 跨章 identical 保前缀缓存，章差异内容一律进 taskUser）
    opts.compilationBasis?.listText
      ? `【编制依据与规范清单（本章列示编制依据时以此为准，禁止编造编号）】\n${opts.compilationBasis.listText}`
      : "",
    prevSummaries.length
      ? `【相邻章上下文（仅供语气衔接与避免重复，禁止照抄其内容）】\n${prevSummaries.map((s) => `${s.title}\n${s.summary}`).join("\n\n")}`
      : "",
    `【当前要编写的章节】第${chapterNo}章 ${ch.title}`,
    sectionLines ? `本章小节：\n${sectionLines}` : "本章无预设小节，请按内容逻辑自行组织 2-4 个小节。",
    clauseList.length
      ? `【本章须响应的招标要求条款清单（逐条成段响应）】\n${clauseList.map((c) => `${c.id}. ${c.text}`).join("\n")}`
      : "",
    opts.figures ? "请编写本章完整正文并按约定格式输出 JSON（content 正文 + 可选 figures）。" : "请编写本章完整正文。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: stableUser },
    { role: "user", content: taskUser },
  ]
}

export type BidSectionPromptOpts = BidChapterPromptOpts & {
  /** 当前小节名（不含编号的纯标题） */
  sectionName: string
  /** 小节编号前缀，如「3.2」 */
  sectionNo: string
  /** 当前小节在本章内的序号（0 起） */
  sectionIndex: number
  /** 本章小节总数 */
  sectionCount: number
  /** 归到本小节的招标要求条款（章级条款的子集） */
  sectionClauses?: RequirementClause[]
  /** 本章已写小节标题清单（防重复主题） */
  writtenTitles?: string[]
  /** 已写小节内容末尾（≤600 字，仅供衔接） */
  writtenTail?: string
}

/**
 * 第八轮改造 3：小节级生成 prompt——复用章节 prompt 的全部素材块
 * （评分细则/条款/全局事实/隐式硬约束/文风硬条款/招标原文片段），
 * 但只写当前小节：注入本章小节清单与已写小节末尾保证衔接，
 * 要求输出以「N.M 小节名」标题行开头的纯文本（不带配图 JSON）。
 */
export function buildBidSectionMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  outline: OutlineNode[],
  chapters: Chapter[],
  chapterIndex: number,
  outlineToText: (nodes: OutlineNode[], prefix?: string) => string,
  opts: BidSectionPromptOpts,
): LlmMessage[] {
  const ch = chapters[chapterIndex]
  const chapterNo = chapterIndex + 1
  const scoringDetail = scoringDetailLines(opts.scoring ?? [])
  const techText = sectionText(report, "delivery_req")
    .split(/\n+/)
    .slice(0, 20)
    .join("\n")
  const prevSummaries = opts.prevSummaries ?? []
  const implicitList = opts.implicitConstraints ?? []
  const clauseList = opts.clauses ?? []
  const sectionClauses = opts.sectionClauses ?? []
  const writtenTitles = opts.writtenTitles ?? []
  // 循环 2 批 2-1：编排定向事实块非空时替代全量全局事实注入（与章级 builder 同口径）
  const directedOn = Boolean((opts.directedFacts ?? "").trim())
  const factsBlock = directedOn ? (opts.directedFacts ?? "").trim() : (opts.globalFacts ?? "")
  const factsLabel = directedOn ? "本章必守事实" : "全局事实"
  const sectionList = (ch.sections ?? [])
    .map((s, j) => `${chapterNo}.${j + 1} ${s}${j === opts.sectionIndex ? "（当前要写的小节）" : ""}`)
    .join("\n")
  const rules = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，正在编写投标项目「${projectName}」（采购人：${hospital || "未填写"}）技术标第${chapterNo}章「${ch.title}」的第 ${opts.sectionIndex + 1} 个小节「${opts.sectionNo} ${opts.sectionName}」（本章共 ${opts.sectionCount} 个小节，本次只写这一个小节）。`,
    "写作铁律：",
    `1. 只写本小节内容：输出第一行必须是小节标题行「${opts.sectionNo} ${opts.sectionName}」（纯文本行，不带任何编号外的符号），随后直接写正文段落（3-8 段、每段 3-6 句）；不要写本章其他小节、不要输出章标题、不要开场白与收尾总结；`,
    "2. 内容必须真实可落地、可直接用于正式投标文件：使用行业规范术语（HIS、EMR、LIS、PACS、集成平台、电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等），杜绝空话套话；",
    "3. 紧扣招标文件的评分办法与技术需求做实质性响应，涉及指标处给出量化承诺（并发用户数、响应时间、可用性 99.9%、驻场人数、到场时限等）；",
    scoringDetail
      ? `4. 本章须逐条响应的评分细则（项名 + 分值 + 评审标准原文）如下，本小节写到对应内容时明确点出响应与承诺，并对齐评审标准中的给分档位：\n${scoringDetail}`
      : "4. 本章未分配到具体评分细则，请围绕招标技术需求写出实质性响应内容；",
    `5. 本小节字数预算约 ${opts.wordBudget} 字（整章预算按小节均分），在该篇幅内围绕招标参数与评分办法扩展；禁止自造招标未给的具体参数数字，拿不准的用「按招标文件要求响应」等规范表述；`,
  ]
  let ruleNo = 6
  if (opts.writtenTail) {
    rules.push(
      `${ruleNo}. 本小节开头必须与已写小节的结尾（见下面【已写小节内容结尾】）自然衔接，禁止重复或改写已写内容；`,
    )
    ruleNo += 1
  } else if (prevSummaries.length) {
    rules.push(
      `${ruleNo}. 本小节是本章第一个小节，首段必须自然承接上一章的收尾内容（见下面【相邻章上下文】）；相邻章内容仅供语气衔接与避免重复，禁止照抄、复述或改写其中任何具体表述；`,
    )
    ruleNo += 1
  }
  if (writtenTitles.length) {
    rules.push(`${ruleNo}. 不得重复【已写小节标题清单】中小节的主题，围绕本小节自身范围展开；`)
    ruleNo += 1
  }
  if (implicitList.length) {
    rules.push(`${ruleNo}. 下面【招标隐式硬约束】任何一条被违反都可能废标，本小节正文涉及相关内容时必须逐条满足；`)
    ruleNo += 1
  }
  if (sectionClauses.length) {
    rules.push(
      `${ruleNo}. 下面【本小节须响应的招标要求条款】共 ${sectionClauses.length} 条，必须在本小节内逐条实质性响应：每条条款至少有一段对应内容并给出量化承诺或落地措施，禁止遗漏、禁止泛泛带过；`,
    )
    ruleNo += 1
  } else if (clauseList.length) {
    rules.push(
      `${ruleNo}. 下面【本章须响应的招标要求条款清单】中与本小节主题相关的条款，必须在本小节内实质性响应；其余条款由本章其他小节响应，不要在本小节展开；`,
    )
    ruleNo += 1
  }
  if (factsBlock) {
    rules.push(
      `${ruleNo}. 正文中出现项目名称、招标编号、采购人、预算金额、工期、质保期、地点、时间节点等事实信息时，必须与下面【${factsLabel}】一致，禁止编造不同数值；`,
    )
    ruleNo += 1
  }
  if (opts.tenderFragments) {
    rules.push(
      `${ruleNo}. 本小节内容必须优先依据下面【招标原文相关段落】展开：技术参数、指标、配置与服务要求以原文为准，与原文冲突的表述一律以原文为准，禁止脱离原文空写套话；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：逐条应答强化（开关开启才注入，零新增 LLM 调用）
  if (opts.starBlock) {
    rules.push(
      `${ruleNo}. 本小节内容须对所涉下面【★/▲ 重点条款】逐条正面应答：涉及到的每一条重点条款都要有明确应答结论（满足/优于），给出落地措施或量化承诺，禁止回避、禁止只写通用套话；与本小节无关的条款不必展开；`,
    )
    ruleNo += 1
  }
  // 第十三轮改造 3：素材优先注入（知识库块级检索命中才注入，注明来源文档）
  if (opts.kbMaterial) {
    rules.push(
      `${ruleNo}. 下面【知识库参考素材】是团队沉淀的方案素材（已注明来源文档），可作为本小节案例、数据与实施细节的支撑材料融入正文；与招标原文冲突的内容一律以招标原文为准，禁止整段照抄；`,
    )
    ruleNo += 1
  }
  // 第十七轮 17D：团队写作资料注入（检索命中才注入；可引用事实与口径，须注明来源，禁止整段照抄）
  if (opts.refMaterials) {
    rules.push(
      `${ruleNo}. 下面【团队写作资料】是自有的人员、案例、资质与制度材料：本小节写到团队配置、同类业绩、资质能力、管理制度等内容时优先引用其中的事实与口径，引用处注明「来自自有资料」；禁止整段照抄，禁止编造资料里没有的人员与业绩；`,
    )
    ruleNo += 1
  }
  // 循环 2 批 1-4：暗标身份脱敏规则条（sealed=true 时注入，零新增 LLM 调用）
  if (opts.sealedIdentityRules) {
    rules.push(`${ruleNo}. ${opts.sealedIdentityRules}`)
    ruleNo += 1
  }
  // 第十七轮 17B：编制依据列示——节级继承章判断（规则句全节携带；清单文本仅目标章的小节携带）
  if (opts.compilationBasis) {
    rules.push(
      `${ruleNo}. 本小节涉及编制依据（标准规范/技术依据）时按约定样式列示：${basisStyleRule(opts.compilationBasis.style)}${
        opts.compilationBasis.listText
          ? "；完整依据清单见下面【编制依据与规范清单】，列示时名称与编号必须以清单为准，禁止编造编号"
          : ""
      }；`,
    )
    ruleNo += 1
  }
  rules.push(`${ruleNo}. 写作风格硬条款（每条必须遵守）：`)
  for (const t of BID_STYLE_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  // 第十六轮 B2 改造 2.2：预编排注入——本小节被选中配图时输出契约改为 JSON（content+figures），否则维持纯文本
  // 循环 2 批 2-1：写作焦点进规则句；编排图带图注时要求图元素支撑图注
  if (opts.orchestration?.writing_focus) {
    rules.push(
      `${ruleNo}. 本小节写作焦点：${opts.orchestration.writing_focus}；正文须围绕该焦点组织重点内容，并对其中点名的评分点给出实质性响应；`,
    )
    ruleNo += 1
  }
  const orchFigure = opts.orchestration?.figure
  if (opts.orchestration?.table) {
    rules.push(
      `${ruleNo}. 本小节宜含一个表格：${opts.orchestration.table.purpose}（用纯文本表格行表达，遵守排版惯例：每行一行文本、列间用两个全角空格分隔、首行为表头，禁止 markdown 表格符号）；`,
    )
    ruleNo += 1
  }
  if (orchFigure) {
    const figCaption = (orchFigure.caption ?? "").trim()
    rules.push(
      `${ruleNo}. 本小节已编排一张${ORCHESTRATION_FIGURE_TYPE_LABEL[orchFigure.type]}：《${orchFigure.title}》${
        figCaption ? `，图注「${figCaption}」` : ""
      }，figures 必须输出该图且内容全部取自本小节正文（模块/步骤/区块用词与正文一致，禁止泛化占位词${figCaption ? "，图元素必须能支撑图注所述内容" : ""}）；`,
      `${ruleNo + 1}. 配图元素格式：architecture（架构图）{"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}；flow（流程图）{"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；demo（系统界面示意）{"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}；`,
      `${ruleNo + 2}. 输出严格 JSON，禁止解释文字、禁止代码围栏，格式：{"content":"本小节纯文本正文（第一行为「${opts.sectionNo} ${opts.sectionName}」标题行，禁止 markdown 符号）","figures":[该张配图]}`,
    )
  } else {
    rules.push(
      `${ruleNo}. 直接输出本小节纯文本：第一行为「${opts.sectionNo} ${opts.sectionName}」标题行，禁止 markdown 符号（#、*、-、反引号）、禁止 JSON、禁止本小节以外的内容；`,
    )
  }
  const system = rules.join("\n")
  // 第十六轮 A：多消息缓存序——稳定大块前置（同项目跨小节 identical），小节差异置后
  const stableUser = [
    `【技术需求与交货服务要求】\n${techText || "（未解析）"}`,
    opts.starBlock ?? "",
    // 循环 2 批 2-1：定向事实启用时全量全局事实不再进稳定块（定向块属小节差异内容，进 taskUser 保前缀缓存）
    directedOn ? "" : (opts.globalFacts ?? ""),
    `【全文大纲（仅供保持上下文一致，不要复述）】\n${outlineToText(outline ?? [])}`,
    implicitList.length
      ? `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  const taskUser = [
    factsBlock && directedOn ? factsBlock : "",
    opts.tenderFragments
      ? `【招标原文相关段落（本小节写作的首要依据，参数、指标、要求以原文为准）】\n${opts.tenderFragments}`
      : "",
    opts.kbMaterial ? `【知识库参考素材（团队沉淀，注明来源文档，可融入本小节支撑细节）】\n${opts.kbMaterial}` : "",
    // 第十七轮 17D：团队写作资料段（小节差异内容进 taskUser）
    opts.refMaterials
      ? `【团队写作资料（自有人员/案例/资质/制度，可引用其事实与口径，注明来自自有资料，禁止整段照抄）】\n${opts.refMaterials}`
      : "",
    // 第十七轮 17B：清单文本仅目标章的小节注入（节级继承章判断）
    opts.compilationBasis?.listText
      ? `【编制依据与规范清单（本小节列示编制依据时以此为准，禁止编造编号）】\n${opts.compilationBasis.listText}`
      : "",
    prevSummaries.length
      ? `【相邻章上下文（仅供语气衔接与避免重复，禁止照抄其内容）】\n${prevSummaries.map((s) => `${s.title}\n${s.summary}`).join("\n\n")}`
      : "",
    `【本章小节清单（当前只写第 ${opts.sectionIndex + 1} 个，其余小节不要展开）】\n${sectionList}`,
    `【当前要编写的小节】${opts.sectionNo} ${opts.sectionName}`,
    writtenTitles.length ? `【已写小节标题清单（不得重复其主题）】\n${writtenTitles.join("\n")}` : "",
    opts.writtenTail ? `【已写小节内容结尾（仅供衔接，禁止重复或照抄）】\n${opts.writtenTail}` : "",
    sectionClauses.length
      ? `【本小节须响应的招标要求条款（逐条成段响应）】\n${sectionClauses.map((c) => `${c.id}. ${c.text}`).join("\n")}`
      : "",
    clauseList.length && !sectionClauses.length
      ? `【本章须响应的招标要求条款清单（与本小节相关的在本小节落实）】\n${clauseList.map((c) => `${c.id}. ${c.text}`).join("\n")}`
      : "",
    `请编写本小节完整正文，第一行为「${opts.sectionNo} ${opts.sectionName}」标题行。`,
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: stableUser },
    { role: "user", content: taskUser },
  ]
}

/** 继续生成：把现有正文末尾作为上下文，要求 LLM 从断点续写补足本章篇幅预算；返回值追加到现有正文末尾 */
export function buildBidContinueMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  chapterTitle: string,
  chapterNo: number,
  existingContent: string,
  remainBudget: number,
  globalFacts?: string,
  opts?: { clauses?: RequirementClause[]; outlineText?: string; scoring?: ScoringItem[]; tenderFragments?: string },
): LlmMessage[] {
  void report
  // 第八轮改造 3：续写视野增强——已写小节标题清单 + 末尾 1200 字（原为仅末尾 800 字）
  const tail = existingContent.slice(-1200)
  const titles = writtenSectionTitles(existingContent)
  const clauseList = opts?.clauses ?? []
  const scoringDetail = scoringDetailLines(opts?.scoring ?? [])
  const body: string[] = []
  const push = (t: string) => {
    body.push(`${body.length + 1}. ${t}`)
  }
  push("从【已有正文结尾】的最后一段自然衔接：禁止重复、复述或总结已写过的段落，禁止输出结尾原文；")
  push("不得重复已写小节（见【已写小节标题清单】）的主题，围绕尚未展开的实施细节、量化承诺与保障措施继续；")
  push(
    `续写约 ${remainBudget} 字使整章达到篇幅预算；可写内容不足时围绕招标技术需求与评分办法展开实施细节、量化承诺、保障措施、培训与运维安排，禁止自造招标未给的参数数字；`,
  )
  push(
    `本章在全文大纲中的位置：第${chapterNo}章「${chapterTitle}」${opts?.outlineText ? `；完整大纲如下（仅供定位与避免与其他章重复，不要复述）：\n${opts.outlineText}` : "；"}；`,
  )
  push("沿用已有正文的口径与术语；如需新增小节，小节标题行沿用原有编号格式「N.M 小节名」顺延；")
  if (opts?.tenderFragments) {
    push("续写必须优先依据下面【招标原文相关段落】展开，参数、指标以原文为准，与原文冲突的表述一律以原文为准；")
  }
  if (clauseList.length) {
    push(
      `本章须响应的招标要求条款如下，续写部分必须继续逐条落实（已写过的条款不要重复响应）：\n${clauseList.map((c) => `${c.id}. ${c.text}`).join("\n")}`,
    )
  }
  if (scoringDetail) {
    push(`本章须逐条响应的评分细则如下，续写部分写到对应内容时明确点出响应与承诺：\n${scoringDetail}`)
  }
  if (globalFacts) {
    push("续写中出现项目名称、编号、工期、金额等事实信息时必须与【全局事实】一致，禁止编造不同数值；")
  }
  body.push("写作风格硬条款（每条必须遵守）：")
  for (const t of BID_STYLE_RULES) {
    body.push(`${body.length + 1}. ${t}`)
  }
  body.push(`${body.length + 1}. 只输出续写部分纯文本：禁止 markdown 符号、禁止开场白、禁止复述结尾、禁止收尾总结语。`)
  const system = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，正在为投标项目「${projectName}」（采购人：${hospital || "未填写"}）技术标第${chapterNo}章「${chapterTitle}」续写正文。`,
    "该章正文已写到一半，你的任务是从断点无缝续写：",
    ...body,
  ].join("\n")
  const user = [
    globalFacts ?? "",
    opts?.tenderFragments
      ? `【招标原文相关段落（续写的首要依据，参数、指标、要求以原文为准）】\n${opts.tenderFragments}`
      : "",
    titles.length ? `【已写小节标题清单（不得重复这些主题）】\n${titles.join("\n")}` : "",
    `【已有正文结尾】\n${tail}`,
    "请从断点直接输出续写内容。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 去掉续写开头与现有正文结尾重叠的复述部分，避免追加后段落重复 */
export function stripOverlap(existing: string, continuation: string): string {
  const cont = continuation.trim()
  const base = existing.trimEnd()
  for (const len of [120, 80, 40, 20]) {
    if (base.length >= len && cont.startsWith(base.slice(-len))) return cont.slice(len).trim()
  }
  return cont
}

/** 技术偏离表 AI 映射：条款清单（序号+原文+所属系统）+ 投标大纲树 + 各章正文摘要（前 300 字）+ 全局事实表 → 每行响应判定 */
export function buildDeviationMapMessages(
  clauses: RequirementClause[],
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
  globalFacts?: string,
): LlmMessage[] {
  const clauseLines = clauses.map((c, i) => `${i + 1}. [${c.id}]（${c.source}）${c.text}`).join("\n")
  const chapterLines = chapters
    .map((c, i) => `第${i + 1}章 ${c.title}：${c.content.slice(0, 300).replace(/\n/g, " ")}`)
    .join("\n")
  const system = [
    "你是资深投标顾问，需要为评标专家制作「招标技术条款 ↔ 投标文件响应」技术偏离表，逐条判定投标文件对每条招标技术条款的响应程度。",
    "判定铁律：",
    "1. 对每条条款，结合投标大纲树与各章正文摘要，找出响应最贴切的大纲节点（章/节标题原文），并判定响应程度：完全响应（有实质性响应与量化承诺）/ 部分响应（有响应但不完整、缺量化或打了折扣）/ 偏离（未找到响应或与招标要求不一致）；",
    "2. response_summary 用不超过 80 字概括投标文件的响应内容（引用承诺与指标）；偏离时写明缺口；",
    "3. bid_ref 填响应位置的章-节编号（如「3.2」，按大纲树编号），找不到时留空；",
    "4. 判定要保守：拿不准就标部分响应或偏离，宁可多提醒；clause_id 必须与条款清单一致，每条条款都要有一行，禁止遗漏。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"rows":[{"clause_id":"c1","response_node":"响应的大纲节点标题","response_level":"完全响应","response_summary":"","bid_ref":"3.2"}]}',
  ].join("\n")
  const user = [
    `【招标技术条款清单（共 ${clauses.length} 条）】\n${clipText(clauseLines, MAX_BID_CHARS)}`,
    globalFacts ?? "",
    `【投标文件大纲树（带章-节编号）】\n${outlineToText(outlineNodes ?? [])}`,
    `【投标文件各章正文摘要（标题+前 300 字）】\n${clipText(chapterLines, MAX_BID_CHARS)}`,
    "请逐条判定并输出偏离表 JSON（rows 数组，每条条款一行）。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export function buildDupJudgeMessages(pairs: DupPair[]): LlmMessage[] {
  const blocks = pairs
    .map(
      (pr, i) =>
        `【段落对 ${i + 1}】本地相似度 ${Math.round(pr.similarity * 100)}%\n本标书段落（${pr.target_chapter}）：\n${pr.target_text.slice(0, 500)}\n历史标书段落（来源项目「${pr.source_project}」${pr.source_chapter}）：\n${pr.source_text.slice(0, 500)}`,
    )
    .join("\n\n")
  const system = [
    "你是标书查重评审专家。评标中不同投标人的标书出现大段雷同可能被认定为串通投标（废标风险），同一团队复用自家历史标书也需要改写降低雷同度。",
    "对每个段落对给出复判：ai_verdict 取 high（实质性雷同，必须改写）/ medium（表达相近，建议改写）/ low（仅术语或通用表述重合，可保留）；ai_note 用一句话说明判断依据与改写建议。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"results":[{"index":1,"ai_verdict":"high","ai_note":""}]}',
  ].join("\n")
  const user = `${blocks}\n\n请逐段复判并输出 JSON（index 与段落对编号一致）。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 第九轮改造 2：输出契约升级——双向定位（source_location/response_location）+ severity + suggestion + evidence */
export function buildVoidCheckMessages(clauses: string[], bidText: string, starBlock?: string): LlmMessage[] {
  const clauseLines = clauses.map((c, i) => `${i + 1}. ${c}`).join("\n")
  const system = [
    "你是资深开标评审专家，负责投标前的废标风险合规自查。对每条废标条款，在投标文件中查找对应响应或满足证据，并输出合规核销矩阵条目：",
    "clause 照抄条款原文；source_location 写该条款在招标文件中的位置描述（如「第三章 评标办法 2.1 条」，不超过 30 字）；response 摘录投标文件中的对应响应原文摘要（不超过 80 字）；response_location 写响应所在的投标章节位置（如「第2章 资质证明」，不超过 30 字，找不到响应时留空）；",
    "status 取 compliant（已明确响应/满足）/ partial（有响应但不完整或存疑）/ non_compliant（未找到任何响应或明确不满足）；",
    "severity 取 critical / major / minor——废标条款默认 severity=critical，仅当条款本身属轻微程序性要求（如份数、装订、封面格式类）才可降档为 major 或 minor；",
    "suggestion 给出不超过 60 字的可操作整改建议（status=compliant 时可留空）；evidence 摘录支撑判定的投标文件原文（不超过 120 字）。",
    "防误报硬规则：",
    "1. 每条 partial / non_compliant 判定必须附证据：evidence 字段摘录投标文件中支撑该判定的原文（不超过 120 字）；找不到任何可摘录的原文依据时，不得输出该条的风险判定；",
    "2. 投标文件中存在「章节标题 / 目录项 / 附件清单 / 表格条目」等结构性文本线索提到相应材料（证书、报告、授权书、证明材料等）时，不得判 non_compliant——文本解析看不到图片与扫描件附件，此类情况判 compliant 并在 suggestion 中注明「依据目录/附件清单线索，需人工核对原件」；",
    "3. 每条条款都必须输出一行结果（含 compliant），禁止遗漏；判定要保守：拿不准就标 partial，宁可多提醒。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"items":[{"clause":"条款原文","source_location":"","response":"","response_location":"","status":"compliant","severity":"critical","suggestion":"","evidence":""}]}',
  ].join("\n")
  const user = `【废标条款清单】\n${clauseLines}\n\n${starBlock && starBlock.trim() ? `${starBlock.trim()}\n\n` : ""}【投标文件正文】\n${clipText(bidText, MAX_BID_CHARS)}\n\n请逐条比对并输出 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 第六轮升级（改造 6）：逐章「标题+前 400 字摘要」入参；评分办法命中的关键章节注入前 1500 字；瑕疵制扣分 */
export function buildEvalMessages(
  scoringText: string,
  chapters: Chapter[],
  opts?: { globalFacts?: string; outlineText?: string },
): LlmMessage[] {
  const scoringNames = extractScoringFromText(scoringText).map((s) => s.item).filter(Boolean)
  const filled = chapters.map((c, i) => ({ no: i + 1, c })).filter(({ c }) => (c.content ?? "").trim())
  const blocks = filled.map(({ no, c }) => {
    const isKey =
      filled.length === 1 ||
      scoringNames.some((n) => clauseMatchesTitle(n, c.title) || (c.sections ?? []).some((s) => clauseMatchesTitle(n, s)))
    const limit = filled.length === 1 ? MAX_BID_CHARS : isKey ? 1500 : 400
    const body = c.content.replace(/\s+/g, " ").trim().slice(0, limit)
    return `第${no}章 ${c.title}${isKey && filled.length > 1 ? "（评分办法命中的关键章节，附更多内容）" : ""}\n${body}`
  })
  const digest = clipText(blocks.join("\n\n"), MAX_TENDER_CHARS)
  const system = [
    "你是医疗信息化项目评标委员会资深专家，现在要对一份技术标做模拟评标。",
    "评标方法（瑕疵制扣分）：",
    "1. 每个评分项默认满分，再按评分标准逐项检视：每发现一处瑕疵，按评分标准中的扣分阶梯扣分（未响应扣满该档、响应不完整或缺量化承诺按对应档扣、表述笼统酌情轻扣），每项得分不得低于 0 分、不得超过该项分值；",
    "2. 每项 reason 必须引用投标文件中的具体表现（哪一章写了什么、缺了什么承诺或数据），禁止编造评委偏好、禁止使用评分标准之外的扣分理由；",
    "3. suggestion 给出可操作的改进建议（补什么内容、加什么承诺、放什么证明）；",
    "4. summary 给出总体评价：预估得分区间、最大失分风险、3 条最重要的改进方向，并必须附「模拟评标结果仅供参考，实际得分以评标委员会评审为准」的不确定性声明；禁止下「确定中标 / 必然中标」类结论。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"items":[{"scoring_item":"评分项名","max_score":0,"ai_score":0,"reason":"","suggestion":""}],"summary":""}',
  ].join("\n")
  const user = [
    `【评分办法（逐项分值）】\n${scoringText}`,
    opts?.outlineText ? `【投标文件大纲树（仅供定位章节）】\n${clipText(opts.outlineText, 4000)}` : "",
    opts?.globalFacts ?? "",
    `【待评标投标文件内容（逐章摘要，关键章节附更多内容）】\n${digest}`,
    "请逐项打分并输出 JSON。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export type BidRefineKind = "rewrite" | "expand" | "condense"

// ---------------------------------------------------------------------------
// 第九轮改造 3：三路评标之「格式规范路」与「商务要素路」（技术路 = buildEvalMessages 不动）
// 评标三路调用不带技能块：审计要保持中立，沿用交卷体检格局
// ---------------------------------------------------------------------------

/**
 * 格式规范路 prompt：检查章节结构完整性 / 编号连续性 / 排版惯例 / 页数份数装订类硬约束响应。
 * 入参 = 大纲树 + 各章标题与小节标题清单 + 每章正文前 200 字采样 + 隐式硬约束清单（本地零 AI 抽取）。
 */
export function buildEvalFormatMessages(
  chapters: Chapter[],
  opts: { outlineText: string; implicitConstraints: string[] },
): LlmMessage[] {
  const chapterLines = chapters
    .map((c, i) => {
      const sections = (c.sections ?? []).filter((s) => s.trim())
      const sample = (c.content ?? "").replace(/\s+/g, " ").trim().slice(0, 200)
      return `第${i + 1}章 ${c.title}\n小节：${sections.length ? sections.join("；") : "（无小节标题）"}\n正文采样：${sample || "（本章正文为空）"}`
    })
    .join("\n\n")
  const constraints = opts.implicitConstraints.length
    ? opts.implicitConstraints.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "（未从招标文件中抽取到页数/份数/装订类硬约束）"
  const system = [
    "你是医疗信息化项目评标委员会的格式规范审查专家，对投标文件做格式符合性检查（不评内容质量、不打分）。",
    "检查范围（只查这四类）：",
    "1. 章节结构完整性：大纲树里有的章在正文中缺失或正文为空、章节层级明显残缺；",
    "2. 编号连续性：章/小节编号跳号、重号、错序；",
    "3. 排版惯例：正文残留装饰符号（【】★◆■●✓→等）、Markdown 符号残留（# * - > 等标题/列表/加粗符号）、明显乱码；",
    "4. 硬约束响应：招标文件中页数/份数/装订/密封/签字盖章类硬约束，投标文件是否有对应响应或承诺。",
    "severity 判级：结构性缺章或硬约束完全未响应=critical；编号混乱、响应不完整=major；个别排版残留=minor。",
    "防误报硬规则：判定仅基于文本解析，图片、扫描件、签章效果一律看不到；章节标题、目录项、附件清单等结构性线索存在即不判缺失；拿不准的不输出，宁缺毋滥；没有发现问题就输出空数组，禁止为凑数编造问题。",
    "location 写问题所在位置（如「第3章 实施方案」或「全文」，不超过 30 字）；suggestion 写不超过 60 字的修复建议。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"format_issues":[{"issue":"","severity":"major","location":"","suggestion":""}]}',
  ].join("\n")
  const user = [
    `【投标文件大纲树】\n${clipText(opts.outlineText, 4000)}`,
    `【各章标题、小节清单与正文采样】\n${clipText(chapterLines, MAX_TENDER_CHARS)}`,
    `【招标文件隐式硬约束清单（本地抽取）】\n${clipText(constraints, 3000)}`,
    "请逐项检查并输出 JSON。",
  ].join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 商务要素核对涉及的解析分区（商务/报价相关项；含旧 key 兼容存量报告） */
export const COMMERCIAL_SECTION_KEYS = [
  "overview",
  "project_info",
  "delivery_req",
  "bid_deposit",
  "bid_bond",
  "biz_score",
  "bid_nodes",
  "key_nodes",
]

/** 拼出解析报告中商务/报价相关项文本（商务路入参之一） */
export function buildCommercialSectionText(report: ParseReport | null): string {
  if (!report) return ""
  const blocks: string[] = []
  for (const key of COMMERCIAL_SECTION_KEYS) {
    const text = sectionText(report, key)
    if (!text.trim()) continue
    blocks.push(`【${parseSectionTitle(key)}】\n${text.trim()}`)
  }
  return blocks.join("\n\n")
}

/** 商务关键词：正文段落命中任一即视为含关键商务值（本地捞取，零 AI） */
const COMMERCIAL_KEYWORDS = [
  "金额", "报价", "预算", "万元", "人民币", "付款", "价格", "保证金",
  "工期", "日历天", "交付期", "质保", "保修", "运维期", "维保",
  "人员", "驻场", "团队", "项目经理", "负责人", "年限",
]

/** 商务路入参：各章正文中含金额/工期/质保/人员关键词的段落（本地关键词捞取，≤3000 字） */
export function collectCommercialParagraphs(chapters: Chapter[], maxChars = 3000): string {
  const blocks: string[] = []
  let total = 0
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    const content = (c.content ?? "").trim()
    if (!content) continue
    for (const para of splitParagraphs(content, 20, 600)) {
      if (total >= maxChars) break
      if (!COMMERCIAL_KEYWORDS.some((k) => para.includes(k))) continue
      const block = `[第${i + 1}章 ${c.title}] ${para.replace(/\s+/g, " ").trim()}`
      if (total + block.length > maxChars) break
      blocks.push(block)
      total += block.length + 1
    }
  }
  return blocks.join("\n")
}

/**
 * 商务要素路 prompt：globalFacts 与正文关键值逐项核对（项目名称/编号/金额/工期/质保期/驻场人数等）。
 * 找不到投标值时 bid_value 填「未找到」且 consistent=false。
 */
export function buildEvalCommercialMessages(
  globalFacts: string,
  commercialSections: string,
  bidParagraphs: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化项目评标委员会的商务符合性审查专家，负责核对投标文件中的关键商务值与招标要求是否一致（不评技术方案、不打分）。",
    "核对方法：从【全局事实】与【招标商务要求】中逐项提取关键商务值（项目名称、招标编号、采购人、预算/报价金额、工期、质保期、保证金、驻场人数、时间节点等），再到【投标文件商务相关段落】中查找投标侧的对应值，逐项输出核对结果：",
    "key 写核对项名（不超过 20 字）；tender_value 写招标侧要求值（原文摘录，不超过 60 字）；bid_value 写投标文件中的实际值（原文摘录，不超过 60 字）；consistent 写两者是否一致（true/false）；note 一句话说明核对依据或不一致点（不超过 60 字）。",
    "硬规则：",
    "1. 投标文件段落中找不到某核对项的值时，bid_value 填「未找到」且 consistent=false，note 注明「正文未见对应商务值，需人工补充核对」；",
    "2. 数值比对允许表述差异（如「12 个月」与「一年」），但金额、天数、人数等实质数值不同必须判 false；",
    "3. 只核对有招标侧依据的项，禁止编造招标要求；没有可核对的项就输出空数组。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"commercial_checks":[{"key":"","tender_value":"","bid_value":"","consistent":true,"note":""}]}',
  ].join("\n")
  const user = [
    globalFacts || "【全局事实】（解析报告中未提取到全局事实，请以下面商务要求为准）",
    commercialSections ? `【招标商务要求（解析报告摘录）】\n${clipText(commercialSections, 6000)}` : "",
    `【投标文件商务相关段落（关键词捞取）】\n${bidParagraphs.trim() ? clipText(bidParagraphs, 3200) : "（正文中没有捞到含金额/工期/质保/人员关键词的段落）"}`,
    "请逐项核对并输出 JSON。",
  ]
    .filter((s) => s.trim())
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 改造 2：投标文件口径的改写/扩写/精简 prompt（含全局事实 + 本章评分细则 + 写作风格硬条款） */
export function buildBidRefineMessages(
  kind: BidRefineKind,
  projectName: string,
  hospital: string,
  chapterTitle: string,
  chapterNo: number,
  content: string,
  opts?: { globalFacts?: string; scoring?: ScoringItem[]; tenderFragments?: string },
): LlmMessage[] {
  const action =
    kind === "rewrite"
      ? "改写：保持原有信息量与结构，换用更专业、更符合投标文件口径的表达，消除口语与重复，突出实质性响应与量化承诺"
      : kind === "expand"
        ? "扩写：补充医疗信息化行业细节、量化指标、实施要点与风险考虑，篇幅增加约 50%"
        : "精简：压缩到约 60% 篇幅，只保留关键响应内容，不丢失小节结构"
  const scoringDetail = scoringDetailLines(opts?.scoring ?? [])
  const system = [
    `你是医疗信息化行业资深标书编辑，当前处理对象是投标文件《${projectName}》（采购人：${hospital || "未填写"}）第${chapterNo}章「${chapterTitle}」的正文。`,
    `请对该章正文执行「${action}」。`,
    scoringDetail
      ? `本章须逐条响应的评分细则（改写/扩写时保持并强化对这些细则的响应；精简时禁止删除已响应评分细则的内容）：\n${scoringDetail}`
      : "",
    opts?.globalFacts ? `事实信息必须与下面【全局事实】一致，禁止编造不同数值。\n${opts.globalFacts}` : "",
    opts?.tenderFragments
      ? "处理必须优先依据下面【招标原文相关段落】：扩写补充的参数、指标、要求以原文为准，与原文冲突的表述一律按原文修正。\n【招标原文相关段落】\n" + opts.tenderFragments
      : "",
    "写作风格硬条款（每条必须遵守）：",
    ...BID_STYLE_RULES.map((t, i) => `${i + 1}. ${t}`),
    "输出铁律：直接输出处理后的完整正文纯文本，小节标题行保持「N.M 小节名」格式，禁止 markdown 符号、禁止任何解释说明或开场白。",
  ]
    .filter((s) => s !== "")
    .join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: `【原文】\n${content}` },
  ]
}

/**
 * 循环 5 A1：小节级局部扩缩写——只对给定小节切片片段做定向扩写/缩写（不重生成整节）。
 * expand 目标 ≈ 现长 ×1.5、shrink ≈ ×0.6，具体目标字数以 targetChars 传入为准；
 * 调用方复用第十五轮条级重写的确定性切片与原位替换机制（sliceSectionPieces / rebuildSectionContent）。
 */
export function buildSectionResizeMessages(
  leafTitle: string,
  sliceText: string,
  mode: "expand" | "shrink",
  targetChars: number,
): LlmMessage[] {
  const target = Math.max(100, Math.round(targetChars))
  const verb = mode === "expand" ? "扩写" : "缩写"
  const system = [
    `你是医疗信息化行业资深标书编辑，正在对投标文件的「${leafTitle}」小节做局部「${verb}」。`,
    "硬规则（每条必须遵守）：",
    "1. 只处理给定片段本身，禁止改写其他小节、禁止输出片段之外的内容；",
    "2. 保持事实口径与片段一致：金额、工期、人数、指标值等硬数据不得改动，禁止编造新数值；",
    mode === "expand"
      ? "3. 扩写须基于片段已有内容展开：补充实施细节、操作步骤、保障措施与风险考虑，禁止空话套话、禁止重复已有句子凑字数；"
      : "3. 缩写须保留全部硬指标与承诺要点，不丢评分点：合并重复表述、删去空话，关键响应内容一条不能少；",
    "4. 写作风格与片段上下文保持一致：正式投标口径、纯文本，禁止 markdown 符号与装饰符号；",
    `5. 处理后正文长度控制在约 ${target} 字（±10%）。`,
    "输出铁律：只输出处理后的正文，不输出任何解释、标题、编号或开场白。",
  ].join("\n")
  const user = `【目标长度】约 ${target} 字\n【待${verb}片段】\n${sliceText}`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 快捷评标工具：从「评分项:分值」行文本解析评分办法 */
export function parseScoringLines(text: string): ScoringItem[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = line.match(/^(.*?)[：:，,\s]+(\d+(?:\.\d+)?)\s*分?$/)
      if (m) return { item: m[1].replace(/^\d+[.、]\s*/, "").trim(), score: Number(m[2]), criteria: "" }
      return { item: line.replace(/^\d+[.、]\s*/, ""), score: 0, criteria: "" }
    })
    .filter((s) => s.item.length > 0)
    .slice(0, 40)
}

export function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null
  const target = new Date(dateStr)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / 86400000)
}

/** 章节清单 → 纯文本（废标检查/交卷体检/查重共用）；第十三轮改造 4：跳过空 content 章（商务骨架章与未生成章不产生「第X章 标题」空段噪音），编号保持原章序 */
export function chaptersToText(chapters: Chapter[], max = MAX_BID_CHARS): string {
  const full = (chapters ?? [])
    .map((c, i) => ({ c, i }))
    .filter((x) => (x.c.content ?? "").trim().length > 0)
    .map((x) => `第${x.i + 1}章 ${x.c.title}\n${x.c.content}`)
    .join("\n\n")
  return clipText(full, max)
}

// ---------------------------------------------------------------------------
// 第六轮改造：讲标与答辩（专家问题池 / 讲标大纲 / 讲标稿要点）
// ---------------------------------------------------------------------------

export type DefenseQuestion = {
  id: string
  question: string
  intent: string
  answer_points: string[]
  ref_chapters: string[]
  full_answer: string
  edited: boolean
}

export type DefenseOutlinePage = { page_title: string; bullets: string[] }

export type DefenseSpeechSection = { title: string; points: string[] }

export type DefenseSpeechNotes = {
  opening: string
  sections: DefenseSpeechSection[]
  closing: string
}

export type BidDefense = {
  questions: DefenseQuestion[]
  defense_outline: DefenseOutlinePage[]
  speech_notes: DefenseSpeechNotes | null
  updated_at: string
}

export function emptyBidDefense(): BidDefense {
  return { questions: [], defense_outline: [], speech_notes: null, updated_at: "" }
}

function strList(v: unknown): string[] {
  return asArray(v)
    .map((x) => asString(x).trim())
    .filter(Boolean)
}

function objList(v: unknown): Record<string, unknown>[] {
  return asArray(v).filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
}

/** 存量记录缺 bid_defense 列 / 数据损坏时容错：统一归一成空结构，老项目打开不崩 */
export function normalizeBidDefense(raw: unknown): BidDefense {
  const base = emptyBidDefense()
  if (!raw || typeof raw !== "object") return base
  const rec = raw as Record<string, unknown>
  const questions = objList(rec.questions)
    .map((q) => ({
      id: asString(q.id).trim() || makeUid(),
      question: asString(q.question).trim(),
      intent: asString(q.intent).trim(),
      answer_points: strList(q.answer_points),
      ref_chapters: strList(q.ref_chapters),
      full_answer: asString(q.full_answer),
      edited: q.edited === true,
    }))
    .filter((q) => q.question)
  const defense_outline = objList(rec.defense_outline)
    .map((pg) => ({ page_title: asString(pg.page_title).trim(), bullets: strList(pg.bullets) }))
    .filter((pg) => pg.page_title)
  let speech_notes: DefenseSpeechNotes | null = null
  const sn = rec.speech_notes
  if (sn && typeof sn === "object") {
    const r = sn as Record<string, unknown>
    const sections = objList(r.sections).map((s) => ({ title: asString(s.title).trim(), points: strList(s.points) }))
    const opening = asString(r.opening).trim()
    const closing = asString(r.closing).trim()
    if (opening || closing || sections.some((s) => s.title || s.points.length)) speech_notes = { opening, sections, closing }
  }
  return { questions, defense_outline, speech_notes, updated_at: asString(rec.updated_at) }
}

/** AI 输出 → 专家问题池（JSON 容错，8-15 条，缺关键字段丢弃） */
export function sanitizeDefenseQuestions(raw: unknown): DefenseQuestion[] {
  const rec = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { questions: raw }) as Record<string, unknown>
  const out = objList(rec.questions ?? rec.items ?? raw)
    .map((q) => ({
      id: makeUid(),
      question: asString(q.question ?? q.q).trim(),
      intent: asString(q.intent ?? q.point).trim(),
      answer_points: strList(q.answer_points ?? q.points).slice(0, 6),
      ref_chapters: strList(q.ref_chapters ?? q.chapters).slice(0, 6),
      full_answer: "",
      edited: false,
    }))
    .filter((q) => q.question.length >= 4)
    .slice(0, 15)
  if (!out.length) throw new Error("AI 返回的问题池内容为空，请重试")
  return out
}

/** AI 输出 → 讲标大纲（10-15 页，每页 bullets ≤6 条） */
export function sanitizeDefenseOutline(raw: unknown): DefenseOutlinePage[] {
  const rec = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { pages: raw }) as Record<string, unknown>
  const out = objList(rec.pages ?? rec.slides ?? raw)
    .map((pg, i) => ({
      page_title: asString(pg.page_title ?? pg.title).trim() || `第 ${i + 1} 页`,
      bullets: strList(pg.bullets ?? pg.points).slice(0, 6),
    }))
    .slice(0, 15)
  if (!out.length) throw new Error("AI 返回的讲标大纲为空，请重试")
  return out
}

/** AI 输出 → 讲标稿要点（sections 与大纲页对齐，缺标题用大纲页标题兜底） */
export function sanitizeSpeechNotes(raw: unknown, pages: DefenseOutlinePage[]): DefenseSpeechNotes {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const opening = asString(rec.opening).trim()
  const closing = asString(rec.closing ?? rec.ending).trim()
  const sections = objList(rec.sections)
    .map((s, i) => ({
      title: asString(s.title ?? s.page_title).trim() || pages[i]?.page_title || `第 ${i + 1} 页`,
      points: strList(s.points ?? s.bullets).slice(0, 4),
    }))
    .slice(0, 20)
  if (!opening && !closing && !sections.length) throw new Error("AI 返回的讲标稿内容为空，请重试")
  return { opening, sections, closing }
}

/** 标书各章标题 + 前 300 字摘要（问题池入参） */
export function buildChapterDigest(chapters: Chapter[], max = 300): string {
  return chapters
    .map((c, i) => ({ i, c }))
    .filter(({ c }) => (c.content ?? "").trim())
    .map(({ i, c }) => `第${i + 1}章 ${c.title}\n摘要：${clipText((c.content ?? "").replace(/\s+/g, " "), max)}`)
    .join("\n\n")
}

/** 拼出某问题相关章节正文（「生成完整答案」入参；未命中章节时退回全部有正文的章节） */
export function defenseRefChapterText(chapters: Chapter[], refTitles: string[], max = 6000): string {
  const hit = chapters.filter(
    (c) => (c.content ?? "").trim() && refTitles.some((t) => t && clauseMatchesTitle(t, c.title)),
  )
  const list = hit.length ? hit : chapters.filter((c) => (c.content ?? "").trim())
  return clipText(
    list.map((c) => `【${c.title}】\n${c.content}`).join("\n\n"),
    max,
  )
}

export function buildDefenseQuestionsMessages(
  scoringText: string,
  voidText: string,
  chapterDigest: string,
  globalFacts: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化项目资深评标专家兼投标顾问，需要在开标后的讲标答辩环节前，帮投标人预判评标专家最可能提出的问题。",
    "出题铁律：",
    "1. 出 8-15 个问题，优先覆盖：评分办法中分值高的项、废标条款相关项、标书章节中可能被追问的细节（参数响应、实施方案、售后承诺、业绩资质）；",
    "2. intent 一句话写明该问题考察什么；answer_points 给 3-5 条答辩要点，必须基于标书实际内容，禁止编造标书中没有的承诺；",
    "3. ref_chapters 列出回答该问题可引用的标书章节标题，只能从给定章节标题中选；",
    "4. 问题表述模拟真实评标专家口吻，具体、可追问，禁止空泛。",
    globalFacts,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"questions":[{"question":"","intent":"","answer_points":["",""],"ref_chapters":[""]}]}',
  ]
    .filter((s) => s.trim())
    .join("\n")
  const user = `【评分办法】\n${clipText(scoringText, 4000) || "（未提供）"}\n\n【废标条款】\n${clipText(voidText, 3000) || "（未提供）"}\n\n【标书章节标题与摘要】\n${clipText(chapterDigest, 9000)}\n\n请出 8-15 个专家问题并输出 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export function buildDefenseAnswerMessages(
  question: DefenseQuestion,
  refChapterText: string,
  globalFacts: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化项目投标主讲人，正在准备讲标答辩环节的现场应答。",
    "请针对给定专家问题写一段答辩口径的完整答案：200-400 字，口语化但专业，先给结论再分要点展开；内容必须来自标书相关章节的实际表述，禁止编造标书中没有的参数或承诺。",
    globalFacts,
    "直接输出答案正文纯文本，禁止 markdown 符号、禁止解释说明。",
  ]
    .filter((s) => s.trim())
    .join("\n")
  const user = [
    `【专家问题】${question.question}`,
    question.intent ? `【考察点】${question.intent}` : "",
    question.answer_points.length ? `【答辩要点】\n${question.answer_points.map((pt) => `- ${pt}`).join("\n")}` : "",
    `【标书相关章节内容】\n${refChapterText || "（未找到相关正文，请基于答辩要点谨慎作答）"}`,
    "请写出完整答辩答案。",
  ]
    .filter(Boolean)
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export function buildDefenseOutlineMessages(
  outlineText: string,
  scoringText: string,
  globalFacts: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化行业资深售前顾问，请基于标书大纲与评分办法，为投标人编排讲标 PPT 大纲。",
    "大纲铁律：",
    "1. 输出 10-15 页，页序按「项目理解 → 总体方案 → 各分系统亮点（按评分办法分值权重排序，高分项靠前）→ 实施与质保 → 服务承诺」组织；",
    "2. 每页 bullets 3-6 条，内容取自标书对应章节，突出量化承诺与差异化亮点，禁止空泛形容词；",
    "3. page_title 简短（15 字内），能直接当 PPT 页标题。",
    globalFacts,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"pages":[{"page_title":"","bullets":["",""]}]}',
  ]
    .filter((s) => s.trim())
    .join("\n")
  const user = `【标书大纲树】\n${clipText(outlineText, 8000)}\n\n【评分办法（含分值权重）】\n${clipText(scoringText, 4000) || "（未提供）"}\n\n请输出讲标大纲 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

export function buildSpeechNotesMessages(pages: DefenseOutlinePage[], globalFacts: string): LlmMessage[] {
  const system = [
    "你是医疗信息化项目投标主讲人，请为讲标 PPT 大纲撰写讲标稿要点。",
    "撰写铁律：",
    "1. opening 为 150 字内开场白（问候 + 项目理解 + 信心表达），closing 为 100 字内收尾（承诺 + 致谢）；",
    "2. sections 与大纲页一一对应，每页给 2-3 句口语化讲述要点（points），说清这页要讲什么、强调哪个数字，不要照抄 bullets；",
    "3. 全文口语化、像现场讲出来的稿子，禁止书面套话。",
    globalFacts,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"opening":"","sections":[{"title":"页标题","points":["",""]}],"closing":""}',
  ]
    .filter((s) => s.trim())
    .join("\n")
  const outlineText = pages
    .map((pg, i) => `第${i + 1}页 ${pg.page_title}\n${pg.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n")
  const user = `【讲标大纲】\n${clipText(outlineText, 9000)}\n\n请输出讲标稿要点 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// ---------------------------------------------------------------------------
// 第七轮改造 5：交卷体检（实质响应覆盖审计）
// ---------------------------------------------------------------------------

export type SubmissionCheckKind = "scoring" | "void"

export const SUBMISSION_KIND_LABEL: Record<SubmissionCheckKind, string> = {
  scoring: "评分项",
  void: "废标条款",
}

export type SubmissionCheckItem = {
  index: number
  kind: SubmissionCheckKind
  label: string
  covered: boolean
  /** 支撑判定的投标文件原文摘录（≤30 字） */
  evidence: string
  /** 第九轮改造 2：本地推导（废标项 critical / 评分项按分值≥5 critical 否则 major），不问 AI */
  severity: SeverityLevel
  /** AI 输出的整改建议（仅未覆盖项，≤40 字；老数据为空） */
  suggestion: string
  review_status: ReviewStatus
  skip_reason: string
}

export type SubmissionCheck = {
  items: SubmissionCheckItem[]
  checked_at: string
  /** 第十七轮 17C：本地格式规则检查报告（零 AI）；老数据缺字段容错为 null */
  format_report?: FormatCheckReport | null
  /** 循环 8 A3：全局事实一致性核对结果；null=未跑/失败（无事实表或事实路 LLM 失败），[]=跑过且无矛盾 */
  fact_conflicts?: FactConflict[] | null
}

/** 评分项严重度本地推导：分值≥5 critical，否则 major；废标条款一律 critical */
function submissionSeverity(kind: SubmissionCheckKind, score: number): SeverityLevel {
  if (kind === "void") return "critical"
  return score >= 5 ? "critical" : "major"
}

/** 循环 8 A3：fact_conflicts 列容错——非数组→null（未跑/失败语义）；数组→逐条字段规整截断，坏条目丢弃 */
function normalizeFactConflicts(raw: unknown): FactConflict[] | null {
  if (!Array.isArray(raw)) return null
  const out: FactConflict[] = []
  for (const it of raw) {
    const r = (it ?? {}) as Record<string, unknown>
    const fact = asString(r.fact).trim()
    if (!fact) continue
    out.push({
      fact: fact.slice(0, 120),
      chapter: asString(r.chapter).trim().slice(0, 60),
      quote: asString(r.quote).trim().slice(0, 200),
      suggestion: asString(r.suggestion).trim().slice(0, 120),
    })
    if (out.length >= 50) break
  }
  return out
}

/** 存量记录容错读取（缺列 / 损坏 → null，老项目打开不崩）；scoring 可选，用于老数据补推导 severity */
export function normalizeSubmissionCheck(raw: unknown, scoring?: ScoringItem[]): SubmissionCheck | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const scoreOf = new Map((scoring ?? []).map((s) => [s.item, s.score]))
  const items = asArray(rec.items)
    .map((it, i) => {
      const r = (it ?? {}) as Record<string, unknown>
      const label = asString(r.label).trim()
      if (!label) return null
      const idxRaw = Number(r.index)
      const kind: SubmissionCheckKind = r.kind === "void" ? "void" : "scoring"
      return {
        index: Number.isFinite(idxRaw) ? idxRaw : i + 1,
        kind,
        label,
        covered: r.covered === true,
        evidence: asString(r.evidence).trim().slice(0, 60),
        severity: asSeverity(r.severity, submissionSeverity(kind, scoreOf.get(label) ?? 0)),
        suggestion: asString(r.suggestion).trim().slice(0, 80),
        review_status: asReviewStatus(r.review_status, "pending"),
        skip_reason: asString(r.skip_reason),
      }
    })
    .filter((x): x is SubmissionCheckItem => !!x)
  // 第十七轮 17C：保留本地格式规则检查报告；仅格式报告（items 空但有格式报告）不丢弃
  const formatReport = normalizeFormatCheckReport(rec.format_report)
  // 循环 8 A3：保留事实一致性核对结果（[]=跑过无矛盾要保留，null/损坏=未跑可随空 items 一并丢弃）
  const factConflicts = normalizeFactConflicts(rec.fact_conflicts)
  if (!items.length && !formatReport && !factConflicts) return null
  return { items, checked_at: asString(rec.checked_at), format_report: formatReport, fact_conflicts: factConflicts }
}

/** bigram 重合度：关键词救援定位用（关键词的 2-gram 在段落中出现的比例） */
function bigramOverlap(keyword: string, text: string): number {
  const k = normalizePara(keyword)
  const t = normalizePara(text)
  if (k.length < 2 || !t.length) return 0
  const grams = new Set<string>()
  for (let i = 0; i + 2 <= k.length; i++) grams.add(k.slice(i, i + 2))
  let hit = 0
  for (const g of grams) if (t.includes(g)) hit += 1
  return hit / (grams.size || 1)
}

/**
 * 审计入参压缩：逐章「标题 + 前 400 字」；超限时先用评分项 / 废标条款关键词
 * bigram 定位相关章节段落，相关章优先注入更多内容。
 */
export function buildSubmissionDigest(
  chapters: Chapter[],
  scoring: ScoringItem[],
  voidClauses: string[],
  maxChars = 13000,
): string {
  const filled = chapters.map((c, i) => ({ no: i + 1, c })).filter(({ c }) => (c.content ?? "").trim())
  if (!filled.length) return ""
  const head = (c: Chapter, n: number) => c.content.replace(/\s+/g, " ").trim().slice(0, n)
  const base = filled.map(({ no, c }) => `第${no}章 ${c.title}\n${head(c, 400)}`).join("\n\n")
  if (base.length <= maxChars) return base
  const keywords = [...scoring.map((s) => s.item), ...voidClauses]
    .map((k) => k.trim())
    .filter((k) => k.length >= 4)
    .slice(0, 60)
  const ranked = filled
    .map(({ no, c }) => {
      const paras = splitParagraphs(c.content, 30).slice(0, 40)
      const relevant = paras.filter((p) => keywords.some((k) => bigramOverlap(k, p) >= 0.5)).slice(0, 3)
      const titleHit = keywords.some((k) => bigramOverlap(k, c.title) >= 0.5)
      return { no, c, relevant, score: relevant.length + (titleHit ? 1 : 0) }
    })
    .sort((a, b) => b.score - a.score || a.no - b.no)
  const blocks: string[] = []
  let total = 0
  for (const r of ranked) {
    const body = r.score > 0 ? r.relevant.join("\n") || head(r.c, 300) : head(r.c, 200)
    const block = `第${r.no}章 ${r.c.title}${r.score > 0 ? "（关键词命中，附相关段落）" : ""}\n${body}`
    if (total + block.length > maxChars) break
    blocks.push(block)
    total += block.length + 2
  }
  return blocks.join("\n\n")
}

/** 交卷体检 prompt：评标委员会视角逐条判「实质响应」；输出仅 index/covered/evidence，禁长 reason 防截断 */
export function buildSubmissionCheckMessages(
  scoring: ScoringItem[],
  voidClauses: string[],
  digest: string,
  starBlock?: string,
): LlmMessage[] {
  const checklist = [
    ...scoring.map((s, i) => `${i + 1}. [评分项] ${s.item}${s.criteria.trim() ? `（评审标准：${s.criteria.trim()}）` : ""}`),
    ...voidClauses.map((c, i) => `${scoring.length + i + 1}. [废标条款] ${c}`),
  ].join("\n")
  const total = scoring.length + voidClauses.length
  const system = [
    "你是医疗信息化项目评标委员会资深专家，投标人在交卷前请你对其投标文件做「实质响应」覆盖审计，逐条判断每个评分项与废标条款是否已被实质响应。",
    "审计铁律：",
    "1. 实质响应 = 投标文件给出了对应的措施、承诺、数据或证明材料，仅仅出现关键词或标题呼应不算实质响应；",
    "2. 废标条款从严判定：看不出明确正面规避或满足的响应，一律 covered=false；",
    "3. 评分项按评审标准判定：有可得分的实质内容才算 covered=true；",
    `4. 全部 ${total} 条审计项每条都要输出一行，index 与清单编号一致；evidence 摘录支撑判定的投标文件关键原文（不超过 30 字），未覆盖时可留空；`,
    "5. covered=false 时必须在 suggestion 给出不超过 40 字的补写建议（补什么内容、放哪一章）；covered=true 时 suggestion 留空；",
    "6. 禁止编写长 reason、禁止解释文字、禁止 markdown 代码围栏，只输出严格 JSON 数组，格式：",
    '[{"index":1,"covered":true,"evidence":"","suggestion":""}]',
  ].join("\n")
  const user = `【审计清单（共 ${total} 条）】\n${clipText(checklist, 6000)}\n\n${starBlock && starBlock.trim() ? `${starBlock.trim()}\n\n` : ""}【投标文件章节内容（压缩摘要）】\n${digest}\n\n请逐条审计并输出 JSON 数组。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/**
 * AI 输出 → 交卷体检结果。解析不出任何有效条目时抛错——
 * 调用方必须降级显示「审计未完成」，绝不把解析失败当成全未覆盖。
 */
export function sanitizeSubmissionCheck(rawText: string, scoring: ScoringItem[], voidClauses: string[]): SubmissionCheck {
  const data = extractJsonLoose(rawText)
  const rec = (data ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(data) ? data : rec.items ?? rec.results)
  const byIndex = new Map<number, { covered: boolean; evidence: string; suggestion: string }>()
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const idx = Number(r.index)
    if (!Number.isFinite(idx)) continue
    byIndex.set(idx, {
      covered: r.covered === true,
      evidence: asString(r.evidence).trim().slice(0, 30),
      suggestion: asString(r.suggestion).trim().slice(0, 60),
    })
  }
  if (!byIndex.size) throw new Error("交卷体检结果解析失败")
  const pick = (idx: number) => byIndex.get(idx) ?? { covered: false, evidence: "", suggestion: "" }
  const items: SubmissionCheckItem[] = [
    ...scoring.map((s, i) => {
      const v = pick(i + 1)
      return {
        index: i + 1,
        kind: "scoring" as const,
        label: s.item,
        covered: v.covered,
        evidence: v.evidence,
        severity: submissionSeverity("scoring", s.score),
        suggestion: v.covered ? "" : v.suggestion,
        review_status: "pending" as const,
        skip_reason: "",
      }
    }),
    ...voidClauses.map((c, i) => {
      const v = pick(scoring.length + i + 1)
      return {
        index: scoring.length + i + 1,
        kind: "void" as const,
        label: c,
        covered: v.covered,
        evidence: v.evidence,
        severity: submissionSeverity("void", 0),
        suggestion: v.covered ? "" : v.suggestion,
        review_status: "pending" as const,
        skip_reason: "",
      }
    }),
  ]
  return { items, checked_at: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// 第十六轮 B1：全局事实设定（AI 生成事实清单 + 事实一致性核对）
// ---------------------------------------------------------------------------

/** 事实一致性核对发现的矛盾项 */
export type FactConflict = {
  fact: string
  chapter: string
  quote: string
  suggestion: string
}

/**
 * 事实设定生成的输入材料：解析报告关键节全文按「节名 + 内容」拼接，截断 8000 字。
 * 只取 FACT_SOURCE_KEYS 与评分/响应相关节，避免把无关内容喂给模型。
 */
export function factSettingsSourceText(report: ParseReport | null): string {
  if (!report) return ""
  const extraKeys = ["tech_score", "biz_score", "response_req", "qualification", "void_items"]
  const keys = [...FACT_SOURCE_KEYS, ...extraKeys]
  const blocks: string[] = []
  for (const key of keys) {
    const sec = report.sections.find((s) => s.key === key)
    const text = (sec?.content ?? "").trim()
    if (!text) continue
    blocks.push(`【${sec?.title ?? key}】\n${text}`)
  }
  return clipText(blocks.join("\n\n"), 8000)
}

/** 改造 1.2：「AI 生成事实设定」prompt——投标一致性专家口径，输出一行一条「主题：统一口径」清单 */
export function buildFactSettingsMessages(reportText: string): LlmMessage[] {
  const system = [
    "你是投标文件一致性专家，负责在动笔前为整个投标团队定下「全局事实设定」——全文所有章节必须统一遵守的口径清单。",
    "提炼铁律：",
    "1. 一行一条，格式「主题：统一口径」，主题 2-12 字，口径给出确定数值/名称/表述（能引用招标原文数字的必须原样引用）；",
    "2. 重点覆盖最容易前后不一致的项：工期/交货期、响应时间（到场/故障响应/解决时限）、人员配置（人数/驻场/角色）、设备型号与数量、质保期/运维期、验收标准、项目经理及关键人、项目名称与编号、采购人、预算金额、投标保证金、服务地点、关键时间节点；",
    "3. 只输出材料中有依据的事实，材料没写的禁止编造；同一主题只保留一条；",
    "4. 事实不是要求摘录：「招标要求工期不超过 90 天」是要求不是事实，必须改写为「本项目工期：90 天（满足招标不超过 90 天要求）」这类以「本项目…」口径落定的事实句，禁止把要求原句直接当口径；",
    "5. 一条一事：每行只承载一个独立事实，人员配置与工期、金额与期限等多个取值必须拆成多行分别落定；",
    "6. 工期/交货期类事实必须包含：材料中找不到明确数值时，该行口径必须写「【需人工确认】」，严禁编造天数或日期；",
    "7. 输入材料含【历史标书范本摘录】时，同一主题的口径优先采用范本摘录中的数值与表述（范本是历史真实投标口径），范本未提及的再采用招标解析口径；",
    "8. 输出 10-30 条，按重要性排序；直接输出清单纯文本，禁止任何解释、禁止 markdown 代码围栏。",
  ].join("\n")
  const user = `【招标文件解析报告关键节】\n${reportText || "（解析报告为空）"}\n\n请输出全局事实设定清单（一行一条「主题：统一口径」）。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** AI 输出的事实清单 → 行数组（去编号/列表符号，过滤空行与超长行，上限 40 条） */
export function parseFactSettingsLines(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const rawLine of (raw ?? "").split(/\n+/)) {
    const line = stripEnumerator(rawLine.trim()).replace(/^[-*•·]+\s*/, "").trim()
    if (!line || line.length > 120) continue
    if (!/[：:=]/.test(line)) continue
    const key = line.slice(0, 20)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= 40) break
  }
  return out
}

/** 一条事实的主题词（检索关键词）：「主题：口径」取冒号前；「k=v」取等号前 */
export function factTopicOf(line: string): string {
  const t = (line ?? "").trim()
  const m = t.match(/^([^：:=]{2,20})[：:=]/)
  return (m ? m[1] : t).trim().slice(0, 20)
}

/**
 * 改造 1.3 本地检索：对每条事实取主题词在各章 content 内 indexOf 命中段落切片
 * （每段 ≤400 字、每事实 ≤3 段），拼成核对材料；零 AI 调用。
 */
export function collectFactEvidence(factLines: string[], chapters: Chapter[], maxPerFact = 3): string {
  const blocks: string[] = []
  for (const line of factLines) {
    const topic = factTopicOf(line)
    if (!topic) continue
    const hits: string[] = []
    for (const ch of chapters) {
      const content = ch.content ?? ""
      if (!content.trim()) continue
      let idx = content.indexOf(topic)
      let guard = 0
      while (idx >= 0 && hits.length < maxPerFact && guard < 6) {
        const from = Math.max(0, idx - 120)
        hits.push(`《${ch.title}》…${content.slice(from, idx + 280).replace(/\s+/g, " ")}…`)
        idx = content.indexOf(topic, idx + topic.length + 200)
        guard += 1
      }
      if (hits.length >= maxPerFact) break
    }
    blocks.push(`【事实】${line.trim()}\n${hits.length ? hits.map((h) => `- ${h}`).join("\n") : "- （正文中未检索到该主题词）"}`)
  }
  return clipText(blocks.join("\n\n"), 12000)
}

/** 改造 1.3：「事实一致性核对」prompt——输入事实表 + 命中段落，输出矛盾清单 JSON */
export function buildFactCheckMessages(factsBlock: string, evidenceText: string): LlmMessage[] {
  const system = [
    "你是投标文件一致性审查专家，负责核对标书正文与「全局事实设定」是否口径一致。",
    "核对铁律：",
    "1. 只依据给定段落判断，段落里出现的数值/名称/承诺与事实口径不一致（如工期天数不同、响应时限更长、人员数量更少、型号数量对不上）才算矛盾；",
    "2. 段落未提及该事实、或表述与事实一致/更优的，不算矛盾，禁止为凑数编造；",
    "3. quote 原样摘录矛盾句（≤80 字），chapter 用给定段落标注的章名，suggestion 给出应改成的统一口径（≤60 字）；",
    "4. 无任何矛盾时输出空数组 []。",
    "输出严格 JSON 数组，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"fact":"事实行","chapter":"章名","quote":"矛盾原句","suggestion":"修改建议"}]',
  ].join("\n")
  const user = `${factsBlock}\n\n【各章命中事实关键词的段落】\n${evidenceText || "（正文中未检索到任何事实关键词）"}\n\n请逐条核对并输出矛盾清单 JSON 数组。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** AI 输出 → 矛盾清单（解析失败返回空数组，由调用方给绿态文案） */
export function sanitizeFactConflicts(rawText: string): FactConflict[] {
  const data = extractJsonLoose(rawText)
  const rec = (data ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(data) ? data : rec.items ?? rec.results)
  const out: FactConflict[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const fact = asString(r.fact).trim()
    if (!fact) continue
    out.push({
      fact: fact.slice(0, 120),
      chapter: asString(r.chapter).trim().slice(0, 60),
      quote: asString(r.quote).trim().slice(0, 200),
      suggestion: asString(r.suggestion).trim().slice(0, 120),
    })
    if (out.length >= 50) break
  }
  return out
}

// ---------------------------------------------------------------------------
// 循环 2 批 1-1：审计自动修复闭环（矛盾清单 → 替换补丁 → 本地唯一命中校验后改写正文）
// ---------------------------------------------------------------------------

/** 一条替换补丁：old_text 必须原样复制自对应章正文且全章唯一命中，否则本地跳过 */
export type FactPatchItem = {
  chapter: string
  old_text: string
  new_text: string
}

/**
 * 「一键修复」prompt——输入矛盾清单 + 各矛盾所在章的正文截段（每章前 6000 字），
 * 输出 [{chapter, old_text, new_text}] 替换补丁；铁律要求 old_text 原样复制、唯一命中、
 * new_text 最小改动（本地校验见 useBidWorkspace.runFactPatch，不唯一/缺失一律跳过）。
 */
export function buildFactPatchMessages(conflicts: FactConflict[], chapters: Chapter[]): LlmMessage[] {
  const usedTitles: string[] = []
  const blocks: string[] = []
  for (const c of conflicts) {
    const t = (c.chapter ?? "").trim()
    if (!t || usedTitles.includes(t)) continue
    usedTitles.push(t)
    const ch =
      (chapters ?? []).find((x) => (x.title ?? "").trim() === t) ??
      (chapters ?? []).find((x) => {
        const xt = (x.title ?? "").trim()
        return xt !== "" && (xt.includes(t) || t.includes(xt))
      })
    blocks.push(`【章名：${t}】\n${clipText(ch?.content ?? "（未找到该章正文）", 6000)}`)
  }
  const conflictLines = (conflicts ?? [])
    .map(
      (c, i) =>
        `${i + 1}. 事实口径：${c.fact}\n   所在章：${c.chapter || "（未标注）"}\n   矛盾原句：「${c.quote}」\n   修改建议：${c.suggestion || "（无）"}`,
    )
    .join("\n")
  const system = [
    "你是投标文件正文修复专家。给你「事实口径矛盾清单」与矛盾所在章的正文截段，请生成精确的替换补丁，把正文中与事实口径矛盾的句子改成与口径一致。",
    "修复铁律：",
    "1. old_text 必须从下面正文截段中逐字原样复制（含标点与空格），并且必须在该章全文中只出现一次；严禁改写、缩写、拼接跨句或自造正文里没有的片段；",
    "2. new_text 是在 old_text 基础上做最小改动后的文本：只修改与事实口径矛盾的数值/名称/期限等成分，其余文字保持原样，长度与 old_text 相近；",
    "3. 只修复矛盾清单涉及的句子，清单以外的内容一律不动；正文截段里找不到矛盾原句、或拿不准怎么改的条目，直接不输出该条，禁止硬凑；",
    "4. chapter 填矛盾清单标注的章名原文；",
    "5. 输出严格 JSON 数组，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"chapter":"章名","old_text":"原样复制自正文的片段","new_text":"修改后的片段"}]',
  ].join("\n")
  const user = `【事实口径矛盾清单】\n${conflictLines || "（无矛盾）"}\n\n【矛盾所在章正文截段】\n${blocks.join("\n\n") || "（无正文截段）"}\n\n请输出替换补丁 JSON 数组。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** AI 输出 → 替换补丁清单（解析失败抛错交由调用方 JSON 修复重试；空改/超长条目过滤，上限 50 条） */
export function sanitizeFactPatches(rawText: string): FactPatchItem[] {
  const data = extractJsonLoose(rawText)
  const rec = (data ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(data) ? data : rec.items ?? rec.patches)
  const out: FactPatchItem[] = []
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const oldText = asString(r.old_text ?? r.oldText)
    const newText = asString(r.new_text ?? r.newText)
    if (!oldText.trim() || !newText.trim() || oldText === newText) continue
    out.push({
      chapter: asString(r.chapter).trim().slice(0, 60),
      old_text: oldText.slice(0, 2000),
      new_text: newText.slice(0, 2000),
    })
    if (out.length >= 50) break
  }
  return out
}

// ---------------------------------------------------------------------------
// 循环 2 批 1-2：LLM JSON 修复重试（本地宽松解析失败后的一次「只修语法不改内容」修复调用）
// ---------------------------------------------------------------------------

/**
 * JSON 语法修复 prompt——只修语法不改内容、截断按已有结构补全闭合、只输出 JSON；
 * 费用由各入口原有的费用确认覆盖，不单独弹确认。
 */
export function buildJsonRepairMessages(badText: string): LlmMessage[] {
  const system = [
    "你是 JSON 语法修复器。用户给你一段 JSON 解析失败的模型输出文本，你只允许修复语法问题，严禁改动任何内容。",
    "修复铁律：",
    "1. 只修语法不改内容：不得增删改任何字段名、字段值、数字与文字表述；",
    "2. 文本被截断时按已有结构补全闭合括号与引号，严禁编造新条目或新内容；",
    "3. 剥除 markdown 代码围栏与解释文字，只保留 JSON 本体；",
    "4. 只输出修复后的合法 JSON，禁止任何解释、禁止代码围栏。",
  ].join("\n")
  const user = `【解析失败的原始输出】\n${clipText(badText ?? "", 12000)}\n\n请输出修复后的合法 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// ---------------------------------------------------------------------------
// 第十六轮 B2 改造 2.1：预编排（表格/配图）——类型、本地工具与批量编排 prompt
// ---------------------------------------------------------------------------

export type OrchestrationFigureType = "architecture" | "flow" | "demo"

export const ORCHESTRATION_FIGURE_TYPE_LABEL: Record<OrchestrationFigureType, string> = {
  architecture: "架构图",
  flow: "流程图",
  demo: "界面示意",
}

export type OrchestratedTable = { needed: boolean; purpose: string }

export type OrchestratedFigure = {
  needed: boolean
  type: OrchestrationFigureType
  title: string
  /** 3-5（5=最该配图）；priority<3 在清洗时强制置 needed=false */
  priority: number
  reason: string
  /** 循环 2 批 2-1：图注——描述这张图呈现什么、与本节正文的关联（导出时随图插入图注行） */
  caption?: string
  /** 程序全局择优结果：true=该叶获得全文配图名额（LLM 不输出，selectOrchestrationFigures 写入） */
  selected: boolean
}

export type LeafOrchestration = {
  table?: OrchestratedTable
  figure?: OrchestratedFigure
  /** 循环 2 批 2-1：从全局事实表行定向挑选的本节必守事实（≤5 条；非空时章/节 prompt 以定向事实块替代全量全局事实注入） */
  facts?: string[]
  /** 循环 2 批 2-1：一句话写作焦点 + 对应评分点（进章/节生成规则句） */
  writing_focus?: string
}

/** 存进 bid_projects.orchestration（json 列）的编排结果 */
export type BidOrchestration = {
  /** key = 大纲叶子 nodeId */
  leaves: Record<string, LeafOrchestration>
  generated_at: string
}

/** 全文配图上限默认值（max_figures 留空时生效；0=不配图；figures_enabled 仍是总开关） */
export const DEFAULT_MAX_FIGURES = 6

export function effectiveMaxFigures(v: number | null | undefined): number {
  if (v === null || v === undefined) return DEFAULT_MAX_FIGURES
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_MAX_FIGURES
  return Math.min(20, Math.max(0, Math.round(n)))
}

export type TechLeafRef = { nodeId: string; title: string; chapter: string }

/** 按文档顺序收集技术章叶子（part!=="biz" 顶层章下的末端节点；技术章自身无 children 时自己算叶子） */
export function collectTechLeafRefs(nodes: OutlineNode[]): TechLeafRef[] {
  const out: TechLeafRef[] = []
  const walk = (list: OutlineNode[], chapter: string) => {
    for (const n of list ?? []) {
      const kids = n.children ?? []
      if (kids.length) walk(kids, chapter)
      else out.push({ nodeId: n.id, title: n.title, chapter })
    }
  }
  for (const top of nodes ?? []) {
    if (isBizPart(top)) continue
    walk([top], top.title)
  }
  return out
}

/** 某节点下全部叶子 id（自身无 children 时即自身） */
function collectLeafIdsUnder(node: OutlineNode): string[] {
  const kids = node.children ?? []
  if (!kids.length) return [node.id]
  const out: string[] = []
  for (const k of kids) out.push(...collectLeafIdsUnder(k))
  return out
}

/** 编排批量调用的单批叶子上限（规格硬约束 ≤10 叶/次） */
export const ORCHESTRATION_BATCH_SIZE = 10

/** 编排输入的项目概述节：项目概述 + 项目信息 + 技术需求摘录（本地拼接，零 AI） */
export function orchestrationProjectBrief(report: ParseReport | null): string {
  const blocks: string[] = []
  for (const key of ["overview", "project_info", "delivery_req"]) {
    const text = sectionText(report, key).trim()
    if (text) blocks.push(`【${parseSectionTitle(key)}】\n${text}`)
  }
  return clipText(blocks.join("\n\n"), 4000)
}

/**
 * 改造 2.1：预编排批量 prompt——正文编排助手口径、克制判断，输出每叶 {table, figure} JSON。
 * 循环 2 批 2-1：输入增全局事实表行与评分项清单，输出增 facts（本节必守事实，从输入事实行挑选）/
 * writing_focus（一句话写作焦点+对应评分点）/ figure.caption（图注）；缺省不传时行为与现状一致。
 */
export function buildOrchestrationMessages(
  batch: TechLeafRef[],
  projectBrief: string,
  opts?: { factsLines?: string[]; scoringItems?: ScoringItem[] },
): LlmMessage[] {
  const factsLines = (opts?.factsLines ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 40)
  const scoringItems = (opts?.scoringItems ?? []).slice(0, 40)
  const system = [
    "你是投标文件正文编排助手，负责在动笔前为技术标大纲的每个叶子节点做克制的版面编排判断：这一节正文放一个表格是否真能提升清晰度、这一节是否值得配一张架构图/流程图/界面示意图，并为这一节挑选必守事实、给出写作焦点。",
    "编排铁律（克制优先，宁缺毋滥）：",
    "1. table.needed=true 仅当该节内容天然是多维对照信息（参数对照、配置清单、人员分工、进度计划、指标承诺、设备清单等）、表格确实能提升评标专家阅读清晰度时才给；纯论述、纯方案描述一律 needed=false、purpose 留空；",
    "2. figure.needed=true 仅当该节是具象工程场景（系统架构、业务流程、界面功能布局）且一张图能让评标专家快速理解时才给；抽象论述（项目理解、需求分析、保障措施、管理制度等）一律 needed=false；",
    "3. figure.priority 取 3-5 的整数（5=最该配图）；priority 低于 3 的一律置 needed=false，禁止为凑数抬高优先级；",
    "4. figure.type 按内容选 architecture/flow/demo；figure.title 用「××架构图 / ××流程图 / ××界面示意」式具体命名（≤20 字）；reason ≤30 字说明配图价值；table.purpose ≤40 字说明表格呈现什么；",
    "5. 只依据叶子标题、上级章、项目概述与给定的事实表行、评分项清单判断，禁止编造输入里没有的内容；拿不准就 needed=false；",
    "6. facts：从下面【全局事实表行】里挑选本节正文写作必须遵守的事实行（原样照抄整行，≤5 条；只挑与本节主题直接相关的，禁止改写数值、禁止编造；没有可挑的输出空数组）；",
    "7. writing_focus：一句话（≤50 字）点明本节的写作焦点与对应评分点——对照下面【评分项清单】写出对应评分项名，没有对应评分点时聚焦本节标题的实质性响应；",
    "8. figure.needed=true 时必须同时给 figure.caption：图注（≤40 字），说明这张图呈现什么、如何支撑本节正文；",
    "9. 相邻小节不连续同类型图：清单中相邻的两个叶子都值得配图时，figure.type 尽量错开（architecture/flow/demo 交替），程序选定后还会做邻接同类型查重。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（items 与输入叶子清单一一对应，node_id 原样回填）：",
    '{"items":[{"node_id":"叶子ID","facts":["事实行1"],"writing_focus":"写作焦点（对应评分点）","table":{"needed":false,"purpose":""},"figure":{"needed":true,"type":"architecture","title":"图名","caption":"图注","priority":4,"reason":"理由"}}]}',
  ].join("\n")
  const user = [
    projectBrief ? `【项目概述】\n${projectBrief}` : "",
    factsLines.length
      ? `【全局事实表行（facts 只能从这里原样挑选，禁止编造）】\n${factsLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
      : "",
    scoringItems.length
      ? `【评分项清单（writing_focus 对应评分点从这里选）】\n${scoringItems
          .map((s, i) => `${i + 1}. ${s.item}（${s.score} 分）`)
          .join("\n")}`
      : "",
    `【本批叶子清单（共 ${batch.length} 个，逐个判断；相邻叶子配图类型尽量错开）】\n${batch
      .map((l, i) => `${i + 1}. node_id=${l.nodeId}｜标题：${l.title}｜上级章：${l.chapter}`)
      .join("\n")}`,
    "请为清单中每个叶子输出编排判断 JSON（node_id 原样回填，漏判按 needed=false、facts 空数组处理）。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 单批编排输出清洗：只收本批合法 nodeId；table 无 purpose 视为不需要；figure priority<3 或无标题强制 needed=false；facts ≤5 条、writing_focus/caption 截断保留 */
export function sanitizeOrchestrationBatch(rawText: string, validIds: Set<string>): Record<string, LeafOrchestration> {
  const data = extractJsonLoose(rawText)
  const rec = (data ?? {}) as Record<string, unknown>
  const arr = asArray(Array.isArray(data) ? data : rec.items ?? rec.leaves)
  const out: Record<string, LeafOrchestration> = {}
  for (const it of arr) {
    const r = (it ?? {}) as Record<string, unknown>
    const id = asString(r.node_id ?? r.nodeId ?? r.id).trim()
    if (!id || !validIds.has(id)) continue
    const entry: LeafOrchestration = {}
    const t = (r.table ?? {}) as Record<string, unknown>
    const tPurpose = asString(t.purpose).trim().slice(0, 80)
    if (t.needed === true && tPurpose) entry.table = { needed: true, purpose: tPurpose }
    const f = (r.figure ?? {}) as Record<string, unknown>
    const fTypeRaw = asString(f.type).trim()
    const fType: OrchestrationFigureType = fTypeRaw === "flow" || fTypeRaw === "demo" ? fTypeRaw : "architecture"
    const fPriority = Math.min(5, Math.max(1, Math.round(asNumber(f.priority) || 3)))
    const fTitle = asString(f.title).trim().slice(0, 40)
    const fCaption = asString(f.caption).trim().slice(0, 60)
    if (f.needed === true && fPriority >= 3 && fTitle) {
      entry.figure = {
        needed: true,
        type: fType,
        title: fTitle,
        priority: fPriority,
        reason: asString(f.reason).trim().slice(0, 60),
        ...(fCaption ? { caption: fCaption } : {}),
        selected: false,
      }
    }
    // 循环 2 批 2-1：定向事实行（≤5 条）与写作焦点（缺省走现状，老编排无字段不受影响）
    const facts = asArray(r.facts)
      .map((x) => asString(x).trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 5)
    if (facts.length) entry.facts = facts
    const focus = asString(r.writing_focus ?? r.writingFocus).trim().slice(0, 100)
    if (focus) entry.writing_focus = focus
    if (entry.table || entry.figure || entry.facts || entry.writing_focus) out[id] = entry
  }
  return out
}

/**
 * 改造 2.1 程序全局择优：figure 候选按叶子文档顺序均分成 maxFigures 段、每段取 priority 最高者
 * （同分取段内靠前者）。均分分段保证配图均匀散布全文，避免「头重脚轻」（前几章堆满、后面全无）。
 * 候选数 ≤ 上限时全选；上限 0 或无候选时不选。直接改写 leaves 里的 selected 标记，返回选中张数。
 * 循环 2 批 2-1 邻接避同：段选后按文档序校验，选中序列相邻两叶 figure.type 相同时，
 * 后者换成段内类型不同的次高 priority 候选；段内无次高则弃选该段（宁缺毋滥，不强凑同类型相邻图）。
 */
export function selectOrchestrationFigures(
  leafOrder: string[],
  leaves: Record<string, LeafOrchestration>,
  maxFigures: number,
): number {
  // 先全量清除旧标记（重复编排时不残留上一轮选中态）
  for (const id of Object.keys(leaves)) {
    const entry = leaves[id]
    if (entry?.figure) leaves[id] = { ...entry, figure: { ...entry.figure, selected: false } }
  }
  const cap = Math.max(0, Math.min(20, Math.round(maxFigures)))
  const candidates = (leafOrder ?? []).filter((id) => leaves[id]?.figure?.needed)
  if (!candidates.length || cap === 0) return 0
  // 分段：候选数 ≤ 上限时每候选自成一档；否则均分 cap 段（段间不重不漏，与既有口径一致）
  const segments: number[][] = []
  if (candidates.length <= cap) {
    for (let i = 0; i < candidates.length; i++) segments.push([i])
  } else {
    const n = candidates.length
    for (let s = 0; s < cap; s++) {
      const from = Math.floor((s * n) / cap)
      const to = Math.max(from + 1, Math.floor(((s + 1) * n) / cap))
      const seg: number[] = []
      for (let i = from; i < to && i < n; i++) seg.push(i)
      segments.push(seg)
    }
  }
  const typeOf = (idx: number): OrchestrationFigureType => leaves[candidates[idx]]?.figure?.type ?? "architecture"
  const prioOf = (idx: number): number => leaves[candidates[idx]]?.figure?.priority ?? 0
  const pickBest = (seg: number[], used: Set<number>, avoidType?: OrchestrationFigureType): number => {
    let best = -1
    for (const i of seg) {
      if (used.has(i)) continue
      if (avoidType && typeOf(i) === avoidType) continue
      if (best === -1 || prioOf(i) > prioOf(best)) best = i
    }
    return best
  }
  const winners: number[] = []
  const used = new Set<number>()
  for (const seg of segments) {
    const prevType = winners.length ? typeOf(winners[winners.length - 1]) : undefined
    let pick = pickBest(seg, used)
    if (pick !== -1 && prevType !== undefined && typeOf(pick) === prevType) {
      // 邻接同类型：换段内类型不同的次高；无次高则弃选本段
      pick = pickBest(seg, used, prevType)
    }
    if (pick === -1) continue
    used.add(pick)
    winners.push(pick)
  }
  for (const idx of winners) {
    const id = candidates[idx]
    const entry = leaves[id]
    if (entry?.figure) leaves[id] = { ...entry, figure: { ...entry.figure, selected: true } }
  }
  return winners.length
}

/** bid_projects.orchestration 列反序列化容错（形状不符/存量缺列 → null=未编排） */
export function normalizeOrchestration(raw: unknown): BidOrchestration | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const leavesRaw = rec.leaves
  if (!leavesRaw || typeof leavesRaw !== "object" || Array.isArray(leavesRaw)) return null
  const leaves: Record<string, LeafOrchestration> = {}
  for (const [id, v] of Object.entries(leavesRaw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue
    const e = v as Record<string, unknown>
    const entry: LeafOrchestration = {}
    const t = e.table as Record<string, unknown> | undefined
    const tPurpose = t ? asString(t.purpose).trim().slice(0, 80) : ""
    if (t?.needed === true && tPurpose) entry.table = { needed: true, purpose: tPurpose }
    const f = e.figure as Record<string, unknown> | undefined
    const fTitle = f ? asString(f.title).trim().slice(0, 40) : ""
    if (f?.needed === true && fTitle) {
      const fTypeRaw = asString(f.type).trim()
      const fCaption = asString(f.caption).trim().slice(0, 60)
      entry.figure = {
        needed: true,
        type: fTypeRaw === "flow" || fTypeRaw === "demo" ? fTypeRaw : "architecture",
        title: fTitle,
        priority: Math.min(5, Math.max(3, Math.round(asNumber(f.priority) || 3))),
        reason: asString(f.reason).trim().slice(0, 60),
        ...(fCaption ? { caption: fCaption } : {}),
        selected: f.selected === true,
      }
    }
    // 循环 2 批 2-1：存量编排无 facts/writing_focus 字段时缺省走现状（消费侧自动回退全量事实注入）
    const facts = Array.isArray(e.facts)
      ? (e.facts as unknown[]).map((x) => asString(x).trim().slice(0, 80)).filter(Boolean).slice(0, 5)
      : []
    if (facts.length) entry.facts = facts
    const focus = asString(e.writing_focus).trim().slice(0, 100)
    if (focus) entry.writing_focus = focus
    if (entry.table || entry.figure || entry.facts || entry.writing_focus) leaves[id] = entry
  }
  if (!Object.keys(leaves).length) return null
  return { leaves, generated_at: asString(rec.generated_at).trim() }
}

export type OrchestrationSummary = { leafCount: number; tableCount: number; figureCount: number; generatedAt: string }

/** 编排结果概览（UI 展示用；未编排/空结果返回 null） */
export function summarizeOrchestration(orch: BidOrchestration | null): OrchestrationSummary | null {
  if (!orch) return null
  const entries = Object.values(orch.leaves)
  if (!entries.length) return null
  return {
    leafCount: entries.length,
    tableCount: entries.filter((e) => e.table?.needed).length,
    figureCount: entries.filter((e) => e.figure?.selected).length,
    generatedAt: orch.generated_at,
  }
}

// ------------------------------ 第十六轮 B2 改造 2.2：编排结果消费（叶 → 章/节映射） ------------------------------

export type MergedOrchestration = {
  /** 本章/节合并范围内被全局选中的唯一一张配图（未选中则缺省） */
  figure?: { type: OrchestrationFigureType; title: string; caption?: string }
  /** 本章/节的表格建议（合并范围内第一个 needed 的 purpose） */
  table?: { purpose: string }
  /** 循环 2 批 2-1：合并范围内的定向事实行（按文档序去重，≤8 条；非空时替代全量全局事实注入） */
  facts?: string[]
  /** 循环 2 批 2-1：合并范围内的写作焦点（取前 3 条用「；」连接；进章/节生成规则句） */
  writing_focus?: string
}

/**
 * 多叶编排合并为章/节级提示。映射规则（编排叶=大纲末端节点，章生成时 sections 为二级、叶可能是三级）：
 * - figure：取范围内所有「needed 且被全局选中」的配图中 priority 最高的 1 个（同分取文档序靠前）——每章/节至多 1 张；
 * - table：取范围内第一个 needed=true 的表格 purpose（表格提示成本低，每级取一处即可）；
 * - facts/writing_focus（循环 2 批 2-1）：按文档序合并去重（facts ≤8 条、focus ≤3 条）；
 * - 全部皆无时返回空对象（调用方仍视为「已编排覆盖」，figures 相应强制关）。
 */
export function mergeLeafOrchestrations(orch: BidOrchestration, leafIds: string[]): MergedOrchestration {
  const merged: MergedOrchestration = {}
  let best: OrchestratedFigure | null = null
  const facts: string[] = []
  const focuses: string[] = []
  for (const id of leafIds) {
    const e = orch.leaves[id]
    if (!e) continue
    if (e.figure?.needed && e.figure.selected && (!best || e.figure.priority > best.priority)) best = e.figure
    if (!merged.table && e.table?.needed && e.table.purpose) merged.table = { purpose: e.table.purpose }
    for (const f of e.facts ?? []) {
      const t = f.trim()
      if (t && !facts.includes(t) && facts.length < 8) facts.push(t)
    }
    const wf = (e.writing_focus ?? "").trim()
    if (wf && !focuses.includes(wf) && focuses.length < 3) focuses.push(wf)
  }
  if (best) merged.figure = { type: best.type, title: best.title, ...(best.caption ? { caption: best.caption } : {}) }
  if (facts.length) merged.facts = facts
  if (focuses.length) merged.writing_focus = focuses.join("；")
  return merged
}

/** 循环 2 批 2-1：编排定向事实块——facts 非空时替代全量全局事实注入章/节 prompt（空清单返回空串=保持全量） */
export function buildDirectedFactsBlock(facts: string[] | undefined | null): string {
  const rows = (facts ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 8)
  if (!rows.length) return ""
  return `【本章必守事实】（从全局事实表中为本章定向挑选的事实行，正文出现这些事实值时必须与之一致，禁止编造不同数值）\n${rows.join("\n")}`
}

/**
 * 循环 2 批 2-1：把编排图注写进生成图——标题精确匹配优先；仅一张图时直接挂。
 * 无图注 / 无图时原样返回（老项目与未编排路径行为不变）。
 */
export function attachFigureCaptions(
  figures: FigureSpec[],
  orchFigure?: { title: string; caption?: string } | null,
): FigureSpec[] {
  const caption = (orchFigure?.caption ?? "").trim()
  if (!caption || !figures?.length) return figures ?? []
  const title = (orchFigure?.title ?? "").trim()
  const hit = figures.find((f) => (f.title ?? "").trim() === title)
  if (hit) return figures.map((f) => (f === hit ? { ...f, caption } : f))
  if (figures.length === 1) return figures.map((f) => ({ ...f, caption }))
  return figures
}

/**
 * 章级编排视图：合并该章大纲节点下所有叶子的编排。
 * covered=false 表示该章的叶子在编排结果里一个都找不到（如编排后重新生成过大纲、nodeId 全换了），
 * 调用方此时应回退现状 figures_enabled 逻辑，而不是把配图强制关掉。
 */
export function chapterOrchestration(
  orch: BidOrchestration | null,
  outline: OutlineNode[],
  chapterNodeId: string,
): { covered: boolean; merged: MergedOrchestration } | null {
  if (!orch) return null
  const node = (outline ?? []).find((n) => n.id === chapterNodeId)
  if (!node) return null
  const leafIds = collectLeafIdsUnder(node)
  const covered = leafIds.some((id) => Boolean(orch.leaves[id]))
  return { covered, merged: mergeLeafOrchestrations(orch, leafIds) }
}

/**
 * 节级编排视图：节名即章节点下二级节点标题，按标题精确匹配（trim 后全等）找到该二级节点，
 * 再合并其下全部叶子（节自身无 children 时节即叶子）的编排；找不到同名二级节点视为未覆盖。
 */
export function sectionOrchestration(
  orch: BidOrchestration | null,
  outline: OutlineNode[],
  chapterNodeId: string,
  sectionTitle: string,
): { covered: boolean; merged: MergedOrchestration } | null {
  if (!orch) return null
  const node = (outline ?? []).find((n) => n.id === chapterNodeId)
  if (!node) return null
  const needle = (sectionTitle ?? "").trim()
  const sec = (node.children ?? []).find((c) => c.title.trim() === needle)
  if (!sec) return { covered: false, merged: {} }
  const leafIds = collectLeafIdsUnder(sec)
  const covered = leafIds.some((id) => Boolean(orch.leaves[id]))
  return { covered, merged: mergeLeafOrchestrations(orch, leafIds) }
}

// ---------------------------------------------------------------------------
// 循环 5 A2：覆盖审计与补写——逐节核对写作方案（写作焦点/必守事实/表格计划）是否在正文落实
// ---------------------------------------------------------------------------

/** 审计输入：每个技术叶节点的写作方案 + 正文摘录（hook 本地拼装，零 AI） */
export type CoverageAuditLeafInput = {
  leaf_id: string
  title: string
  chapter: string
  writing_focus: string
  facts: string[]
  table_plan: string
  body_excerpt: string
}

export type CoverageLevel = "full" | "partial" | "missing"

export const COVERAGE_LEVEL_LABEL: Record<CoverageLevel, string> = {
  full: "全部落实",
  partial: "部分落实",
  missing: "未落实",
}

/** 审计结果条目（leaf_id 与输入一一对应；结果仅会话内有效，零 collection 变更） */
export type CoverageAuditEntry = {
  leaf_id: string
  title: string
  covered: CoverageLevel
  missing_points: string[]
  suggestion: string
}

/** 覆盖审计 prompt：一次调用核对全部技术叶，输出逐节 JSON 报告（正文摘录截断在调用方完成以控 token） */
export function buildCoverageAuditMessages(leaves: CoverageAuditLeafInput[]): LlmMessage[] {
  const blocks = leaves
    .map((l, i) =>
      [
        `【第${i + 1}节】leaf_id: ${l.leaf_id}`,
        `标题：${l.title}（所属章：${l.chapter}）`,
        `写作焦点：${l.writing_focus.trim() || "（未设置）"}`,
        l.facts.length
          ? `必守事实：\n${l.facts.map((f, j) => `${j + 1}. ${f}`).join("\n")}`
          : "必守事实：（无）",
        `表格计划：${l.table_plan.trim() || "（无）"}`,
        `正文摘录（前 800 字截断）：${l.body_excerpt.trim() || "（正文为空）"}`,
      ].join("\n"),
    )
    .join("\n\n")
  const system = [
    "你是标书质量审核专家，逐节核对写作方案计划的内容（写作焦点、必守事实、表格计划）是否在该节正文中落实。",
    "判定口径：",
    "1. 计划要点在正文中全部有对应落实 → covered=full；",
    "2. 部分要点落实、存在遗漏 → covered=partial，missing_points 逐条列出遗漏的计划要点；",
    "3. 正文为空或计划几乎全部未落实 → covered=missing，missing_points 列出全部未落实要点；",
    "4. 未设置任何计划（焦点/事实/表格均空）的节，按正文是否实质响应节标题判定。",
    "missing_points 每条不超过 40 字、最多 6 条，必须是计划或标题响应中可核对的要点，禁止编造额外要求；covered=full 时输出空数组。",
    "suggestion 写不超过 60 字的补写建议（full 时可为空串）。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"leaf_id":"","covered":"full","missing_points":[],"suggestion":""}]',
  ].join("\n")
  const user = `${clipText(blocks, 24000)}\n\n请逐节核对写作方案是否在正文中落实，输出 JSON 数组（每个 leaf_id 都要出现在返回里）。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 审计输出清洗：只收输入清单内的 leaf_id；covered 归一三档（非法值按 missing_points 判）；按输入文档序去重输出 */
export function sanitizeCoverageAudit(rawText: string, inputLeaves: CoverageAuditLeafInput[]): CoverageAuditEntry[] {
  const data = extractJsonLoose(rawText)
  const rec = data as Record<string, unknown> | null
  const arr = asArray(Array.isArray(data) ? data : (rec?.items ?? rec?.results ?? rec?.audit))
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const id = asString(r.leaf_id ?? r.leafId ?? r.node_id).trim()
    if (id && !byId.has(id)) byId.set(id, r)
  }
  const out: CoverageAuditEntry[] = []
  for (const leaf of inputLeaves) {
    const row = byId.get(leaf.leaf_id)
    if (!row) continue
    const rawLevel = asString(row.covered).trim().toLowerCase()
    const points = asArray(row.missing_points ?? row.missingPoints)
      .map((x) => asString(x).trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 6)
    const level: CoverageLevel =
      rawLevel === "full" || rawLevel === "partial" || rawLevel === "missing"
        ? (rawLevel as CoverageLevel)
        : points.length
          ? "partial"
          : "full"
    const covered: CoverageLevel = level === "full" && points.length ? "partial" : level
    out.push({
      leaf_id: leaf.leaf_id,
      title: leaf.title,
      covered,
      missing_points: covered === "full" ? [] : points,
      suggestion: asString(row.suggestion).trim().slice(0, 120),
    })
  }
  return out
}

/**
 * 叶子定位：返回叶子所属顶层章 nodeId 与其二级小节标题（章自身即叶子时 sectionTitle 为空串）。
 * 供「补写」把审计叶子映射回既有条级重写（章 nodeId + sectionIdx）链路，不新造生成通道。
 */
export function resolveLeafSection(
  outline: OutlineNode[],
  leafId: string,
): { chapterId: string; sectionTitle: string } | null {
  for (const top of outline ?? []) {
    if (top.id === leafId) return { chapterId: top.id, sectionTitle: "" }
    for (const sec of top.children ?? []) {
      if (sec.id === leafId) return { chapterId: top.id, sectionTitle: sec.title }
      if (collectLeafIdsUnder(sec).includes(leafId)) return { chapterId: top.id, sectionTitle: sec.title }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 第十六轮 B2 改造 2.3：长标书分步大纲（leafGoal 超阈值时：顶层章一次 + 技术章逐章展开）
// ---------------------------------------------------------------------------

/** 分步触发阈值：目标叶子数超过该值时大纲生成自动改走分步（单次大 JSON 输出在长规模下易截断/失衡） */
export const STAGED_OUTLINE_LEAF_GOAL = 40

/**
 * 分步大纲 call1：只生成顶层章清单——商务骨架章（含一级小节）+ 技术章（仅标题、children 为空）。
 * 商务章仍由模型按招标要求增删（与单次生成同口径），技术章的章内展开交给 call2 逐章做。
 */
export function buildOutlineLevel1Messages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  opts?: {
    globalFacts?: string
    implicitConstraints?: string[]
    techChapterHint?: number
    /** 用户反馈轮项 3：是否输出商务标骨架章（缺省 true；false 时商务段整体替换为「不输出任何商务章节」） */
    includeBiz?: boolean
  },
): LlmMessage[] {
  const includeBiz = opts?.includeBiz !== false
  const scoringText = combinedScoringText(report)
  const bizText = sectionText(report, "biz_score")
  const respText = sectionText(report, "response_req")
  const qualText = sectionText(report, "qualification")
  const starText = sectionText(report, STAR_CLAUSE_SECTION.key).trim()
  const implicitList = opts?.implicitConstraints ?? []
  const techHint = Math.max(4, Math.min(16, Math.round(opts?.techChapterHint ?? 8)))
  const numbered: string[] = includeBiz
    ? [
        "顶层章分「商务部分」与「技术部分」两组：商务章在前、技术章在后，每个顶层章对象必须带 part 字段（\"biz\"=商务章、\"tech\"=技术章）；",
        "商务部分输出 6-10 个骨架章（part=\"biz\"）：投标函及报价、法定代表人授权、资质与证照证明、财务审计报告、同类项目业绩、商务条款响应/偏离表、售后服务承诺函、中小企业声明等，按下面【响应文件要求】【资质要求】【商务评分办法】的实际内容增删；商务章 children 只列一级小节名（不展开三级），正文由投标人线下填写；",
      ]
    : [
        "顶层章全部为技术部分：每个顶层章对象必须带 part 字段（一律 \"tech\"）；",
        "本次不输出任何商务部分章节（part=\"biz\"），大纲仅含技术标章节；投标函、资质证照、商务偏离表等商务内容由投标人线下自行处理，禁止为其安排任何章节；",
      ]
  numbered.push(
    `技术部分（part=\"tech\"）输出 ${techHint} 个左右的顶层章、children 一律为空数组（章内小节由后续步骤逐章展开，本次禁止展开）：以评分办法为纲，把下面技术评分的重要评分项分组成章，章与章之间范围互斥、合起来覆盖全部技术评分项与响应文件要求；`,
    "技术章常规骨架参考：项目理解与需求分析、总体建设方案、详细技术方案（可按系统拆多章）、项目实施组织与进度计划、质量保障与测试验收、培训方案、售后服务与运维保障、应急预案；再按本招标文件增删；",
    "标题只写名称、不带编号、不以标点结尾；章标题必须具体（主题词+落点词），禁止「概述/说明/介绍/相关内容/其他」式空泛命名；",
  )
  if (starText) {
    numbered.push(
      `下面【★/▲ 重点条款】为实质性响应条款，任何一条未响应都可能直接废标：必须让每条重点条款都有明确的顶层章落点${
        includeBiz ? "（商务类落商务章、技术类落技术章）" : "（一律落技术章）"
      }，禁止只靠通用章笼统带过；`,
    )
  }
  if (implicitList.length) {
    numbered.push(
      `下面【招标隐式硬约束】共 ${implicitList.length} 条（如页数/份数/装订/格式等刚性要求），任何一条被违反都可能废标，必须有对应顶层章落点；`,
    )
  }
  numbered.push(
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"outline":[{"title":"商务章标题","part":"biz","children":[{"title":"小节标题","children":[]}]},{"title":"技术章标题","part":"tech","children":[]}]}',
  )
  const system = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，擅长按评分办法组织技术标结构。当前任务：为投标项目「${projectName}」（采购人：${hospital || "未填写"}）生成响应大纲的【顶层章清单】（本次只到章一级）。`,
    "硬性要求：",
    ...numbered.map((t, i) => `${i + 1}. ${t}`),
  ].join("\n")
  const stableParts = [
    `【技术评分办法（逐项分值）】\n${scoringText || "（未解析到技术评分）"}`,
    // 用户反馈轮项 3：不含商务章时商务评分办法不再注入（避免误导模型输出商务章）
    ...(includeBiz ? [`【商务评分办法】\n${bizText || "（未解析到商务评分）"}`] : []),
    `【响应文件要求】\n${respText || "（未解析到响应要求）"}`,
    `【资质要求】\n${qualText || "（无）"}`,
  ]
  if (opts?.globalFacts) stableParts.push(opts.globalFacts)
  if (implicitList.length) {
    stableParts.push(
      `【招标隐式硬约束（任何一条被违反都可能废标）】\n${implicitList.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    )
  }
  if (starText) stableParts.push(`【★/▲ 重点条款（实质性响应条款，每条必须有顶层章落点）】\n${clipText(starText, 6000)}`)
  return [
    { role: "system", content: system },
    { role: "user", content: stableParts.join("\n\n") },
    {
      role: "user",
      content: includeBiz
        ? "请输出这份投标文件响应大纲的顶层章清单 JSON（商务骨架章在前且含一级小节，技术章在后且 children 为空数组，顶层章带 part 字段）。"
        : "请输出这份投标文件响应大纲的顶层章清单 JSON（全部为技术章且 children 为空数组，顶层章 part 一律为 tech，不输出任何商务章节）。",
    },
  ]
}

/**
 * 分步大纲 call2：为单个技术章展开章内节/条（最多两层，输出即该章 children）。
 * 注入该章标题 + 评分相关节 + 其余技术章标题（防跨章重复）+ 叶子配额（全局目标均分，±2 容差）。
 */
export function buildOutlineChildrenMessages(
  chapterTitle: string,
  otherChapterTitles: string[],
  report: ParseReport | null,
  opts: { quota: number; level: 0 | 1 | 2 | 3; sectionWords: number; globalFacts?: string },
): LlmMessage[] {
  const scoringText = combinedScoringText(report)
  const techText = sectionText(report, "delivery_req")
  const quota = Math.max(1, Math.round(opts.quota))
  const lo = Math.max(1, quota - 2)
  const hi = quota + 2
  const depthRule =
    opts.level === 2
      ? "层级硬约束：本章恰好一层子节点（章—节），只输出节节点、每个节节点 children 为空数组，禁止第三层；"
      : opts.level === 3
        ? "层级硬约束：本章恰好两层子节点（章—节—条），每个节下至少 1 个条级节点，条节点 children 为空数组；"
        : "层级自定（一层「节」或两层「节—条」，最多到条为止）：按本章内容复杂度决定，节必须有、条可选；"
  const numbered: string[] = [
    depthRule,
    `叶子规模配额：本章叶子节点（无子节点的末端节点）总数必须落在 ${lo}-${hi} 个（配额 ${quota} 个），每个叶子将承载约 ${opts.sectionWords} 字正文；不足时按系统/模块/阶段/保障维度拆分补足，超出时合并相近叶子；`,
    "内容以评分办法为纲：下面技术评分中与本章主题相关的评分项，每项都要落到具体节/条标题；与本章无关的评分项不要抢写（由其他章承担）；",
  ]
  if (otherChapterTitles.length) {
    numbered.push(
      `其他技术章标题如下，本章的节/条标题禁止与它们或它们的职责范围重复：${otherChapterTitles.map((t) => `「${t}」`).join("、")}；`,
    )
  }
  numbered.push(
    "标题只写名称、不带编号、不以标点结尾；节/条标题必须用具体响应式命名：主题词+落点词（设计/范围/保障/机制/流程等），形如「设备兼容性设计」「知识更新机制」；禁止「概述/说明/介绍/相关内容/其他」式空泛标题；",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式（outline 数组即本章的 children，不要输出章节点本身）：",
    '{"outline":[{"title":"节标题","children":[{"title":"条标题","children":[]}]}]}',
  )
  const system = [
    "你是资深投标顾问，正在为医疗信息化投标文件的某一个技术章展开章内大纲（节/条两级以内）。整份大纲的顶层章已定，本次只展开当前章。",
    `当前要展开的技术章：「${chapterTitle}」。`,
    "硬性要求：",
    ...numbered.map((t, i) => `${i + 1}. ${t}`),
  ].join("\n")
  const user = [
    `【技术评分办法（逐项分值，只取与本章相关的展开）】\n${clipText(scoringText, 4000) || "（未解析到技术评分）"}`,
    `【技术需求与交货服务要求】\n${clipText(techText, 4000) || "（未解析）"}`,
    opts.globalFacts ?? "",
    `请为技术章「${chapterTitle}」输出章内节/条大纲 JSON（叶子 ${lo}-${hi} 个，outline 数组即本章 children）。`,
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
