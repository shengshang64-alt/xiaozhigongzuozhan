// ---------------------------------------------------------------------------
// 知识原子 · Schema / subject_key 校验 / 归一化（2026-10-30 知识库治理改造 P0）
//
// 依据《知识库改造需求文档 v1.0》§4.2 / §4.4 / §5 / 附录 A：
//   · 八种原子类型，各有严格抽取口径（§5）
//   · subject_key 必须符合「{类型}:{主体}|{限定}」格式，AI 输出 + 正则强校验（§4.4）
//   · 归一化（全角转半角/去空格/客户名去后缀/指标名映射）由**代码**做，不交给模型
//
// 为什么校验这么严：subject_key 是去重与冲突分组的唯一依据。
// 如果模型输出「metric:EMR分级」和「metric:电子病历应用水平分级」两条不同 key，
// 同一指标就永远归不到一组，去重和冲突检测全部失效。
// ---------------------------------------------------------------------------

import { z } from "zod"

// ===========================================================================
// 一、枚举（与 pb_hooks/kb_atoms.pb.js 完全一致，改一处必须同步另一处）
// ===========================================================================

export const ATOM_TYPES = [
  "fact", // 稳定事实
  "metric", // 带数值的指标
  "case", // 项目案例
  "qualification", // 资质证书
  "policy", // 政策条款
  "product_capability", // 产品能力
  "play", // 打法
  "script", // 话术
] as const
export type AtomType = (typeof ATOM_TYPES)[number]

export const ATOM_TYPE_LABEL: Record<AtomType, string> = {
  fact: "事实",
  metric: "指标",
  case: "案例",
  qualification: "资质",
  policy: "政策",
  product_capability: "产品能力",
  play: "打法",
  script: "话术",
}

/** 原子内容状态（§6 状态机） */
export const ATOM_STATUSES = ["draft", "pending", "approved", "rejected", "expired", "conflict", "superseded"] as const
export type AtomStatus = (typeof ATOM_STATUSES)[number]

export const ATOM_STATUS_LABEL: Record<AtomStatus, string> = {
  draft: "草稿",
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  expired: "已过期",
  conflict: "冲突待裁决",
  superseded: "已被替代",
}

/** 用途（P3：审核员不问"有用吗"，只问"以后能在哪儿用"） */
export const USABLE_FOR = ["proposal", "ppt", "bid", "quote", "faq"] as const
export type UsableFor = (typeof USABLE_FOR)[number]

export const USABLE_FOR_LABEL: Record<UsableFor, string> = {
  proposal: "方案",
  ppt: "PPT",
  bid: "标书",
  quote: "报价",
  faq: "答疑",
}

/** 密级 */
export const CONFIDENTIALITY = ["public", "internal", "client_only", "secret"] as const
export type Confidentiality = (typeof CONFIDENTIALITY)[number]

export const CONFIDENTIALITY_LABEL: Record<Confidentiality, string> = {
  public: "公开",
  internal: "内部",
  client_only: "仅客户可见",
  secret: "机密",
}

/** 密级高低（数字越大越敏感），用于「取最高密级」与消费侧过滤 */
export const CONFIDENTIALITY_RANK: Record<Confidentiality, number> = {
  public: 0,
  internal: 1,
  client_only: 2,
  secret: 3,
}

// ===========================================================================
// 二、subject_key 格式校验（§4.4 正则原样搬过来）
// ===========================================================================

const SUBJECT_KEY_RE: Record<AtomType, RegExp> = {
  metric: /^metric:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}\|[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
  case: /^case:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
  qualification: /^qual:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
  policy: /^policy:[\u4e00-\u9fa5A-Za-z0-9〔〕[\]（）()·-]{2,50}\|[\u4e00-\u9fa5A-Za-z0-9.-]{1,20}$/,
  product_capability: /^prod:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}\|[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
  play: /^play:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}\|[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
  fact: /^fact:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}\|[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
  script: /^script:[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}$/,
}

/** subject_key 是否符合该 atom_type 的格式 */
export function isValidSubjectKey(type: AtomType, key: string): boolean {
  const re = SUBJECT_KEY_RE[type]
  if (!re) return false
  return re.test(String(key ?? "").trim())
}

// ===========================================================================
// 三、归一化（§4.4「归一化补充规则，代码里做，不交给模型」）
// ===========================================================================

