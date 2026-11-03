// ---------------------------------------------------------------------------
// 段落切分与 source_anchor（2026-10-30 知识库治理 P0-3）
//
// 依据《知识库改造需求文档 v1.0》§附录 C Step 3 + §4.2 source_anchor 定义：
//   anchor 格式 `p{段落号}-c{起}-{止}`，用于「3 次点击回到原文对应段落并高亮」。
//
// 为什么不能只存段落号：kb_docs.content 是纯文本，同一段落内可能只有一句话是证据，
// 存字符区间才能精确高亮。段落号用于人读（"段落 12"），字符区间用于程序高亮。
//
// 切分策略（与文档伪代码一致但更稳健）：
//   · 优先按空行切段；没有空行的中文文档按「。！？」+ 换行切
//   · 段落 < 40 字不参与抽取（太碎，多为页眉页脚/标题残片）
//   · 单段 > 1200 字再按句号切（避免一次塞太多给模型）
//   · anchor 的字符区间基于**原始 content**（不是清理后的文本），保证能回原文定位
// ---------------------------------------------------------------------------

/** 一个可抽取的段落 */
export type ParsedParagraph = {
  /** `p{段落号}-c{起}-{止}` */
  anchor: string
  /** 段落文本（已 trim） */
  text: string
  /** 在原始 content 里的起止字符位置 */
  start: number
  end: number
}

/** 段落最小长度：短于此不参与抽取（§附录 C） */
const MIN_PARA_LEN = 40
/**
 * 段落最大长度：超过则按句切分。
 *
 * 2026-10-30 从 1200 降到 600：单段 1200 字塞给模型抽取时，
 * 中间内容容易被忽略（长上下文注意力衰减），且一条原子 body 只有 300 字上限，
 * 600 字一段既能覆盖一条完整论述，又不会让模型漏读。
 */
const MAX_PARA_LEN = 600

/**
 * 把文档正文切成带 anchor 的段落。
 *
 * @param content kb_docs.content 原文
 * @param opts.minLen 段落最小字数（默认 40）
 */
export function splitWithAnchor(content: string, opts?: { minLen?: number }): ParsedParagraph[] {
  const text = String(content ?? "")
  if (!text.trim()) return []
  const minLen = Math.max(1, opts?.minLen ?? MIN_PARA_LEN)

  // 1) 先按空行切（最可靠：绝大多数 docx→txt 保留段间空行）
  const rawSegments: { text: string; start: number }[] = []
  const blankLineRe = /\n\s*\n/g
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = blankLineRe.exec(text)) !== null) {
    const seg = text.slice(cursor, m.index)
    if (seg.trim()) rawSegments.push({ text: seg, start: cursor })
    cursor = m.index + m[0].length
  }
  const tail = text.slice(cursor)
  if (tail.trim()) rawSegments.push({ text: tail, start: cursor })

/**
 * 把文本按「句子」累积合并成目标长度的块。
 *
 * 2026-10-30 修复的真实缺陷：按句切分后若每句单独成段（中文一句约 20-30 字），
 * 会全部低于 MIN_PARA_LEN(40) 被过滤掉 → 长文档切出 0 段，抽取直接没素材。
 * 正确做法是**累积多句**直到接近目标长度再成段。
 */
