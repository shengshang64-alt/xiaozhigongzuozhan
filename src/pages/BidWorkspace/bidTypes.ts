import { parseJsonTolerant } from "@/lib/jsonTolerant"
import type { Chapter, FigureSpec, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import { makeUid } from "@/pages/SolutionStudio/solutionTypes"
// R69 搬迁：BidSectionPromptOpts 定义随 buildBidChapterMessages 移至 prompts/bidChapter，本地仍引用（type-only 不产生运行时环）

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

/** 关键项 8 项：必选不可取消（2026-09-23 用户反馈轮：商务评分与投标文件目录要求升档，修「评分办法解析不到」「目录不一致」） */
export const PARSE_KEY_SECTIONS: ParseSectionDef[] = [
  {
    key: "overview",
    title: "项目概述",
    // 用户反馈轮（2026-09-18）：项目概述=完整项目画像六维度（用户口径：只要识别项目概述，提取这六类）
    // 2026-09-21 用户口径补充：基本信息需含项目类型/预算/地址，且只提要点禁止整段拉原文
    guide:
      "项目概述按六个维度提取，每行一条「字段名：内容」：项目基本信息（名称/招标编号/项目类型/采购人/预算金额/项目地址）、背景目的（建设背景与采购目的一句话）、规模预算（建设规模/投资/预算金额，保留原文表述）、时间安排（工期/投标截止/开标/关键节点）、实施内容（建设内容与范围要点）、技术特点（核心系统与关键技术要求要点）；只提上述重点字段，禁止把招标正文整段抄入",
  },
  {
    key: "tech_score",
    title: "技术评分要求",
    guide: "评分办法中技术部分逐项分值表，每行一条「评分项名（分值 分）：评分标准摘要（档位与给分条件）」，分值必须与原文一致",
  },
  {
    key: "project_info",
    title: "项目信息",
    // 2026-09-23 用户反馈轮：与项目概述/交货要求职责切分，修「关键信息重复解析」（重复行另由跨项去重兜底）
    guide: "逐项提取项目背景、建设内容概况、工期要求、资金来源与落实情况等基础信息，每行一条；项目名称/编号/采购人/预算金额等基本信息字段不重复输出（已由项目概述项承担），技术需求明细不归本项（属交货和服务要求）",
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
  // 2026-09-23 用户反馈轮：商务评分随技术评分同档解析（评分办法整体不再依赖「完整档」勾选）
  {
    key: "biz_score",
    title: "商务评分要求",
    guide: "评分办法中商务部分逐项分值表，每行一条「评分项名（分值 分）：评分标准摘要」",
  },
  // 2026-09-23 用户反馈轮：投标文件目录要求升档，大纲生成默认有招标目录锚点可遵循（防自造目录漂移）
  {
    key: "bid_outline_req",
    title: "投标文件目录要求",
    guide: "招标文件中对投标文件/技术标目录结构的规定（章节名录原文），每行一条目录项，保留原编号与层级",
  },
]

/** 其他项 11 项：完整解析模式下自由勾选 */
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
  { key: "void_items", title: "无效标与废标项", guide: "废标/无效投标条款原文摘录（未密封、未盖公章、报价超预算、资质不符、串通投标认定，以及电子标 CA 有效期/签章/加密上传/解密要求、模板占位文字残留等废标条款），每行一条" },
  // 循环 2 批 2-3：原 contract_award + contract_end 合并升级为 contract_terms（补质保衔接口径）
  { key: "contract_terms", title: "合同关键条款", guide: "合同授予条件、签订时限与履约保证金、合同解除与终止条款、质保期与缺陷责任期衔接，每行一条" },
  // 第十七轮 17B：编制依据与规范编号清单（规范库补选与正文注入依据）
  { key: "compilation_basis", title: "编制依据与规范", guide: "招标文件中要求或提及的编制依据、标准规范清单（国家标准/行业标准/技术文件/法律法规的编号与名称），每行一条「编号 名称」，保留原文编号格式" },
  // R74/C-lot-splitting：多包件招标的标包划分（本地扫描 + AI 解析双路，用户在报告中人工确认本次投标所投包件）
  { key: "lots", title: "标包划分", guide: "招标文件划分的标包/标段/包件清单：每个包一条，含包号、包名称、预算金额或最高限价、主要内容摘要，逐条保留原文表述；未划分标包的文件此区为空" },
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

/** R46/F3（体验审计）：把逐段失败 warnings 聚合为一条不矛盾的横幅文案。
 * 背景：旧横幅把多条「第 X 段解析失败」直接列在顶部，与侧栏「核心信息 7/7 项」同屏——
 * 段＝招标全文切分的文本块、项＝提取出的核心信息，两个口径不同，但用户读来像自相矛盾。改为汇总一条，口径说清。无 warnings 返回 null。 */
export function summarizeParseWarnings(warnings: string[] | undefined): { failedChunks: number; headline: string } | null {
  const n = warnings?.length ?? 0
  if (n <= 0) return null
  return {
    failedChunks: n,
    headline: `招标全文按段落切分解析，其中 ${n} 段本次未读取成功（多为超长/图表段），已自动跳过；下列核心信息仍从其余成功段落中提取。`,
  }
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

/** 本次解析实际要输出的项：关键项档=8 项；完整档=关键项+勾选项（未勾任何项=全部其他项） */
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

// ------------------------------ R74/C-lot-splitting：标包划分本地扫描（零 AI 费用） ------------------------------

/** 标包标题行：「第1包 / 第一包 / 标段一 / 包2 / 分包3」等（编号可汉字可数字），或含「标段/包件号」的表头行 */
const LOT_HEADER_RE = /^(?:第|[一二三四五六七八九十百]{1,4}包|[0-9]{1,3}包).{0,3}?(?:包|标段)|^(?:标段|包件?|分包)\s*[一二三四五六七八九十百0-9]{1,4}(?:[:：（(]|\s|$)|^(?:标段|包件)\s*号/
const LOT_NO_RE = /(第\s*([一二三四五六七八九十百0-9]{1,4})\s*(?:包|标段|包件))|(标段\s*([一二三四五六七八九十百0-9]{1,4}))|((?:包|标段|分包|包件)\s*([0-9]{1,3}))/
/** 预算/限价行：与当前包块关联 */
const LOT_BUDGET_RE = /(预算金额|最高限价|预算|控制价|限价)[^0-9]{0,8}([0-9][0-9,，.]*)\s*(万元|元)/

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100 }

/** 汉字/数字编号 → int（「十」=10、「二十三」=23、超复杂忽略返回 0） */
export function lotNumberCnToInt(raw: string): number {
  const digits = raw.replace(/[^0-9一二三四五六七八九十百]/g, "")
  if (/^[0-9]+$/.test(digits)) return Number(digits)
  // 汉字编号简单求值（十位组合：二十三=23；含「百」按字面×）
  let total = 0
  let cur = 0
  for (const ch of digits) {
    if (ch === "十") {
      cur = cur || 1
      total += cur * 10
      cur = 0
    } else if (ch === "百") {
      cur = cur || 1
      total += cur * 100
      cur = 0
    } else {
      cur = CN_NUM[ch] ?? 0
      // 个位紧跟十/百已在上面累加；这里暂存待遇十/百或结束
      if (!/[十百]/.test(digits.slice(digits.indexOf(ch) + 1))) {
        total += cur
        cur = 0
      }
    }
  }
  return total + cur
}

/**
 * R74/C-lot-splitting：从招标原文本地扫描「标包/标段/包件」划分（纯函数，零 AI 费用）。
 * 逐行找标包标题行开新包，收集该包块内的名称/预算/内容摘录行（预算行就近归属），
 * 输出每包一条「第N包：名称；预算金额 X 万元；主要内容…」；无划分返回 []。
 * 局限（诚实声明）：PDF 表格转译可能把包信息拆行错位，漏识别的由 AI 解析兜底；复杂捆绑（包内分包）v1 不展开。
 */
export function extractLotsFromText(text: string): string[] {
  const out: string[] = []
  type Lot = { no: string; lines: string[] }
  let lots: Lot[] = []
  for (const rawLine of (text ?? "").split(/\n+/)) {
    const line = rawLine.replace(/[\s\u3000]+/g, " ").trim()
    if (!line || line.length > 200) continue
    if (LOT_HEADER_RE.test(line)) {
      const noM = line.match(LOT_NO_RE)
      const label = noM ? (noM[1] || noM[3] || noM[5] || line.slice(0, 12)) : line.slice(0, 12)
      lots.push({ no: String(label).trim(), lines: [line] })
      continue
    }
    if (!lots.length) continue
    // 预算行就近归属当前包；普通行作为内容摘录（每包最多 6 行）
    if (LOT_BUDGET_RE.test(line) || lots[lots.length - 1].lines.length < 7) {
      lots[lots.length - 1].lines.push(line)
    }
  }
  lots = lots.filter((l) => l.lines.length >= 1 && l.no)
  for (const lot of lots) {
    const budget = lot.lines.map((l) => l.match(LOT_BUDGET_RE)).find(Boolean)
    const budgetText = budget ? `；预算/限价 ${budget[2]}${budget[3]}` : ""
    const content = lot.lines
      .slice(1)
      .filter((l) => !LOT_BUDGET_RE.test(l))
      .join("；")
      .slice(0, 160)
    const head = lot.lines[0].slice(0, 80)
    out.push(`${head}${budgetText}${content && content !== head ? `；${content}` : ""}`)
  }
  return out.slice(0, 40)
}

/** 标包分区组装（镜像 starClauseSectionFrom；无标包返回 null 不落分区） */
export function lotsSectionFrom(lots: string[]): ParseSection | null {
  if (!lots.length) return null
  return {
    key: "lots",
    title: "标包划分",
    content: lots.join("\n"),
    status: "ok",
    snippet: `共 ${lots.length} 包`,
  }
}

// ------------------------------ 第十二轮改造 2：★/▲ 重点条款本地扫描（零 AI 费用） ------------------------------

export const STAR_CLAUSE_LIMIT = 200

const STAR_MARK_RE = /[★☆▲△]/

// R50/F2：标记行后续正文行吸收的上限（防把后文整段吞进条款）
const STAR_CONT_CAP = 4
const STAR_CLAUSE_MAX_CHARS = 600
// 结构边界：章节标题/中文编号/附表附件表头 → 当前条款到此为止
const STAR_BOUNDARY_RE = /^(第[一二三四五六七八九十百]+[章节部分篇]|[一二三四五六七八九十]+、|附[件表]|评标办法|评分标准|技术参数及要求|序号$)/

/**
 * 从招标文件原文本地扫描 ★/▲ 标记条款（纯函数，零 AI 调用）：
 * 标记行=条款起点；去重；上限 200 条，超出时末行追加「…另有 N 条未列出」。
 * R50/F2 修「★条款只剩★1~★10光杆编号、正文全丢」（13431 实测，S0 级：实质性条款依据丢失）：
 * PDF 转译后「★N」常单独占行、条款正文在其后行（中间隔空行），旧逻辑只保留含标记的行、
 * 其余一律 flush 丢弃 → 现在标记行后最多吸收 4 行非标记正文（单条 ≤600 字），
 * 遇章标题/前附表等结构边界即终止本条；连续标记行改为各自成条（每条=一个独立落点，对大纲映射更有利）。
 */
export function extractStarClauses(text: string): string[] {
  const clauses: string[] = []
  const seen = new Set<string>()
  let buf: string[] = []
  let chars = 0
  const flush = () => {
    if (!buf.length) { chars = 0; return }
    const clause = buf.join("\n").trim()
    buf = []
    chars = 0
    if (!clause) return
    const dedupeKey = clause.replace(/\s+/g, "").slice(0, 60)
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    clauses.push(clause)
  }
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue // 空行只是分隔符，不结束条款（PDF 转译 marker 与正文间必有空行）
    if (STAR_MARK_RE.test(line)) { flush(); buf = [line]; chars = line.length; continue }
    if (!buf.length) continue // 无进行中的条款：普通正文跳过
    if (buf.length > STAR_CONT_CAP || chars >= STAR_CLAUSE_MAX_CHARS) continue // 超长截断：不再吸收，等下一个标记
    if (STAR_BOUNDARY_RE.test(line)) { flush(); continue } // 结构边界 = 本条结束
    buf.push(line)
    chars += line.length
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

// ------------------------------ parse-validator-01（docs/07 §4.1 缺口1）：解析输出本地硬兜底 ------------------------------

/** 提示词软约束「要点化铁律」的本地硬兜底：概览/摘要型 section 每节条数与每条字数上限
 * （Issue 1：原 60 字/25 条会把项目概述等长句腰斩＝展示不全，放宽到能看全正常内容、仅拦失控输出） */
const PARSE_MAX_LINES_PER_SECTION = 80
const PARSE_MAX_CHARS_PER_LINE = 200
/**
 * 原文型/清单型 section 放宽上限（一刀切会截掉参数与时间原文＝丢数据）：
 * - 逐字/原文保留类（废标条款/保证金/时间节点/评分标准/采购清单/概述/项目信息/交付与响应要求/合同条款）：600 字/条；
 * - 天然多条目列表类（目录项/规范编号/资格条款常超 25 条）：100 条/节；其余仍按全局上限。
 */
const PARSE_LINE_CHAR_OVERRIDES: Record<string, number> = {
  void_items: 600,
  bid_deposit: 600,
  bid_nodes: 600,
  tech_score: 600,
  biz_score: 600,
  purchase_list: 600,
  overview: 600,
  project_info: 600,
  delivery_req: 600,
  response_req: 600,
  purchaser_info: 600,
  contract_terms: 600,
}
const PARSE_LINE_COUNT_OVERRIDES: Record<string, number> = {
  bid_outline_req: 100,
  compilation_basis: 100,
  qualification: 100,
}
/** 固定截断提示行（不含漂移计数）：一旦截断就固化该行为，读路径重复调用时靠它保持幂等 */
const PARSE_CLAMP_MARKER = "（部分要点已按上限自动截断，完整内容以招标文件原文为准）"

/**
 * 解析章节数量/长度本地校验（共享纯函数，与 cleanParseSectionContent 同三点共用：落库清洗 / 分块合并 / 读路径规整）：
 * 行条数按节类型分档、每行字数分档，超出则截断；一旦截断追加一行固定提示（不含具体条数，以保证幂等）。
 * 豁免长度截断：URL 行与「原文未提及：」汇总行（均为本地产物、可合法超长）。
 * 幂等：已收敛内容再过一次输出不变——因为“是否截断过”由固定提示行自身携带并保留（hadMarker），
 *   而非从已被不可逆截断的数据里重算计数（那样每次读会漂移）。
 */
export function clampParseSectionContent(key: string, content: string): string {
  const src = (content ?? "").trim()
  if (!src) return ""
  const maxChars = PARSE_LINE_CHAR_OVERRIDES[key] ?? PARSE_MAX_CHARS_PER_LINE
  const maxLines = PARSE_LINE_COUNT_OVERRIDES[key] ?? PARSE_MAX_LINES_PER_SECTION
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean)
  // 剥离既有固定提示行（不重复叠加）；并记住“曾经截断”，以便本轮即使不再超长也保留提示（幂等）
  const hadMarker = lines.includes(PARSE_CLAMP_MARKER)
  const dataLines = lines.filter((l) => l !== PARSE_CLAMP_MARKER)
  let clipped = false
  const out = dataLines.map((l) => {
    // 本地产物行豁免长度截断：URL / 「原文未提及」汇总 / R30 出处回指后缀（出处被截断会产生幻觉页码，整行保全优先于 60 字纪律）
    if (/^https?:\/\//i.test(l) || l.startsWith("原文未提及：") || l.includes("（出处：")) return l
    if (l.length <= maxChars) return l
    clipped = true
    return `${l.slice(0, maxChars - 1)}…`
  })
  const excess = out.length > maxLines
  if (excess) out.length = maxLines
  // clipped||excess 本次发生截断；hadMarker 历史已截断——三者任一即保留固定提示行（不含会漂移的 N）
  if (clipped || excess || hadMarker) out.push(PARSE_CLAMP_MARKER)
  return out.join("\n")
}

/**
 * 用户反馈轮：解析报告重复部分不展示——跨 section 行级去重：
 * 按 sections 顺序遍历，归一化（去空白）后相同的行只保留在首个出现的 section，后续 section 删除该行。
 * 豁免：star_clauses（原文摘录重复于其他项是其价值）、human_edited（尊重手改，既不删也不作去重源）；
 * 「原文未提及：…」汇总行不参与去重（各 section 缺失口径不同）。
 */
export function dedupeAcrossSections(report: ParseReport): ParseReport {
  const seen = new Set<string>()
  // 归一口径增强（2026-09-23 用户反馈轮：同一信息多条措辞微差重复提取）：去空白 + 去行尾（出处：…）回指后缀 + 全角标点归一，仅措辞/出处不同的重复行也收敛到首条
  const norm = (t: string) =>
    t
      .replace(/（出处：[^）]*）\s*$/g, "")
      .replace(/\s+/g, "")
      .replace(/[，、；：！？（）]/g, (c) => ({ "，": ",", "、": ",", "；": ";", "：": ":", "！": "!", "？": "?", "（": "(", "）": ")" })[c] ?? c)
      .toLowerCase()
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
      const key = norm(t)
      if (!key || seen.has(key)) continue
      seen.add(key)
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
      const content = humanEdited ? rawContent : clampParseSectionContent(key, cleanParseSectionContent(rawContent))
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
    const text = clampParseSectionContent(key, cleanParseSectionContent(toContentText(rec[key]).trim()))
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

/** 从评分办法文本行里恢复评分项（兼容「项名（N 分）：标准」与「项名：N 分」两种行格式；
 * Issue 2：额外兼容参考实现的【评分项名称】/【权重/分值】/【评分标准】/【数据来源】分块格式，作解析侧安全网） */
export function extractScoringFromText(text: string): ScoringItem[] {
  const out: ScoringItem[] = []
  // 分块格式：以【评分项名称】为界切块，块内聚合分值/标准/出处为一条 ScoringItem
  if (/【\s*评分项名称\s*】/.test(text)) {
    const blocks = text.split(/【\s*评分项名称\s*】/)
    for (let bi = 1; bi < blocks.length; bi++) {
      const blk = blocks[bi]
      const name = blk.split(/\n/)[0].replace(/^[：:\s]*/, "").replace(/\s+/g, " ").trim()
      if (!name) continue
      const scoreM = blk.match(/【\s*(?:权重|分值|权重\/分值|权?重?\/分\s*值)\s*】[：:]?\s*([0-9]+(?:\.[0-9]+)?)/)
      const critM = blk.match(/【\s*评分标准\s*】[：:]?\s*([\s\S]*?)(?=【|$)/)
      const srcM = blk.match(/【\s*(?:数据来源|出处)\s*】[：:]?\s*([\s\S]*?)(?=【|$)/)
      const criteria = (critM ? critM[1] : "").replace(/\s+/g, " ").trim()
      const src = srcM ? srcM[1].replace(/\s+/g, " ").trim() : ""
      out.push({ item: name, score: scoreM ? Number(scoreM[1]) : 0, criteria: criteria + (src ? `（出处：${src}）` : "") })
    }
    if (out.length) return out
  }
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

// ------------------------------ R31：评分细项编号体系 + 主客观分类 ------------------------------

/** 带稳定编号的评分细项（R31 prompt-matrix-02） */
export type NumberedScoringItem = ScoringItem & {
  /** 稳定编号："R1","R2"…(tech) / "B1","B2"…(biz) */
  id: string
  category: "tech" | "biz"
  isSubjective: boolean
}

/** 启发式判定评分项是否为主观分（含“得 N-M 分”、优秀/良/一般/差、方案质量/完整性/合理性等评判词） */
export function classifySubjective(item: ScoringItem): boolean {
  const text = `${item.item} ${item.criteria}`
  if (/\d+\s*[-~到至]\s*\d+\s*分/.test(text)) return true
  if (/优.*?良|一般.*?差|合理|完整|清晰|可操作性|评委.*?横向|优者得|酌情/.test(text)) return true
  return false
}

/**
 * 给 ScoringItem[] 分配稳定编号。
 * 技术/商务分别编号（R1/R2… | B1/B2…）；来源用 section key 区分。
 */
export function numberScoringItems(report: ParseReport | null): NumberedScoringItem[] {
  const techItems = extractScoringFromText(sectionText(report, "tech_score"))
  const bizItems = extractScoringFromText(sectionText(report, "biz_score"))
  return [
    ...techItems.map((s, i) => ({ ...s, id: `R${i + 1}`, category: "tech" as const, isSubjective: classifySubjective(s) })),
    ...bizItems.map((s, i) => ({ ...s, id: `B${i + 1}`, category: "biz" as const, isSubjective: classifySubjective(s) })),
  ]
}

/** 带编号的评分细则 prompt 行（注入大纲生成器，让模型可用 [响应:Rx] 标注承接） */
export function numberedScoringDetailLines(items: NumberedScoringItem[]): string {
  return items
    .map((s) => `[${s.id}] ${s.item}（${s.score} 分）${s.isSubjective ? "「主观」" : "「客观」"}：${s.criteria.trim() || "（评审标准细则未解析）"}`)
    .join("\n")
}

/** 一条评分项在大纲中的承接情况（R31 覆盖矩阵行） */
export type ScoringCoverageEntry = {
  item: NumberedScoringItem
  /** 承接该评分项的大纲叶子节点标题（按大纲顺序，去重） */
  coveredBy: string[]
}

/** 收集大纲全部 [响应:Rx] 标注：编号 → 承接叶子标题列表（R31，纯本地） */
function collectResponseAnnotations(
  outline: import("../SolutionStudio/solutionTypes").OutlineNode[],
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (nodes: import("../SolutionStudio/solutionTypes").OutlineNode[]) => {
    for (const n of nodes) {
      if (n.description) {
        const m = n.description.match(/\[(?:响应|Response):([^\]]+)]/i)
        if (m) {
          for (const raw of m[1].split(/[,，]\s*/)) {
            const id = raw.trim()
            if (!id) continue
            const list = map.get(id) ?? []
            if (!list.includes(n.title)) list.push(n.title)
            map.set(id, list)
          }
        }
      }
      if (n.children?.length) walk(n.children)
    }
  }
  walk(outline ?? [])
  return map
}

/**
 * R31 评分点覆盖矩阵（纯本地零 AI）：每个编号评分项 ↔ 承接它的大纲叶子标题。
 * 只扫技术部分顶层章（商务骨架章不承担承接）；商务项（B*）不进矩阵。
 */
export function buildScoringCoverageMatrix(
  outline: import("../SolutionStudio/solutionTypes").OutlineNode[],
  items: NumberedScoringItem[],
): ScoringCoverageEntry[] {
  const annotations = collectResponseAnnotations(techOutlineNodes(outline))
  return items
    .filter((s) => s.category === "tech")
    .map((s) => ({ item: s, coveredBy: annotations.get(s.id) ?? [] }))
}

/**
 * R31 提纲层评分点覆盖检查（纯本地零 AI）：
 * 扫描全部技术叶子节点的 description 字段中的 [响应:R\d+] 标注，
 * 返回未被任何叶子承接的评分项 ID 列表。
 */
export function findUncoveredScoringIds(
  outline: import("../SolutionStudio/solutionTypes").OutlineNode[],
  items: NumberedScoringItem[],
): string[] {
  return buildScoringCoverageMatrix(outline, items)
    .filter((e) => !e.coveredBy.length)
    .map((e) => e.item.id)
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
/** 05 三模式（合并稿 v1.0 重定义 R30）：compliance_mode 三档写作模式 strict 严格响应（只做对标响应禁扩展）/ moderate 场景扩展（骨架+项目应用场景描述 30%~50%）/ full 大量充实（骨架+场景+通用充实材料，设编造红线）；
 *  section_words_touched=用户是否手动调过每小节字数（true 时切换模式不再自动覆盖字数，方案B 第5步联动） */
export type GenOptions = {
  clause_response: boolean
  material_boost: boolean
  intra_dup_threshold?: number
  include_biz?: boolean
  compliance_mode?: ComplianceMode
  section_words_touched?: boolean
}

/** 循环 7 A4：章间互查阈值缺省值（与 findIntraDupPairs 默认参数一致） */
export const INTRA_DUP_THRESHOLD_DEFAULT = 0.35

export function defaultGenOptions(): GenOptions {
  return { clause_response: false, material_boost: false, include_biz: true, compliance_mode: COMPLIANCE_MODE_DEFAULT }
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
    compliance_mode: isComplianceMode(rec.compliance_mode) ? rec.compliance_mode : COMPLIANCE_MODE_DEFAULT,
    section_words_touched: rec.section_words_touched === true,
  }
}

/** 05 三模式：合规严格度开关，只切「超出招标原文的程度」；新增可验收承诺始终受 BID_STYLE_RULES 忠实/克制底线约束 */
export type ComplianceMode = "strict" | "moderate" | "full"
export const COMPLIANCE_MODE_DEFAULT: ComplianceMode = "strict"
export const COMPLIANCE_MODE_LABEL: Record<ComplianceMode, string> = {
  strict: "严格响应",
  moderate: "场景扩展",
  full: "大量充实",
}
/** 每模式建议的每小节字数默认（方案B 第5步：切模式且用户未手改字数时联动到此值） */
export const COMPLIANCE_MODE_SECTION_WORDS: Record<ComplianceMode, number> = {
  strict: 800,
  moderate: 1000,
  full: 1400,
}
function isComplianceMode(v: unknown): v is ComplianceMode {
  return v === "strict" || v === "moderate" || v === "full"
}
/** 合并稿 §6.2 三档写作模式规则块（作一条硬约束注入）：三档均非空（2026-09-22 用户拍板全量切换，
 *  存量项目缺省 strict 也注入严格响应块）；忠实参数/克制承诺底线仍在 BID_STYLE_RULES，此处只界定「素材来源与扩展程度」 */
export function complianceModeRule(mode: ComplianceMode | undefined): string {
  if (mode === "moderate") {
    return "生成模式=场景扩展（合并稿三档之扩展模式）：① 先按严格响应完成本节全部对标响应（骨架，必须先写、写全）；② 再增加「项目应用场景描述」：结合项目背景、建设目标与业务场景，写本节技术/功能/方案在本项目中的应用方式、业务流程、使用角色、预期效果；③ 场景描述必须与本节技术内容直接相关、与项目概述一致，不得虚构招标文件中不存在的项目事实（具体科室、品牌型号、既有数据等，除非原文或素材中有）；④ 场景描述篇幅约占本节 30%~50%；⑤ 不写与本节无关的通用性材料；"
  }
  if (mode === "full") {
    return "生成模式=大量充实（合并稿三档之大量模式）：① 先完成对标响应骨架与项目应用场景描述（两者必须先写、写全）；② 在此之上允许写入与本节技术/项目/功能/流程相关的充实性材料：行业背景与趋势、通用技术原理与方法论、管理体系与制度框架、通用工作流程与规范、风险识别与应对框架、质量保障体系、培训方法论、服务承诺体系等；③ 充实材料定位是「通用能力描述」，用「通常」「一般」「我公司建立了……体系」等表述，严禁把通用材料包装成本项目已发生的事实；④ 严禁虚构具体事实：不编造项目名称、合同金额、客户名称、证书编号、量化指标（招标文件或素材中已有的除外），需要处输出【待填写】占位；⑤ 充实材料必须与章节主题相关，拒绝无关堆砌，不与同级章节重复同类表述，篇幅可充分展开但段落结构清晰、语言克制；"
  }
  return "生成模式=严格响应（合并稿三档之严格模式）：① 本节正文以「对标响应」为唯一目标，逐条响应本章/小节对应的招标要求与评分细项原文；② 标准响应句式：引述招标要求并将要求类字眼改为响应表述（「投标人应具备……」改为「我公司具备……」，「应提供……」改为「我公司提供……，完全满足招标文件要求」），改写只动人称与语气、不动任何数值与限定语；③ 响应内容只允许来自：招标文件原文的响应式改写、用户提供的素材资料、主观材料描述（对本项目的理解、服务承诺、配合意愿）；④ 需要截图、证书等客观材料的位置输出【待填写】占位，禁止用文字虚构其内容；⑤ 禁止扩展：不写招标文件未要求的技术细节展开、行业背景、通用方法论等充实性内容；⑥ 篇幅从简，以响应完整、表述清晰为限；"
}

/** 05 三模式·大纲侧（§5.4）：骨架宽度随模式切换；strict/缺省 返回空串（不追加，大纲 prompt 与现状字节级一致）；
 *  full 允许增设支撑性技术章（结构层扩展，不涉及新增可验收承诺，符合方案B） */
export function complianceOutlineRule(mode: ComplianceMode | undefined): string {
  if (mode === "moderate") {
    return "技术章骨架范围：以上述常规骨架八章为基准，各技术章的小节数按招标评分点数量决定；不额外增设招标未涉及的顶层技术章；"
  }
  if (mode === "full") {
    return "技术章可扩展骨架：在常规骨架八章基础上，允许按本项目实际需要增设支撑性技术章以体现方案完整性，候选如「总体架构与技术路线、系统集成与数据治理、数据安全与隐私保护、运维服务与 SLA、知识转移与持续改进、同类项目业绩、项目创新点与先进性」；每个新增章必须与本项目直接相关、能落到招标需求或评分点，禁止为凑篇幅增设空泛章节；"
  }
  return ""
}

// ------------------------------ 合并稿 v1.0 底座（R30）：【真实性铁律】+【通用输出要求】公共 SystemPrompt 组件 ------------------------------

/** 标书提示词版本号（2026-09-22 R30 合并稿全量切换；2026-09-23 R31 编号体系+承接标注；R32 批次1 矛盾修复：解析版铁律/三标注圆括号/优先级 P0 句式） */
export const BID_PROMPT_VERSION = "merged-v1.0/R32-2026-09-23"

/**
 * 【真实性铁律】（合并稿 §三，最高优先级）：全链（解析/大纲/正文/续写/改写）system 固定前置、逐字一致。
 * 与合并稿的两处落地适配（均已在台账 R30 留证）：
 * ① 占位符统一用既有约定【待填写】（稿作【待补充：xxx】）——meta_leftover 事后检查器与元话语禁令均拦「待补充」，
 *    沿用旧口径避免提示词与检查器互相打架；② 承诺标注（稿 §三铁律5 要求标「【承诺值，请人工确认】」）同理不进正文，
 *    改用「可在原文/全局事实中核实，拿不准写【待填写】」口径（与承诺克制底线同义）。
 */
export const TRUTH_IRON_RULES: string[] = [
  "只允许基于用户提供的招标文件原文、用户提供的素材与事实资料进行分析和写作，严禁编造招标文件中不存在的要求、数据、条款、评分点；",
  "引用招标文件的任何信息（数字、日期、金额、分值、条款编号、名称）必须与原文完全一致，每一处引用都必须能回指到原文出处（章节号/页码/附件号）；",
  "招标文件未提及的信息，明确标注「原文未提及」，严禁用推测、行业惯例或「合理想象」填补；",
  "严禁虚构事实性材料：包括但不限于不存在的项目案例、合同、客户名称、资质证书、专利、软著、获奖、人员证书、检测数据；确需此类材料的位置输出【待填写】占位，由用户人工补充；",
  "承诺性表述（服务承诺、工期承诺等）可按行业惯例撰写，但具体数字（工期天数、响应时长、质保年限）必须与招标文件要求一致或更优、可在原文或全局事实中核实；拿不准的一律写【待填写】；",
  "原文表述模糊、可能理解有误或无法确定的地方，必须显式列出，不得静默跳过。",
]

/** 【通用输出要求】（合并稿 §三）：与铁律同块前置，逐字一致 */
export const COMMON_OUTPUT_RULES: string[] = [
  "只输出任务要求的最终结果，不输出过程、解释、客套话；",
  "结构化任务只输出指定格式的 JSON 或文本，不包裹 markdown 代码围栏（任务明确要求时除外）；",
  "分析类结论（解析/归纳/核查）区分三类标注：（原文事实）（直接摘自原文）、（整理归纳）（基于原文的归纳不改变原意）、（原文未提及）；三类标注统一使用圆括号，不使用方括号（避免与正文装饰符号禁令冲突）；正文写作不适用此标注。",
]

/**
 * 各阶段 system 共用的铁律前置块（固定文本、缓存友好：同项目多次调用逐字一致）。
 * R32 批次1 矛盾修复：
 * - 优先级句式统一为 P0 层（本块 > 任务指令 P1 > 风格规则 P2），不再各处单独自称「最高」而互不排序；
 * - mode="write"（默认：大纲/章/小节/续写/改写）保留铁律3「未提及必须显式标注」；
 * - mode="parse"（结构化解析）改写铁律3：缺失项一律省略对应行、由系统统一汇总，
 *   与 cleanParseSectionContent（删除未明确行 + 末尾追加「原文未提及」汇总）的下游处理对齐，消除自相矛盾。
 */
const TRUTH_HEADER_P0 =
  "【真实性铁律】（最高优先级 · P0：本块优先于任务指令(P1)与风格规则(P2)，任何冲突以本块为准）"
/** 解析版铁律3：与结构化解析「省略 + 系统汇总」的下游清洗对齐 */
const TRUTH_RULE3_PARSE =
  "招标文件未提及 / 无法确定的信息，按本任务的输出指令处理：该省略的直接省略对应行，缺失汇总由系统统一生成，禁止在结构化输出里自行插入「未明确/未提及」类说明行，严禁用推测、行业惯例或「合理想象」填补；"

export function truthPreamble(mode: "write" | "parse" = "write"): string {
  const rules = TRUTH_IRON_RULES.map((t, i) => (mode === "parse" && i === 2 ? TRUTH_RULE3_PARSE : t))
  return [
    TRUTH_HEADER_P0,
    ...rules.map((t, i) => `${i + 1}. ${t}`),
    "【通用输出要求】",
    ...COMMON_OUTPUT_RULES.map((t, i) => `${i + 1}. ${t}`),
  ].join("\n")
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

/**
 * 公司《智业软件文档编辑使用规范 V2.1》投标文件排版参数（一键套用）：
 * A4，边距左 2.8 / 右 2.6 / 上下 2.5cm；正文宋体小四、1.5 倍行距、段前后 0、首行缩进 2 字符；
 * 表格内容宋体五号；目录到三级（标题样式 1-9）。封面/页眉页脚/智业 Logo 仍须以智业 Word 模板为准，本预设不覆盖暗标设置。
 */
export const ZHIYE_STANDARD_FORMAT: Partial<FormatSettings> = {
  paper: "A4",
  margins: { top: 2.5, bottom: 2.5, left: 2.8, right: 2.6 },
  heading: [
    { font: "黑体", size: "三号", align: "left" },
    { font: "黑体", size: "四号", align: "left" },
    { font: "黑体", size: "小四", align: "left" },
    { font: "黑体", size: "小四", align: "left" },
    { font: "黑体", size: "小四", align: "left" },
    { font: "黑体", size: "小四", align: "left" },
  ],
  body: { font: "宋体", size: "小四", firstIndent: 2, align: "justify", lineSpacing: "1.5倍" },
  table: { border: "0.5pt", contentFont: "宋体五号" },
  toc: true,
  pageNumber: true,
  titleNumbering: "1.1.1",
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
  /** R32 批次2 #1：装饰符号 / Markdown 正文残留扫描（BID_STYLE_RULES 装饰禁令的事后拦截，零 AI） */
  | "decoration_leftover"

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
  "decoration_leftover",
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
  decoration_leftover: "正文不残留装饰符号/Markdown（【】★☆◆■●✓→ 及行首 # - * > 列表符）",
}

/** 交叉警告规则（暗标页数 × 目标页数联动生成，不在禁则勾选清单内）；number_conflict 为循环 8 A4 本地数字口径核对 */
export type FormatCheckRule = FormatCheckKey | "sealed_pages_cross" | "number_conflict" | "param_escalation" | "metric_conflict" | "meta_leftover" | "deviation_undercommit" | "over_price_ceiling"

export const FORMAT_RULE_LABEL: Record<FormatCheckRule, string> = {
  ...FORMAT_CHECK_LABEL,
  sealed_pages_cross: "暗标页数与目标页数交叉核对",
  number_conflict: "数字口径一致性（事实表 × 正文/偏离表/大纲）",
  param_escalation: "参数加码（承诺优于招标档位，过度响应＝额外验收义务）",
  metric_conflict: "指标口径唯一性（跨章同指标多值）",
  meta_leftover: "占位元话语与绝对化承诺残留",
  deviation_undercommit: "承诺不够（偏离表负偏离：响应低于招标要求）",
  over_price_ceiling: "投标报价超最高限价/预算（废标风险）",
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
 * R32 批次2 #1：装饰符号 / Markdown 正文残留扫描（BID_STYLE_RULES「排版惯例」「元话语禁令」的事后拦截）。
 * 合法占位【待填写】【请补充素材】先剥离再判残留，避免误报；markdown 只认行首结构符（标题/列表/引用/加粗），
 * 不认句中 - 或 | （负数、区间、表格分隔等正常用法），守零误报。
 */
const LEGAL_PLACEHOLDER_RE = /【待填写】|【请补充素材】/g
const DECORATION_GLYPH_RE = /[【】★☆◆◇□■●○▲△▷✔✓✗✘→←↑↓▪▫]/
const MD_RESIDUE_RE = /^\s*(#{1,6}\s|[-*+]\s|>\s|__|\*\*)/

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
  // R32 批次2 #1：装饰符号 / Markdown 残留（合法占位剥离后扫 glyph + 行首结构符）
  const wantDecoration = enabled.has("decoration_leftover")
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
    if (wantDecoration) {
      for (const line of lines) {
        const probe = line.replace(LEGAL_PLACEHOLDER_RE, "")
        const g = DECORATION_GLYPH_RE.exec(probe)
        if (g) {
          push(title, "decoration_leftover", quoteAround(probe, g.index, g[0].length), "warn", "glyph")
          continue
        }
        const md = MD_RESIDUE_RE.exec(line)
        if (md) push(title, "decoration_leftover", quoteAround(line, md.index, md[0].length), "warn", "md")
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
 * ② 时钟式排除：冒号前紧跟数字时，冒号后的数字是钟点尾数（8:30 的 30）不提取；「关键词：值」的正常冒号不剔；
 * ③ 比较语境排除：数字前 4 字含「不超过/以上/至少…」等区间词不提取；
 * ④ 编号行由调用方按整行排除（NUM_ID_LINE_RE）；
 * ⑤ 模糊量排除：数字紧邻前是「近/约/大约/约为」时不提取（描述性模糊量非承诺值）。
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
    // ② 时钟式专属：仅当冒号前紧跟数字（8:30 的尾数）才剔；「关键词：5年」式承诺值是标书正文最高频形态，不能误剔（R43 真实标书校准收窄；包含 R42 的 元/万元 豁免——钱值冒号前必是汉字，天然不命中）
    if (/\d\s*[:：]\s*$/.test(beforeAll)) continue
    // ⑤ 模糊量邻近剔除（R43 真实标书校准：原文「医院近20年历史数据」「质保期约为3年」里的近/约不是承诺值）
    if (/(?:大?[约近]|约[为是])\s*$/.test(beforeAll)) continue
    // ① 日期：年值后接「N月」或本身是 1900-2100 的整数纪年
    if (unit === "年" && (/^\s*\d{1,2}\s*月/.test(after) || (Number.isInteger(value) && value >= 1900 && value <= 2100))) continue
    out.push({ value, unit, index: idx, raw: m[0] })
  }
  return out
}

/**
 * R32 批次2 #4：承诺值优于招标档位的方向判定（接进事实表比对，零新增架构）。
 * 保守防误报：仅在主题词命中已知“义务方向”、且正文值超出全部基准档位时报警——
 * 年限/质保类承诺更长＝more 加码；响应/到场/工期类承诺更快＝less 加码；方向未知交回普通 number_conflict。
 */
const OVERCOMMIT_MORE_RE = /质保|维保|运维|保修|服务期|保证期|免费/
const OVERCOMMIT_LESS_RE = /响应|到场|到达|恢复|交付|上线|完工|竣工|工期|RPO|RTO/
function overCommitDirection(topic: string, bodyVal: number, vals: number[]): "more" | "less" | null {
  if (!vals.length) return null
  if (OVERCOMMIT_MORE_RE.test(topic)) return bodyVal > Math.max(...vals) ? "more" : null
  if (OVERCOMMIT_LESS_RE.test(topic)) return bodyVal < Math.min(...vals) ? "less" : null
  return null
}

/**
 * 全局事实基准表（topic → 单位 → 值集）：从事实行「主题：口径」的口径部分提取数值。
 * 含「【需人工确认】」的行跳过；只取首个冒号/等号之后的口径，主题名里的数字不进基准。
 * numberConflictHits（正文）与 structuredNumberConflictHits（偏离表/大纲）共用同一基准口径。
 */
type FactBaseline = Map<string, Map<string, number[]>>
function buildFactBaseline(factLines: string[]): FactBaseline {
  const baseline: FactBaseline = new Map()
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
  return baseline
}

/**
 * 数字口径冲突检查（纯函数、零 AI、零后端）：
 * 基准 = 全局事实行（含「【需人工确认】」的行跳过）口径部分提取的（topic → 单位 → 值集）；
 * 扫描 = 每章正文只扫「含 topic 的行 ±1 行」窗口，且跳过编号/标题/章节号行（isPunctDensityBodyLine）与编号类行；
 * 判定 = 同 topic 同单位出现不同数值 → warn（跨单位不换算不比较）；
 * 去重 = 每章每 topic ≤2 条命中，总命中 ≤30 条（防长文刷屏），与 formatCheckReport 既有 push 骨架同口径。
 */
export function numberConflictHits(factLines: string[], chapters: Chapter[]): FormatCheckHit[] {
  const baseline = buildFactBaseline(factLines)
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
            const verdict = overCommitDirection(tp, n.value, vals)
            hits.push(
              verdict
                ? {
                    chapter: title,
                    rule: "param_escalation",
                    quote: `${quoteAround(wl, n.index, n.raw.length)}（${
                      verdict === "more" ? "承诺高于招标档位" : "承诺优于招标时限"
                    }：${n.value}${n.unit} vs 要求 ${factSide}，过度响应＝额外验收义务）`.slice(0, 80),
                    level: "warn",
                  }
                : {
                    chapter: title,
                    rule: "number_conflict",
                    quote: `${quoteAround(wl, n.index, n.raw.length)}（事实口径「${tp}」为 ${factSide}）`.slice(0, 80),
                    level: "warn",
                  },
            )
            if (hits.length >= 30) break outer
          }
        }
      }
    }
  }
  return hits
}

/**
 * numeric-consistency-01（docs/06 #9 / 08报告 3.2-3，用户点名废标级）：把本地零 AI 数字口径核对
 * 从「事实表 × 正文」扩展到结构化面——偏离表（逐条款 response_summary 响应值）与大纲（节点标题）
 * 同样要对齐招标事实口径。偏离表是评标逐字核对的交付物，正文已核对而偏离表漏检＝真实缺口。
 * 复用既有 buildFactBaseline/extractNumRefs/overCommitDirection/quoteAround 与全部误报控制，零新增正则：
 *  - 偏离表：以 clause_text（招标要求原文）中出现的 topic 为锚，比对 response_summary 里的数值；
 *  - 大纲：节点标题自身含 topic 且含数值时比对（与正文同行锚定同法）；
 *  - 跨单位不比较、比较语境/编号行豁免、方向判定（加码 vs 普通冲突）全部沿用正文口径；
 *  - 命中沿用 number_conflict / param_escalation 两个既有 rule（不动白名单/数据模型），chapter 标注来源面；
 *  - 每行/每标题每 topic ≤1 条，总命中 ≤30。仅告警不阻断、不写库，交人工在偏离表/大纲里复核。
 */
function flattenOutlineTitles(nodes: OutlineNode[]): string[] {
  const out: string[] = []
  const walk = (ns: OutlineNode[]) => {
    for (const n of ns ?? []) {
      const t = (n.title ?? "").trim()
      if (t) out.push(t)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

export function structuredNumberConflictHits(
  factLines: string[],
  outline: OutlineNode[],
  deviationTable: DeviationTable | null,
): FormatCheckHit[] {
  const baseline = buildFactBaseline(factLines)
  const hits: FormatCheckHit[] = []
  if (!baseline.size) return hits
  const topics = [...baseline.keys()]
  const seenExact = new Set<string>()

  const emit = (label: string, text: string, tp: string, n: NumRef) => {
    if (hits.length >= 30) return
    const vals = baseline.get(tp)?.get(n.unit)
    if (!vals || !vals.length || vals.includes(n.value)) return
    const exact = `${label}|${tp}|${n.index}|${n.value}`
    if (seenExact.has(exact)) return
    seenExact.add(exact)
    const factSide = vals.map((v) => `${v}${n.unit}`).join("/")
    const verdict = overCommitDirection(tp, n.value, vals)
    hits.push(
      verdict
        ? {
            chapter: label,
            rule: "param_escalation",
            quote: `${quoteAround(text, n.index, n.raw.length)}（${
              verdict === "more" ? "承诺高于招标档位" : "承诺优于招标时限"
            }：${n.value}${n.unit} vs 要求 ${factSide}）`.slice(0, 80),
            level: "warn",
          }
        : {
            chapter: label,
            rule: "number_conflict",
            quote: `${quoteAround(text, n.index, n.raw.length)}（事实口径「${tp}」为 ${factSide}）`.slice(0, 80),
            level: "warn",
          },
    )
  }

  // 偏离表：条款原文给主题锚，比对响应说明里的数值（评标最逐字核对的面）
  for (const row of deviationTable?.rows ?? []) {
    if (hits.length >= 30) break
    const summary = (row.response_summary ?? "").trim()
    if (!summary || summary.includes("【待填写】")) continue
    const clauseText = row.clause_text ?? ""
    const anchorTopics = topics.filter((tp) => tp.length >= 2 && clauseText.includes(tp))
    if (!anchorTopics.length) continue
    for (const n of extractNumRefs(summary)) {
      for (const tp of anchorTopics) emit(`偏离表 · ${(row.clause_id || clauseText).trim().slice(0, 16) || "未编号条款"}`, summary, tp, n)
    }
  }

  // 大纲：节点标题自身含 topic 且含数值时比对
  for (const titleLine of flattenOutlineTitles(outline)) {
    if (hits.length >= 30) break
    if (NUM_ID_LINE_RE.test(titleLine)) continue
    const anchorTopics = topics.filter((tp) => tp.length >= 2 && titleLine.includes(tp))
    if (!anchorTopics.length) continue
    for (const n of extractNumRefs(titleLine)) {
      for (const tp of anchorTopics) emit(`大纲 · ${titleLine.slice(0, 16)}`, titleLine, tp, n)
    }
  }

  return hits
}

// ---------------------------------------------------------------------------
// prompt-fabscan-03（子集 · 纯本地零 AI）：交卷体检补「承诺不够」维度
// 与 param_escalation（承诺加码＝超配）互补：扫偏离表里已判为「偏离」的负偏离行，
// 在导出前最后一道关（交卷体检）surface 出来，让操作者逐条确认是否影响评分／是否触废标。
// 守审计中立（R6）：只读 response_map 既有结构化字段，不依赖生成模式、不改 AI 提示词、不做导出门禁（只 warn）。
// 待办残差（C 类，需拍板）：整改建议按章聚合回灌、覆盖审计四态（改 AI 提示词语义）、疑似编造未清零禁导出。
// ---------------------------------------------------------------------------

/** 废标级信号：★/▲ 实质性响应条款（本库既有约定）+ [强制] 前缀 + 明确「实质性响应/废标/无效标」字样 */
const MANDATORY_CLAUSE_RE = /[★☆▲△]|\[强制\]|实质性响应|废标|无效标/

/** 承诺不够（偏离表负偏离）：response_level==="deviation" 的行 surfaced 到交卷体检，每行 1 条、总 ≤30 */
export function deviationCommitHits(deviationTable: DeviationTable | null): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  for (const row of deviationTable?.rows ?? []) {
    if (hits.length >= 30) break
    if (row.response_level !== "deviation") continue
    const clause = (row.clause_text ?? "").trim()
    const cid = (row.clause_id ?? "").trim()
    const brief = (clause || cid).slice(0, 40)
    const mandatory = MANDATORY_CLAUSE_RE.test(clause) || MANDATORY_CLAUSE_RE.test(cid)
    hits.push({
      chapter: `偏离表 · ${(cid || clause).slice(0, 16) || "未编号条款"}`,
      rule: "deviation_undercommit",
      quote: (mandatory
        ? `「${brief}」为★/强制条款却判为偏离（承诺低于招标要求），可能触发不符合性／废标，导出前务必复核`
        : `「${brief}」判为偏离（承诺低于招标要求），确认是否影响评分`).slice(0, 80),
      level: "warn",
    })
  }
  return hits
}

// ---------------------------------------------------------------------------
// numeric-consistency-02（做法 A · 纯本地零 AI）：投标报价 vs 最高限价/预算 交叉核对
// 与通用 number_conflict（同 topic 多值）互补：报价是另一个 topic，本规则做「跨 topic + 方向性」判定——
// 仅当标书正文/偏离表里出现的投标报价 > 事实里的最高限价/预算 才报（废标级，只 warn、不阻断、零 AI、零新数据模型）。
// 局限（做法 A 固有）：仅当报价数字被写进标书正文/偏离表响应时才报得出；真实报价总额在 /ppt-quote，接入属做法 B（更重）。
// ---------------------------------------------------------------------------

/** 硬天花板（最高限价/控制价）优先于软天花板（预算/估算价/概算）；报价只信关键词同行，保守防把预算复述当报价 */
const PRICE_HARD_RE = /最高限价|限价|控制价|最高投标/
const PRICE_CEILING_TOPIC_RE = /最高限价|限价|控制价|最高投标|预算|估算价|概算/
const QUOTE_TOPIC_RE = /投标报价|投标总价|投标总报价|投标价|总报价|报价总额|开标一览|报价记录/

/** 元归一：NUM_UNIT_RE 钱单位仅 万元/元；其余返回 null（数量/百分比/日期不参与报价核对） */
function priceToYuan(value: number, unit: string): number | null {
  if (unit === "万元") return value * 10000
  if (unit === "元") return value
  return null
}

/** 元金额回显：≥亿按亿元、≥万按万元，toFixed 去尾零 */
function fmtYuan(y: number): string {
  if (y >= 1e8) return `${+(y / 1e8).toFixed(2)} 亿元`
  if (y >= 1e4) return `${+(y / 1e4).toFixed(2)} 万元`
  return `${y} 元`
}

/** 从事实行解析报价天花板：硬天花板（最高限价/控制价）优先，无则退用软天花板（预算/估算价/概算）；两者都取不到返回 null */
export function priceCeilingFromFacts(factLines: string[]): { ceiling: number; src: string } | null {
  let hardCeiling = -1
  let softCeiling = -1
  for (const rawLine of factLines ?? []) {
    const line = (rawLine ?? "").trim()
    if (!line || line.includes("【需人工确认】")) continue
    const topic = factTopicOf(line)
    if (!PRICE_CEILING_TOPIC_RE.test(topic)) continue
    const head = line.match(/^[^：:=]{2,20}[：:=]/)
    const body = head ? line.slice(head[0].length) : line
    for (const n of extractNumRefs(body.replace(/,/g, ""))) {
      const y = priceToYuan(n.value, n.unit)
      if (y === null) continue
      if (PRICE_HARD_RE.test(topic)) hardCeiling = Math.max(hardCeiling, y)
      else softCeiling = Math.max(softCeiling, y)
    }
  }
  if (hardCeiling >= 0) return { ceiling: hardCeiling, src: "最高限价/控制价" }
  if (softCeiling >= 0) return { ceiling: softCeiling, src: "预算金额" }
  return null
}

/** 投标报价 > 最高限价/预算 → 废标风险（纯函数、零 AI；取不到限价/预算或报价时静默不报，总 ≤15 条） */
export function overPriceCeilingHits(
  factLines: string[],
  chapters: Chapter[],
  deviationTable: DeviationTable | null,
): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const cap = priceCeilingFromFacts(factLines)
  if (!cap) return hits
  const ceiling = cap.ceiling
  const ceilingSrc = cap.src

  const seen = new Set<string>()
  const emit = (label: string, text: string) => {
    if (hits.length >= 15) return
    for (const n of extractNumRefs(text.replace(/,/g, ""))) {
      const y = priceToYuan(n.value, n.unit)
      if (y === null || y <= ceiling) continue
      const pct = Math.round(((y - ceiling) / ceiling) * 100)
      const exact = `${label}|${n.value}${n.unit}`
      if (seen.has(exact)) continue
      seen.add(exact)
      hits.push({
        chapter: label,
        rule: "over_price_ceiling",
        quote: `【废标风险】投标报价 ${n.value}${n.unit} 超${ceilingSrc} ${fmtYuan(ceiling)}（高 ${pct}%），导出前必核`.slice(0, 80),
        level: "warn",
      })
    }
  }

  for (let ci = 0; ci < (chapters ?? []).length; ci++) {
    if (hits.length >= 15) break
    const c = chapters[ci]
    const content = c.content ?? ""
    if (!content.trim()) continue
    const title = (c.title ?? "").trim() || `第${ci + 1}章`
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim() || NUM_ID_LINE_RE.test(line)) continue
      // 只认「关键词同行」；若行是“报价不得超过预算 X”式的约束句（未给出我方具体报价）则跳过，避免把预算复述当报价
      if (!QUOTE_TOPIC_RE.test(line)) continue
      if (/不得超过|不超过|不得超|以内|以下/.test(line) && !/我方|投标总报价为|投标报价为|报价为|人民币/.test(line)) continue
      emit(title, line)
    }
  }
  for (const row of deviationTable?.rows ?? []) {
    if (hits.length >= 15) break
    const summary = (row.response_summary ?? "").trim()
    if (summary && QUOTE_TOPIC_RE.test(summary)) {
      emit(`偏离表 · ${(row.clause_id || row.clause_text || "").trim().slice(0, 16) || "未编号条款"}`, summary)
    }
  }
  return hits
}

/** 报价单快照（由调用方从 /api/quotes 映射，bidTypes 不反向依赖 PptQuote 模块） */
export type QuoteTotalRef = { name: string; totalYuan: number; updated: string; opportunityId: string }

/** 同一报价单的多版本（v1/v2 各一条记录）按名去重只取最新 updated；单商机最多取 3 份，防旧版本刷条数 */
export function pickLatestQuoteTotals(
  refs: QuoteTotalRef[],
  oppId: string,
): { name: string; totalYuan: number }[] {
  const key = (oppId ?? "").trim()
  if (!key) return []
  const byName = new Map<string, QuoteTotalRef>()
  for (const r of refs ?? []) {
    if (!r || (r.opportunityId ?? "").trim() !== key) continue
    if (!Number.isFinite(r.totalYuan) || r.totalYuan <= 0) continue
    const name = (r.name ?? "").trim() || "未命名报价单"
    const prev = byName.get(name)
    if (!prev || String(r.updated) > String(prev.updated)) byName.set(name, { ...r, name })
  }
  return [...byName.values()]
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
    .slice(0, 3)
    .map((r) => ({ name: r.name, totalYuan: r.totalYuan }))
}

/** 做法 B（numeric-consistency-02）：关联商机的报价单真实总额 vs 天花板（与做法 A 同规则同口径，仅报价取数来源不同；≤5 条） */
export function quoteRecordCeilingHits(
  factLines: string[],
  quotes: { name: string; totalYuan: number }[],
): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const cap = priceCeilingFromFacts(factLines)
  if (!cap) return hits
  const seen = new Set<string>()
  for (const q of quotes ?? []) {
    if (hits.length >= 5) break
    if (!q || !Number.isFinite(q.totalYuan) || q.totalYuan <= cap.ceiling) continue
    const name = (q.name ?? "").trim() || "未命名报价单"
    const exact = `${name}|${q.totalYuan}`
    if (seen.has(exact)) continue
    seen.add(exact)
    const pct = Math.round(((q.totalYuan - cap.ceiling) / cap.ceiling) * 100)
    hits.push({
      chapter: `报价单 · ${name.slice(0, 16)}`,
      rule: "over_price_ceiling",
      quote: `【废标风险】关联报价单「${name}」总额 ${fmtYuan(q.totalYuan)} 超${cap.src} ${fmtYuan(cap.ceiling)}（高 ${pct}%），导出前必核`.slice(0, 80),
      level: "warn",
    })
  }
  return hits
}

// ---------------------------------------------------------------------------
// content-guard-02（docs/06 #9 事后一致性拦截，纯本地零 AI）
// 与 number_conflict 互补：number_conflict 要有全局事实表才比；本组只扫正文自身，
// 抓同一份标书内部“RPO 写 0 / 又写 <1h”类口径矛盾与绝对化承诺残留（R1 事前块的反向拦截）。
// 守零误报：只对单位明确、项目级单值的高信号指标做单位归一比对；命中为提醒级，人在交卷体检里复核。
// ---------------------------------------------------------------------------

const METRIC_SPECS: { name: string; alias: string[]; kind: "time" | "pct" }[] = [
  { name: "RPO（数据恢复点目标）", alias: ["RPO", "数据恢复点"], kind: "time" },
  { name: "RTO（业务恢复时间目标）", alias: ["RTO", "业务恢复时间", "故障恢复时间"], kind: "time" },
  { name: "系统可用性", alias: ["可用性", "可用率", "系统可用"], kind: "pct" },
]

function timeToSeconds(v: number, unit: string): number {
  const u = unit.toLowerCase()
  if (/毫秒|ms/.test(u)) return v / 1000
  if (/^s$|秒/.test(u)) return v
  if (/^min$|分钟/.test(u)) return v * 60
  if (/^h$|小时|时/.test(u)) return v * 3600
  if (/天|日/.test(u)) return v * 86400
  if (/周/.test(u)) return v * 604800
  if (/个月|月/.test(u)) return v * 2592000
  if (/年/.test(u)) return v * 31536000
  return v
}

/** 指标口径唯一性（docs/06 #9 规则1）：跨章同指标出现不同归一化值 → warn，每指标最多 1 条 */
export function metricConflictHits(chapters: Chapter[]): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  for (const spec of METRIC_SPECS) {
    const seen = new Set<string>()
    const distinct: { display: string; chapter: string }[] = []
    const register = (key: string, display: string, chapter: string) => {
      if (seen.has(key)) return
      seen.add(key)
      distinct.push({ display, chapter })
    }
    ;(chapters ?? []).forEach((c, ci) => {
      const content = c.content ?? ""
      if (!content.trim()) return
      const title = (c.title ?? "").trim() || `第${ci + 1}章`
      for (const line of content.split(/\r?\n/)) {
        for (const alias of spec.alias) {
          let from = 0
          for (;;) {
            const ai = line.indexOf(alias, from)
            if (ai < 0) break
            from = ai + alias.length
            const seg = line.slice(ai + alias.length, ai + alias.length + 16)
            if (spec.kind === "pct") {
              const m = seg.match(/(\d+(?:\.\d+)?)\s*[%％]/)
              if (m) register(Number(m[1]).toFixed(4), `${m[1]}%`, title)
            } else {
              const m = seg.match(/(\d+(?:\.\d+)?)\s*(毫秒|ms|秒|s|分钟|min|分|小时|h|时|天|日|周|个月|月|年)/i)
              if (m) register(String(Math.round(timeToSeconds(Number(m[1]), m[2]))), `${m[1]}${m[2]}`, title)
              else if (/^[\s=＝:：≤<>]*\s*(0|零)/.test(seg)) register("0", "0", title)
            }
          }
        }
      }
    })
    if (distinct.length >= 2) {
      const a = distinct[0]
      const b = distinct[1]
      hits.push({
        chapter: "（全文）",
        rule: "metric_conflict",
        quote: `「${spec.name}」口径不一：${a.display}（${a.chapter}）／${b.display}（${b.chapter}）；若非分层 SLA 请统一`.slice(0, 80),
        level: "warn",
      })
    }
  }
  return hits
}

