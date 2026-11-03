/**
 * 技术参数响应表（招标技术要求 → 逐条原文响应）的**素材与装配**层（纯本地、零 AI）。
 *
 * 用户 2026-10-15 的三条口径：
 *  ① 参数来源不固定：常在「采购需求 / 技术规格」章节，偶尔在附件——且**可以由使用者自己描述**，
 *     所以本模块先按用户描述定位，再按标题关键词兜底，最后才回退解析报告分区；
 *  ② 重点条款（★/▲）先扫出来、在表头汇总标注，并**按招标文件原文**响应；
 *  ③ 其他参数按招标文件要求**一一响应**：原文响应，只调整要求类字眼（改由 paramRewrite 完成）。
 *
 * 行序保持招标原文顺序（一一对应、便于专家按编号查找），★/▲ 只在表头另列汇总，不打乱行序。
 */

import { classifyKind, type ParamKind } from "./techParamCoverage"
import {
  DEVIATION_CLAUSE_SOURCES,
  extractRequirementClauses,
  leadingClauseNo,
  parseSectionTitle,
  splitRequirementClauses,
  type ClauseGranularity,
  type ParseReport,
  type RequirementClause,
} from "./bidTypes"
import { rewriteRequirementToResponse, type ParamRewriteChange } from "./paramRewrite"

/** 参数来源标题关键词（按优先级）：采购需求/技术规格最常见，附件兜底 */
export const TECH_PARAM_SOURCE_HINTS = [
  "采购需求",
  "技术规格",
  "技术规范",
  "技术参数",
  "技术需求",
  "技术要求",
  "需求清单",
  "货物需求",
  "采购清单",
  "需求一览表",
  "招标需求",
  "技术标准",
  "服务要求",
  "附件",
] as const

/** 判定标题层级：第X章=1、第X节=3、一、=2、1./1.1=2/3，非标题=0 */
function headingLevel(line: string): number {
  const t = line.trim()
  if (!t || t.length > 60) return 0
  if (/^第\s*[0-9一二三四五六七八九十百]+\s*[章篇部分]/.test(t)) return 1
  if (/^第\s*[0-9一二三四五六七八九十百]+\s*节/.test(t)) return 3
  if (/^[一二三四五六七八九十]+\s*[、.．]/.test(t)) return 2
  const num = t.match(/^(\d+(?:\.\d+)*)\s*[、.．:：]?\s*\S/)
  if (num) return num[1].split(".").length + 1
  return 0
}

/**
 * 在招标原文里按标题定位一个章节：命中行起到下一个**同级或更高级**标题为止。
 * 找不到返回 null（调用方继续兜底，绝不猜一段正文出来）。
 *
 * R54：同一关键词常有**多处**命中（目录行、正文里的引用句、章节真正所在处），取「正文最长」的那一处——
 * 实测真实招标文件（15 万字）里「第三章 采购需求」先在目录出现（正文为空）、正文引用句「…和技术规范等。」只有两行页脚，
 * 只有真正的章节标题能带出完整正文；取第一处会把页脚/目录当成参数章节，条款直接跑空。
 * 代价：一次定位要扫完全部命中处（真实 15 万字文件实测约 11ms，调用方均带 memo，可接受）。
 */
export function locateTenderSection(text: string, hint: string): { heading: string; body: string } | null {
  const key = (hint ?? "").trim()
  if (!key) return null
  const lines = (text ?? "").split(/\r?\n/)
  let best: { heading: string; body: string } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (!t || !t.includes(key)) continue
    // 命中行优先当标题；命中行不是标题（说明是正文里的引用）时也接受，但按章级处理
    const level = headingLevel(t) || 1
    const body: string[] = []
    for (let j = i + 1; j < lines.length; j += 1) {
      const lv = headingLevel(lines[j])
      if (lv > 0 && lv <= level) break
      if (isTopicSwitch(lines[j])) break
      body.push(lines[j])
    }
    const joined = body.join("\n").trim()
    if (!best || joined.length > best.body.length) best = { heading: t, body: joined }
  }
  return best
}

export type TechParamSource = {
  text: string
  /** custom=用户描述命中 / heading=招标原文标题关键词命中 / parse=解析报告分区兜底 / none=没找到 */
  how: "custom" | "heading" | "parse" | "none"
  /** 展示用来源说明（面板/导出都要能看出「这条从哪来的」） */
  label: string
  /** 命中章节标题本身（无前缀说明，供条款 source 分组等场景用；none 时为空串） */
  heading: string
}