function packSentences(text: string, baseStart: number, targetLen: number): { text: string; start: number }[] {
  const sentences: { text: string; start: number }[] = []
  const re = /[^。！？!?\n]+[。！？!?]?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) sentences.push({ text: m[0], start: baseStart + m.index })
    if (m.index === re.lastIndex) break
  }
  const out: { text: string; start: number }[] = []
  let buf = ""
  let bufStart = 0
  for (const s of sentences) {
    if (!buf) bufStart = s.start
    if (buf && buf.length + s.text.length > targetLen) {
      out.push({ text: buf, start: bufStart })
      buf = s.text
      bufStart = s.start
    } else {
      buf += s.text
    }
  }
  if (buf) out.push({ text: buf, start: bufStart })
  return out
}

  // 2) 若切出的段太少（1-2 段）且整体偏长，说明原文没有空行分隔：
  //    中文文档常见"整篇一个段"。此时按行切；仍不行则按**句子累积**切。
  if (rawSegments.length <= 2 && text.length > MAX_PARA_LEN) {
    rawSegments.length = 0
    const lineRe = /[^\n]+\n?/g
    let lm: RegExpExecArray | null
    while ((lm = lineRe.exec(text)) !== null) {
      if (lm[0].trim()) rawSegments.push({ text: lm[0], start: lm.index })
      if (lm.index === lineRe.lastIndex) break
    }
    // 仍只有 1 段（整篇无换行）→ 按句子累积合并（关键：不能一句一段）
    if (rawSegments.length <= 1) {
      rawSegments.length = 0
      rawSegments.push(...packSentences(text, 0, 400))
    }
  }

  // 2b) 单段仍超长（如整段无句号的表格/清单）→ 强制按长度硬切，
  //     否则会有一条 3000 字的"段落"塞给模型，抽取质量极差。
  for (let i = 0; i < rawSegments.length; i += 1) {
    const seg = rawSegments[i]
    if (seg.text.trim().length <= MAX_PARA_LEN) continue
    const pieces: { text: string; start: number }[] = []
    const body = seg.text
    let off = 0
    while (off < body.length) {
      pieces.push({ text: body.slice(off, off + MAX_PARA_LEN), start: seg.start + off })
      off += MAX_PARA_LEN
    }
    rawSegments.splice(i, 1, ...pieces)
    i += pieces.length - 1
  }

  // 3) 逐段处理：trim 后定位真实起止、超长再拆、过短丢弃
  const out: ParsedParagraph[] = []
  for (const seg of rawSegments) {
    const raw = seg.text
    const leading = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (!trimmed) continue
    const absStart = seg.start + leading
    const absEnd = absStart + trimmed.length

    if (trimmed.length <= MAX_PARA_LEN) {
      if (trimmed.length >= minLen) {
        out.push({ anchor: `p${out.length + 1}-c${absStart}-${absEnd}`, text: trimmed, start: absStart, end: absEnd })
      }
      continue
    }

    // 超长段：按句号切成若干子段（双保险——正常情况已被 2b 预切）
    let subStart = absStart
    let buf = ""
    const flushSub = () => {
      const t = buf.trim()
      if (t.length >= minLen) {
        // trim 后起点要加上前导空白偏移，否则高亮区间会偏
        const lead = buf.length - buf.trimStart().length
        const s = subStart + lead
        out.push({ anchor: `p${out.length + 1}-c${s}-${s + t.length}`, text: t, start: s, end: s + t.length })
      }
    }
    for (const sent of trimmed.match(/[^。！？!?]+[。！？!?]?/g) ?? [trimmed]) {
      if (buf.length + sent.length > 800 && buf) {
        flushSub()
        subStart += buf.length
        buf = sent
      } else {
        buf += sent
      }
    }
    flushSub()
  }

  return out
}

// ===========================================================================
// B0 选批打分（§10.3）
// ===========================================================================

export type DocForScoring = {
  title?: string
  folder_path?: string
  content?: string
  updated?: string
  created?: string
  file_bytes?: number
}

/**
 * B0 冷启动优先级打分（§10.3 原式）：
 *   score = 0.40*recency + 0.30*outcome + 0.20*completeness + 0.10*size
 */
export function scoreDocForB0(doc: DocForScoring, now = Date.now()): number {
  // recency：12 个月内 1.0，24 个月内 0.6，更早 0.2
  const ts = Date.parse(doc.updated || doc.created || "")
  let recency = 0.2
  if (Number.isFinite(ts)) {
    const months = (now - ts) / (1000 * 60 * 60 * 24 * 30)
    recency = months <= 12 ? 1.0 : months <= 24 ? 0.6 : 0.2
  }

  // outcome：文件名/路径含中标/成交/合同/终版 → 1.0；含初稿/草稿 → 0.2；其余 0.5
  const name = `${doc.title ?? ""} ${doc.folder_path ?? ""}`
  let outcome = 0.5
  if (/(中标|成交|合同|终版|定稿|正式版)/.test(name)) outcome = 1.0
  else if (/(初稿|草稿|demo|测试|test)/i.test(name)) outcome = 0.2

  // completeness：按字数估页数（约 800 字/页）；20-120 页 → 1.0
  const chars = (doc.content ?? "").length
  const pages = chars / 800
  const completeness = pages >= 20 && pages <= 120 ? 1.0 : pages < 10 ? 0.3 : 0.5

  // size：50KB-5MB → 1.0
  const bytes = doc.file_bytes ?? chars * 2
  const size = bytes >= 50_000 && bytes <= 5_000_000 ? 1.0 : 0.4

  return 0.4 * recency + 0.3 * outcome + 0.2 * completeness + 0.1 * size
}

/** 按 B0 打分排序取前 N 篇（§10.3「按 score 降序取前 300 篇进 B0」） */
export function pickB0<T extends DocForScoring>(docs: T[], n = 300): T[] {
  return docs
    .map((d) => ({ d, score: scoreDocForB0(d) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.d)
}

// ===========================================================================
// 字符级工具：sha256（file_hash，§4.1）
// ===========================================================================

/**
 * 计算文本指纹（SHA-256 hex）。
 *
 * 用途：§4.1 file_hash「识别同一文件重复导入」。
 * 浏览器与 Node 都可用（Web Crypto；Node 18+ 的 globalThis.crypto 同样支持）。
 * 摘要文本失败时退化为长度+首尾采样（保证不抛错阻断入库）。
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input
  try {
    const subtle = globalThis.crypto?.subtle
    if (subtle) {
      const buf = await subtle.digest("SHA-256", data as unknown as ArrayBuffer)
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    }
  } catch {
    /* 降级到下面的简单指纹 */
  }
  // 降级：不是密码学安全，但足以识别"同一文件重复导入"
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < data.length; i += 1) {
    h1 = (h1 ^ data[i]) * 0x01000193
    h2 = (h2 + data[i] * (i + 1)) >>> 0
  }
  return `fallback${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${data.length.toString(16)}`
}
