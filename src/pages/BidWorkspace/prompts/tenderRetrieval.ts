// ---------------------------------------------------------------------------
// T12 易标解析思路复用（2026-09-28）：分块 → 按解析项相关性检索选块 → 受限 Prompt 素材
// 思路移植自 OpenBidKit_Yibiao（AGPL-3.0）server/index.mjs 的 D-3 管线
// （chunkTenderMarkdown / bidAnalysisKeywords / scoreChunkForTask / selectRelevantChunks /
//  buildDegradedAnalysisContent），按其语义以 TS 重写适配本项目纯文本招标文件与解析项 key 集；
// 署名披露遵循内网自用口径。
// 动机：14k 盲窗口分段会把评分表跨段拦腰截断、全文进 Prompt 又必超时——每个解析项只看
// 与自身关键词相关的高分块，按原文顺序注入并标注章节出处；检索无命中回退首尾截断；
// AI 失败时检索块直接降级为「规则检索原文」交付（人工核对可用，不出现空项）。
// ---------------------------------------------------------------------------

import { parseSectionTitle } from "../bidTypes"
import { categoryAffinity, classifyChapterTitle, detectTenderChapters, dedupeChaptersByTitle } from "./tenderStructure"

export interface TenderChunk {
  heading: string
  text: string
  index: number
  /** T13：块所属章节标题（章节识别成功时），检索按类别亲和加权用 */
  chapterTitle?: string
}

export interface RetrievalSource {
  /** full=全文未超预算整段进；retrieval=按关键词检索选块；truncated=检索无命中首尾截断 */
  mode: "full" | "retrieval" | "truncated"
  /** 进 Prompt 的素材正文（retrieval 模式含片段标头） */
  text: string
  /** retrieval 模式选中的块（按原文顺序）；其余模式为空数组 */
  selected: TenderChunk[]
  /** 全文分块总数（日志/降级文案展示检索覆盖度） */
  totalChunks: number
}

// 块参数对齐参考实现：6000 字/块、300 字重叠、单解析项最多 12 块、素材预算 2 万字
//（预算取 20k 而非参考实现的 30k：本网关模型输出 max_tokens=8192，输入+系统提示词需留在安全上下文内）
export const RETRIEVAL_CHUNK_SIZE = 6000
export const RETRIEVAL_CHUNK_OVERLAP = 300
export const RETRIEVAL_MAX_CHUNKS = 12
export const RETRIEVAL_BUDGET_CHARS = 20000

/** 各解析项专属关键词表（对应参考实现 bidAnalysisKeywords，key 为本项目解析项） */
export const SECTION_KEYWORDS: Record<string, string[]> = {
  overview: ["项目名称", "项目概况", "背景", "建设内容", "预算", "最高限价", "工期", "服务期限", "概况", "项目类型"],
  project_info: ["项目名称", "项目编号", "招标编号", "预算", "最高限价", "项目类型", "实施地点", "项目地址"],
  purchaser_info: ["采购人", "招标人", "采购单位", "业主单位", "甲方", "联系人", "联系电话", "地址", "项目名称"],
  agency_info: ["代理机构", "招标代理", "联系人", "电话", "邮箱", "账户"],
  tech_score: ["技术评分", "评分标准", "评分因素", "评审因素", "详细评审", "分值", "得分", "打分", "权重", "评分办法", "评标办法", "评标方法", "综合评分", "评审办法", "评分细则", "评标因素", "评分表", "评审标准", "技术分"],
  biz_score: ["商务评分", "商务部分", "商务要求", "价格评分", "价格部分", "报价得分", "业绩", "信誉", "综合实力", "评分表"],
  delivery_req: ["交货", "交付", "实施周期", "验收", "质保", "售后", "响应时间", "培训", "服务要求", "技术需求", "功能要求", "性能指标"],
  response_req: ["响应文件", "投标文件", "签字", "盖章", "密封", "装订", "份数", "递交", "格式", "电子签章"],
  bid_nodes: ["公告", "报名", "获取", "答疑", "递交", "截止", "开标", "公示", "质疑", "异议", "有效期"],
  bid_deposit: ["保证金", "缴纳", "退还", "转账", "保函", "账户", "汇款"],
  // Q26 切片A：去泛词修复选块错位——旧「符合性/完整性/有效性/偏差」单双字泛词会命中技术参数区
  // （「数据完整性」「有效性验证」「负偏离」遍布第三章几十万字），导致「符合性检查」降级抓到 HIS 收费行。
  // 改只用组合专词（Q24 同口径），并补资格/符合性审查表的真实表述。
  qualification: ["资格性审查", "资格条件", "资格要求", "资格审查", "资质", "投标人资格", "营业执照", "法定代表人授权", "缴纳社保", "税收证明", "无重大违法记录", "业绩要求", "信用中国"],
  compliance: ["符合性审查", "符合性检查", "符合性评审", "实质性响应", "实质性条款", "逐条响应", "偏差表", "响应性评审", "完整性审查"],
  bid_open_req: ["开标", "解密", "场地", "纪律", "无效标"],
  eval_req: ["评标委员会", "评标方法", "评标程序", "评审", "评分构成", "推荐中标"],
  void_items: ["废标", "无效", "否决", "不予受理", "无效投标", "重大偏差", "实质性偏离", "串通"],
  contract_terms: ["合同", "签订", "履约保证金", "违约", "解除", "终止", "不可抗力", "争议", "质保期"],
  // Q26 切片A：补真实清单表述修复 purchase_list「原文未提及」误报（第三章采购需求大表实际存在，
  // 旧词表缺「货物清单/设备清单/分项报价」等政采常用词，检索系统性漏命中真实清单块）。
  purchase_list: ["采购清单", "货物清单", "设备清单", "系统清单", "采购需求", "建设内容", "数量及规格", "分项报价", "规格型号", "采购内容", "分包预算"],
  compilation_basis: ["编制依据", "参照", "标准", "规范", "GB", "法律法规", "技术文件"],
  bid_outline_req: ["投标文件格式", "投标文件目录", "投标文件的组成", "格式要求", "技术标", "商务标", "资信标", "组成", "章节"],
  lots: ["标包", "标段", "包件", "分标", "采购包"],
}

