// ---------------------------------------------------------------------------
// R50（WorkBuddy《提示词升级文档》切片 3 · P0-3 长文可见性）
//
// 改前的病：长投标正文在进模型前被 clipText(text, MAX_BID_CHARS=12000) 静默截断
// （prompts/voidCheck.ts、prompts/voidCheckRounds.ts、useBidWorkspace.resolveBidText 三处），
// 偏离表更狠——每章只取前 300 字当「正文摘要」（prompts/deviationMap.ts）。
// 后果是「后段证据不可见」被当成「不存在」，而输出里没有任何一处能看出输入其实不完整。
//
// 本模块提供纯函数层（零 AI、零 IO、零 PocketBase）：
//   1. 分块：先按「第N章」切章，再按标题/行边界累计成 ≤6000 字块，块间留 300 字重叠，
//      每块带稳定来源标识（如「第3章 资质证明/块2」）——废标核销矩阵与偏离表共用同一套 id；
//   2. 按条款定向检索：条款关键词（含同义词组、型号/数字等硬词）+ 逆文档频率加权打分，
//      按条款轮转选取（防头几条条款吃光预算），去重后按原文顺序归并成证据包；
//   3. 输入可见性报告：完整 / 检索片段 / 首尾截断、覆盖了哪些章、哪些条款本次无可见证据、
//      未注入字数、input_complete 标志、告警，以及随 user 消息进 Prompt 的【输入可见性】说明块。
//
// 刻意不做的事（对齐升级文档 P0-3 的明确禁止项）：
//   - 不把 MAX_BID_CHARS 调大来掩盖截断：该常量对其它消费者保持原义，本模块用独立预算；
//   - 检索不到 != 不存在：没命中的条款只标 hit=false，由提示词契约降级为 partial/部分响应，
//     本模块绝不产出「确定不合规」「确定偏离」的结论；
//   - 打分是「召回导向」的检索器，不是判定器；词表/块数/词数/命中次数上限都只会让召回更保守。
// ---------------------------------------------------------------------------

/** 检索模式预算（字）：与 prompts/tenderRetrieval.ts 同口径，给 system 与条款清单留上下文余量 */
export const BID_VISIBILITY_BUDGET_CHARS = 20000
/** 块宽与块间重叠：对齐招标侧 chunkTenderByHeading 的 6000/300 */
export const BID_CHUNK_SIZE = 6000
export const BID_CHUNK_OVERLAP = 300
/** 全局注入块数上限（与招标侧 RETRIEVAL_MAX_CHUNKS 同口径） */
export const BID_MAX_CHUNKS = 12
/** 单条款最多占用块数：防「头三条废标条款吃掉全部预算、后面条款永远无可见证据」 */
export const BID_MAX_CHUNKS_PER_CLAUSE = 4
/** 单块超过此倍数的块宽即硬切（与 prompts/tenderRetrieval 同口径） */
export const BID_HARD_SPLIT_FACTOR = 1.5
/** 参与检索的打分词上限（每条款）：截断只会降低召回、提高保守度，不是证据口径 */
const MAX_TERMS_PER_CLAUSE = 40
/** 全局词表上限：超出的只在打分阶段忽略，命中不到的条款同样落到 hit=false（保守方向） */
const MAX_UNION_TERMS = 4000
/** 单块内单次打分最多计入的命中次数（防长表格里同一个词刷分） */
const MAX_HITS_PER_TERM = 3
/** 单个长片段最多派生多少个滑窗词组 */
const MAX_TOKEN_WINDOWS = 12

/** 统一来源标识的载体：废标核销矩阵与偏离表共用同一套 id（第N章 标题/块K） */
export interface BidChunk {
  id: string
  chapter_ref: string
  chapter_index: number
  chunk_index: number
  heading: string
  text: string
}

/** 条款级可见性：hit=false 表示「本次注入的可见范围内，检索不到该条款的证据块」 */
export interface ClauseVisibility {
  clause: string
  /** 条款标识：废标侧为清单序号（1、2...），偏离表侧为条款 id（c3） */
  ref: string
  index: number
  hit: boolean
  score: number
  sources: string[]
}

