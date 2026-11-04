/**
 * 解析页「原文定位」的纯函数（只读展示，不改解析结果）。
 *
 * 为什么单独成文件：
 *   解析报告里已经带了两类位置线索——规则扫描的风险项带 1 起行号（L6807），
 *   AI 兜底的风险项只有一句原文摘录（line=0）。用户看到「红 2 条」时最需要的
 *   不是再读一遍结论，而是**回到招标原文那一行自己看一眼**。此前行号只是一段
 *   灰色文字，点不动，等于给了坐标却没给地图。
 *
 *   定位逻辑（行号优先、片段兜底、都找不到就如实说）必须能做到：
 *     · 越界行号不崩，回落到片段检索；
 *     · 片段被裁剪过（带「…」、去掉了引号与空白、原文里被物理换行切断）也能命中；
 *     · 命中后给出上下文窗口，且窗口边界 clamp 在正文内；
 *     · 找不到时返回一句人话，而不是空面板。
 *   这些正是最容易写错、也最容易在重构里被改坏的地方，故抽成零 React 依赖的纯函数。
 */

/** 展示用的一行原文 */
export type OriginalRow = {
  /** 1 起行号 */
  no: number
  /** 原文该行（保留原样，仅去掉行尾空白） */
  text: string
  /** 是否为命中行（高亮用） */
  hit: boolean
}

export type OriginalHit = {
  /** line=按行号命中；excerpt=按片段检索命中；none=不可定位 */
  how: "line" | "excerpt" | "none"
  /** 命中行号（1 起）；none 时为 0 */
  line: number
  /** 上下文窗口（含命中行，1 起、闭区间）；none 时为 0 */
  from: number
  to: number
  rows: OriginalRow[]
  /** 一句人话说明（找不到时说明原因与下一步） */
  note: string
}

/** 片段检索最多向前合并几行（招标原文常被物理换行切断，一条摘录可能横跨 2–4 行） */
const MAX_WRAP_LINES = 4

/** 摘录里会被「裁剪」掉的字符：省略号、各种引号、括号与空白等（只用于比对，不改展示） */
const TRIMMED_CHARS_RE = /[\s…⋯·．.「」『』"“”'‘’《》<>〈〉()（）[\]【】]/g

/** 摘录里表示「此处被裁掉」的省略号（含水平省略号 ⋯，模型输出两种都有） */
const ELLIPSIS_RE = /[…⋯]{1,}|[.·．]{2,}/

/** 归一化一行：去掉排版噪音，只用于比对，不用于展示 */
function normalizeForMatch(s: string): string {
  return (s ?? "").replace(TRIMMED_CHARS_RE, "")
}

/**
 * 把一段可能被裁剪过的摘录拆成若干「片段」。
 * 摘录形如「…（企业名称），从业人员 1 人，营业收入为 1 万元，资产总额为 5 万元…」时，
 * 首尾的点是被裁掉的位置，中间才是真文本；用最长的那个片段当检索针，命中率最高。
 */
function segmentsOf(excerpt: string): string[] {
  return (excerpt ?? "")
    .split(ELLIPSIS_RE)
    .map((s) => normalizeForMatch(s))
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length)
}

/** 行号 → 下标（0 起），越界返回 -1 */
function toIndex(line: number, total: number): number {
  if (!Number.isFinite(line) || line < 1 || line > total) return -1
  return line - 1
}

function buildHit(input: {
  how: OriginalHit["how"]
  line: number
  lines: string[]
  context: number
  note: string
}): OriginalHit {
  const { lines, context } = input
  if (input.how === "none" || input.line <= 0) {
    return { how: "none", line: 0, from: 0, to: 0, rows: [], note: input.note }
  }
  const hitIdx = input.line - 1
  const from = Math.max(0, hitIdx - Math.max(0, context))
  const to = Math.min(lines.length - 1, hitIdx + Math.max(0, context))
  const rows: OriginalRow[] = []
  for (let i = from; i <= to; i++) {
    rows.push({ no: i + 1, text: (lines[i] ?? "").replace(/\s+$/, ""), hit: i === hitIdx })
  }
  return { how: input.how, line: input.line, from: from + 1, to: to + 1, rows, note: input.note }
}

