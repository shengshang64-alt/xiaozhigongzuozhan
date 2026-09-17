// 知识库共享领域模块：行类型、CRUD、本地分词/索引提取/检索打分。
// knowledge 页（问答抽屉）与小智助手取数（assistantCore kb_docs 源）共用，
// 保证两处「问知识库」的检索口径一致。

import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { contextSnippetOf, effectivePolicy } from "@/lib/kbPolicy"

// ---------------------------------------------------------------------------
// 行类型（字段名与 kb_docs collection 100% 一致，snake_case）
// ---------------------------------------------------------------------------

export interface KbDocRow {
  id: string
  rh_user_id: string
  title: string
  folder_path: string
  content: string
  doc_format: string
  visibility: string
  summary: string
  keywords: string[]
  source_file_name: string
  uploader_name: string
  created: string
  updated: string
  /** 轮次 D-1：分类七档（kbPolicy.KB_CATEGORIES），存量为空按「其他」兜底 */
  doc_category?: string
  /** 轮次 D-1：original | sanitized_summary | blocked，空 = 取分类默认 */
  ai_context_mode?: string
  /** 轮次 D-1：检索权重（0.1–3），空 = 取分类默认 */
  retrieval_weight?: number
  /** 轮次 D-1：敏感标记，空 = 取分类默认 */
  is_sensitive?: boolean
}

export type KbVisibility = "team" | "personal"

async function kbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
    err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

/** listKbDocs 可选参数（轮次 C1）：q= 服务端模糊匹配、perPage、PB 原生 fields 裁剪 */
export type ListKbDocsOptions = {
  /** kb_docs list 路由 q=：title / source_file_name like 匹配 */
  q?: string
  /** 缺省 500（与历史行为一致；hook 模板服务端上限 200/页） */
  perPage?: number
  /**
   * PB 原生 fields 查询参数（逗号分隔），用于裁掉 content 全文。
   * 注意：当前自定义 list 路由按 publicExport 返回全字段、暂未消费 fields，
   * 透传只为前端先行收敛 + 服务端未来支持时自动生效；fields 不含 content 时
   * 下方解析对缺失 content 容错为空串。
   */
  fields?: string
}

export async function listKbDocs(opts?: ListKbDocsOptions): Promise<KbDocRow[]> {
  // list 路由不按 rh_user_id 过滤（团队文档全员可见），个人文档隔离在前端做。
  // 循环7 C2-2：服务端把 perPage 钳到 200 且原实现只拉第 1 页，>200 文档会被截断；
  // 改为循环翻页拉全（直到返回条数 < 服务端回显的实际 perPage），安全上限 10 页，
  // 超限 console.warn。函数签名不变，调用方无感。
  const perPage = opts?.perPage ?? 500
  const MAX_PAGES = 10
  // 当前自定义 list 路由按 publicExport 返回全字段、暂未消费 fields 参数（红线：pb_hooks 零变更），
  // 故在解析层兜底瘦身：fields 明确裁掉 content 时强制置空，避免命中仍驻留全文大字符串
  const slimContent = opts?.fields !== undefined && !opts.fields.split(",").includes("content")
  const all: KbDocRow[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    if (opts?.q) params.set("q", opts.q)
    if (opts?.fields) params.set("fields", opts.fields)
    const data = await kbFetch<{ items: KbDocRow[]; perPage?: number }>(
      `/api/kb_docs?${params.toString()}`,
    )
    const rows = (data.items ?? []).map((r) => ({
      ...r,
      // fields 裁掉 content 时响应可能缺失该字段，容错为空串（检索/切块函数均已 ?? "" 兜底）
      content: slimContent ? "" : typeof r.content === "string" ? r.content : "",
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      // 轮次 D-1：存量记录新字段为 null，归一成 undefined 让 effectivePolicy 走分类默认
      doc_category: typeof r.doc_category === "string" ? r.doc_category : "",
      ai_context_mode: typeof r.ai_context_mode === "string" ? r.ai_context_mode : "",
      retrieval_weight: typeof r.retrieval_weight === "number" ? r.retrieval_weight : undefined,
      is_sensitive: typeof r.is_sensitive === "boolean" ? r.is_sensitive : undefined,
    }))
    all.push(...rows)
    // 响应回显钳制后的实际 perPage；返回条数不足一页即最后一页
    const effectivePerPage =
      typeof data.perPage === "number" && data.perPage > 0 ? data.perPage : Math.min(perPage, 200)
    if (rows.length < effectivePerPage) return all
    if (page === MAX_PAGES) {
      console.warn(
        `[kbCore] listKbDocs 达到翻页安全上限 ${MAX_PAGES} 页（已取 ${all.length} 条），超出部分未返回`,
      )
    }
  }
  return all
}