/** 全角转半角 */
function toHalfWidth(s: string): string {
  return s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ")
}

/** 指标名映射表：同义写法 → 规范名（只列高频，按需扩） */
/**
 * 2026-11-01 新增：**policy 主题别名归一**。
 *
 * 实测问题（真实库）：同一政策事实被模型起了 12 种 subject_key 变体——
 *   policy:电子病历应用水平|三级医院
 *   policy:电子病历应用水平分级|三级医院要求
 *   policy:电子病历应用水平分级评价|三级医院基本要求
 *   policy:电子病历应用水平分级评价|三级医院等级要求
 * 于是「按 subject_key 去重」完全失效，一次检索同时返回 3级/4级/5级 三个互斥要求
 * （其中 3 级是 2019 年旧要求、5 级是当前要求），生成时会引用过期政策。
 *
 * 归并策略：把「电子病历应用水平 / 分级 / 分级评价」这类同义主题统一到规范名。
 */
const POLICY_ALIASES: Record<string, string> = {
  电子病历应用水平: "电子病历应用水平分级",
  电子病历分级: "电子病历应用水平分级",
  电子病历应用水平分级评价: "电子病历应用水平分级",
  EMR分级: "电子病历应用水平分级",
  EMR等级: "电子病历应用水平分级",
  互联互通测评: "医院信息互联互通标准化成熟度",
  互联互通成熟度: "医院信息互联互通标准化成熟度",
  互联互通标准化成熟度测评: "医院信息互联互通标准化成熟度",
  等级保护: "网络安全等级保护",
  等保: "网络安全等级保护",
}

const METRIC_ALIASES: Record<string, string> = {
  EMR分级: "电子病历应用水平分级",
  EMR等级: "电子病历应用水平分级",
  电子病历分级: "电子病历应用水平分级",
  电子病历应用水平: "电子病历应用水平分级",
  电子病历应用水平分级评价: "电子病历应用水平分级",
  互联互通测评: "医院信息互联互通标准化成熟度",
  互联互通成熟度: "医院信息互联互通标准化成熟度",
  互联互通标准化成熟度测评: "医院信息互联互通标准化成熟度",
  智慧服务分级: "医院智慧服务分级评估",
  智慧管理分级: "医院智慧管理分级评估",
}

/**
 * 客户名后缀（比对时去掉，展示保留原名）
 *
 * 2026-10-30 实测修正：原来把「医院」也当后缀，导致
 * `六安市中医院` → `六安市中`（客户名被切坏，且与「六安市中医院分院」归不到一组）。
 *
 * 现策略：只剥离**真正冗余的企业后缀**（有限公司/股份有限公司/集团/分院），
 * 「医院」「卫生院」「中医院」是机构主体名的一部分，**绝不能剥**。
 */
const CLIENT_SUFFIXES = ["股份有限公司", "有限公司", "医疗集团", "集团", "分院"]

/**
 * 归一化 subject_key。
 *
 * 处理：
 *   · 全角→半角、去空格
 *   · 去书名号《》
 *   · 指标名走别名表
 *   · 客户名（case:）只剥企业后缀，保留机构主体名
 *
 * 注意：**只归一化 key，不修改 title/body**——展示给用户的仍是原文表述。
 */