/**
 * 2026-10-23（真实项目实测：技术参数章节串到第六章）：定位「第三章 采购需求」时，
 * 第六章里的「6、投标人的资格要求 / 6.1 法定条件」等条目会被当成参数吃进来——
 * 因为章级（level=1）循环只在下一条「第X章」才停，而 PDF 里第六章标题行常常没被识别成标题。
 * 这里补一道**话题切换**边界：短标题行里出现资格审查/符合性/评标/合同/投标人须知，就结束当前章节。
 */
const TOPIC_SWITCH_RE =
  /^(?:第[一二三四五六七八九十百]+[章节]|[0-9]+(?:\.[0-9]+)*\s*[、.．]|[一二三四五六七八九十]+、)?\s*.{0,12}(?:资格要求|资格审查|符合性审查|评标办法|评分办法|合同条款|投标人须知)/

function isTopicSwitch(line: string): boolean {
  const t = (line ?? "").trim()
  return t.length > 0 && t.length <= 40 && TOPIC_SWITCH_RE.test(t)
}

/** 章内技术参数子章节标题关键词（**只认行首标题形态**，正文里引用这些词的句子不算，同 locateTenderSection 的判据） */
export const TECH_PARAM_SUBSECTION_HINTS = [
  "技术参数",
  "技术规格",
  "技术要求",
  "技术需求",
  "需求清单",
  "参数要求",
  "技术标准",
] as const

/**
 * 章内子章节收窄的正文下限：小于此长度只当是正文里的一个提法，不收窄（继续用整章）。
 * 真实文件里「六、技术参数及要求」这类子章节正文都是万字级，200 字足够把「技术规格：见附件。」这类一句话挡掉。
 */
export const TECH_SUBSECTION_MIN_CHARS = 200

/**
 * 在已定位到的章节正文里再收窄到「技术参数 / 技术规格」子章节（R54）。
 * 判据与 `locateTenderSection` 同源：**必须是行首标题形态的短行**（headingLevel>0，即「六、技术参数及要求」「5. 技术规格」），
 * 正文里引用这些词的句子（「…对采购需求中技术参数及要求的响应情况进行评分」）level=0，不会被当成标题。
 * 同样取「正文最长」的那一处（章内可能先有个小的「一、技术参数一览表」，真正的参数清单在后面）。
 * 找不到返回 null → 调用方保持用整章。
 */
export function narrowToTechParamSubsection(body: string): { heading: string; body: string } | null {
  const lines = (body ?? "").split(/\r?\n/)
  let best: { heading: string; body: string } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (!t || t.length > 40) continue
    const lv = headingLevel(t)
    if (lv === 0) continue // 行首标题形态才算（正文引用句不认）
    if (!TECH_PARAM_SUBSECTION_HINTS.some((k) => t.includes(k))) continue
    const out: string[] = []
    for (let j = i + 1; j < lines.length; j += 1) {
      const lj = headingLevel(lines[j])
      if (lj > 0 && lj <= lv) break
      if (isTopicSwitch(lines[j])) break
      out.push(lines[j])
    }
    const sub = out.join("\n").trim()
    if (sub.length < TECH_SUBSECTION_MIN_CHARS) continue
    if (!best || sub.length > best.body.length) best = { heading: t, body: sub }
  }
  return best
}

/**
 * 参数来源解析（优先级：用户描述 → 标题关键词 → 解析报告分区）。
 * 用户描述命中不到时**不静默回退**——label 里写清楚实际用了哪一处，避免「我以为看的是附件，其实看的是交货要求」。
 * opts.minBodyChars：自动关键词层要求命中章节正文至少这么长（默认 0＝不设限）。偏离表传一个下限，
 * 免得正文里的引用句（「…和技术规范等。」）带出两行页脚被当成参数章节——那种情况宁可回退解析报告。
 * 用户描述的层不设限：使用者明确说了看哪一节，就按他说的来。
 * R54：自动关键词层命中整章后，会再尝试收窄到章内的「技术参数/技术规格」子章节（label 用「›」标出层级）。
 */
