// ---------------------------------------------------------------------------
// PPT 参考素材：解析 → 分块 → 检索 → sourceRefs 追溯（2026-10-30 阶段 2）
//
// 为什么需要：
//   原实现把素材全文塞进提示词（`materialText`），带来三个问题：
//     ① 长素材（几十万字标书）根本塞不下，只能截断 → 关键事实丢失；
//     ② 模型分不清"哪句来自素材、哪句是自己编的" → 编造温床；
//     ③ 用户无法核验"这页内容凭什么这么说"。
//
//   本模块做三件事：
//     ① **分块**：把长文档切成带稳定 id 的语义块（按段落/标题聚合，~400 字一块）；
//     ② **检索**：逐页生成时只取与"标题+意图"最相关的 topK 片段，不塞全文；
//     ③ **追溯**：每块带 materialName / 位置信息，写进 slide.sourceRefs 供界面展示。
//
// 设计原则：
//   - **纯前端、无副作用**：解析靠既有 bidFiles，索引是内存 Map，不落库（避免污染集合）
//   - **不做语义理解**：检索用词频+标题命中，简单可靠、可测试，不引入向量模型
//   - **冲突不自动裁决**：同一指标在不同素材里数值不同 → 只标记，交用户确认
// ---------------------------------------------------------------------------

import type { SourceRefZ } from "./deckSchema"

// ===========================================================================
// 一、类型
// ===========================================================================

/** 素材种类：内容素材提供事实，视觉素材提供版式/风格（二者不得混用） */
export type MaterialKind = "content" | "visual"

/** 一个素材块 */
export type MaterialChunk = {
  /** 稳定 id：`${materialId}#${index}` */
  id: string
  /** 所属素材 id */
  materialId: string
  /** 素材名（文件名或方案/标书名） */
  materialName: string
  /** 块序号（从 0 起，便于展示"第 N 段"） */
  index: number
  /** 块文本（≤600 字） */
  text: string
  /** 命中的小节标题（若能识别） */
  heading?: string
}

/** 一份素材 */
export type MaterialDoc = {
  id: string
  name: string
  kind: MaterialKind
  /** 解析出的全文（仅内存保留，供分块与调试） */
  text: string
  /** 分块结果 */
  chunks: MaterialChunk[]
  /** 解析警告（如 PDF 为扫描件、只提取到少量文字） */
  warnings: string[]
  /** 字数 */
  charCount: number
}

/** 素材库：多份素材 + 检索索引 */
export type MaterialLibrary = {
  docs: MaterialDoc[]
  /** 倒排索引：词 → chunk id 集合（内存构建，不持久化） */
  index: Map<string, Set<string>>
  /** chunk id → chunk 引用 */
  chunkById: Map<string, MaterialChunk>
}

// ===========================================================================
// 二、解析
// ===========================================================================

/** 单个素材最大解析字数（超出截断并告警，避免内存打爆） */
const MAX_CHARS_PER_DOC = 400_000
/** 单块目标字数 */
const CHUNK_TARGET = 400
/** 单块上限字数 */
const CHUNK_MAX = 600

let seq = 0
function nextMaterialId(): string {
  seq += 1
  return `m${Date.now().toString(36)}${seq.toString(36)}`
}

/**
 * 解析单个文件为素材。
 * 复用 bidFiles 的 extractTenderFileText（docx/pdf/txt/md）；
 * xlsx 走懒加载的 SheetJS（只取单元格文本，不做结构推断）。
 */
export async function parseMaterialFile(file: File, kind: MaterialKind = "content"): Promise<MaterialDoc> {
  const lower = file.name.toLowerCase()
  const warnings: string[] = []

  // 按扩展名选解析器（每种分支都必然赋值，故用表达式而非 let 初值 + 覆盖）
  const text =
    lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")
      ? await readSpreadsheetText(file)
      : lower.endsWith(".pptx")
        ? await readPptxText(file)
        : await (await import("@/pages/BidWorkspace/bidFiles")).extractTenderFileText(file)
  const normalized = normalizeWhitespace(text)
  let finalText = normalized
  if (normalized.length > MAX_CHARS_PER_DOC) {
    warnings.push(`素材较长（${normalized.length} 字），已截取前 ${MAX_CHARS_PER_DOC} 字用于生成`)
    finalText = normalized.slice(0, MAX_CHARS_PER_DOC)
  }
  if (finalText.length < 50) {
    warnings.push("提取到的文字很少，可能是扫描件或图片型文档（需 OCR 后才能作为内容素材）")
  }

  const id = nextMaterialId()
  const chunks = chunkText(finalText, id, file.name)
  return { id, name: file.name, kind, text: finalText, chunks, warnings, charCount: finalText.length }
}

/** xlsx/xls/csv → 纯文本（行内以 ` | ` 连接，便于检索与人工阅读） */
async function readSpreadsheetText(file: File): Promise<string> {
  const XLSX = await import("xlsx")
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const parts: string[] = []
  for (const sheetName of wb.SheetNames.slice(0, 10)) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" })
    parts.push(`【工作表 ${sheetName}】`)
    rows.slice(0, 2000).forEach((r) => {
      const line = (r as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean).join(" | ")
      if (line) parts.push(line)
    })
  }
  return parts.join("\n")
}