export function normalizeSubjectKey(type: AtomType, rawKey: string): string {
  let k = toHalfWidth(String(rawKey ?? "").trim())
  k = k.replace(/[《》]/g, "").replace(/\s+/g, "")

  const prefix = {
    metric: "metric:",
    case: "case:",
    qualification: "qual:",
    policy: "policy:",
    product_capability: "prod:",
    play: "play:",
    fact: "fact:",
    script: "script:",
  }[type]

  if (!k.startsWith(prefix)) {
    // 前缀不对：尝试纠正（模型有时写成 metric:xxx 但 type 是 fact）
    const idx = k.indexOf(":")
    if (idx >= 0) k = prefix + k.slice(idx + 1)
    else k = prefix + k
  }

  const body = k.slice(prefix.length)
  const parts = body.split("|")

  if (type === "metric" && parts[0]) {
    parts[0] = METRIC_ALIASES[parts[0]] ?? parts[0]
  }
  // 2026-11-01：policy 主题与限定都归一（见 POLICY_ALIASES 注释说明的实测问题）
  if (type === "policy") {
    if (parts[0]) {
      parts[0] = POLICY_ALIASES[parts[0]] ?? parts[0]
      // 主题里带「要求/基本要求/等级要求」等后缀的，剥掉后缀再归一
      parts[0] = parts[0].replace(/(基本要求|等级要求|要求|标准)$/g, "")
      parts[0] = POLICY_ALIASES[parts[0]] ?? parts[0]
    }
    // 限定部分（第 2 段）同样要剥「要求」类后缀——
    // 实测同一个"三级医院要求"写作 |三级医院 / |三级医院要求 / |三级医院基本要求 三种。
    if (parts[1]) {
      parts[1] = parts[1]
        .replace(/(基本要求|等级要求|具体要求|要求)$/g, "")
        .replace(/^(关于|对)/, "")
    }
  }
  if (type === "case" && parts[0]) {
    let name = parts[0]
    for (const suf of CLIENT_SUFFIXES) {
      // 只在剥离后仍有 ≥3 字主体时才剥，避免把名字剥空
      if (name.length > suf.length + 2 && name.endsWith(suf)) {
        name = name.slice(0, -suf.length)
        break
      }
    }
    parts[0] = name
  }
  return prefix + parts.join("|")
}

// ===========================================================================
// 四、Zod Schema
// ===========================================================================

/** attributes：类型相关的附加属性（§4.2） */
// 2026-11-01 修复：所有可选项都允许 **null**。
// 实测（准格尔旗/上海复旦妇幼两篇真实标书）：模型对"该字段不适用"会显式输出 null
// （如 attributes.year = null），而 .optional() 只接受 undefined，
// 导致整段原子被 Zod 判非法而丢弃 —— 实测一次丢 18 条。
export const AtomAttributesSchema = z
  .object({
    value: z.union([z.number(), z.string()]).nullish(),
    unit: z.string().max(20).nullish(),
    year: z.number().int().min(1900).max(2100).nullish(),
    scope: z.string().max(60).nullish(),
    /** 极性：用于冲突检测（positive=达标/支持/有，negative=未达标/不支持/无） */
    polarity: z.enum(["positive", "negative", "neutral"]).nullish(),
    /** 客户类型（play/fact 用） */
    clientType: z.string().max(40).nullish(),
    /** 产品模块（product_capability 用） */
    module: z.string().max(40).nullish(),
    version: z.string().max(30).nullish(),
  })
  .partial()
export type AtomAttributes = z.infer<typeof AtomAttributesSchema>

/**
 * 抽取产物 Schema（模型直接输出这个结构，§附录 A）。
 *
 * 关键约束（都是"错了会污染知识库"的点）：
 *   · title 必须是陈述句：用「不是名词短语」的启发式校验（结尾含"情况/概述"等词判不合格）
 *   · body ≤300 字：超了说明塞了套话
 *   · source_quote 必填：没有原文摘录就无法核验，直接拒
 *   · confidence 0-1
 */
export const ExtractedAtomSchema = z.object({
  atom_type: z.enum(ATOM_TYPES, { message: "原子类型必须是 8 类之一" }),
  // 2026-11-01 放宽：原上限 40 字对中文陈述句太紧（实测「...实现病案编码、流通及纸质病历管理功能」
  // 这类合格标题 45-50 字很常见）。放到 60，仍保留"不是超长句子"的约束。
  // 2026-11-01 二次放宽：实测库中 title 最长正好 60（打满上限），且南安市医院项目
  // 又出现 "atoms.2.title Too big: expected <=60" → 模型确实会写 60-80 字的陈述句。
  // 放到 80 字（中位 25 字、P95 40 字，80 足够容纳长陈述句且仍远短于段落）。
  title: z.string().min(4).max(80),
  body: z.string().max(300),
  subject_key: z.string().min(6).max(120),
  attributes: AtomAttributesSchema.optional(),
  // 2026-11-01 放宽：原上限 200 字，实测模型偶发给出 200-350 字摘录（真实长句）
  // 被 Zod 判非法而整段丢弃。放到 400，仍保留"不能整段照抄"的约束
  // （现有库中位数 54 字、P95 147 字，400 足够宽松且不失约束力）。
  source_quote: z.string().min(8).max(400),
  confidence: z.number().min(0).max(1),
  valid_from: z.string().max(30).nullable().optional(),
  valid_until: z.string().max(30).nullable().optional(),
})
export type ExtractedAtom = z.infer<typeof ExtractedAtomSchema>