/** 占位元话语残留（【待填写】为约定合法占位值，不纳入） */
const META_LEFTOVER_RE = /待定|待补充|待完善|待确认|需人工确认|需补充|此处省略|以下省略|此处略|TBD|TODO|AI\s*生成|由模型生成|模型输出|请填入|请填写|复制内容后|仅保留文本|保留文本|示例占位|占位符/i
/** 绝对化/保证性承诺残留（与 BID_STYLE_RULES “禁绝对化承诺”事前约束成对） */
const ABSOLUTE_PROMISE_RE = /确保通过|保证通过|确保达到|保证达到|确保中标|保证中标|万无一失|零风险|百分百通过|100%\s*(?:满足|响应|符合|通过|覆盖)/

/** 占位元话语与绝对化承诺残留（docs/06 #9 规则5）：每章每类最多 2 条命中，总 ≤30 */
export function metaLeftoverHits(chapters: Chapter[]): FormatCheckHit[] {
  const hits: FormatCheckHit[] = []
  const cap = new Map<string, number>()
  ;(chapters ?? []).forEach((c, ci) => {
    if (hits.length >= 30) return
    const content = c.content ?? ""
    if (!content.trim()) return
    const title = (c.title ?? "").trim() || `第${ci + 1}章`
    for (const line of content.split(/\r?\n/)) {
      const pairs: [RegExp, string][] = [
        [META_LEFTOVER_RE, "meta"],
        [ABSOLUTE_PROMISE_RE, "absolute"],
      ]
      for (const [re, tag] of pairs) {
        const m = re.exec(line)
        if (!m) continue
        const k = `${title}#${tag}`
        if ((cap.get(k) ?? 0) >= 2) continue
        cap.set(k, (cap.get(k) ?? 0) + 1)
        hits.push({ chapter: title, rule: "meta_leftover", quote: quoteAround(line, m.index, m[0].length), level: "warn" })
      }
    }
  })
  return hits
}