export interface BidVisibilityReport {
  /** 投标文件全文（未截断）字数 */
  input_chars: number
  /** full=全文（≤预算，逐字）；retrieval=按条款检索选块；truncated=检索无命中回退首尾节选 */
  mode: "full" | "retrieval" | "truncated"
  /** true 仅当 mode === "full"（全文已整体注入） */
  input_complete: boolean
  total_chapters: number
  total_chunks: number
  selected_chunks: number
  /** 本次注入覆盖到的章（第N章 ...） */
  covered_chapters: string[]
  /** 未注入字数（input_chars - 注入片段字数） */
  omitted_chars: number
  clause_total: number
  clause_hit: number
  warnings: string[]
}

export interface BidEvidencePack {
  report: BidVisibilityReport
  /** 进 Prompt 的素材正文：full=原文逐字；retrieval=带来源标头的定向片段；truncated=首尾节选 */
  text: string
  /** 程序侧生成的【输入可见性】说明块（进 user 消息，非模型推断） */
  note: string
  clauses: ClauseVisibility[]
}

/** 输入可见性契约（废标侧）：prompts/voidCheck.ts 与 prompts/voidCheckRounds.ts 逐字共用，手册 §2.13 同源 */
export const BID_VISIBILITY_CONTRACT_VOID =
  "输入可见性契约（程序生成，必须原样遵守）：user 消息中的【输入可见性】块由程序生成、非模型推断，不得改写或忽略——① 声明「输入完整：是」时，全文已在下方给出，检索不到响应即为真实未响应，可按 non_compliant 判定（仍须附 evidence）；② 声明「输入完整：否」时，其中标注为「本次注入范围内检索不到证据」的条款一律判 partial（部分响应）并在 suggestion 中注明「需人工核对未注入部分」，既不得判 compliant（完全响应）也不得判 non_compliant（未找到响应）；③ 任何情况下，未注入部分都不得当作「投标文件中不存在」，结论必须区分「已核对未见」与「本次不可见」。"

/** 输入可见性契约（偏离表侧）：prompts/deviationMap.ts 逐字共用，手册 §2.11 同源 */
export const BID_VISIBILITY_CONTRACT_DEVIATION =
  "输入可见性契约（程序生成，必须原样遵守）：user 消息中的【输入可见性】块由程序生成、非模型推断，不得改写或忽略——① 声明「输入完整：是」时，全文已在下方给出，检索不到响应即为真实未响应，可判偏离（response_level=deviation）；② 声明「输入完整：否」时，其中标注为「本次注入范围内检索不到证据」的条款一律判部分响应（response_level=partial）并写明「需人工核对未注入部分」，既不得判偏离（response_level=deviation）也不得判完全响应（response_level=full）；③ 任何情况下，未注入部分都不得当作「投标文件中不存在」。"

/** 条款输入：废标侧给纯文本，偏离表侧给 {id,text}（id 进可见性清单，便于人工对号入座） */
export type BidClauseInput = string | { id?: string; text: string }

interface BidBlock {
  ref: string
  index: number
  body: string
}

// ------------------------------ 分块 ------------------------------