export const ExtractionResultSchema = z.object({
  atoms: z.array(ExtractedAtomSchema).max(40),
})
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

/**
 * 解析模型输出的抽取结果（Zod 校验入口）。
 * 返回带字段路径的错误，便于定位"哪条原子哪个字段坏了"。
 */
export function parseExtractionResult(raw: unknown): { ok: true; data: ExtractionResult } | { ok: false; message: string; issues: { path: string; message: string }[] } {
  const r = ExtractionResultSchema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  const issues = r.error.issues.slice(0, 8).map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message,
  }))
  const first = issues[0]
  return {
    ok: false,
    message: first ? `字段「${first.path || "(根)"}」不合法：${first.message}` : "返回结构不合法",
    issues,
  }
}

/** 完整原子（落库形态，§4.2 全字段） */
export const KbAtomSchema = ExtractedAtomSchema.extend({
  id: z.string(),
  kb_track: z.string().max(40).default(""),
  kb_bucket: z.string().max(40).default(""),
  kb_section: z.string().max(40).default(""),
  usable_for: z.array(z.enum(USABLE_FOR)).max(5).default([]),
  content_status: z.enum(ATOM_STATUSES).default("pending"),
  source_doc_id: z.string().min(1),
  source_anchor: z.string().max(60),
  confidentiality: z.enum(CONFIDENTIALITY).default("internal"),
  owner: z.string().max(100).default(""),
  reviewer: z.string().max(100).default(""),
  reviewed_at: z.string().max(30).optional(),
  version: z.number().int().min(1).default(1),
  supersedes: z.string().max(40).optional(),
  superseded_by: z.string().max(40).optional(),
  conflict_group: z.string().max(40).optional(),
  usage_count: z.number().int().min(0).default(0),
  last_used_at: z.string().max(30).optional(),
})
export type KbAtom = z.infer<typeof KbAtomSchema>

// ===========================================================================
// 五、质量校验（比 Schema 更进一步的业务规则）
// ===========================================================================

/** 名词标签式标题结尾（§附录 A「title 必须是完整陈述句，禁止名词短语」） */
const NOUN_TITLE_SUFFIXES = ["情况", "概述", "简介", "介绍", "说明", "汇总", "清单", "列表", "方案", "体系"]

/** 套话/模板残留关键词（§5「明确不抽的内容」） */
const JUNK_PATTERNS = [
  /随着.{0,10}(的发展|进步|推进)/,
  /^(公司简介|企业愿景|组织架构|版权声明|免责声明)/,
  /(XXX|ＸＸＸ|待补充|待填写|待定|此处填写)/,
  /^(目录|前言|序言|致谢)/,
]

export type AtomQualityIssue = { field: string; message: string; severity: "error" | "warn" }

/**
 * 业务质量校验：Schema 过了但内容仍不合格的，在这里拦。
 *
 * 返回 error 级问题 → 该原子不进 pending（丢弃或重抽）；
 * warn 级 → 进 pending 但标记，审核时提示。
 */