export function resolveTechParamSource(
  tenderText: string | null | undefined,
  report: ParseReport | null | undefined,
  customHint?: string,
  opts?: { minBodyChars?: number },
): TechParamSource {
  const tender = (tenderText ?? "").trim()
  const hint = (customHint ?? "").trim()
  const minBody = Math.max(0, opts?.minBodyChars ?? 0)
  // 描述没命中时**不静默回退**：label 里必须写清「你的描述没找到，实际用的是哪一处」，
  // 否则使用者会以为看的是附件、其实看的是交货要求，参数漏响应都发现不了。
  const miss = hint ? `未在招标原文里找到「${hint}」，` : ""
  if (tender && hint) {
    const hit = locateTenderSection(tender, hint)
    if (hit && hit.body.trim()) {
      return { text: hit.body, how: "custom", label: `按你的描述定位：${hit.heading}`, heading: hit.heading }
    }
  }
  if (tender) {
    for (const k of TECH_PARAM_SOURCE_HINTS) {
      const hit = locateTenderSection(tender, k)
      if (!hit || !hit.body.trim() || hit.body.trim().length < minBody) continue
      const sub = narrowToTechParamSubsection(hit.body)
      if (sub) {
        return {
          text: sub.body,
          how: "heading",
          label: `${miss}按招标原文标题定位：${hit.heading} › ${sub.heading}`,
          heading: sub.heading,
        }
      }
      return { text: hit.body, how: "heading", label: `${miss}按招标原文标题定位：${hit.heading}`, heading: hit.heading }
    }
  }
  const sec = (report?.sections ?? []).find((s) => s.key === "delivery_req" && (s.content ?? "").trim())
  if (sec) {
    const title = sec.title || "交货和服务要求"
    return { text: sec.content ?? "", how: "parse", label: `${miss}已回退解析报告分区：${title}`, heading: title }
  }
  return {
    text: "",
    how: "none",
    label: hint ? `${miss}且解析报告里没有可用的技术需求分区` : "未找到技术参数来源",
    heading: "",
  }
}

/**
 * 从**招标原文**里抽条款（纯函数，零 AI）——偏离表/参数响应的条款应取「采购需求 / 技术规格」章节原文，
 * 而不是把解析报告 delivery_req 的 9 个扁平字段值摊平成行再切句子（那样评分细则、验收流程会混进偏离表）。
 * 切分口径与 `extractRequirementClauses` 完全一致（共用内核），所以「拆分维度」按钮在三档之间依旧有效。
 * label 为章节标题（由调用方从 `resolveTechParamSource().heading/label` 传入），作为条款 source 的兜底名。
 */
export function extractTenderRequirementClauses(
  tenderSectionText: string,
  opts?: { granularity?: ClauseGranularity; limit?: number; label?: string },
): RequirementClause[] {
  return splitRequirementClauses(tenderSectionText ?? "", {
    granularity: opts?.granularity ?? "l3",
    limit: opts?.limit ?? 200,
    sourceLabel: opts?.label ?? "",
  })
}

export type DeviationClauseResolution = {
  clauses: RequirementClause[]
  /** 实际来源说明（面板「条款来源」一行直接展示，不写死） */
  label: string
  how: TechParamSource["how"]
}

/**
 * 偏离表自动定位原文时，命中章节正文的**最小长度**。真实招标文件里「技术规范」「采购需求」这类词
 * 也出现在目录行和正文引用句里，那种命中只能带出页脚/目录两行；宁可回退解析报告，也不把页脚当参数章节。
 */
export const DEVIATION_MIN_SECTION_CHARS = 200

/**
 * 偏离表条款的统一来源解析（**偏离表生成 / 条数预告 / 技术参数落点三处必须同调此函数**，否则面板说 137 条、
 * 生成出来 90 条这类不一致会复现）：
 * 先用 `resolveTechParamSource` 在招标原文里定位采购需求/技术规格章节 → 命中就从**原文**抽条款；
 * 未命中或原文抽不到合格条款 → 回退解析报告 delivery_req 分区（与改动前逐字一致，业务不受影响）。
 */
export function resolveDeviationClauses(
  tenderText: string | null | undefined,
  report: ParseReport | null | undefined,
  opts?: { limit?: number; granularity?: ClauseGranularity; customHint?: string },
): DeviationClauseResolution {
  const limit = Math.max(1, opts?.limit ?? 200)
  const granularity = opts?.granularity ?? "l3"
  const src = resolveTechParamSource(tenderText, report, opts?.customHint, { minBodyChars: DEVIATION_MIN_SECTION_CHARS })
  if (src.how === "custom" || src.how === "heading") {
    const clauses = extractTenderRequirementClauses(src.text, {
      granularity,
      limit,
      label: src.heading || src.label,
    })
    if (clauses.length) return { clauses, label: src.label, how: src.how }
  }
  // 回退：口径与改动前逐字一致（只取技术文件要求分区）
  const clauses = extractRequirementClauses(report ?? null, { limit, granularity, sources: DEVIATION_CLAUSE_SOURCES })
  if (src.how === "parse") return { clauses, label: src.label, how: clauses.length ? "parse" : "none" }
  // 原文命中了章节却抽不到合格条款（过短 / 全是标记说明行）：回退必须写清楚，不能让面板显示原文来源却用报告条款
  return {
    clauses,
    label: clauses.length ? `${src.label}；未抽到合格条款，已回退解析报告分区：${parseSectionTitle("delivery_req")}` : src.label,
    how: clauses.length ? "parse" : "none",
  }
}