/** T12b3：弱关键词信号项——答案（采购人名、代理机构名、项目编号）几乎只在封面+公告区（文首块），
 * 全文高频出现「采购人」等泛词时打分无法区分，强制带文首块防挤出 */
const HEAD_ALWAYS_KEYS = new Set(["purchaser_info", "agency_info", "project_info", "overview", "bid_nodes"])

/** 标题行判定（块归属用，比评分定位器宽）：markdown 标题 / 第X章节部分 / 附件X / 编号小节。
 *  T13：排除竖线表格行——「8 | 无线键盘鼠标 | …」曾命中编号前缀分支被误判为标题，
 *  块归属与标题加分全打歪（真实文件审计实锤）。 */
const HEADING_LINE_RE =
  /^\s*(?:#{1,6}\s+\S|第\s*[0-9一二三四五六七八九十百]+\s*(?:章|节|部分|篇)|附\s*件\s*[0-9一二三四五六七八九十]+|[0-9]+(?:\.[0-9]+){0,3}[\s、.．]\s*\S)/
function isTableLine(line: string): boolean {
  return line.includes(" | ") || line.includes("｜")
}

function headingOfSegment(segment: string, fallback: string): string {
  const firstLine = segment.split("\n")[0]?.trim() ?? ""
  if (firstLine && firstLine.length <= 60 && !isTableLine(firstLine) && HEADING_LINE_RE.test(firstLine) && !/[。；;]/.test(firstLine)) {
    return firstLine.replace(/^#+\s*/, "").slice(0, 60)
  }
  return fallback
}

/**
 * T12b：无空行提取件（PDF/Word 单换行流式产物，全文 0 个 \n\n）专用回退——
 * 按「标题行起新组」切分线条，使主流程 headingOfSegment 能恢复每组的标题归属
 * （否则整文本一段、标题全丢「文首」，检索打分与章节标头同时失效）。
 */
function splitLinesByHeading(src: string): string[] {
  const lines = src.split("\n")
  const out: string[] = []
  let buf: string[] = []
  let bufLen = 0
  const flush = () => {
    if (bufLen) out.push(buf.join("\n"))
    buf = []
    bufLen = 0
  }
  for (const line of lines) {
    const t = line.trim()
    const isHeading = t.length > 0 && t.length <= 60 && !isTableLine(t) && HEADING_LINE_RE.test(t) && !/[。；;]/.test(t)
    // 组内已达 1/3 块宽才允许在标题处切组，防碎成数百个小群；超 1.5 倍块宽无条件落盘交硬切兜底
    if ((isHeading && bufLen > RETRIEVAL_CHUNK_SIZE / 3) || bufLen > RETRIEVAL_CHUNK_SIZE * 1.5) {
      flush()
    }
    buf.push(line)
    bufLen += line.length + 1
  }
  flush()
  return out
}

/**
 * 按标题/空行切段后累计成 ≤6000 字块，块间保留 300 字重叠防跨块断裂；
 * 每块记录其归属标题（segment 首个标题行更新）与章节标题（T13 章节树，供亲和打分）；无换行长段硬切。
 */
export function chunkTenderByHeading(text: string): TenderChunk[] {
  const src = (text ?? "").trim()
  if (!src) return []
  let segments = src.split(/\n{2,}/)
  // T12b：全文无空行 → 标题行分组回退（158k 级单换行流提取件实锤场景）
  if (segments.length <= 2) segments = splitLinesByHeading(src)
  const chunks: { heading: string; text: string }[] = []
  let heading = "文首"
  let buffer = ""
  let bufferHeading = "文首"
  const flush = () => {
    const value = buffer.trim()
    if (value) chunks.push({ heading: bufferHeading, text: value })
    buffer = ""
  }
  for (const segment of segments) {
    heading = headingOfSegment(segment, heading)
    if (!buffer) bufferHeading = heading
    if (buffer && buffer.length + segment.length + 2 > RETRIEVAL_CHUNK_SIZE) {
      const tail = buffer.slice(-RETRIEVAL_CHUNK_OVERLAP)
      flush()
      buffer = `${tail}\n${segment}`
      bufferHeading = heading
    } else {
      buffer += (buffer ? "\n\n" : "") + segment
    }
    // 单段无空行超 1.5 倍块宽：立即落盘交给下方硬切，防缓冲区无限增长
    if (buffer.length > RETRIEVAL_CHUNK_SIZE * 1.5) {
      const h = bufferHeading
      flush()
      bufferHeading = h
    }
  }
  flush()
  const normalized: TenderChunk[] = []
  for (const chunk of chunks) {
    if (chunk.text.length <= RETRIEVAL_CHUNK_SIZE * 1.5) {
      normalized.push({ ...chunk, index: normalized.length })
      continue
    }
    for (let start = 0; start < chunk.text.length; start += RETRIEVAL_CHUNK_SIZE) {
      normalized.push({ heading: chunk.heading, text: chunk.text.slice(start, start + RETRIEVAL_CHUNK_SIZE), index: normalized.length })
    }
  }
  // T13：章节归属（章节树识别成功时给每块标注章标题；定位用块文本首行在原文中的位置）
  const spans = dedupeChaptersByTitle(detectTenderChapters(src))
  if (spans.length) {
    for (const chunk of normalized) {
      const at = src.indexOf(chunk.text.slice(0, 80))
      const pos = at < 0 ? -1 : at
      const span = spans.find((s) => pos >= s.start && pos < s.end)
      if (span) chunk.chapterTitle = span.title
    }
  }
  return normalized
}

/**
 * 块打分：关键词命中次数计分（≥3 字长词权重 2），块标题命中另加 5（对齐参考实现 scoreChunkForTask）；
 * T13 章节亲和：块所属章节类别在 key 亲和表内计 1 倍、表外乘 0.34（约需 3 倍关键词分才能追平亲和块）——
 * 修「第三章设备参数表用海量『评分项』字样把第四章评分表挤出 top12」的检索错位。
 */
export function scoreChunkForSection(chunk: TenderChunk, keywords: string[], key = ""): number {
  let score = 0
  // T12b3：PDF 表格提取件字符间插空格与竖线（「采 | 购 | 人」）→ 归一化后再匹配，否则关键词系统性漏命中
  const norm = chunk.text.replace(/[\s|｜]/g, "")
  const normHeading = chunk.heading.replace(/[\s|｜]/g, "")
  for (const keyword of keywords) {
    if (!keyword) continue
    const kw = keyword.replace(/[\s|｜]/g, "")
    const hits = norm.split(kw).length - 1
    if (hits) score += hits * (keyword.length >= 3 ? 2 : 1)
    if (normHeading.includes(kw)) score += 5
  }
  if (key && chunk.chapterTitle && score > 0) {
    score *= categoryAffinity(key, classifyChapterTitle(chunk.chapterTitle))
  }
  return score
}

/** 首尾对半截断（检索无命中/无表项时的兜底素材，对齐参考实现 bidAnalysisSource） */
function truncateHeadTail(text: string, budget: number): string {
  if (text.length <= budget) return text
  const half = Math.floor(budget / 2)
  return `${text.slice(0, half)}\n\n[中间内容因篇幅限制省略]\n\n${text.slice(-half)}`
}

/**
 * 单解析项素材构建：全文 ≤ 预算直接整段（full）；否则分块检索 top12 块按原文顺序注入并标
 * [原文片段 i/N · 章节：X]（retrieval）；关键词表缺失或无命中回退首尾截断（truncated）。
 */
export function selectRelevantChunks(text: string, key: string, budget = RETRIEVAL_BUDGET_CHARS): RetrievalSource {
  const source = (text ?? "").trim()
  if (!source) return { mode: "full", text: "", selected: [], totalChunks: 0 }
  if (source.length <= budget) return { mode: "full", text: source, selected: [], totalChunks: 1 }
  const chunks = chunkTenderByHeading(source)
  const keywords = SECTION_KEYWORDS[key] ?? []
  const positive = keywords.length
    ? chunks
        .map((chunk) => ({ chunk, score: scoreChunkForSection(chunk, keywords, key) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
    : []
  if (!positive.length) {
    return { mode: "truncated", text: truncateHeadTail(source, budget), selected: [], totalChunks: chunks.length }
  }
  const selected: TenderChunk[] = []
  let used = 0
  if (HEAD_ALWAYS_KEYS.has(key) && chunks[0]) {
    selected.push(chunks[0])
    used += chunks[0].text.length
  }
  for (const item of positive) {
    if (selected.includes(item.chunk)) continue
    if (selected.length >= RETRIEVAL_MAX_CHUNKS) break
    if (used + item.chunk.text.length > budget && selected.length) continue
    selected.push(item.chunk)
    used += item.chunk.text.length
  }
  selected.sort((a, b) => a.index - b.index)
  const text2 = selected
    .map((chunk, i) => `【原文片段 ${i + 1}/${selected.length} · 章节：${chunk.heading}】\n${chunk.text}`)
    .join("\n\n")
  return { mode: "retrieval", text: text2, selected, totalChunks: chunks.length }
}

/**
 * AI 失败降级交付（对齐参考实现 buildDegradedAnalysisContent 的「不破坏结果可用性」口径）：
 * 显式标注降级原因，把检索到的相关原文片段按原序列出供人工核对整理。
 * 系统自产生文本：不过字段清洗链，仅做总长度封顶。
 */
/** Q26 切片A：降级交付封顶——总字数与单片段展示上限，防 2 万字原文碎片铺满报告 */
export const DEGRADED_MAX_CHARS = 3000
const DEGRADED_FRAGMENT_CHARS = 800

export function buildDegradedSectionContent(key: string, source: RetrievalSource, reason: string): string {
  const title = parseSectionTitle(key)
  const header = [
    `〔系统降级 · 关键词检索原文〕「${title}」AI 解析未完成（${reason.slice(0, 200)}）。`,
    `以下为系统按关键词检索出的相关原文片段（节选，供人工核对）；修复模型后可「重新解析此项」由 AI 提炼要点。`,
    "",
  ]
  if (source.mode === "retrieval" && source.selected.length) {
    const lines = [...header, `—— 相关原文片段（检索自全文 ${source.totalChunks} 个分块，共 ${source.selected.length} 段，下为节选）——`]
    // Q26 切片A：片段间去重 + 单片段截断 + 总量封顶，超出折叠为一行提示（旧版整段堆 2 万字）
    const seen = new Set<string>()
    let bodyChars = 0
    let omitted = 0
    for (const [i, chunk] of source.selected.entries()) {
      const dedupe = chunk.text.replace(/\s+/g, "").slice(0, 120)
      if (seen.has(dedupe)) { omitted += 1; continue }
      seen.add(dedupe)
      if (bodyChars >= DEGRADED_MAX_CHARS) { omitted += 1; continue }
      const body = chunk.text.length > DEGRADED_FRAGMENT_CHARS ? chunk.text.slice(0, DEGRADED_FRAGMENT_CHARS) + "…" : chunk.text
      lines.push(`【片段 ${i + 1} · 章节：${chunk.heading}】`, body, "")
      bodyChars += body.length
    }
    if (omitted > 0) lines.push(`…另有 ${omitted} 段原文未展示，点「重新解析此项」由 AI 提炼为要点。`)
    return lines.join("\n").trim()
  }
  return [...header, "—— 原文摘录（首尾截断·节选）——", "", source.text.slice(0, DEGRADED_MAX_CHARS)].join("\n").trim()
}

/** 服务商限流识别（对齐参考实现 429/TPM/rate limit 熔断口径） */
export function isRateLimitError(message: string): boolean {
  return /\b429\b|TPM|rate\s*limit|限流|too\s*many\s*requests/i.test(message)
}

/**
 * Q27/切片A：「整项无结果」语义判定（思路移植自易标 2.30.3 MARKDOWN_MISSING_RESULT 口径，
 * 对齐本项目既有「原文未提及」契约，不新增标记词、不改 prompt）。
 * 区分两态：
 *  - 局部缺失（部分字段未提及但另有有效内容）→ false，正常保留；
 *  - 整项无内容（模型按契约只回一行「原文未提及」等短占位）→ true，应触发自动重跑、不计成功、UI 走 miss 态。
 * 判定与 sectionStatus 的 miss 口径（bidTypes：t.length<=30 && 含「未提及」）保持一致，
 * 但排除「〔系统降级」前缀——那是 AI 失败的降级交付（供人工核对），不属可自动重跑的伪空。
 */
export function isMissingSectionResult(content: string): boolean {
  const t = (content ?? "").trim()
  if (!t) return true
  if (t.startsWith("〔系统降级")) return false
  return t.length <= 30 && t.includes("未提及")
}