/** 自动修复动作（供生成后回显）：rule 复用体检规则名，note 人类可读 */
export type AutoRepairFix = { rule: FormatCheckRule; note: string }

/** 填值槽位类元话语（明确表示「此处应有一个具体值」）→ 规范化为合法占位【待填写】 */
const META_SLOT_RE = /待定|待补充|待完善|需补充|请填入|请填写/g
/** 过程性元话语（AI 腔的过程注释，删掉即可，不留残值）→ 删除 */
const META_PROC_RE = /此处省略|以下省略|此处略|需人工确认|待确认|AI\s*生成|由模型生成|模型输出|复制内容后|仅保留文本|保留文本|示例占位|占位符|TBD|TODO/gi

/**
 * R32 批次2「生成后自动定向修复」：对单章正文做**确定性代码清洗**（零 AI、零费用、零幻觉），
 * 只处理两类可安全自动修的命中——「不改事实/数值语义的纯文本清洗」与「按招标基线把超承诺值降回」：
 *  ① 装饰/Markdown（decoration_leftover / no_bold / no_underline）：剥离行首 # - * > 结构符、** __ <u> 标记、装饰符号（合法占位【待填写】【请补充素材】先保护后还原）；
 *  ② no_empty_line_consecutive：≥3 连续空行压成 1 行；
 *  ③ meta_leftover：填值槽位（待定/待补充/请填入…）→【待填写】；过程性元话语（此处省略/TBD/AI生成…）→ 删除；
 *     —— 绝对化承诺（确保通过/零风险…）需语言重写、非确定性安全修，保留为 warn 交人工，本函数不动；
 *  ④ param_escalation：承诺值高于/优于招标档位、且招标基线为**单一确定值**时，把该处数字就地降回基线值（基线多档=不确定，留 warn 不自动改）；
 *  ⑤ no_half_width_punct：仅把紧跟汉字的半角 , ; : ! ? 转全角（排除 3,000 等数字千分位与英文语境）。
 * number_conflict / metric_conflict / identity_leak / sealed 页数等一律不自动改，交人工复核。
 * 清洗类规则是否执行尊重项目 format_check_items 勾选；元话语与加码属常开体检项，不受勾选限制。
 * 正文无变化时 applied 为空（调用方据此决定是否回写/提示）。
 */