const CHAPTER_MARK_RE = /^[ \t\u3000]*第\s*([0-9]{1,3})\s*章[ \t\u3000:：]*(.*)$/
const HEADING_RE =
  /^[ \t\u3000]*(?:#{1,6}[ \t\u3000]+|[0-9]+(?:\.[0-9]+)*[ \t\u3000、.．:：)]|[（(][ \t\u3000]*[0-9一二三四五六七八九十]{1,3}[ \t\u3000]*[）)]|[一二三四五六七八九十]{1,3}[ \t\u3000]*[、.．)]|第[ \t\u3000]*[0-9一二三四五六七八九十]{1,3}[ \t\u3000]*节|[0-9]{1,2}[ \t\u3000]*[、.．)])\S/

/** 章标题行判定（≤32 字且形如编号标题）：仅用于给块标注 heading 与选择切点，不参与内容裁剪 */
export function isBidHeadingLine(line: string): boolean {
  const t = (line ?? "").trim()
  if (!t || t.length > 32) return false
  return HEADING_RE.test(t) || CHAPTER_MARK_RE.test(t)
}

/** 章标题行 → 来源章标识（`第3章 资质证明`；无标题时 `第3章`；正文首段无章标题时为 `文首`） */
function chapterRefOf(number: string, title: string): string {
  const t = (title ?? "").trim().replace(/\s+/g, " ")
  return t ? `第${number}章 ${t.slice(0, 20)}` : `第${number}章`
}

/** 投标纯文本 → 章块：按正文里的「第N章 标题」行切分（编号取自正文自身，与 chaptersToText 产出同源） */
export function parseBidTextBlocks(text: string): BidBlock[] {
  const out: BidBlock[] = []
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
  let cur: BidBlock | null = null
  for (const line of lines) {
    const m = CHAPTER_MARK_RE.exec(line)
    if (m) {
      cur = { ref: chapterRefOf(m[1], m[2]), index: Number(m[1]), body: line }
      out.push(cur)
      continue
    }
    if (!cur) {
      cur = { ref: "文首", index: 0, body: "" }
      out.push(cur)
    }
    cur.body = cur.body ? `${cur.body}\n${line}` : line
  }
  return out.filter((b) => b.body.trim().length > 0)
}

/** 单块超 1.5 倍块宽 → 硬切（无换行长段兜底） */
function hardSplit(piece: string): string[] {
  if (piece.length <= BID_CHUNK_SIZE * BID_HARD_SPLIT_FACTOR) return [piece]
  const out: string[] = []
  for (let i = 0; i < piece.length; i += BID_CHUNK_SIZE) out.push(piece.slice(i, i + BID_CHUNK_SIZE))
  return out
}

/** 章正文 → ≤6000 字片段：标题处/超宽处切，块间留 300 字重叠防跨块证据断裂 */
function packPieces(body: string): string[] {
  const out: string[] = []
  const lines = String(body ?? "").split("\n")
  let buf: string[] = []
  let bufLen = 0
  const flush = (carry: boolean) => {
    const text = buf.join("\n").trim()
    if (text) out.push(text)
    if (carry && text) {
      const tail = text.slice(-BID_CHUNK_OVERLAP)
      buf = [tail]
      bufLen = tail.length + 1
    } else {
      buf = []
      bufLen = 0
    }
  }
  for (const line of lines) {
    // 组内已有 1/3 块宽才允许在标题处切，防碎成上百个小块；超 1.5 倍块宽无条件切
    if ((isBidHeadingLine(line) && bufLen > BID_CHUNK_SIZE / 3) || bufLen > BID_CHUNK_SIZE * BID_HARD_SPLIT_FACTOR) {
      flush(true)
    }
    buf.push(line)
    bufLen += line.length + 1
  }
  flush(false)
  return out.flatMap((piece) => hardSplit(piece))
}

function firstHeadingOf(piece: string): string {
  const lines = piece.split("\n")
  for (const line of lines.slice(0, 3)) {
    if (isBidHeadingLine(line)) return line.trim()
  }
  return ""
}

/** 投标纯文本 → 带来源标识的块清单（id 形如 `第3章 资质证明/块2`；无章标题时 `文首/块1`） */
export function chunkBidText(text: string): BidChunk[] {
  const chunks: BidChunk[] = []
  for (const block of parseBidTextBlocks(text)) {
    packPieces(block.body).forEach((piece, k) => {
      chunks.push({
        id: `${block.ref}/块${k + 1}`,
        chapter_ref: block.ref,
        chapter_index: block.index,
        chunk_index: k,
        heading: firstHeadingOf(piece) || block.ref,
        text: piece,
      })
    })
  }
  return chunks
}

// ------------------------------ 条款关键词 ------------------------------

/** 高频虚词/泛词：单独成词时无区分度，剔除后召回更准（只影响选块，不影响判定） */
const STOP_TERMS = new Set([
  "投标人",
  "供应商",
  "应当",
  "应该",
  "必须",
  "不得",
  "可以",
  "本项目",
  "招标文件",
  "投标文件",
  "文件",
  "要求",
  "提供",
  "内容",
  "相关",
  "按照",
  "符合",
  "满足",
  "具有",
  "其他",
  "以及",
  "其中",
  "凡是",
  "需要",
  "予以",
  "视为",
  "否则",
  "以上",
  "以下",
  "不少于",
  "不超过",
])

/** 同义词组：命中组内任一词即补齐整组（与废标提示词的「同义词检索规则」同口径） */
const SYNONYM_GROUPS: readonly string[][] = [
  ["业绩", "类似项目", "工程实例", "项目经验", "案例"],
  ["资质", "证书", "执照", "许可"],
  ["授权", "委托", "代理"],
  ["保证金", "押金", "质保金"],
  // 程序性用词组：盖章/签章 互不包含但语义同指，漏了会系统性漏召回（只扩大召回方向）
  ["盖章", "签章", "印章", "公章", "签字"],
]

/** 助词/连接词：长句先在这些字处断开，避免派生出的词组跨界失真 */
const CLAUSE_SPLIT_RE = /[，。；、：（）()【】“”"'\s]+|(?:并|且|及|或|与|须|需|应|可|不|则|为|以|之|其|该|等|均|者|的)/g

/** 硬词（型号/数字/单位/英文缩写）：整段照抄，属高价值匹配 */
const HARD_TOKEN_RE =
  /[A-Za-z][A-Za-z0-9._/-]{1,}|[0-9]+(?:\.[0-9]+)?(?:%|％|年|个月|月|天|小时|分钟|周|次|人|项|套|台|份|倍|万元|万|元|GB|TB|Gbps|Mbps|小时)/g

/** 停止词粘在词首/词尾时（「提供采购人」「验收证明材料」），补出剥离后的剩余词——只扩召回，不参与判定 */
function addAffixStripped(terms: Set<string>, token: string): void {
  for (const s of STOP_TERMS) {
    if (token.length <= s.length + 1) continue
    if (token.startsWith(s)) {
      const rest = token.slice(s.length)
      if (rest.length >= 2 && !STOP_TERMS.has(rest)) terms.add(rest)
    }
    if (token.endsWith(s)) {
      const rest = token.slice(0, token.length - s.length)
      if (rest.length >= 2 && !STOP_TERMS.has(rest)) terms.add(rest)
    }
  }
}

/** 条款关键词派生：长词优先、含同义词扩展与滑窗（只做召回，不做判定） */
export function deriveClauseTerms(clause: string): string[] {
  const raw = String(clause ?? "")
  const terms = new Set<string>()
  for (const m of raw.matchAll(HARD_TOKEN_RE)) {
    if (m[0].length >= 2) terms.add(m[0])
  }
  for (const token of raw.split(CLAUSE_SPLIT_RE)) {
    const t = (token ?? "").trim()
    if (t.length < 2 || STOP_TERMS.has(t)) continue
    if (t.length <= 6) {
      terms.add(t)
      addAffixStripped(terms, t)
      continue
    }
    // 长句：4 字滑窗（步长 2）+ 3 字滑窗（步长 3），保证长条款也有可检索词组
    let added = 0
    for (let i = 0; i + 2 <= t.length && added < MAX_TOKEN_WINDOWS; i += 2) {
      const w = t.slice(i, i + 4)
      if (w.length >= 2 && !STOP_TERMS.has(w)) {
        terms.add(w)
        added += 1
      }
    }
    for (let i = 0; i + 2 <= t.length && added < MAX_TOKEN_WINDOWS; i += 3) {
      const w = t.slice(i, i + 3)
      if (w.length >= 2 && !STOP_TERMS.has(w)) {
        terms.add(w)
        added += 1
      }
    }
  }
  for (const group of SYNONYM_GROUPS) {
    if (group.some((g) => raw.includes(g))) for (const g of group) terms.add(g)
  }
  const list = [...terms].filter((t) => t.length >= 2)
  list.sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  return list.slice(0, MAX_TERMS_PER_CLAUSE)
}

// ------------------------------ 打分与选块 ------------------------------

/** 归一化：PDF 表格提取件的字符间空格与竖线（「采 | 购 | 人」）先去掉，否则关键词系统性漏命中 */
function normalizeText(text: string): string {
  return String(text ?? "").replace(/[\s|｜]/g, "")
}

/** 词频打分：命中次数封顶 MAX_HITS_PER_TERM，长词权重 2，标题命中另加 5；idf 压低泛词 */
export function scoreBidChunk(normChunk: string, normHeading: string, terms: readonly string[], idf: (term: string) => number): number {
  let score = 0
  for (const term of terms) {
    const key = normalizeText(term)
    if (key.length < 2) continue
    const hits = countOccurrences(normChunk, key)
    if (hits) score += Math.min(hits, MAX_HITS_PER_TERM) * (key.length >= 3 ? 2 : 1) * idf(term)
    if (normHeading.includes(key)) score += 5 * idf(term)
  }
  return score
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0
  let at = haystack.indexOf(needle)
  while (at >= 0) {
    n += 1
    if (n >= 32) break
    at = haystack.indexOf(needle, at + needle.length)
  }
  return n
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** 首尾对半截断（检索无命中时的兜底素材，与招标侧同口径） */
const MIDDLE_MARKER = "[中间内容因篇幅限制省略]"
function truncateHeadTail(text: string, budget: number): string {
  if (text.length <= budget) return text
  const half = Math.floor(budget / 2)
  return `${text.slice(0, half)}\n\n${MIDDLE_MARKER}\n\n${text.slice(-half)}`
}

function normalizeClauses(clauses: readonly BidClauseInput[]): { ref: string; text: string }[] {
  const out: { ref: string; text: string }[] = []
  ;(clauses ?? []).forEach((c, i) => {
    const text = (typeof c === "string" ? c : (c?.text ?? "")).trim()
    if (!text) return
    const id = (typeof c === "string" ? "" : (c?.id ?? "")).trim()
    out.push({ ref: id || String(i + 1), text })
  })
  return out
}

const MODE_LABEL: Record<BidVisibilityReport["mode"], string> = {
  full: "全文完整注入（未截断）",
  retrieval: "按条款定向检索注入（未注入全文）",
  truncated: "按条款检索无命中，改注入首尾节选（未注入全文）",
}

/** 程序侧【输入可见性】说明块：进 user 消息，模型只读不改（提示词契约要求原样遵守） */
function buildNote(report: BidVisibilityReport, clauses: readonly ClauseVisibility[]): string {
  const head =
    `【输入可见性｜程序生成，非模型推断】投标正文全文 ${report.input_chars} 字，共 ${report.total_chapters} 章 / ${report.total_chunks} 段；` +
    `本次注入方式：${MODE_LABEL[report.mode]}。`
  if (report.mode === "full") return `${head}\n输入完整：是（全部正文已在下方给出）。`
  const injected = Math.max(0, report.input_chars - report.omitted_chars)
  const lines = [
    head,
    `输入完整：否——本次注入 ${report.selected_chunks} 段共约 ${injected} 字，覆盖 ${
      report.covered_chapters.length ? report.covered_chapters.join(" / ") : "（无命中片段）"
    }；未注入 ${report.omitted_chars} 字。`,
  ]
  const missed = clauses.filter((c) => !c.hit)
  if (missed.length) {
    lines.push(
      `以下条款在本次注入范围内检索不到对应证据：${missed.map((c) => c.ref).join("、")} —— 这些条款不得判 non_compliant（偏离表不得判「偏离」），` +
        `也不得判 compliant（完全响应），须判 partial（部分响应）并注明「需人工核对未注入部分」。`,
    )
  }
  lines.push("未注入部分不得当作「投标文件中不存在」；结论必须区分「已核对未见」与「本次不可见」。")
  return lines.join("\n")
}

/**
 * 证据包 → 进 user 消息的素材段：可见性说明块 + 正文（空文本给显式占位，避免被当成「文件里没写」）。
 * 三份提示词（单轮废标 / 三轮废标 / 偏离表）逐字共用同一拼装口径，禁止各自拼。
 */
export function bidEvidenceBlock(pack: BidEvidencePack, heading = "投标文件正文"): string {
  const note = String(pack?.note ?? "").trim()
  const body = String(pack?.text ?? "").trim() ? String(pack.text) : "（本次无可注入的投标文件正文）"
  return (note ? note + "\n\n" : "") + "【" + heading + "】\n" + body
}

/**
 * 一行用户可见的可见性说明（进 toast）——「没注入」不得被读成「没风险」，
 * 输出里必须有一处能看出输入其实不完整。
 */
export function describeBidVisibility(pack: BidEvidencePack, label = "本次检查"): string {
  const r = pack.report
  if (r.input_complete) return `${label}：投标正文全文 ${r.input_chars} 字已完整注入模型`
  const injected = Math.max(0, r.input_chars - r.omitted_chars)
  const covered = r.covered_chapters.length ? r.covered_chapters.slice(0, 4).join(" / ") : "（无命中片段）"
  const missed = pack.clauses.filter((c) => !c.hit)
  return (
    `${label}：投标正文 ${r.input_chars} 字（${r.total_chapters} 章 / ${r.total_chunks} 段）本次仅注入 ${r.selected_chunks} 段约 ${injected} 字（覆盖 ${covered}），` +
    `未注入 ${r.omitted_chars} 字` +
    (missed.length ? `；条款 ${missed.map((c) => c.ref).join("、")} 无可见证据，已降级为待人工核对` : "")
  )
}

/**
 * 投标正文 → 证据包（唯一入口，废标核销矩阵与偏离表共用）：
 *   - 全文 ≤ 预算：mode=full，text 为原文逐字（不做任何裁剪），input_complete=true；
 *   - 超预算：分块 + 按条款轮转定向检索，注入片段带来源标头，未覆盖范围写进 note/warnings；
 *   - 全条款无命中：mode=truncated，回退首尾节选并全部标 hit=false。
 * 纯函数、可重复：同一输入必得同一输出（无时间/随机依赖）。
 */
export function selectBidEvidence(
  text: string,
  clauses: readonly BidClauseInput[],
  budget: number = BID_VISIBILITY_BUDGET_CHARS,
): BidEvidencePack {
  const src = String(text ?? "").trim()
  const normalized = normalizeClauses(clauses)
  const clausesOut: ClauseVisibility[] = normalized.map((c, i) => ({
    clause: c.text,
    ref: c.ref,
    index: i + 1,
    hit: true,
    score: 0,
    sources: [],
  }))

  if (!src) {
    const report: BidVisibilityReport = {
      input_chars: 0,
      mode: "full",
      input_complete: true,
      total_chapters: 0,
      total_chunks: 0,
      selected_chunks: 0,
      covered_chapters: [],
      omitted_chars: 0,
      clause_total: clausesOut.length,
      clause_hit: clausesOut.length,
      warnings: [],
    }
    return { report, text: "", note: "", clauses: clausesOut }
  }

  const chunks = chunkBidText(src)
  const allChapterRefs = uniqueInOrder(chunks.map((c) => c.chapter_ref))

  if (src.length <= budget) {
    const report: BidVisibilityReport = {
      input_chars: src.length,
      mode: "full",
      input_complete: true,
      total_chapters: allChapterRefs.length,
      total_chunks: chunks.length,
      selected_chunks: chunks.length,
      covered_chapters: allChapterRefs,
      omitted_chars: 0,
      clause_total: clausesOut.length,
      clause_hit: clausesOut.length,
      warnings: [],
    }
    return { report, text: src, note: buildNote(report, clausesOut), clauses: clausesOut }
  }

  // --- 超预算：分块 + 按条款轮转定向检索 ---
  const perClauseTerms = normalized.map((c) => deriveClauseTerms(c.text))
  const union: string[] = []
  const unionSeen = new Set<string>()
  for (const terms of perClauseTerms) {
    for (const t of terms) {
      if (unionSeen.has(t)) continue
      unionSeen.add(t)
      union.push(t)
      if (union.length >= MAX_UNION_TERMS) break
    }
    if (union.length >= MAX_UNION_TERMS) break
  }
  const normChunks = chunks.map((c) => normalizeText(c.text))
  const normHeadings = chunks.map((c) => normalizeText(c.heading))
  const df = new Map<string, number>()
  for (const t of union) {
    const key = normalizeText(t)
    if (key.length < 2) continue
    let n = 0
    for (const body of normChunks) if (body.includes(key)) n += 1
    df.set(t, n)
  }
  // 逆文档频率：几乎每块都出现的泛词权重 ≈1，只在少数块出现的关键词权重更高 → 选块不被泛词带偏
  const idf = (term: string): number => 1 + Math.log(chunks.length / (1 + (df.get(term) ?? 0)))

  const scored = perClauseTerms.map((terms) => {
    const rows: { k: number; score: number }[] = []
    chunks.forEach((_, k) => {
      const score = scoreBidChunk(normChunks[k], normHeadings[k], terms, idf)
      if (score > 0) rows.push({ k, score })
    })
    rows.sort((a, b) => b.score - a.score || a.k - b.k)
    return rows
  })

  const selectedScore = new Map<number, number>()
  const tried = normalized.map(() => 0)
  const clauseSources: string[][] = normalized.map(() => [])
  let used = 0
  for (let round = 0; round < BID_MAX_CHUNKS_PER_CLAUSE; round += 1) {
    for (let ci = 0; ci < scored.length; ci += 1) {
      if (selectedScore.size >= BID_MAX_CHUNKS) break
      const rows = scored[ci]
      while (tried[ci] < rows.length) {
        const cand = rows[tried[ci]]
        tried[ci] += 1
        if (selectedScore.has(cand.k)) {
          // 该块已被别的条款选走：同一块可为本条款共用为证据（去重只针对注入，不针对归属）
          clauseSources[ci].push(chunks[cand.k].id)
          continue
        }
        const size = chunks[cand.k].text.length
        if (selectedScore.size > 0 && used + size > budget) {
          tried[ci] = rows.length
          break
        }
        selectedScore.set(cand.k, cand.score)
        clauseSources[ci].push(chunks[cand.k].id)
        used += size
        break
      }
    }
  }

  const selected = [...selectedScore.keys()].sort((a, b) => a - b).map((k) => chunks[k])
  const clausesWithHit = clausesOut.map((c, i) => ({
    ...c,
    hit: selected.length > 0 && clauseSources[i].length > 0,
    score: scored[i][0]?.score ?? 0,
    sources: clauseSources[i],
  }))
  const missedRefs = clausesWithHit.filter((c) => !c.hit).map((c) => c.ref)

  if (!selected.length) {
    // 全条款检索无命中：保守回退首尾节选，且全部条款标 hit=false（一律待人工核对）
    const fallback = truncateHeadTail(src, budget)
    const omitted = Math.max(0, src.length - fallback.replace(MIDDLE_MARKER, "").length)
    const report: BidVisibilityReport = {
      input_chars: src.length,
      mode: "truncated",
      input_complete: false,
      total_chapters: allChapterRefs.length,
      total_chunks: chunks.length,
      selected_chunks: 0,
      covered_chapters: [],
      omitted_chars: omitted,
      clause_total: clausesOut.length,
      clause_hit: 0,
      warnings: [
        "按条款检索无命中：已回退首尾节选注入",
        missedRefs.length ? `条款 ${missedRefs.join("、")} 本次无可见证据：一律降级为待人工核对` : "",
      ].filter(Boolean),
    }
    const all = clausesWithHit.map((c) => ({ ...c, hit: false }))
    return { report, text: fallback, note: buildNote(report, all), clauses: all }
  }

  const text2 = selected.map((chunk, i) => `【投标签片段 ${i + 1}/${selected.length} · 来源：${chunk.id}】\n${chunk.text}`).join("\n\n")
  const covered = uniqueInOrder(selected.map((c) => c.chapter_ref))
  const report: BidVisibilityReport = {
    input_chars: src.length,
    mode: "retrieval",
    input_complete: false,
    total_chapters: allChapterRefs.length,
    total_chunks: chunks.length,
    selected_chunks: selected.length,
    covered_chapters: covered,
    omitted_chars: Math.max(0, src.length - used),
    clause_total: clausesOut.length,
    clause_hit: clausesWithHit.filter((c) => c.hit).length,
    warnings: [
      `输入未完整覆盖：共 ${chunks.length} 段（${src.length} 字），本次仅注入 ${selected.length} 段（约 ${used} 字）`,
      missedRefs.length ? `条款 ${missedRefs.join("、")} 本次无可见证据：一律降级为待人工核对` : "",
    ].filter(Boolean),
  }
  return { report, text: text2, note: buildNote(report, clausesWithHit), clauses: clausesWithHit }
}