/** 条款作答类型：参数型＝逐条可判「满足/不满足」；方案型＝须成文作答（方案+承诺函） */
export type ParamClauseKind = "param" | "proposal"

/**
 * 2026-10-23（用户实测：「★8 系统集成、培训」这类被当成参数逐条响应）：
 * 判「这条能不能用一句『完全响应』过关」。
 *   方案型：长条款（≥120 字）/ 带 ①②③ 分点 / 明写承诺函·专项方案·培训·驻场·实施服务——
 *   这类内容评委看的是方案写没写透，不是参数表里打勾，按「完全响应」处理等于主动丢分。
 */
export function classifyParamClause(text: string): ParamClauseKind {
  const t = (text ?? "").replace(/\s/g, "")
  // 纯长度不能判：功能清单里的「要求支持…」也常 200~300 字，但它仍是参数（逐条满足即可）。
  // 判据看「是不是要成文」：服务/方案/承诺类措辞，或 ★ 实质条款且成段/分点。
  const serviceWord = /(承诺函|专项方案|实施方案|培训方案|服务方案|培训服务|系统集成实施|驻场|运维服务)/.test(t)
  const numbered = /[①②③④⑤⑥⑦⑧⑨⑩]/.test(t)
  const isStar = /(^|[\d.、)）])\s*[★☆▲△]/.test(t)
  if (serviceWord && t.length >= 100) return "proposal"
  if (isStar && (numbered || t.length >= 200)) return "proposal"
  if (numbered && t.length >= 300) return "proposal"
  return "param"
}

export type ParamResponseRow = {
  /** 招标文件行内原编号（5.3.2 / （一）/ ①），无则空串 */
  no: string
  /** 1 起的表内序号 */
  index: number
  kind: ParamKind
  /** 作答类型：参数型逐条响应 / 方案型须成文作答（2026-10-23） */
  clauseKind: ParamClauseKind
  /** 招标要求原文（逐字，保留 ★/▲ 标记）——原文响应要求「招标要求」列必须是原文 */
  original: string
  /** 响应式表述（只调整要求类字眼；未改写时与原文一致） */
  response: string
  changes: ParamRewriteChange[]
  rewritten: boolean
  needs_review: boolean
  reason: string
}

/** 表头汇总用的 ★/▲ 重点条款 */
export type StarParamClause = { no: string; text: string }

const PARAM_LINE_MIN = 6

/**
 * 2026-10-22（用户实测：技术参数表抽出来是页脚/表头）：
 * 招标原文里的**版式噪声行**——页脚「第 215 页 共 256 页」、表头「序号 技术参数及要求」、
 * 纯编号/纯符号行——都不是参数，逐条建行会把响应表灌成垃圾。
 */
function isLayoutNoise(line: string): boolean {
  const t = line.replace(/\s/g, "")
  if (/^第\d+页共\d+页$/.test(t)) return true
  if (/^第[一二三四五六七八九十百\d]+[章节部篇]?$/.test(t)) return true
  if (/^(?:序号|名称|参数|要求|指标|备注|单位|数量|内容|项目)+$/.test(t)) return true
  // 表头拼接行（「序号 技术参数及要求」这类只有列名没有内容的行）
  if (t.length <= 14 && /^(?:序号|名称|参数|要求|指标|备注|单位|数量|内容|项目)/.test(t) && !/[，。；：,.;:]/.test(t) && t.length <= 12) {
    return true
  }
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(t)) return true
  return false
}

/**
 * 逐行装配参数响应行：保持招标原文顺序，逐条做字眼转换。
 * 过滤：过短行、纯编号行、以及「以“★”标示…」这类标记说明行（与 starClauseNoise 同口径的轻量判定）。
 */