/** pptx → 纯文本（走 JSZip 解 XML，只取 <a:t> 文本节点） */
async function readPptxText(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate")
  const buf = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(buf)
  const names = Object.keys(entries)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(/slide(\d+)/.exec(a)?.[1] ?? 0)
      const nb = Number(/slide(\d+)/.exec(b)?.[1] ?? 0)
      return na - nb
    })
  const parts: string[] = []
  for (const n of names) {
    const xml = strFromU8(entries[n])
    const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1].trim()).filter(Boolean)
    if (texts.length) parts.push(texts.join(" "))
  }
  return parts.join("\n")
}

/** 压掉多余空白但保留段落换行 */
function normalizeWhitespace(s: string): string {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ===========================================================================
// 三、分块
// ===========================================================================

/** 识别小节标题（数字编号开头、或全角括号章节） */
function looksLikeHeading(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 40) return false
  return /^(第[一二三四五六七八九十]+[章节部分]|[一二三四五六七八九十]+[、.]|\d+(\.\d+)*[、.\s])/.test(t)
}

/**
 * 文本分块：按段落聚合到 ~400 字，识别到小节标题时另起一块并把标题记入 heading。
 * 这样一页 PPT 能引用"可研报告 · 第三章 现状分析"而不是笼统的"可研报告"。
 */
export function chunkText(text: string, materialId: string, materialName: string): MaterialChunk[] {
  const lines = String(text ?? "").split("\n")
  const chunks: MaterialChunk[] = []
  let buf: string[] = []
  let bufLen = 0
  let heading: string | undefined

  const flush = () => {
    const body = buf.join("\n").trim()
    if (!body) {
      buf = []
      bufLen = 0
      return
    }
    chunks.push({
      id: `${materialId}#${chunks.length}`,
      materialId,
      materialName,
      index: chunks.length,
      text: body.slice(0, CHUNK_MAX),
      ...(heading ? { heading } : {}),
    })
    buf = []
    bufLen = 0
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (looksLikeHeading(line)) {
      // 标题另起一块（避免标题被埋在大段中间，检索时命中不到）
      flush()
      heading = line.slice(0, 40)
      buf.push(line)
      bufLen = line.length
      continue
    }
    buf.push(line)
    bufLen += line.length
    if (bufLen >= CHUNK_TARGET) flush()
  }
  flush()
  return chunks
}

// ===========================================================================
// 四、索引与检索
// ===========================================================================

/** 中文按 2-gram、英文/数字按词切，用于倒排索引 */
function tokenize(text: string): string[] {
  const out: string[] = []
  const s = String(text ?? "").toLowerCase()
  // 英文/数字词
  for (const m of s.matchAll(/[a-z0-9]{2,}/g)) out.push(m[0])
  // 中文 2-gram（去掉标点空白后连续汉字切片）
  for (const seg of s.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const w = seg[0]
    for (let i = 0; i + 1 < w.length; i += 1) out.push(w.slice(i, i + 2))
  }
  return out
}

/** 建立素材库 + 倒排索引 */
export function buildLibrary(docs: MaterialDoc[]): MaterialLibrary {
  const chunkById = new Map<string, MaterialChunk>()
  const index = new Map<string, Set<string>>()
  for (const d of docs) {
    for (const c of d.chunks) {
      chunkById.set(c.id, c)
      for (const tk of tokenize(`${c.heading ?? ""} ${c.text}`)) {
        let set = index.get(tk)
        if (!set) {
          set = new Set()
          index.set(tk, set)
        }
        set.add(c.id)
      }
    }
  }
  return { docs, index, chunkById }
}

/**
 * 检索与 query 最相关的块。
 *
 * 打分 = 命中词数（少量加权标题命中）。
 * 只返回 content 类素材（视觉素材不参与内容检索——需求明确要求"不得混用"）。
 */
export function searchChunks(
  lib: MaterialLibrary,
  query: string,
  opts?: { topK?: number; minScore?: number },
): MaterialChunk[] {
  const topK = Math.max(1, opts?.topK ?? 6)
  const minScore = opts?.minScore ?? 2
  const visualIds = new Set(lib.docs.filter((d) => d.kind === "visual").map((d) => d.id))
  const scores = new Map<string, number>()
  for (const tk of tokenize(query)) {
    const ids = lib.index.get(tk)
    if (!ids) continue
    for (const id of ids) {
      const chunk = lib.chunkById.get(id)
      if (!chunk || visualIds.has(chunk.materialId)) continue
      const bonus = chunk.heading && chunk.heading.includes(tk) ? 2 : 0
      scores.set(id, (scores.get(id) ?? 0) + 1 + bonus)
    }
  }
  return Array.from(scores.entries())
    .filter(([, s]) => s >= minScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => lib.chunkById.get(id))
    .filter((c): c is MaterialChunk => Boolean(c))
}