/**
 * 在招标原文里定位一处引用。
 *
 * @param text     招标文件全文（可以是空串）
 * @param opts.line    解析/扫描给出的 1 起行号；0 或缺省表示没有行号
 * @param opts.excerpt 原文摘录（可被裁剪、可被换行切断）；行号不可用时用它检索
 * @param opts.context 命中行上下各展示几行（默认 2）
 */
export function locateOriginal(
  text: string | null | undefined,
  opts: { line?: number; excerpt?: string; context?: number } = {},
): OriginalHit {
  const raw = String(text ?? "")
  const lines = raw.split(/\r?\n/)
  const context = Math.max(0, Math.min(opts.context ?? 2, 10))
  const total = lines.length

  if (!raw.trim()) {
    return buildHit({
      how: "none",
      line: 0,
      lines,
      context,
      note: "这份项目没有保留招标原文（或原文已被清空），无法回到原文核对。可在第 1 步重新导入招标文件后再看。",
    })
  }

  // ① 行号优先：扫描器/解析器给的行号是确定位置，直接用
  const idx = toIndex(opts.line ?? 0, total)
  if (idx >= 0) {
    // 行号在范围内但该行是空行（原文分页/空段），向下找最近的非空行，避免高亮一片空白
    let at = idx
    if (!(lines[at] ?? "").trim()) {
      for (let d = 1; d < total; d++) {
        const down = idx + d
        const up = idx - d
        if (down < total && (lines[down] ?? "").trim()) {
          at = down
          break
        }
        if (up >= 0 && (lines[up] ?? "").trim()) {
          at = up
          break
        }
      }
    }
    return buildHit({
      how: "line",
      line: at + 1,
      lines,
      context,
      note: `已定位到原文第 ${at + 1} 行（按解析时的行号）。请对照这一行核实结论。`,
    })
  }

  // ② 行号缺失/越界 → 用摘录在原文里检索（本地字符串比对，不联网、不调模型）
  const segments = segmentsOf(opts.excerpt ?? "")
  if (segments.length) {
    const normalizedLines = lines.map((l) => normalizeForMatch(l))
    for (const needle of segments) {
      // ②a 单行命中
      for (let i = 0; i < total; i++) {
        if (normalizedLines[i]!.includes(needle)) {
          return buildHit({
            how: "excerpt",
            line: i + 1,
            lines,
            context,
            note: `这条结论没有行号，已按原文摘录在上面这一行找到（第 ${i + 1} 行）。`,
          })
        }
      }
      // ②b 跨行命中：原文被物理换行切断时，把 2..MAX_WRAP_LINES 行拼起来再比。
      //     注意：必须回算「摘录起点落在哪一行」，否则窗口里前几行也会被算成命中行，
      //     用户会被带偏到无关标题上（这是本模块最早写错的地方，已由单测钉住）。
      for (let i = 0; i < total; i++) {
        const offsets: number[] = []
        let joined = ""
        for (let k = 0; k < MAX_WRAP_LINES && i + k < total; k++) {
          offsets.push(joined.length)
          joined += normalizedLines[i + k]!
        }
        if (!joined) continue
        const at = joined.indexOf(needle)
        if (at < 0) continue
        // 起点落在 offsets 的哪一段：最后一个 offsets[j] <= at
        let lineOffset = 0
        for (let j = offsets.length - 1; j >= 0; j--) {
          if (offsets[j]! <= at) {
            lineOffset = j
            break
          }
        }
        const hitLine = i + lineOffset + 1
        return buildHit({
          how: "excerpt",
          line: hitLine,
          lines,
          context: Math.max(context, 1),
          note: `这条结论没有行号，已按原文摘录在第 ${hitLine} 行起找到（原文在此处换行）。`,
        })
      }
    }
  }

  return buildHit({
    how: "none",
    line: 0,
    lines,
    context,
    note: opts.line
      ? `解析时记录的是第 ${opts.line} 行，但当前招标原文只有 ${total} 行——原文可能重新导入或被替换过，按行号已对不上；按摘录也没找到，请手动在原文里搜索关键词。`
      : "这条结论是模型语义提示，没有行号，且它的原文摘录在当前招标文件里没有逐字命中（可能已被改写或该段未导入）。请手动在原文里搜索关键词核实。",
  })
}