export function checkAtomQuality(atom: ExtractedAtom): AtomQualityIssue[] {
  const issues: AtomQualityIssue[] = []

  // subject_key 格式
  if (!isValidSubjectKey(atom.atom_type, atom.subject_key)) {
    issues.push({
      field: "subject_key",
      message: `主题键格式不符合 ${ATOM_TYPE_LABEL[atom.atom_type]} 的要求（应为 ${subjectKeyTemplate(atom.atom_type)}）`,
      severity: "error",
    })
  }

  // title 不能是名词短语
  const title = atom.title.trim()
  if (NOUN_TITLE_SUFFIXES.some((suf) => title.endsWith(suf))) {
    issues.push({ field: "title", message: "标题是名词短语，应改为陈述句（如「X 达到 Y」）", severity: "warn" })
  }

  // body 不得含套话
  for (const re of JUNK_PATTERNS) {
    if (re.test(atom.body)) {
      issues.push({ field: "body", message: "正文含套话/模板残留，应只写事实本身", severity: "error" })
      break
    }
  }

  // source_quote 必须能在原文里找到（由调用方传入原文做校验，这里只做长度下限）
  if (atom.source_quote.trim().length < 8) {
    issues.push({ field: "source_quote", message: "缺少原文摘录，无法核验", severity: "error" })
  }

  // metric 必须有数值
  if (atom.atom_type === "metric") {
    const v = atom.attributes?.value
    if (v === undefined || v === null || v === "") {
      issues.push({ field: "attributes.value", message: "指标类原子必须有数值", severity: "error" })
    }
    if (!atom.attributes?.year) {
      issues.push({ field: "attributes.year", message: "指标类原子建议标注统计年份", severity: "warn" })
    }
    if (!atom.attributes?.scope) {
      issues.push({ field: "attributes.scope", message: "指标类原子建议标注统计口径", severity: "warn" })
    }
  }

  // case 必须有客户名
  if (atom.atom_type === "case" && !atom.subject_key.startsWith("case:")) {
    issues.push({ field: "subject_key", message: "案例类主题键必须以 case: 开头", severity: "error" })
  }

  // 政策/资质/价格类必须有有效期（§4.2：政策/价格/资质必填）
  if ((atom.atom_type === "policy" || atom.atom_type === "qualification") && !atom.valid_until) {
    issues.push({ field: "valid_until", message: "政策/资质类建议填写有效期，否则过期后仍会被引用", severity: "warn" })
  }

  return issues
}

/** 各类型的 subject_key 模板（报错提示用） */
function subjectKeyTemplate(type: AtomType): string {
  return {
    metric: "metric:{指标名}|{口径}",
    case: "case:{客户名}",
    qualification: "qual:{证书名}",
    policy: "policy:{发文号}|{条款号}",
    product_capability: "prod:{模块}|{功能}",
    play: "play:{客户类型}|{场景}",
    fact: "fact:{实体}|{属性}",
    script: "script:{异议类型}",
  }[type]
}

/**
 * 抽取结果整体清洗：格式归一 + 质量过滤 + 去重。
 *
 * @param quotedText 原文（用于校验 source_quote 是否逐字来自原文）
 */
export function sanitizeExtraction(
  raw: ExtractionResult,
  quotedText: string,
): { atoms: ExtractedAtom[]; dropped: { atom: ExtractedAtom; reasons: string[] }[] } {
  const atoms: ExtractedAtom[] = []
  const dropped: { atom: ExtractedAtom; reasons: string[] }[] = []
  const seen = new Set<string>()
  const haystack = String(quotedText ?? "").replace(/\s+/g, "")

  for (const a of raw.atoms) {
    // 1) 归一化 subject_key（不改变 title/body）
    const normalized: ExtractedAtom = { ...a, subject_key: normalizeSubjectKey(a.atom_type, a.subject_key) }

    // 2) 质量校验
    const issues = checkAtomQuality(normalized)
    const errors = issues.filter((i) => i.severity === "error")
    if (errors.length) {
      dropped.push({ atom: normalized, reasons: errors.map((e) => e.message) })
      continue
    }

    // 3) source_quote 必须逐字来自原文（去空白后子串匹配；允许省略号截断）
    const quote = normalized.source_quote.replace(/^[…]|…$/g, "").replace(/\s+/g, "")
    if (haystack && quote.length >= 8 && !haystack.includes(quote.slice(0, Math.min(quote.length, 40)))) {
      dropped.push({ atom: normalized, reasons: ["原文摘录未能在源文档中找到（可能是改写或拼接的）"] })
      continue
    }

    // 4) 同一批内去重（同 subject_key + 同 title）
    const dedupeKey = `${normalized.subject_key}||${normalized.title}`
    if (seen.has(dedupeKey)) {
      dropped.push({ atom: normalized, reasons: ["与本批内另一条重复"] })
      continue
    }
    seen.add(dedupeKey)
    atoms.push(normalized)
  }
  return { atoms, dropped }
}

/** 低置信阈值（§4.2：<0.55 强制 pending 且标记"低置信"） */
export const LOW_CONFIDENCE = 0.55

/** 是否低置信（审核台据此高亮） */
export function isLowConfidence(atom: { confidence: number }): boolean {
  return atom.confidence < LOW_CONFIDENCE
}