/** 为某一页（标题+意图）检索素材，转成 sourceRefs */
export function refsForSlide(lib: MaterialLibrary, title: string, intent: string, topK = 3): SourceRefZ[] {
  const chunks = searchChunks(lib, `${title} ${intent}`, { topK })
  return chunks.map((c) => ({
    chunkId: c.id,
    materialName: c.heading ? `${c.materialName} · ${c.heading}` : c.materialName,
    excerpt: c.text.slice(0, 240),
    kind: "content" as const,
  }))
}

// ===========================================================================
// 五、数据冲突检测
// ===========================================================================

export type ConflictHit = {
  /** 指标名（如"门诊量"） */
  metric: string
  /** 出现过的值（去重） */
  values: string[]
  /** 涉及片段 */
  refs: { chunkId: string; materialName: string; excerpt: string }[]
}

/**
 * 指标同义词归组：把"编制床位/开放床位/床位数"视为同一指标。
 *
 * 2026-10-30 实测修正：原来每个词独立统计，导致「编制床位 300」与「开放床位 320」
 * 被当成两个不同指标，真正的冲突反而漏报。
 * 归组原则：同一业务含义的不同叫法合并（但"编制"与"开放"在业务上确有差异，
 * 因此**仍会报冲突**，只是提示文案会带上各自口径，由用户判断该用哪个）。
 */
const METRIC_GROUPS: { group: string; words: string[] }[] = [
  { group: "床位", words: ["床位数", "编制床位", "开放床位", "实际开放床位", "床位"] },
  { group: "门诊量", words: ["年门诊量", "门诊量", "门诊人次", "年门急诊量", "门急诊人次"] },
  { group: "住院量", words: ["年住院量", "住院量", "出院人次", "住院人次"] },
  { group: "手术量", words: ["年手术量", "手术量", "手术台次"] },
  { group: "收入", words: ["年收入", "总收入", "医疗收入", "业务收入"] },
  { group: "投资", words: ["投资", "投资额", "总投资", "预算", "建设投资"] },
  { group: "面积", words: ["建筑面积", "总建筑面积", "占地面积"] },
  { group: "人数", words: ["职工人数", "在职职工", "员工人数", "卫技人员"] },
]

/** 词 → 所属指标组 */
const WORD_TO_GROUP = new Map<string, string>()
for (const g of METRIC_GROUPS) for (const w of g.words) WORD_TO_GROUP.set(w, g.group)

/**
 * 冲突检测：同一指标在不同素材/片段里出现不同数值时**只报告不裁决**。
 *
 * 需求明确：素材之间出现数据冲突时不得自行选择，必须提示用户确认。
 */
export function detectConflicts(lib: MaterialLibrary): ConflictHit[] {
  // group → (value → chunks)
  const byGroup = new Map<string, Map<string, MaterialChunk[]>>()
  // group → 出现过的原始指标词（用于提示"到底是编制还是开放"）
  const groupWords = new Map<string, Set<string>>()

  for (const chunk of lib.chunkById.values()) {
    for (const [word, group] of WORD_TO_GROUP) {
      // 用 lookahead 避免短词吞掉长词（"床位"不应命中"编制床位"里的"床位"两次数值）
      const re = new RegExp(`${word}[^\\d]{0,8}(\\d+(?:\\.\\d+)?)\\s*(万|亿|张|人|元|%|平方米|㎡)?`, "g")
      for (const m of chunk.text.matchAll(re)) {
        const value = `${m[1]}${m[2] ?? ""}`
        let valueMap = byGroup.get(group)
        if (!valueMap) {
          valueMap = new Map()
          byGroup.set(group, valueMap)
        }
        const arr = valueMap.get(value) ?? []
        arr.push(chunk)
        valueMap.set(value, arr)
        let ws = groupWords.get(group)
        if (!ws) {
          ws = new Set()
          groupWords.set(group, ws)
        }
        ws.add(word)
      }
    }
  }

  const out: ConflictHit[] = []
  for (const [group, valueMap] of byGroup) {
    if (valueMap.size < 2) continue // 只有一个值，不算冲突
    const words = Array.from(groupWords.get(group) ?? [])
    // 指标名带口径说明，让用户知道冲突是"编制 vs 开放"还是真的同一口径不一致
    const metric = words.length > 1 ? `${group}（${words.join("/")}）` : group
    const refs: ConflictHit["refs"] = []
    for (const arr of valueMap.values()) {
      for (const c of arr.slice(0, 2)) {
        refs.push({ chunkId: c.id, materialName: c.materialName, excerpt: c.text.slice(0, 160) })
      }
    }
    out.push({ metric, values: Array.from(valueMap.keys()), refs: refs.slice(0, 6) })
  }
  return out
}

/** 把素材库统计成一句给用户看的摘要 */
export function librarySummary(lib: MaterialLibrary): string {
  const content = lib.docs.filter((d) => d.kind === "content")
  const visual = lib.docs.filter((d) => d.kind === "visual")
  const chars = content.reduce((n, d) => n + d.charCount, 0)
  return `内容素材 ${content.length} 份（${chars.toLocaleString()} 字，${lib.chunkById.size} 个片段）· 视觉素材 ${visual.length} 份`
}