/** 当前用户可见的文档：团队库全部 + 自己的个人笔记 */
export function visibleKbDocs(rows: KbDocRow[], userId: string | null): KbDocRow[] {
  return rows.filter((r) => r.visibility !== "personal" || (!!userId && r.rh_user_id === userId))
}

export async function createKbDoc(body: {
  rh_user_id: string
  title: string
  folder_path: string
  content: string
  doc_format: string
  visibility: string
  summary: string
  keywords: string[]
  source_file_name: string
  uploader_name: string
  doc_category?: string
}): Promise<KbDocRow> {
  return kbFetch<KbDocRow>(`/api/kb_docs`, { method: "POST", body: JSON.stringify(body) })
}

export async function updateKbDoc(
  id: string,
  body: Partial<
    Pick<
      KbDocRow,
      | "title"
      | "folder_path"
      | "content"
      | "summary"
      | "keywords"
      | "visibility"
      | "doc_category"
      | "ai_context_mode"
      | "retrieval_weight"
      | "is_sensitive"
    >
  >,
): Promise<KbDocRow> {
  return kbFetch<KbDocRow>(`/api/kb_docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export async function deleteKbDoc(id: string): Promise<void> {
  await kbFetch<{ ok: boolean }>(`/api/kb_docs/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// 本地分词（CJK 连续段 + 拉丁词），问答检索与小智取数共用
// ---------------------------------------------------------------------------

const LATIN_WORD_RE = /[a-zA-Z0-9][a-zA-Z0-9_.-]{1,}/g
const CJK_RUN_RE = /[一-龥]{2,}/g

export function tokenizeText(text: string): string[] {
  const src = (text ?? "").toLowerCase()
  const tokens: string[] = []
  for (const m of src.matchAll(LATIN_WORD_RE)) {
    if (!tokens.includes(m[0])) tokens.push(m[0])
  }
  for (const m of src.matchAll(CJK_RUN_RE)) {
    const run = m[0]
    if (run.length <= 4) {
      if (!tokens.includes(run)) tokens.push(run)
    }
    // 连续段再切二元组，保证「互联互通评级」能命中「评级」「互联」等片段
    for (let i = 0; i + 2 <= run.length; i++) {
      const bi = run.slice(i, i + 2)
      if (!tokens.includes(bi)) tokens.push(bi)
    }
  }
  return tokens
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`|~-]{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// 上传建索引：摘要（首个有效段落截断）+ 关键词（标题分词 + 正文高频词）
// ---------------------------------------------------------------------------

export function extractKbIndex(title: string, content: string): { summary: string; keywords: string[] } {
  const plain = stripMarkdown(content ?? "")
  const paragraphs = (content ?? "")
    .split(/\n{1,}/)
    .map((line) => stripMarkdown(line))
    .filter((line) => line.length >= 10 && !/^[-*\d.、\s]*$/.test(line))
  const summary = (paragraphs[0] ?? plain).slice(0, 160)

  const counts = new Map<string, number>()
  for (const tok of tokenizeText(plain)) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1)
  }
  const titleTokens = tokenizeText(title)
  const keywords: string[] = []
  for (const t of titleTokens) {
    if (keywords.length < 8) keywords.push(t)
  }
  const frequent = [...counts.entries()]
    .filter(([tok, n]) => tok.length >= 2 && n >= 3 && !titleTokens.includes(tok))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([tok]) => tok)
  for (const t of frequent) {
    if (keywords.length < 24) keywords.push(t)
  }
  return { summary, keywords }
}

// ---------------------------------------------------------------------------
// 中文切块（轮次 D-2）：标题三体系识别 + 1200/120/120 贪心合并与回溯重叠
// ---------------------------------------------------------------------------

export interface KbChunk {
  index: number
  /** 最近两级标题拼接（无标题为空串） */
  headingPath: string
  /** 块首字符在 doc.content 中的偏移 */
  start: number
  text: string
}

const KB_HEADING_MD_RE = /^#{1,6}\s+\S/
const KB_HEADING_SECTION_RE = /^第[一二三四五六七八九十百\d]+[章节篇条部分]/
const KB_HEADING_NUM_RE = /^([一二三四五六七八九十]+、|\d+(\.\d+)*[\s、．.])/

/** 中文标题三体系：markdown #、章节条款、序号行（行首判定） */
export const KB_HEADING_RES = [KB_HEADING_MD_RE, KB_HEADING_SECTION_RE, KB_HEADING_NUM_RE]

const KB_CHUNK_SIZE = 1200
const KB_CHUNK_OVERLAP = 120

function isHeadingLine(line: string): boolean {
  const t = (line ?? "").trim()
  if (!t || t.length > 60) return false
  return KB_HEADING_RES.some((re) => re.test(t))
}

interface ChunkUnit {
  start: number
  text: string
  heading: boolean
}

function buildChunkUnits(text: string): ChunkUnit[] {
  const units: ChunkUnit[] = []
  let buf: string[] = []
  let bufStart = 0
  let offset = 0
  const flushBuf = () => {
    if (buf.length === 0) return
    const joined = buf.join("\n").trim()
    if (joined) units.push({ start: bufStart, text: joined, heading: false })
    buf = []
  }
  for (const line of text.split("\n")) {
    const lineStart = offset
    offset += line.length + 1
    const trimmed = line.trim()
    if (!trimmed) {
      flushBuf()
      continue
    }
    if (isHeadingLine(trimmed)) {
      flushBuf()
      units.push({ start: lineStart + (line.length - line.trimStart().length), text: trimmed, heading: true })
      continue
    }
    if (buf.length === 0) bufStart = lineStart + (line.length - line.trimStart().length)
    buf.push(line)
  }
  flushBuf()
  return units
}

function computeKbChunks(content: string): KbChunk[] {
  const units = buildChunkUnits(content ?? "")
  if (units.length === 0) return []
  const chunks: KbChunk[] = []
  const headingStack: string[] = []
  let curText: string[] = []
  let curLen = 0
  let curStart = -1
  let headingPath = ""
  let prevTail = ""

  const flush = () => {
    if (curLen === 0) return
    const joined = curText.join("\n")
    chunks.push({ index: chunks.length, headingPath, start: curStart < 0 ? 0 : curStart, text: joined })
    // 块间回溯重叠：取上一块尾部 120 字，截到整行且不含标题行（不跨标题）
    const tailRaw = joined.slice(-KB_CHUNK_OVERLAP)
    const tailFromNl = tailRaw.includes("\n") ? tailRaw.slice(tailRaw.indexOf("\n") + 1) : tailRaw
    prevTail = tailFromNl.split("\n").some((l) => isHeadingLine(l)) ? "" : tailFromNl
    curText = []
    curLen = 0
    curStart = -1
  }

  for (const unit of units) {
    if (unit.heading) {
      flush()
      headingStack.push(unit.text.replace(/^#{1,6}\s+/, ""))
      if (headingStack.length > 2) headingStack.shift()
      headingPath = headingStack.join(" / ")
    }
    let rest = unit.text
    let restStart = unit.start
    for (;;) {
      if (curLen > 0 && curLen + rest.length + 1 > KB_CHUNK_SIZE) {
        const room = KB_CHUNK_SIZE - curLen - 1
        if (room > 200) {
          curText.push(rest.slice(0, room))
          curLen += room + 1
          restStart += room
          rest = rest.slice(room)
          continue
        }
        flush()
        if (prevTail) {
          curText.push(prevTail)
          curLen = prevTail.length
          curStart = Math.max(0, restStart - prevTail.length)
        }
      }
      if (curStart === -1) curStart = restStart
      curText.push(rest)
      curLen += rest.length + (curText.length > 1 ? 1 : 0)
      break
    }
  }
  flush()
  return chunks
}

// 模块级缓存：doc.updated 变化才重切
const kbChunkCache = new Map<string, { updated: string; chunks: KbChunk[] }>()

export function chunkKbDoc(doc: KbDocRow): KbChunk[] {
  const cached = kbChunkCache.get(doc.id)
  if (cached && cached.updated === (doc.updated ?? "")) return cached.chunks
  const chunks = computeKbChunks(doc.content ?? "")
  kbChunkCache.set(doc.id, { updated: doc.updated ?? "", chunks })
  return chunks
}

// ---------------------------------------------------------------------------
// 检索打分（块级，轮次 D-2）：blocked 过滤 + retrieval_weight 加权，
// 每 doc 最多贡献 2 块（第 2 块分数 ≥ 第 1 块 60% 才带），topN 仍按 doc 数。
// ---------------------------------------------------------------------------

export interface KbSearchHit {
  doc: KbDocRow
  score: number
  snippet: string
  /** 命中块最近两级标题（块级命中才有） */
  headingPath?: string
  /** 命中块在 doc.content 中的字符偏移（引用跳转定位用） */
  chunkStart?: number
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1 && count < 50) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

export function makeSnippet(content: string, tokens: string[], maxLen = 500): string {
  const src = (content ?? "").toLowerCase()
  let hitAt = -1
  for (const tok of tokens) {
    const at = src.indexOf(tok)
    if (at !== -1 && (hitAt === -1 || at < hitAt)) hitAt = at
  }
  const half = Math.floor(maxLen / 2)
  if (hitAt === -1) {
    return stripMarkdown((content ?? "").slice(0, maxLen))
  }
  const start = Math.max(0, hitAt - half)
  const raw = (content ?? "").slice(start, start + maxLen)
  const prefix = start > 0 ? "…" : ""
  const suffix = start + maxLen < (content ?? "").length ? "…" : ""
  return `${prefix}${stripMarkdown(raw)}${suffix}`
}

export function scoreKbDoc(doc: KbDocRow, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const title = (doc.title ?? "").toLowerCase()
  const keywords = (doc.keywords ?? []).map((k) => String(k).toLowerCase())
  const body = (doc.content ?? "").toLowerCase()
  let score = 0
  for (const tok of tokens) {
    if (title.includes(tok)) score += 3
    if (keywords.some((k) => k.includes(tok) || tok.includes(k))) score += 2
    score += Math.min(countOccurrences(body, tok), 20)
  }
  return score
}

export function searchKbDocs(docs: KbDocRow[], question: string, topN = 5): KbSearchHit[] {
  const tokens = tokenizeText(question).filter((t) => t.length >= 2)
  if (tokens.length === 0) return []
  const limit = Math.max(3, Math.min(topN, 5))
  const docEntries: { bestScore: number; hits: KbSearchHit[] }[] = []

  for (const doc of docs) {
    const policy = effectivePolicy(doc)
    // D-1 执行点①：禁止进 AI 的文档不参与检索
    if (policy.ai_context_mode === "blocked") continue

    const lowerTitle = (doc.title ?? "").toLowerCase()
    const keywords = (doc.keywords ?? []).map((k) => String(k).toLowerCase())
    let docBonus = 0
    for (const tok of tokens) {
      if (lowerTitle.includes(tok)) docBonus += 3
      if (keywords.some((k) => k.includes(tok) || tok.includes(k))) docBonus += 2
    }

    const scored: { chunk: KbChunk; chunkScore: number }[] = []
    for (const chunk of chunkKbDoc(doc)) {
      const lowerText = chunk.text.toLowerCase()
      const lowerHeading = (chunk.headingPath ?? "").toLowerCase()
      let chunkScore = 0
      for (const tok of tokens) {
        if (lowerHeading && lowerHeading.includes(tok)) chunkScore += 2
        chunkScore += Math.min(countOccurrences(lowerText, tok), 10)
      }
      if (chunkScore > 0) scored.push({ chunk, chunkScore })
    }
    scored.sort((a, b) => b.chunkScore - a.chunkScore)

    const hits: KbSearchHit[] = []
    if (scored.length > 0) {
      const topChunks = scored.slice(0, 2).filter((x, i) => i === 0 || x.chunkScore >= scored[0].chunkScore * 0.6)
      for (const { chunk, chunkScore } of topChunks) {
        hits.push({
          doc,
          score: (chunkScore + docBonus) * policy.retrieval_weight,
          snippet: makeSnippet(chunk.text, tokens),
          headingPath: chunk.headingPath || undefined,
          chunkStart: chunk.start,
        })
      }
    } else if (docBonus > 0) {
      // 仅标题/关键词命中：退回全文定位片段（无块字段）
      hits.push({
        doc,
        score: docBonus * policy.retrieval_weight,
        snippet: makeSnippet(doc.content ?? "", tokens),
      })
    }
    if (hits.length > 0) docEntries.push({ bestScore: hits[0].score, hits })
  }

  docEntries.sort((a, b) => b.bestScore - a.bestScore)
  const out: KbSearchHit[] = []
  for (const entry of docEntries.slice(0, limit)) out.push(...entry.hits)
  return out
}

// ---------------------------------------------------------------------------
// 问知识库：system prompt 与小智回填格式化
// ---------------------------------------------------------------------------

export const KB_QA_SYSTEM_PROMPT = `你是医疗软件售前团队的「知识库问答」助手。用户的问题附带了从团队知识库中检索出的文档片段（含文档标题与命中片段），可能还带有【标准答案】（团队弹药库已审批的问答对）。

回答要求：
1. 只依据提供的文档片段与标准答案回答，用简体中文，专业、简洁、可落地，适度使用 Markdown 排版。
2. 若资料中含【标准答案】，优先采用其口径组织回答。
3. 回答中凡是依据某份资料的句子，句末标注 [资料N]（N 为资料编号，与资料列表中的【资料 N】对应）；只能使用给定编号，不得编造；同一句可标多个。
4. 片段信息不足以回答时如实说明「知识库中没有找到足够的内容」，并建议用户补充上传哪类文档，绝不编造。
5. 用户追问时结合此前的片段与对话历史继续回答。`

/** 小智取数回填：把检索结果压成标题+摘要列表文本；standardAnswer 为弹药库中置信标准答案 */
export function formatKbHitsForAssistant(
  hits: KbSearchHit[],
  question: string,
  standardAnswer?: string | null,
): string {
  const stdBlock = standardAnswer
    ? `【标准答案】（团队弹药库已审批口径，回答时优先采用）：\n${standardAnswer}\n\n`
    : ""
  if (hits.length === 0) {
    if (standardAnswer) {
      return `按用户问题「${question}」未检索到文档片段，但弹药库命中了【标准答案】，请优先采用其口径回答，不要编造其他知识库内容。`
    }
    return `用户的知识库中没有检索到与「${question}」相关的文档（可能尚未上传相关资料）。请如实告知用户没找到，并建议其上传相关文档，不要编造知识库内容。`
  }
  const rows = hits.map((h, i) => ({
    序号: i + 1,
    标题: h.doc.title,
    目录: h.doc.folder_path || "（根目录）",
    库: h.doc.visibility === "personal" ? "个人笔记" : "团队知识库",
    ...(h.headingPath ? { 章节: h.headingPath } : {}),
    摘要: (h.doc.summary || "").slice(0, 120),
    // D-1 执行点③：脱敏摘要文档只回填 summary，绝不出现原文
    命中片段: contextSnippetOf(h.doc, h).slice(0, 400),
  }))
  const json = JSON.stringify(rows)
  const head = `按用户问题「${question}」在知识库中检索到 ${hits.length} 段相关资料：`
  const body = json.length > 6000 ? `${head}\n${json.slice(0, 6000)}…（已截断）` : `${head}\n${json}`
  return `${stdBlock}${body}`
}