export function autoRepairChapter(
  content: string,
  factLines: string[],
  items: FormatCheckKey[],
): { content: string; applied: AutoRepairFix[] } {
  if (!content || !content.trim()) return { content, applied: [] }
  const enabled = new Set<FormatCheckKey>(items ?? [])
  const wantDecor = enabled.has("decoration_leftover")
  const wantBold = enabled.has("no_bold")
  const wantUnderline = enabled.has("no_underline")
  const wantEmpty = enabled.has("no_empty_line_consecutive")
  const wantPunct = enabled.has("no_half_width_punct")
  const glyphG = new RegExp(DECORATION_GLYPH_RE.source, "g")

  // 招标基线表（topic→unit→values），与 numberConflictHits 同口径；仅取单一档位的 topic 用于降档
  const baseline = new Map<string, Map<string, number[]>>()
  for (const rawLine of factLines ?? []) {
    const fl = (rawLine ?? "").trim()
    if (!fl || fl.includes("【需人工确认】")) continue
    const topic = factTopicOf(fl)
    if (!topic) continue
    const head = fl.match(/^[^：:=]{2,20}[：:=]/)
    const body = head ? fl.slice(head[0].length) : fl
    for (const n of extractNumRefs(body)) {
      let um = baseline.get(topic)
      if (!um) {
        um = new Map()
        baseline.set(topic, um)
      }
      const vs = um.get(n.unit) ?? []
      if (!vs.includes(n.value)) vs.push(n.value)
      um.set(n.unit, vs)
    }
  }
  const topics = [...baseline.keys()]

  let decorLines = 0
  let metaLines = 0
  let punctLines = 0
  let escCount = 0
  let emptyCollapsed = 0

  const HALF_MAP: Record<string, string> = { ",": "，", ";": "；", ":": "：", "!": "！", "?": "？" }

  const lines = content.split(/\r?\n/)
  const out: string[] = []
  for (const raw of lines) {
    let line = raw

    // ① 装饰 / Markdown 残留（合法占位先剥离保护，处理完再放回）
    if (wantDecor || wantBold || wantUnderline) {
      const slots: string[] = []
      let s = line.replace(LEGAL_PLACEHOLDER_RE, (m) => {
        slots.push(m)
        return `\u0000${slots.length - 1}\u0000`
      })
      const before = s
      if (wantBold) s = s.replace(/\*\*([^*\n]{1,60})\*\*/g, "$1").replace(/__([^_\n]{1,60})__/g, "$1")
      if (wantUnderline) s = s.replace(/<u>([\s\S]{0,60}?)<\/u>/gi, "$1")
      if (wantDecor) {
        s = s.replace(/^(\s*)(?:#{1,6}\s+|[-*+]\s+|>\s+)/, "$1")
        s = s.replace(glyphG, "")
      }
      if (s !== before) {
        decorLines += 1
        line = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] ?? "")
      } else {
        line = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] ?? "")
      }
    }

    // ③ 元话语规范化（先保护【待填写】避免二次包裹）
    {
      const before = line
      line = line.replace(META_SLOT_RE, "【待填写】").replace(META_PROC_RE, "")
      if (line !== before) metaLines += 1
    }

    // ⑤ 半角标点转全角（仅紧跟汉字后）
    if (wantPunct) {
      const before = line
      line = line.replace(/([\u4e00-\u9fa5])([,;:!?])/g, (_, c, p) => c + (HALF_MAP[p] ?? p))
      if (line !== before) punctLines += 1
    }

    // ④ 参数加码降档（正文承诺值超/优于招标单一基线档 → 就地降回基线值）
    if (topics.length && isPunctDensityBodyLine(line) && !NUM_ID_LINE_RE.test(line)) {
      const hitTopics = topics.filter((tp) => tp.length >= 2 && line.includes(tp))
      if (hitTopics.length) {
        const edits: { start: number; end: number; text: string }[] = []
        for (const n of extractNumRefs(line)) {
          for (const tp of hitTopics) {
            const vals = baseline.get(tp)?.get(n.unit)
            if (!vals || vals.length !== 1) continue // 多档基线不确定，不自动改
            const verdict = overCommitDirection(tp, n.value, vals)
            if (!verdict) continue
            const target = vals[0]
            if (target === n.value) continue
            const suffix = n.raw.slice(String(n.value).length)
            const text = `${target}${suffix}`
            edits.push({ start: n.index, end: n.index + n.raw.length, text })
            escCount += 1
            break
          }
        }
        if (edits.length) {
          edits.sort((a, b) => b.start - a.start)
          for (const e of edits) line = line.slice(0, e.start) + e.text + line.slice(e.end)
        }
      }
    }

    out.push(line)
  }

  // ② 连续空行折叠
  let finalLines = out
  if (wantEmpty) {
    finalLines = []
    let blank = 0
    for (const l of out) {
      if (!l.trim()) {
        blank += 1
        continue
      }
      if (blank > 2) {
        emptyCollapsed += blank - 1
        finalLines.push("")
      } else {
        for (let i = 0; i < blank; i++) finalLines.push("")
      }
      blank = 0
      finalLines.push(l)
    }
    if (blank > 2) {
      emptyCollapsed += blank - 1
      finalLines.push("")
    } else {
      for (let i = 0; i < blank; i++) finalLines.push("")
    }
  }

  const applied: AutoRepairFix[] = []
  if (decorLines) applied.push({ rule: "decoration_leftover", note: `清理装饰符号/Markdown 残留 ${decorLines} 行` })
  if (metaLines) applied.push({ rule: "meta_leftover", note: `占位/过程性元话语规范化 ${metaLines} 行` })
  if (escCount) applied.push({ rule: "param_escalation", note: `承诺值降回招标基线 ${escCount} 处` })
  if (punctLines) applied.push({ rule: "no_half_width_punct", note: `半角标点转全角 ${punctLines} 行` })
  if (emptyCollapsed) applied.push({ rule: "no_empty_line_consecutive", note: `连续空行折叠 ${emptyCollapsed} 处` })

  const next = finalLines.join("\n")
  return { content: applied.length ? next : content, applied }
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

