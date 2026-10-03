// ---------------------------------------------------------------------------
// T15（2026-09-29）字数局部精调（易标 contentGenerationTask 字数调整阶段移植）：
// 生成/治理后仍处预算带外的章/小节，用「局部操作 JSON」做外科手术式增删，替代整段重写：
//  - 操作三态 insert/replace/delete，锚点逐字唯一命中才生效（未命中/多处命中一律跳过）；
//  - 保护区间：代码围栏块与全角空格表格行禁止修改（对齐易标 collectProtectedContentRanges 口径，
//    本项目正文无 markdown 表格/图片，保护面相应收窄）；
//  - 结果校验：方向必须成立（扩写增字/缩写减字）、单轮变化 ≤ maxChangeWords、与目标距离必须收敛；
//  - 粒度：偏离 >20% 走段落级，否则句子级（对齐易标 differenceRatio 阈值）。
// 纯函数零依赖，锚点匹配语义与 runFactPatch 的唯一命中校验一致。
// ---------------------------------------------------------------------------

export type WordAdjustDirection = "expand" | "shrink"
export type WordAdjustGranularity = "paragraph" | "sentence"

export type WordAdjustmentOp =
  | { operation: "insert"; anchor: string; position: "before" | "after"; content: string }
  | { operation: "replace"; target_text: string; content: string }
  | { operation: "delete"; target_text: string }

/** 全角空格表格行（正文表格约定：列间 U+3000 分隔）与代码围栏块属于保护区间 */
const TABLE_LINE_RE = /^[^\n]*\u3000+[^\n]*$/
const FENCED_BLOCK_RE = /```[\s\S]*?```/g

/** 收集保护区间偏移（围栏块整块 + 表格行整行，含行尾换行） */
export function collectProtectedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  for (const m of (text ?? "").matchAll(FENCED_BLOCK_RE)) {
    ranges.push([m.index, m.index + m[0].length])
  }
  for (const m of (text ?? "").matchAll(/[^\n]+\n?/g)) {
    if (TABLE_LINE_RE.test(m[0].replace(/\n$/, ""))) {
      ranges.push([m.index, m.index + m[0].length])
    }
  }
  return ranges
}

function inRanges(index: number, length: number, ranges: [number, number][]): boolean {
  return ranges.some(([s, e]) => index < e && index + length > s)
}

/** 唯一命中定位：未命中 / 多处命中 / 落在保护区间 → -1（调用方跳过该操作） */
export function findUniqueMatch(text: string, target: string): number {
  const t = (target ?? "").trim()
  if (!t) return -1
  const first = text.indexOf(t)
  if (first < 0 || text.lastIndexOf(t) !== first) return -1
  const ranges = collectProtectedRanges(text)
  if (inRanges(first, t.length, ranges)) return -1
  return first
}

function asTrimmed(v: unknown, cap: number): string {
  const s = String(v ?? "").trim()
  return s.slice(0, cap)
}

/**
 * 模型输出的操作清单 → 净化后的安全操作（非法/越界条目丢弃，上限 12 条）。
 * insert 锚点可为空串（视为插到文首）；position 非法归 after；content 必填（delete 除外）。
 */
export function normalizeWordAdjustmentOps(raw: unknown): WordAdjustmentOp[] {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const arr = Array.isArray(raw) ? raw : Array.isArray(rec.operations) ? rec.operations : []
  const out: WordAdjustmentOp[] = []
  for (const it of arr.slice(0, 12)) {
    const r = (it ?? {}) as Record<string, unknown>
    const op = String(r.operation ?? "").trim()
    if (op === "insert") {
      const content = asTrimmed(r.content, 2000)
      if (!content) continue
      out.push({
        operation: "insert",
        anchor: asTrimmed(r.anchor ?? r.target_text, 200),
        position: r.position === "before" ? "before" : "after",
        content,
      })
    } else if (op === "replace") {
      const target = asTrimmed(r.target_text ?? r.anchor, 200)
      const content = asTrimmed(r.content, 2000)
      if (!target || !content || target === content) continue
      out.push({ operation: "replace", target_text: target, content })
    } else if (op === "delete") {
      const target = asTrimmed(r.target_text ?? r.anchor, 200)
      if (!target) continue
      out.push({ operation: "delete", target_text: target })
    }
  }
  return out
}

export type ApplyOpsResult = { text: string; applied: number; skipped: number }

/** 依次应用局部操作（前一条的结果是后一条的输入）；全部跳过时原文原样返回 */
export function applyWordAdjustmentOps(text: string, ops: WordAdjustmentOp[]): ApplyOpsResult {
  let cur = text ?? ""
  let applied = 0
  let skipped = 0
  for (const op of ops) {
    if (op.operation === "insert") {
      const anchor = op.anchor.trim()
      if (!anchor) {
        // 空锚点 = 插到文首（模型未给锚点时的兜底，仅 insert 允许）
        cur = `${op.content}${cur}`
        applied += 1
        continue
      }
      const at = findUniqueMatch(cur, anchor)
      if (at < 0) {
        skipped += 1
        continue
      }
      const pos = at + (op.position === "before" ? 0 : anchor.length)
      cur = `${cur.slice(0, pos)}${op.content}${cur.slice(pos)}`
      applied += 1
    } else if (op.operation === "replace") {
      const at = findUniqueMatch(cur, op.target_text)
      if (at < 0) {
        skipped += 1
        continue
      }
      cur = `${cur.slice(0, at)}${op.content}${cur.slice(at + op.target_text.length)}`
      applied += 1
    } else {
      const at = findUniqueMatch(cur, op.target_text)
      if (at < 0) {
        skipped += 1
        continue
      }
      cur = `${cur.slice(0, at)}${cur.slice(at + op.target_text.length)}`
      applied += 1
    }
  }
  return { text: cur, applied, skipped }
}