export function buildParamResponseRows(sourceText: string, opts?: { cap?: number }): ParamResponseRow[] {
  const cap = Math.max(1, opts?.cap ?? 400)
  // 2026-10-22：页眉页脚在 PDF 抽取里每页重复一次——同一短句重复 ≥3 次即视为版式重复行
  const freq = new Map<string, number>()
  for (const raw of (sourceText ?? "").split(/\r?\n/)) {
    const k = raw.trim()
    if (k) freq.set(k, (freq.get(k) ?? 0) + 1)
  }
  const usable: string[] = []
  for (const raw of (sourceText ?? "").split(/\r?\n/)) {
    const line = raw.trim()
    // \s 已覆盖全角空格，字符类里不再写字面量（那会触发 no-irregular-whitespace）
    if (line.replace(/\s/g, "").length < PARAM_LINE_MIN) continue
    // 标记说明行（「注：以“★”标示的为实质性条款」）不是参数，不建行
    if (/^[（(【]?\s*注\s*[：:）)】]/.test(line) || /以.{0,3}[★☆▲△].{0,6}(标示|标注|标记)/.test(line)) continue
    if (isLayoutNoise(line)) continue
    if (line.length <= 30 && (freq.get(line) ?? 0) >= 3) continue
    usable.push(line)
  }
  // 2026-10-23：**先并条款、再建行**。原实现一个物理行一条，
  // 于是「★8. 系统集成、培训」下面的（1）（2）①～⑤ 各自变成一条"参数"，
  // 一律标「完全响应」——方案型内容被当参数打勾，评委按方案给分时等于零分。
  const clauses = mergeClauseLines(usable)
  const out: ParamResponseRow[] = []
  for (const clause of clauses) {
    const rw = rewriteRequirementToResponse(clause)
    out.push({
      no: leadingClauseNo(clause),
      index: out.length + 1,
      kind: classifyKind(clause),
      clauseKind: classifyParamClause(clause),
      original: clause,
      response: rw.response,
      changes: rw.changes,
      rewritten: rw.rewritten,
      needs_review: rw.needs_review,
      reason: rw.reason,
    })
    if (out.length >= cap) break
  }
  return out
}

/** 条款起始行：多级编号 / 括号号 / 中文序号 / 圈码 */
const CLAUSE_HEAD_RE = /^\s*(?:\d+(?:\.\d+)*[.、)）]|[（(]\d+[)）]|[一二三四五六七八九十]+、|[①-⑳])/

/** ★/▲ 实质条款头（可能带编号前缀，如「8. ★…」） */
const STAR_HEAD_RE = /^\s*(?:\d+(?:\.\d+)*[.、)）]\s*)?[★☆▲△]/

/** 章节边界：遇到就结束当前条款，不论是否在 ★ 段内 */
const CLAUSE_BOUNDARY_RE = /^\s*(?:第[一二三四五六七八九十百]+[章节部分篇]|[一二三四五六七八九十]+、|附[件表])/

/** 合并后单条上限（防一条吞掉整章） */
const CLAUSE_MAX_CHARS = 2000

/**
 * 把一个章节里的物理行**合并成条款**。
 *
 * 2026-10-23（用户实测「★8 系统集成、培训」被拆碎）：合并必须**两层**——
 *   ① 顶层的 ★/▲ 条款一旦开始，其下的（1）（2）①～⑤ 都属于同一条，不能再按编号切；
 *   ② 不在 ★ 段内时，编号行才是新条款的起点。
 * 边界判据不依赖 ★ 是否幸存：PDF 抽取常把 ★ 丢掉，但编号（8. / （1） / ①）丢不掉。
 */
export function mergeClauseLines(lines: string[]): string[] {
  const out: string[] = []
  let buf = ""
  let inStar = false
  const flush = () => {
    const t = buf.trim()
    if (t) out.push(t)
    buf = ""
    inStar = false
  }
  for (const line of lines ?? []) {
    const l = String(line ?? "").trim()
    if (!l) continue
    if (CLAUSE_BOUNDARY_RE.test(l)) {
      flush()
      buf = l
      continue
    }
    if (STAR_HEAD_RE.test(l)) {
      flush()
      buf = l
      inStar = true
      continue
    }
    if (!inStar && CLAUSE_HEAD_RE.test(l)) {
      flush()
      buf = l
      continue
    }
    if (!buf) {
      buf = l
      continue
    }
    buf = `${buf}${/[,，;；]$/.test(buf) ? "" : " "}${l}`
    if (buf.length >= CLAUSE_MAX_CHARS) flush()
  }
  flush()
  return out
}