/** R45/F4（体验审计）：视图层显示阶段——stage 仍为 pending_parse 但已有解析产物时不再显示「待解析」。
 * 阶段状态机不变（BidStage 枚举、deriveStage、归档/闸门判定均不动），仅消卡片「待解析」与解析报告已存在的矛盾文案 */
export function displayStageLabel(rec: Pick<BidProjectRecord, "stage"> & Partial<Pick<BidProjectRecord, "parse_report">>): string {
  if (rec.stage === "pending_parse" && (rec.parse_report?.sections?.length ?? 0) > 0) return "已解析 · 待编制"
  return STAGE_LABEL[rec.stage] ?? "待解析"
}

/** R45/F5（体验审计）：解析完成后的保守回填提取——只认解析正文里的精确标签形态（「采购人名称：/项目（招标）编号：/开标时间|日期：」）；
 * 无命中留空、占位写法（某编号）不取、出处后缀剔除；是否覆盖由调用方保证（仅填空白字段，绝不改用户已填值） */
export function parseBackfillFields(report: ParseReport | null): { hospital: string; tender_no: string; bid_open_date: string } {
  const blank = { hospital: "", tender_no: "", bid_open_date: "" }
  if (!report) return blank
  const all = report.sections.map((s) => s.content).join("\n")
  const labelValue = (re: RegExp): string => {
    const m = all.match(re)
    const v = (m?.[1] ?? "").replace(/\s*[（(]?\s*出处[：:].*$/, "").trim()
    return /^某/.test(v) ? "" : v
  }
  const hospital = labelValue(/采购人名称[：:]\s*([^\n（(，。；;]{2,40})/)
  const tender_no = labelValue(/(?:项目|招标)编号[：:]\s*([^\s，。；;、（(：:）)]{3,40})/)
  let bid_open_date = ""
  const dm = all.match(/开标(?:时间|日期)[：:]\s*20(\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日/)
  if (dm) bid_open_date = `20${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`
  return { hospital, tender_no, bid_open_date }
}

/** R45/F5（体验审计）：展示层取采购人——已存 hospital 优先，为空则从本项目解析报告的 purchaser_info 派生（零写入、纯读）。
 * 解决存量项目（解析早于回填代码上线）卡片一直显「采购人未填写」的问题；下次解析会由 parseBackfillFields 正式回填字段 */
export function effectiveHospital(rec: Pick<BidProjectRecord, "hospital"> & Partial<Pick<BidProjectRecord, "parse_report">>): string {
  return rec.hospital?.trim() || parseBackfillFields(rec.parse_report ?? null).hospital
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
  // ai-stability-01：逐级放宽（原样→结构修复→转义字符串内裸控制字符→叠加），全失败才抛可读错误，不再裸抛 SyntaxError
  return parseJsonTolerant(candidate, repairJsonCandidate)
}

export function asString(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v)
}

function asNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function asArray(v: unknown): unknown[] {
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
    // lint-debt-01: ok 初值 false 会被 try/catch 立即覆盖（3741 处 no-useless-assignment）；
    // 改为初值 true、仅在 catch 里置 false，两条路径的取值都在下方 3748 读取，行为完全等价
    let ok = true
    try {
      parsed = JSON.parse(span)
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
export const MAX_BID_CHARS = 12000 // R65 搬迁：prompts/voidCheck 引用，值与语义不变

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
    const content = clampParseSectionContent(key, cleanParseSectionContent(lines.join("\n")))
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
const TEMPLATE_HEADING_RE = /^[一二三四五六七八九十0-9.、]+[、.]?.{2,40}$/

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
    const title = line.replace(/^[一二三四五六七八九十0-9.、]+[、.]?/, "").trim()
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
  // 公司招投标培训（第一期）⑤技术条款编写 / ②投标文件编制技巧：参数忠实与承诺克制
  "技术参数忠实：引用招标技术参数、指标与条款表述时逐字照抄进正文，不漏项、不改原意、不换说法、不做「优化改写」；",
  "承诺克制（最小值响应）：功能点、响应时间、故障到场时限、质保与运维期等承诺按满足招标要求的最小档响应，禁止超出招标要求多加功能或拔高指标——过度响应就是验收义务；仅投标有效期、授权期限、交货期等形式项在招标未明确时按从宽口径自信满足；",
  "禁绝对化承诺：不得使用「确保通过 / 保证中标 / 满分响应 / 100% 满足 / 万无一失 / 零风险 / 完全无误差」等绝对化、保证性表述；可承诺处一律用「满足招标要求 / 按招标文件响应 / 承诺……（可验收的具体措施与量化值）」等可核实口径，把结论落在证据上而非形容词上；",
]

/**
 * 第 1 轮止血（防翻车增量三条，见 docs/05 §4）：与 BID_STYLE_RULES 同级、注入正文生成器。
 * 只补 BID_STYLE_RULES 未覆盖的净增量——规模量级自洽 / 政策法规时效 / 术语文字统一；
 * 红线「技术参数忠实」「承诺克制」「防编造占位」「禁装饰符号」已在 BID_STYLE_RULES，此处不重复。
 * 与「事后一致性检查器」(docs/06 #9) 是事前约束/事后拦截一对，规则口径共享本节。
 */
export const FULLTEXT_GUARD_RULES: string[] = [
  "规模量级自洽：架构选型与技术配置的规模必须与项目预算量级、医院等级和招标范围相匹配，禁止在数百万级预算项目里堆砌「双活数据中心 / PB 级存储 / 全栈容器中台」等明显超配的旗舰架构；招标未明确要求的高规格设施不得自行写入，规模拿不准时以招标原文界定的范围为上限；",
  "政策法规时效：引用国家政策、行业标准、规划文件时须为其现行有效的版本与名称，禁止把已过期的阶段性目标当作建设依据（如当前已越过原文件有效期仍写「到 2025 年底前」「《2021—2025 年行动方案》」）；不确定是否现行时，统称「国家及行业现行有效的相关政策与标准」，不写死过期文件名与年份区间；",
  "术语文字统一：同一指标、系统、评级在全篇使用同一中文名称与口径（如「电子病历系统应用水平分级评价」不要一会儿简称「EMR 评级」一会儿「病历评分」），英文缩写首次出现附中文全称；禁止错别字、无必要的中英文混排与同一概念多名并存；",
]

/**
 * docs/05 §2「技术参数响应边界」落地（第 14 轮）：把「允许响应性包装 / 禁止实质性变更」
 * 从一句原则变成可执行清单 + 自检动作。
 * 与 BID_STYLE_RULES 的「技术参数忠实」「承诺克制（最小值响应）」是同一红线的可操作化补充
 * ——那两条给底线，这里给判定标准与逐条反例；属「加约束」，不改任何既有约束的含义，
 * 因此对存量项目只增不减、方向更严，不会造成新旧内容口径冲突。
 * 注入正文生成器（章 / 小节 / 续写）与改写器（refine）。
 */
export const PARAM_RESPONSE_BOUNDARY_RULES: string[] = [
  "技术参数响应边界（防废标，所有生成模式均不放宽）：只允许「响应性包装」，禁止「实质性变更」。允许的改写仅三类且必须保留原文全部限定信息——① 人称语态转换（招标「投标人应提供 7×24 小时服务」→ 正文「本项目提供 7×24 小时服务，满足招标要求」）；② 疑问或条件句转陈述句（招标「是否支持 ≥500 并发」→ 正文「本项目支持 500 并发用户，满足招标要求」）；③ 在原文后补响应结论词（「满足招标文件要求」「完全响应」）；",
  "实质性变更禁令（逐条自检，命中即改回原文口径）：① 改数值（≥500 并发写成 ≥1000、≤8 小时到场写成 ≤4 小时、3 年质保写成 5 年）；② 改单位或口径（Mbps 换 Gbps、并发用户换注册用户、工作日换自然日）；③ 改范围（部分科室换全院、试点换全面推广）；④ 删限定语（漏掉「含税」「含运费」「含三年质保」「含安装调试」）；⑤ 无依据加码（招标未要求的功能主动承诺）。无法逐字对应的，改写为「按招标文件要求响应」或【待填写】，不得自行给一个看起来合理的值；",
  "参数自检动作（每章输出前执行一次，不输出自检过程）：逐句核对本章出现的每一个数值、单位、范围与限定语，确认其与招标原文逐字一致；凡本章承诺值高于招标要求档位的，一律降回招标档位——高出部分不构成加分，只构成更高的验收义务。",
]

/**
 * docs/07 §5.3 + §5.4 落地（第 18 轮）：把事后检查器规则前移为事前「输出前自检」，并注入实测历史缺陷反例。
 * 与 PARAM_RESPONSE_BOUNDARY_RULES 同为「加约束」——只增不减、方向更严，不改任何既有约束的含义；
 * 反例是测试报告实测出过的真实负样本（模型对具体反例的遵守度远高于抽象禁令）。
 * 注入正文生成器（章 / 小节 / 续写）与改写器（refine），紧随参数响应边界之后，与 §5.1 同款接入模式。
 */
export const PRE_OUTPUT_SELFCHECK_RULES: string[] = [
  "输出前自检（每章输出前执行一次，不输出自检过程、只输出正文）：① 本章是否出现招标未要求的服务项或功能承诺？有则删除；② 本章每个数值是否能在招标原文或【全局事实】中找到出处？无出处则改【待填写】；③ 本章指标是否与前文已给值一致？不一致则沿用前文唯一值；④ 是否残留「待补充 / TODO / 占位」等元话语？有则删除；⑤ 是否出现装饰符号（【】★●→）或 Markdown 标记？有则改为纯文本；",
  "历史缺陷反例（以下为实测出过的问题，同类错误禁止重犯）：同一指标全篇只能一个值（如 RPO 写 0 又写 <1 小时、病历缺陷率写 1% 又写 2% 均属自相矛盾，必须统一）；预算量级与架构规模要相称（数百万预算不得承诺「双活数据中心 + K8s 容器云 + PB 级存储」）；政策引用须现行有效（不得仍写「2025 年前」「《2021—2025 年行动方案》」等已过期表述）；术语与文字统一（禁止「三级甲院」等错别字、禁止无必要中英夹杂）；禁止任何测试占位符残留（如「13131医院」）；禁止绝对化承诺（「确保通过五级评定」「确保获得满分」「数据准确率 100%」一律改为可核实口径）。",
]

const IMPLICIT_CONSTRAINT_PATTERN = /(不得超过|不得少于|不低于|至少|必须包含|必须涵盖|视为|总页数|页数不|份数)/

/**
 * R51/F6：把被换行切断的句子接回来——上一行未以句末标点收尾时并入下一行。
 * PDF 转译常在字中间换行（如「截止时间」被拆成两行），不接回就会产出
 * 「止时间前未完成…」「知书，中标…」这类碎片句。缓冲超 300 字强制落段，防表格行粘连成巨段。
 */
function joinWrappedLines(text: string): string[] {
  const paragraphs: string[] = []
  let buf = ""
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim()
    if (!line) continue
    buf += line
    if (/[。；;！？：]["”'’]?\)?」?』?$/.test(line) || buf.length >= 300) {
      paragraphs.push(buf)
      buf = ""
    }
  }
  if (buf) paragraphs.push(buf)
  return paragraphs
}

/** 句内裁剪：以关键词为锚，尽量贴住逗号/顿号等句内边界切，避免从字中间下手 */
function clipAround(s: string, anchor: number, max = 110): string {
  if (s.length <= max) return s
  let start = Math.max(0, anchor - 20)
  for (let i = anchor; i >= start && i > 0; i--) {
    if (/[,，、：;]/.test(s[i - 1])) {
      start = i
      break
    }
  }
  const end = Math.min(s.length, start + max)
  const head = start > 0 ? "…" : ""
  const tail = end < s.length ? "…" : ""
  return head + s.slice(start, end) + tail
}

/**
 * 改造 3：从招标文件全文本地抽取「隐式硬约束」（零 AI）——
 * 命中固定句式的完整句取为摘录（R51/F6：先接回换行断句再按句提取，超长句锚定关键词按句内标点裁剪），
 * 去重后最多 limit 条。「备份」后的「份数」是功能描述不是投标约束，排除。
 */
export function extractImplicitConstraints(tenderText: string, limit = 40): string[] {
  const text = (tenderText ?? "").trim()
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const para of joinWrappedLines(text)) {
    if (out.length >= limit) break
    for (const piece of para.split(/(?<=[。；;])/)) {
      if (out.length >= limit) break
      const s = piece.replace(/\s+/g, "").trim()
      if (s.length < 8) continue
      const m = s.match(IMPLICIT_CONSTRAINT_PATTERN)
      if (!m || m.index === undefined) continue
      if (s.slice(Math.max(0, m.index - 1), m.index) === "备") continue
      const excerpt = clipAround(s, m.index)
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
export { buildTenderParseMessages, extractScoringSectionExcerpt, PROMPT_VERSION as TENDER_PARSE_PROMPT_VERSION } from "./prompts/tenderParse"

export { buildSectionParseMessages, PROMPT_VERSION as SECTION_PARSE_PROMPT_VERSION } from "./prompts/sectionParse"

export { buildBidOutlineMessages, PROMPT_VERSION as BID_OUTLINE_PROMPT_VERSION } from "./prompts/bidOutline"

export { buildOutlineFixMessages, PROMPT_VERSION as OUTLINE_FIX_PROMPT_VERSION } from "./prompts/outlineFix"

export { buildBidChapterMessages, PROMPT_VERSION as BID_CHAPTER_PROMPT_VERSION } from "./prompts/bidChapter"
export type { BidChapterPromptOpts, BidSectionPromptOpts } from "./prompts/bidChapter"

/**
 * 第八轮改造 3：小节级生成 prompt——复用章节 prompt 的全部素材块
 * （评分细则/条款/全局事实/隐式硬约束/文风硬条款/招标原文片段），
 * 但只写当前小节：注入本章小节清单与已写小节末尾保证衔接，
 * 要求输出以「N.M 小节名」标题行开头的纯文本（不带配图 JSON）。
 */
export { buildBidSectionMessages, PROMPT_VERSION as BIDSECTION_PROMPT_VERSION } from "./prompts/bidSection"

export { buildBidContinueMessages, stripOverlap, PROMPT_VERSION as BIDCONTINUE_PROMPT_VERSION } from "./prompts/bidContinue"

export { buildDeviationMapMessages, PROMPT_VERSION as DEVIATIONMAP_PROMPT_VERSION } from "./prompts/deviationMap"
export { buildDupJudgeMessages, PROMPT_VERSION as DUP_JUDGE_PROMPT_VERSION } from "./prompts/dupJudge"
export { buildVoidCheckMessages, PROMPT_VERSION as VOID_CHECK_PROMPT_VERSION } from "./prompts/voidCheck"
export { buildEvalMessages, PROMPT_VERSION as EVAL_PROMPT_VERSION } from "./prompts/eval"
export { buildBidRefineMessages, PROMPT_VERSION as BID_REFINE_PROMPT_VERSION } from "./prompts/bidRefine"

export type BidRefineKind = "rewrite" | "expand" | "condense"

// ---------------------------------------------------------------------------
// 第九轮改造 3：三路评标之「格式规范路」与「商务要素路」（技术路 = buildEvalMessages 不动）
// 评标三路调用不带技能块：审计要保持中立，沿用交卷体检格局
// ---------------------------------------------------------------------------

export { buildEvalFormatMessages, PROMPT_VERSION as EVAL_FORMAT_PROMPT_VERSION } from "./prompts/evalFormat"


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
export { buildCommercialSectionText, collectCommercialParagraphs, buildEvalCommercialMessages, PROMPT_VERSION as COMMERCIALPAIR_PROMPT_VERSION } from "./prompts/commercialPair"

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

export { buildDefenseQuestionsMessages, PROMPT_VERSION as DEFENSE_QUESTIONS_PROMPT_VERSION } from "./prompts/defenseQuestions"

export { buildDefenseAnswerMessages, PROMPT_VERSION as DEFENSE_ANSWER_PROMPT_VERSION } from "./prompts/defenseAnswer"
export { buildDefenseOutlineMessages, PROMPT_VERSION as DEFENSE_OUTLINE_PROMPT_VERSION } from "./prompts/defenseOutline"

export { buildSpeechNotesMessages, PROMPT_VERSION as SPEECH_NOTES_PROMPT_VERSION } from "./prompts/speechNotes"

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
export function bigramOverlap(keyword: string, text: string): number { // R72 搬迁：prompts/submissionCheck 引用
  const k = normalizePara(keyword)
  const t = normalizePara(text)
  if (k.length < 2 || !t.length) return 0
  const grams = new Set<string>()
  for (let i = 0; i + 2 <= k.length; i++) grams.add(k.slice(i, i + 2))
  let hit = 0
  for (const g of grams) if (t.includes(g)) hit += 1
  return hit / (grams.size || 1)
}

export { buildSubmissionCheckMessages, PROMPT_VERSION as SUBMISSION_CHECK_PROMPT_VERSION } from "./prompts/submissionCheck"
export { buildSubmissionDigest } from "./prompts/submissionCheck"


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

export { buildFactSettingsMessages, PROMPT_VERSION as FACT_SETTINGS_PROMPT_VERSION } from "./prompts/factSettings"

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

export { buildFactCheckMessages, PROMPT_VERSION as FACT_CHECK_PROMPT_VERSION } from "./prompts/factCheck"
export { collectFactEvidence } from "./prompts/factCheck"


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

export { buildFactPatchMessages, PROMPT_VERSION as FACT_PATCH_PROMPT_VERSION } from "./prompts/factPatch"


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

export { buildJsonRepairMessages, PROMPT_VERSION as JSON_REPAIR_PROMPT_VERSION } from "./prompts/jsonRepair"
export { buildSectionResizeMessages, PROMPT_VERSION as SECTION_RESIZE_PROMPT_VERSION } from "./prompts/sectionResize"

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
export function collectLeafIdsUnder(node: OutlineNode): string[] {
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

export { buildOrchestrationMessages, PROMPT_VERSION as ORCHESTRATION_PROMPT_VERSION } from "./prompts/orchestration"

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

export { buildCoverageAuditMessages, resolveLeafSection, sanitizeCoverageAudit, PROMPT_VERSION as COVERAGE_AUDIT_PROMPT_VERSION } from "./prompts/coverageAudit"

// 第十六轮 B2 改造 2.3：长标书分步大纲（leafGoal 超阈值时：顶层章一次 + 技术章逐章展开）
// ---------------------------------------------------------------------------

/** 分步触发阈值：目标叶子数超过该值时大纲生成自动改走分步（单次大 JSON 输出在长规模下易截断/失衡） */
export const STAGED_OUTLINE_LEAF_GOAL = 40

export { buildOutlineLevel1Messages, PROMPT_VERSION as OUTLINE_LEVEL1_PROMPT_VERSION } from "./prompts/outlineLevel1"

export { buildOutlineChildrenMessages, PROMPT_VERSION as OUTLINE_CHILDREN_PROMPT_VERSION } from "./prompts/outlineChildren"

