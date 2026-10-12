// 知识库共享领域模块：行类型、CRUD、本地分词/索引提取/检索打分。
// knowledge 页（问答抽屉）与小智助手取数（assistantCore kb_docs 源）共用，
// 保证两处「问知识库」的检索口径一致。

import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { categoryOf, contextSnippetOf, effectivePolicy } from "@/lib/kbPolicy"
import { redactPii } from "@/lib/piiRedact"

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
  /** 组装层第一期：赛道标签（kbTaxonomy.KB_TRACKS，空=未分类），供调用时按场景软加权 */
  kb_track?: string
  kb_section?: string
  /** 组装层第一期：用途桶标签（kbTaxonomy.KB_BUCKETS，空=未分类） */
  kb_bucket?: string
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
  /** R80/B-01：slim=1 时服务端把 content 置空（列表瘦身），正文按需走 getKbDoc 单条补拉 */
  slim?: boolean
  /** 缺省 500（与历史行为一致；hook 模板服务端上限 200/页） */
  perPage?: number
  /**
   * PB 原生 fields 查询参数（逗号分隔），用于裁掉 content 全文。
   * 注意：当前自定义 list 路由按 publicExport 返回全字段、暂未消费 fields，
   * 透传只为前端先行收敛 + 服务端未来支持时自动生效；fields 不含 content 时
   * 下方解析对缺失 content 容错为空串。
   */
  fields?: string
  /**
   * T9 冷加载渐进直显：每拉完一批（KB_LIST_PAGE_BATCH 页）回调一次已积累的快照副本，
   * 让列表在首批（约 600 篇 / 3-6s）就能开始渲染，不必等全量 30s+。可选参数，不影响既有调用。
   */
  onBatch?: (accumulated: KbDocRow[]) => void
}

/**
 * listKbDocs 翻页安全上限（页）。仅作服务端异常时的兜底——正常路径靠
 * 「返回条数 < 一页」提前收敛，故提高上限不产生额外请求。
 * 本轮（kb-cap-01）：30 → 60。实测 kb_docs 真实总数 6423（末页为第 33 页、23 条），
 * 旧上限 30 页 × 200 = 6000 使第 31–33 页共 423 篇文档被**静默丢弃**并退出前端检索；
 * 60 页(=12000) 为当前规模留一倍余量，避免再次静默截断。
 */
export const KB_LIST_MAX_PAGES = 60

/** 服务端 kb_docs list 路由的每页硬上限（hook 把 perPage 钳到 200，请求更大值无效）。 */
export const KB_LIST_PER_PAGE = 200

/**
 * perf-01：全量翻页并发批大小。冷加载实测单页(200 篇含全文)~3.2s，6400+ 篇要串行 33 页
 * ≈ 60–100s（kb-cap-01 坐实）；改为每批 3 页并发下载、批间仍串行（保留「返回不满一页即停」
 * 的收敛语义），冷加载约降 3 倍。并发度取 3 是低内存机器的保守值（每页响应体均为大字符串，
 * 在飞响应 ×3 可控），高于 4 无必要且加剧带宽争抢。
 */
const KB_LIST_PAGE_BATCH = 3

/** R80/B-01：单条取全文（列表瘦身后的正文保真通道） */
export function getKbDoc(id: string): Promise<KbDocRow> {
  return kbFetch<KbDocRow>(`/api/kb_docs/${encodeURIComponent(id)}`)
}