export type ParamResponseSummary = {
  total: number
  /** 【评审项】/关键参数 */
  review: number
  /** ★/▲ 实质性/重点条款 */
  star: number
  general: number
  /** 已按字眼转换改写的条数 */
  rewritten: number
  /** 需人工确认口径的条数（禁止类/许可类/非投标人义务/未识别谓语） */
  needs_review: number
  /** 表头汇总：★/▲ 重点条款（按招标原文顺序，逐字） */
  starClauses: StarParamClause[]
}

export function summarizeParamResponse(rows: ParamResponseRow[]): ParamResponseSummary {
  const list = rows ?? []
  return {
    total: list.length,
    review: list.filter((r) => r.kind === "review").length,
    star: list.filter((r) => r.kind === "star").length,
    general: list.filter((r) => r.kind === "general").length,
    rewritten: list.filter((r) => r.rewritten).length,
    needs_review: list.filter((r) => r.needs_review).length,
    starClauses: list.filter((r) => r.kind === "star" || r.kind === "review").map((r) => ({ no: r.no, text: r.original })),
  }
}

/** 覆盖核对用的轻量归一化：只留汉字/字母/数字（与原文比对同口径） */
function normForCoverage(s: string): string {
  return String(s ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
}

export type ParamResponseCoverage = {
  /** 从解析报告抽到的条款数 */
  clause_count: number
  /** 参数响应表行数 */
  row_count: number
  /** 抽到条款但表里没有对应行的（点名，便于逐条补） */
  missing: string[]
}

/**
 * 覆盖核对：抽取条款 ↔ 参数响应表行（行数应等于条款数）。
 * 两侧文本口径不同（解析报告条款 vs 招标原文参数行），因此按归一化包含匹配，命不中即点名。
 */
export function checkParamResponseCoverage(clauseTexts: string[], rows: ParamResponseRow[]): ParamResponseCoverage {
  const hay = (rows ?? []).map((r) => normForCoverage(r.original))
  const missing = (clauseTexts ?? []).filter((t) => {
    const key = normForCoverage(t)
    if (!key) return false
    return !hay.some((h) => h.includes(key) || key.includes(h))
  })
  return { clause_count: (clauseTexts ?? []).length, row_count: (rows ?? []).length, missing }
}

/**
 * 2026-10-22（用户需求：技术参数要能按投标文件格式输出）
 * 响应行 → 投标文件「技术参数响应表」的表格数据。列按投标常用五列，
 * 「招标要求原文」逐字取 original（不改写），「投标响应」取 response（只换要求类字眼），
 * 需人工确认的行在偏离列如实标注，证明材料留待人工挂载（不编造编号）。
 */
export function techParamTableRows(rows: ParamResponseRow[]): string[][] {
  const head = ["序号", "招标文件技术参数要求（原文）", "投标响应", "偏离情况", "证明材料/页码"]
  return [
    head,
    ...(rows ?? []).map((r) => [
      r.no || String(r.index),
      r.original,
      r.clauseKind === "proposal" ? "须成文作答：编制专项方案并附承诺函（本条为方案型要求，不能以「完全响应」概括）" : r.response,
      r.clauseKind === "proposal" ? "须方案作答" : r.needs_review ? "需人工确认" : "完全响应",
      "【待填写】",
    ]),
  ]
}

/**
 * 2026-10-22（B4 回填）：技术参数**原表** → 响应行。
 * 与 buildParamResponseRows 的区别：行边界来自原表，不是按行文本猜；
 * 因此「一条参数 = 原表一行」，导出的响应表与招标原表逐行对得上。
 */
export function paramRowsFromTable(items: { no: string; text: string }[], opts?: { cap?: number }): ParamResponseRow[] {
  const cap = Math.max(1, opts?.cap ?? 400)
  const out: ParamResponseRow[] = []
  for (const it of items ?? []) {
    const original = String(it.text ?? "").trim()
    if (!original) continue
    const rw = rewriteRequirementToResponse(original)
    out.push({
      no: String(it.no ?? ""),
      index: out.length + 1,
      kind: classifyKind(original),
      clauseKind: classifyParamClause(original),
      original,
      response: rw.response,
      changes: rw.changes,
      rewritten: rw.rewritten,
      needs_review: rw.needs_review,
      reason: rw.reason,
    })
    if (out.length >= cap) break
  }
  return out
}