/**
 * 单轮结果校验：方向成立 + 变化量受控 + 距目标收敛；违规返回人话原因（进下一轮/放弃），null = 通过。
 * 对齐易标口径：扩写必须增字、缩写必须减字、单轮变化 ≤ maxChangeWords、与目标差距必须缩小。
 */
export function validateAdjustmentResult(input: {
  before: number
  after: number
  direction: WordAdjustDirection
  targetWords: number
  maxChangeWords: number
}): string | null {
  const { before, after, direction, targetWords, maxChangeWords } = input
  const delta = after - before
  if (direction === "expand" && delta <= 0) return "扩写后字数未增加"
  if (direction === "shrink" && delta >= 0) return "缩写后字数未减少"
  if (Math.abs(delta) > maxChangeWords) return `单轮变化 ${Math.abs(delta)} 字超过上限 ${maxChangeWords} 字`
  if (Math.abs(after - targetWords) >= Math.abs(before - targetWords)) return "与目标字数的差距未收敛"
  return null
}

/** 粒度判定（对齐易标 differenceRatio>0.2 走段落级） */
export function adjustGranularity(currentWords: number, targetWords: number): WordAdjustGranularity {
  const target = Math.max(1, targetWords)
  return Math.abs(currentWords - target) / target > 0.2 ? "paragraph" : "sentence"
}

/** 单轮允许的最大变化字数：扩写 ≤目标 40%，缩写 ≤当前 25%（对齐易标 TOTAL_WORD_SHRINK_SECTION_RATIO） */
export function maxChangeWordsFor(direction: WordAdjustDirection, currentWords: number, targetWords: number): number {
  return direction === "expand" ? Math.max(120, Math.round(targetWords * 0.4)) : Math.max(80, Math.round(currentWords * 0.25))
}

/** 字数精调预算带（对齐易标 sectionWords×0.8~1.2 容差带） */
export const WORD_REFINE_LOWER_RATIO = 0.8
export const WORD_REFINE_UPPER_RATIO = 1.2

export type WordRefineTarget = {
  /** 小节下标；-1 = 整章单文本（无 section_stats 的章节） */
  sectionIndex: number
  title: string
  text: string
  chars: number
  targetWords: number
  direction: WordAdjustDirection
}

/**
 * 从章节切片中挑出预算带外的精调候选（按偏离度从大到小排序，上限 maxTargets）。
 * stats 与 sections 对齐（title 相等）才启用小节级；chars=0 的失败片不参与（由生成重试负责）。
 */
export function pickWordRefineTargets(input: {
  content: string
  sections: string[]
  sectionStats: { title: string; chars: number }[] | undefined
  sectionBudget: number
  chapterBudget: number
  maxTargets?: number
}): WordRefineTarget[] {
  const max = Math.max(1, input.maxTargets ?? 4)
  const out: WordRefineTarget[] = []
  const stats = input.sectionStats ?? []
  const aligned = stats.length > 0 && stats.length === input.sections.length && stats.every((s, i) => s.title === input.sections[i])
  if (aligned && input.sectionBudget > 0) {
    const pieces = slicePiecesForRefine(input.content, stats)
    stats.forEach((s, i) => {
      const chars = s.chars ?? 0
      if (chars <= 0) return
      const piece = pieces[i] ?? ""
      if (!piece.trim()) return
      const target = input.sectionBudget
      if (chars >= target * WORD_REFINE_LOWER_RATIO && chars <= target * WORD_REFINE_UPPER_RATIO) return
      out.push({
        sectionIndex: i,
        title: input.sections[i] ?? s.title,
        text: piece,
        chars,
        targetWords: target,
        direction: chars < target ? "expand" : "shrink",
      })
    })
  } else if (input.chapterBudget > 0) {
    const chars = (input.content ?? "").length
    if (chars > 0 && (chars < input.chapterBudget * WORD_REFINE_LOWER_RATIO || chars > input.chapterBudget * WORD_REFINE_UPPER_RATIO)) {
      out.push({
        sectionIndex: -1,
        title: "",
        text: input.content ?? "",
        chars,
        targetWords: input.chapterBudget,
        direction: chars < input.chapterBudget ? "expand" : "shrink",
      })
    }
  }
  return out
    .sort((a, b) => Math.abs(b.chars - b.targetWords) / b.targetWords - Math.abs(a.chars - a.targetWords) / a.targetWords)
    .slice(0, max)
}

/** 与 bidTypes.sliceSectionPieces 同口径的切片（此处独立实现避免 wordAdjust 反向依赖 bidTypes 大模块） */
function slicePiecesForRefine(content: string, stats: { title: string; chars: number }[]): string[] {
  const src = content ?? ""
  let lastNonEmpty = -1
  for (let i = stats.length - 1; i >= 0; i--) {
    if ((stats[i]?.chars ?? 0) > 0) {
      lastNonEmpty = i
      break
    }
  }
  const pieces: string[] = []
  let pos = 0
  for (let i = 0; i < stats.length; i++) {
    const len = Math.max(0, Math.round(stats[i]?.chars ?? 0))
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