export async function listKbDocs(opts?: ListKbDocsOptions): Promise<KbDocRow[]> {
  // list 路由不按 rh_user_id 过滤（团队文档全员可见），个人文档隔离在前端做。
  // 循环7 C2-2：服务端把 perPage 钳到 200 且原实现只拉第 1 页，>200 文档会被截断；
  // 改为循环翻页拉全（直到返回条数 < 服务端回显的实际 perPage）。安全上限原为 10 页(=2000)，
  // 但本地材料批量导入后团队+个人已超 2000（实测 2004），尾部文档会被静默丢弃且退出前端检索，
  // 故先上调到 30 页(=6000)；本轮 kb-cap-01 再上调到 KB_LIST_MAX_PAGES(=60 页)。
  const perPage = opts?.perPage ?? 500
  const MAX_PAGES = KB_LIST_MAX_PAGES
  // 当前自定义 list 路由按 publicExport 返回全字段、暂未消费 fields 参数（红线：pb_hooks 零变更），
  // 故在解析层兜底瘦身：fields 明确裁掉 content 时强制置空，避免命中仍驻留全文大字符串
  const slimContent = opts?.fields !== undefined && !opts.fields.split(",").includes("content")
  const fetchKbPage = async (page: number): Promise<{ rows: KbDocRow[]; effectivePerPage: number; totalItems: number }> => {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    if (opts?.q) params.set("q", opts.q)
    if (opts?.fields) params.set("fields", opts.fields)
    if (opts?.slim) params.set("slim", "1")
    const data = await kbFetch<{ items: KbDocRow[]; perPage?: number; totalItems?: number }>(
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
      kb_track: typeof r.kb_track === "string" ? r.kb_track : "",
      kb_bucket: typeof r.kb_bucket === "string" ? r.kb_bucket : "",
      kb_section: typeof r.kb_section === "string" ? r.kb_section : "",
    }))
    // 响应回显钳制后的实际 perPage；返回条数不足一页即最后一页
    const effectivePerPage =
      typeof data.perPage === "number" && data.perPage > 0 ? data.perPage : Math.min(perPage, 200)
    // 服务端 list 路由回显真实总数 totalItems；缺失/非法记为 -1，走保守降级（旧语义）
    const totalItems = typeof data.totalItems === "number" && data.totalItems >= 0 ? data.totalItems : -1
    return { rows, effectivePerPage, totalItems }
  }
  const all: KbDocRow[] = []
  // 首页单独串行取：一次即可学习 effectivePerPage + totalItems，据此精确算末页，杜绝越界空页预取
  const first = await fetchKbPage(1)
  all.push(...first.rows)
  const epp = first.effectivePerPage
  // 首页满 epp 且总数尚未取满才继续翻页（totalItems<0 未知时保守继续，靠 lastPage=MAX 收敛）
  const needMore = first.rows.length >= epp && (first.totalItems < 0 || all.length < first.totalItems)
  if (opts?.onBatch && all.length > 0) {
    try {
      opts.onBatch([...all])
    } catch {
      /* 渐进直显属体验增强，静默降级 */
    }
  }
  if (needMore) {
    // 精确末页：totalItems>0 时按总数收敛；totalItems<0（缺失）时退回安全上限，靠「返回不满一页」收敛
    const lastPage =
      first.totalItems >= 0
        ? Math.min(MAX_PAGES, Math.ceil(first.totalItems / epp))
        : MAX_PAGES
    for (let start = 2; start <= lastPage; start += KB_LIST_PAGE_BATCH) {
      const size = Math.min(KB_LIST_PAGE_BATCH, lastPage - start + 1)
      // 同批并发拉页，任一页失败则整体抛出（与旧串行实现一致）；拼接按页序，结果与串行版逐字等价
      const batch = await Promise.all(
        Array.from({ length: size }, (_, i) => fetchKbPage(start + i)),
      )
      for (const { rows } of batch) all.push(...rows)
      // T9：批间快照回调（副本，防调用方持有后被追加污染）；回调异常不中断拉取主链路
      if (opts?.onBatch && all.length > 0) {
        try {
          opts.onBatch([...all])
        } catch {
          /* 渐进直显属体验增强，静默降级 */
        }
      }
    }
    // 撞满安全上限且总数仍大于已取条数，才说明仍有文档未返回
    if (first.totalItems >= 0 && all.length < first.totalItems && lastPage >= MAX_PAGES) {
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

// ---------------------------------------------------------------------------
// KB 变更广播（R104）：kb_docs 增/改/删入口全部汇聚在下方三个函数，成功后
// 通知已注册监听（如 kbAssemble 共享组装缓存）即时失效，替代「变更后要等
// TTL 过期才可见」的断链。注册方向 kbAssemble→kbCore，无循环依赖；
// 监听器异常静默吞掉，绝不影响变更主链路。
// ---------------------------------------------------------------------------
type KbMutationListener = () => void
const kbMutationListeners = new Set<KbMutationListener>()

/** 注册 kb_docs 变更事件监听，返回取消函数（测试清场用；生产侧注册后常驻） */
export function onKbMutation(cb: KbMutationListener): () => void {
  kbMutationListeners.add(cb)
  return () => {
    kbMutationListeners.delete(cb)
  }
}

function notifyKbMutation(): void {
  for (const cb of kbMutationListeners) {
    try {
      cb()
    } catch {
      /* 监听失败不影响变更主链路 */
    }
  }
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
  ai_context_mode?: string
  retrieval_weight?: number
  is_sensitive?: boolean
  /** 章节用途/赛道/用途桶（2026-10-07 知识库整合：方案入库时自动打标，生成检索按用途软加权） */
  kb_section?: string
  kb_track?: string
  kb_bucket?: string
}): Promise<KbDocRow> {
  const row = await kbFetch<KbDocRow>(`/api/kb_docs`, { method: "POST", body: JSON.stringify(body) })
  notifyKbMutation()
  return row
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
  const row = await kbFetch<KbDocRow>(`/api/kb_docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  notifyKbMutation()
  return row
}

export async function deleteKbDoc(id: string): Promise<void> {
  await kbFetch<{ ok: boolean }>(`/api/kb_docs/${encodeURIComponent(id)}`, { method: "DELETE" })
  notifyKbMutation()
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

/** 摘要候选行判定：跳过空/纯标点、xlsx 合成表名标记【工作表 X】、以及分隔符密集却几乎无正文的纯 CSV 表头噪声行 */
function isSummaryJunkLine(line: string): boolean {
  if (!line || line.length < 10) return true
  if (/^[-*\d.、\s（）()·｜|]*$/.test(line)) return true
  if (/^【工作表[^】]*】$/.test(line)) return true
  const seps = (line.match(/[,，|\t]/g) ?? []).length
  const core = line.replace(/[,，|\t\s]/g, "")
  if (seps >= 3 && core.length < seps * 2) return true
  return false
}

export function extractKbIndex(title: string, content: string): { summary: string; keywords: string[] } {
  const plain = stripMarkdown(content ?? "")
  const paragraphs = (content ?? "")
    .split(/\n{1,}/)
    .map((line) => stripMarkdown(line))
    .filter((line) => !isSummaryJunkLine(line))
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

// 模块级缓存：doc.updated 或正文长度变化才重切
// R87 回归修复：slim 列表 content 为空串，loadDocContent 补拉正文回填时 updated 不变；
// 只校验 updated 会把空 chunks 永久缓存，该文档从此退出全文检索（知识库问答静默降级）
const kbChunkCache = new Map<string, { updated: string; len: number; chunks: KbChunk[] }>()

export function chunkKbDoc(doc: KbDocRow): KbChunk[] {
  const len = (doc.content ?? "").length
  const cached = kbChunkCache.get(doc.id)
  if (cached && cached.updated === (doc.updated ?? "") && cached.len === len) return cached.chunks
  const chunks = computeKbChunks(doc.content ?? "")
  kbChunkCache.set(doc.id, { updated: doc.updated ?? "", len, chunks })
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

// ---------------------------------------------------------------------------
// 检索打分（块级 v2，p1-kb）：IDF + BM25 tf-saturation + 短语邻接 +
// 标题整串强匹配 + 分类多样化 + 疑问词停用；每 doc 最多贡献 2 块（第 2 块分数
// ≥ 第 1 块 60% 才带），topN 按 doc 数；blocked 过滤与 retrieval_weight 加权不变。
// ---------------------------------------------------------------------------

// 中文常见疑问/连接词：出现频次高但信息量低，进入主排序会稀释信号，直接过滤
const QUERY_STOPWORDS = new Set([
  "什么", "怎么", "怎样", "如何", "为什么", "哪些", "哪个", "是否", "可以", "需要",
  "有没", "多少", "对于", "关于", "以及", "或者", "并且", "但是", "可是", "然后",
  "进行", "一下", "这个", "那个", "哪些个",
])

// 语料 df 缓存：以 docs 数组引用为 WeakMap 键，listKbDocs 每次返回新数组即重建；
// 同一 session 内多次调 searchKbDocs 只扫一遍语料。
const kbIdfCache = new WeakMap<KbDocRow[], { N: number; df: Map<string, number> }>()

function getOrBuildIdf(docs: KbDocRow[]): { N: number; df: Map<string, number> } {
  const hit = kbIdfCache.get(docs)
  if (hit) return hit
  const df = new Map<string, number>()
  let N = 0
  for (const d of docs) {
    // blocked 文档既不参与检索也不进 df，避免其词汇压低公共词权重
    if (effectivePolicy(d).ai_context_mode === "blocked") continue
    N += 1
    const unique = new Set<string>()
    const head = (d.title ?? "") + " " + (d.keywords ?? []).join(" ")
    // body 采样前 6000 字：df 是文档级布尔量，抽样近似不影响排序且避免超长文档遍历开销
    const body = (d.content ?? "").slice(0, 6000)
    for (const t of tokenizeText(head + " " + body)) unique.add(t)
    for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const built = { N, df }
  kbIdfCache.set(docs, built)
  return built
}

function idfOf(tok: string, N: number, df: Map<string, number>): number {
  const d = df.get(tok) ?? 0
  // Lucene 风格：恒正且稀词权重更高；N 极小时也不会爆
  return Math.log(1 + (N - d + 0.5) / (d + 0.5))
}

// 分词权重：CJK 长段 > 3 字片段 > 拉丁词 > 2 字 bigram（bigram 是子串证据，非独立信号）
function tokenWeightOf(tok: string): number {
  if (/^[a-z0-9]/i.test(tok)) return 1.0
  const L = tok.length
  if (L >= 4) return 1.6
  if (L === 3) return 1.3
  return 1.0
}

interface QueryToken {
  tok: string
  weight: number
}

function tokenizeQueryWeighted(q: string): QueryToken[] {
  const src = (q ?? "").toLowerCase()
  const out: QueryToken[] = []
  const seen = new Set<string>()
  const add = (t: string) => {
    if (seen.has(t) || t.length < 2 || QUERY_STOPWORDS.has(t)) return
    seen.add(t)
    out.push({ tok: t, weight: tokenWeightOf(t) })
  }
  for (const m of src.matchAll(LATIN_WORD_RE)) add(m[0])
  for (const m of src.matchAll(CJK_RUN_RE)) {
    const run = m[0]
    if (run.length <= 4) add(run)
    // 长段截前 4 字保留主信号（bigram 循环下面已覆盖其余子串）
    else add(run.slice(0, 4))
    for (let i = 0; i + 2 <= run.length; i++) add(run.slice(i, i + 2))
  }
  return out
}

// 短语邻接：query 命中的不同 tok 若首次位置间距 ≤ 100 字，视为「共同描述同一件事」，
// 每一对相邻加 2 分。仅按 tok 首次出现位置计算避免高频词反复触发。
function phraseAdjacencyBonus(hits: { tok: string; at: number }[]): number {
  if (hits.length < 2) return 0
  const first = new Map<string, number>()
  for (const h of hits) if (!first.has(h.tok)) first.set(h.tok, h.at)
  const arr = [...first.values()].sort((a, b) => a - b)
  let bonus = 0
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] - arr[i - 1] <= 100) bonus += 2
  }
  return bonus
}

const BM25_K1 = 1.4

function bm25Tf(tf: number, dl: number, avgDl: number): number {
  const cap = Math.min(tf, 20)
  const b = 0.75
  const norm = 1 - b + b * (dl / Math.max(1, avgDl))
  return (cap * (BM25_K1 + 1)) / (cap + BM25_K1 * norm)
}

// 单文档 chunk 命中的粗估平均块长（避免全局扫描；用当前 doc 的 chunks 长度中位数）
function estimateAvgDl(docs: KbDocRow[], cap = 20): number {
  let total = 0
  let n = 0
  const lim = Math.min(docs.length, cap)
  for (let i = 0; i < lim; i++) {
    const chunks = chunkKbDoc(docs[i])
    for (const c of chunks) {
      total += c.text.length
      n += 1
    }
  }
  return n > 0 ? Math.max(200, total / n) : 800
}

export function searchKbDocs(docs: KbDocRow[], question: string, topN = 5): KbSearchHit[] {
  const qTokens = tokenizeQueryWeighted(question)
  if (qTokens.length === 0) return []
  const limit = Math.max(3, Math.min(topN, 8))
  const { N, df } = getOrBuildIdf(docs)
  const avgDl = estimateAvgDl(docs)
  const rawQ = (question ?? "").toLowerCase().trim()
  const tokList = qTokens.map((q) => q.tok)

  const docEntries: { bestScore: number; hits: KbSearchHit[]; category: string }[] = []

  for (const doc of docs) {
    const policy = effectivePolicy(doc)
    // D-1 执行点①：禁止进 AI 的文档不参与检索
    if (policy.ai_context_mode === "blocked") continue

    const lowerTitle = (doc.title ?? "").toLowerCase()
    const keywords = (doc.keywords ?? []).map((k) => String(k).toLowerCase())
    let docBonus = 0
    for (const { tok, weight } of qTokens) {
      if (lowerTitle.includes(tok)) docBonus += 3 * weight
      if (keywords.some((k) => k.includes(tok) || tok.includes(k))) docBonus += 2 * weight
    }
    // 原查询整串作为 title 子串（≥3 字）：极强信号，加 15 分
    if (rawQ.length >= 3 && lowerTitle.includes(rawQ)) docBonus += 15

    const scored: { chunk: KbChunk; chunkScore: number }[] = []
    for (const chunk of chunkKbDoc(doc)) {
      const lowerText = chunk.text.toLowerCase()
      const lowerHeading = (chunk.headingPath ?? "").toLowerCase()
      const dl = Math.max(1, lowerText.length)

      let s = 0
      const pos: { tok: string; at: number }[] = []
      for (const { tok, weight } of qTokens) {
        const tf = countOccurrences(lowerText, tok)
        if (tf === 0) continue
        pos.push({ tok, at: lowerText.indexOf(tok) })
        const idf = idfOf(tok, N, df)
        s += weight * idf * bm25Tf(tf, dl, avgDl)
        if (lowerHeading && lowerHeading.includes(tok)) s += 2 * weight
      }
      if (s > 0) {
        s += phraseAdjacencyBonus(pos)
        // 超长块轻罚：>1500 字后每 1000 字衰减 ~1/1.5，避免大段落自然赢小段落
        if (dl > 1500) s *= 1500 / dl
        scored.push({ chunk, chunkScore: s })
      }
    }
    scored.sort((a, b) => b.chunkScore - a.chunkScore)

    const hits: KbSearchHit[] = []
    if (scored.length > 0) {
      const topChunks = scored.slice(0, 2).filter((x, i) => i === 0 || x.chunkScore >= scored[0].chunkScore * 0.6)
      for (const { chunk, chunkScore } of topChunks) {
        hits.push({
          doc,
          score: (chunkScore + docBonus) * policy.retrieval_weight,
          snippet: makeSnippet(chunk.text, tokList),
          headingPath: chunk.headingPath || undefined,
          chunkStart: chunk.start,
        })
      }
    } else if (docBonus > 0) {
      // 仅标题/关键词命中：退回全文定位片段（无块字段）
      hits.push({
        doc,
        score: docBonus * policy.retrieval_weight,
        snippet: makeSnippet(doc.content ?? "", tokList),
      })
    }
    if (hits.length > 0) {
      docEntries.push({ bestScore: hits[0].score, hits, category: categoryOf(doc) })
    }
  }

  docEntries.sort((a, b) => b.bestScore - a.bestScore)

  // 分类多样化：top limit 全为同一分类且存在其它分类的可信候选（≥ top1 * 60%），
  // 用最佳不同分类替换末位，避免 AI 上下文被单一视角垄断。
  const picked = docEntries.slice(0, limit)
  if (picked.length >= 3) {
    const catCount = new Map<string, number>()
    for (const e of picked) catCount.set(e.category, (catCount.get(e.category) ?? 0) + 1)
    const dominant = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]
    if (dominant && dominant[1] >= picked.length - 1) {
      const threshold = picked[0].bestScore * 0.6
      const cand = docEntries
        .slice(limit)
        .find((e) => e.category !== dominant[0] && e.bestScore >= threshold)
      if (cand) picked[picked.length - 1] = cand
    }
  }

  const out: KbSearchHit[] = []
  for (const entry of picked) out.push(...entry.hits)
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
    摘要: redactPii((h.doc.summary || "").slice(0, 120)),
    // D-1 执行点③：脱敏摘要文档只回填 summary，绝不出现原文
    命中片段: contextSnippetOf(h.doc, h).slice(0, 400),
  }))
  const json = JSON.stringify(rows)
  const head = `按用户问题「${question}」在知识库中检索到 ${hits.length} 段相关资料：`
  const body = json.length > 6000 ? `${head}\n${json.slice(0, 6000)}…（已截断）` : `${head}\n${json}`
  return `${stdBlock}${body}`
}
