// ---------------------------------------------------------------------------
// REQ-026（2026-10-17）：超长顿号清单 → 分行条目（纯本地、零 AI、零失真）
//
// 【为什么需要它】
// REQ-025 已把「多句拼成的长段落」按句号拆开（608 → 61），但剩下的 61 段拆不动：
// 它们**本身就是一句话**，一句话里塞了几十个顿号并列的系统名/功能名。
// 这是生成时把「本该做成清单的内容」写成了散文，换行解决不了，因为句子还没结束。
//
// 【判据来自真实语料，不是我的偏好】
// 2026-10-17 实测（60 份真实标书 / 226.6 万字 vs 用户 44.6 万字 AI 稿）：
//   同一判据（单句 ≥260 字 + 顿号项 ≥6 + 并列项短 ≤28 字占比 ≥70%）
//     · 真实标书命中 11 处 / 226.6 万字 = 每万字 0.049
//     · AI 稿   命中 55 处 /  44.6 万字 = 每万字 1.232  → **25 倍差**
//   真实标书里命中的那几处，多为「招标文件」本身在罗列设备清单——
//   也就是连真实文本都很少这么写；投标文件正文更不该这么写。
//
// 【为什么不做「引导语 + 编号条目」】
// 2026-10-17 实测 69 条命中的清单句：以冒号结尾的引导语 **0 条**，
// 带「包括/如下/涵盖」类标记词 **0 条**，第一段就是第一个条目本身
// （「实验室信息系统」7 字）或「引导语与第一个条目粘死」（「本项目需完成新系统与实验室信息系统」17 字），
// 中间没有任何标点可依。**靠猜引导语边界必然切出半句话**，故放弃该形态。
//
// 【采用的形态：把可切的顿号换成换行，仅此而已】
//   · 不加编号：用户书写要求「有序列表只用于步骤、流程、时间顺序」，
//     罗列系统名不是步骤，编号反而违规；且编号要新增字符。
//   · 不新增任何字符：唯一变化是「顿号 → 换行」。可证：
//     把输出的各行用「、」拼回去，与原句逐字相同。
//   · 一行 = 一个 Word 段落（bidFiles 导出器按 \n 切行），落地就是「每项一行」。
//
// 【安全边界：宁可漏改，不可错改】
//   ① 只处理**单句**（不跨句），且句子必须够长（ENUM_MIN_SENT_CHARS）——短清单本来就好读；
//   ② 并列项必须「短」（≤ENUM_ITEM_MAX_CHARS）才是名词罗列；有长项说明是复句，不动；
//   ③ 不碰表格行（含全角空格/竖线分隔）、已有编号行、标题行、图位锚点行、围栏行；
//   ④ 括号内的顿号不切（「（含高质量数据集）」是同一项的说明）；
//   ⑤ 转换后必须能**逐字还原**，不满足则整句放弃。
// ---------------------------------------------------------------------------

/** 触发转换的最小单句字数（字）。低于此值不处理——短清单不影响观感。 */
export const ENUM_MIN_SENT_CHARS = 260

/** 视为「名词罗列」的单个并列项最大长度（字，**去掉括注后计**）。
 *
 *  阈值怎么定的（2026-10-17 实测，判据敏感性扫描）：
 *    项长上限 | 真实标书(每万字) | AI 稿(每万字) | 倍差 | 真实误报数
 *    ---------|------------------|--------------|------|------------
 *    ≤28      | 0.053            | 0.134        | 2.5× | 12
 *    ≤35      | 0.066            | 0.402        | 6.1× | 15   ← 区分度最好
 *    ≤45      | 0.102            | 0.781        | 7.7× | 23
 *    ≤60      | 0.110            | 1.116        | 10.1×| 25
 *  取 35：倍差最大而真实标书只多 3 处。**不要为了多转换而调大它**——
 *  实测 78 条候选里，去掉括注后最长项 >36 字的有 60 条，那些是真复句（最长 179 字），
 *  切了就是半句话。本模块的定位是「宁可漏改，不可错改」。 */
export const ENUM_ITEM_MAX_CHARS = 35

/** 最少并列项数。少于此值的顿号是正常行文（「设备、网络、数据库」）。 */
export const ENUM_MIN_ITEMS = 6

/** 行级排除：这些行不是散文正文，不得改 */
const NON_PROSE_LINE_RE: RegExp[] = [
  /^【图[:：]/, // 图位锚点（导出器按标题精确匹配，改了图就丢）
  /^【表[:：]/, // 表位锚点
  /^```/, // 围栏块
  /^[|｜]/, // markdown 表格行
  /\u3000/, // 全角空格分列 = 纯文本表格行（导出器据此建 docx Table）
  /^\s*第\s*\d+\s*[章节]/, // 已是章/节标题行
  /^\s*\d+(?:\.\d+)+\s*\S/, // 已是 N.M 编号标题行
]

function isNonProseLine(line: string): boolean {
  return NON_PROSE_LINE_RE.some((re) => re.test(line))
}

/** 括号深度（全角与半角都算）。顿号在括号内时不切。 */
function bracketDepthAt(s: string, upto: number): number {
  let d = 0
  for (let i = 0; i < upto; i++) {
    const c = s[i]
    if (c === "（" || c === "(") d++
    else if (c === "）" || c === ")") d = Math.max(0, d - 1)
  }
  return d
}

/** 在句子内部找可切分的顿号下标（括号内的不算） */
export function findSplittableDunhao(sentence: string): number[] {
  const idx: number[] = []
  for (let i = 0; i < sentence.length; i++) {
    if (sentence[i] !== "、") continue
    if (bracketDepthAt(sentence, i) !== 0) continue
    idx.push(i)
  }
  return idx
}

/**
 * 单句转换：把超长顿号清单句拆成多行（一行一项）。
 * 不能安全转换时返回 null（调用方原样保留）。
 *
 * @param sentence 已去掉首尾空白的单句（可含句末标点）
 * @returns 各行文本（不含换行符），拼回「、」即原句
 */
export function listifySentence(sentence: string): string[] | null {
  const s = (sentence ?? "").trim()
  if (s.length < ENUM_MIN_SENT_CHARS) return null

  const cuts = findSplittableDunhao(s)
  if (cuts.length + 1 < ENUM_MIN_ITEMS) return null

  // 按顿号切成各段（不丢任何字符：段与段之间就是那个顿号）
  const segs: string[] = []
  let prev = 0
  for (const c of cuts) {
    segs.push(s.slice(prev, c))
    prev = c + 1
  }
  segs.push(s.slice(prev))

  const items = segs.map((x) => x.trim())
  if (items.length < ENUM_MIN_ITEMS) return null

  // 判据②：并列项必须都是短的（名词罗列）。任一项过长 → 是复句，整句不动。
  // 项长按**去掉括注后**计：括注里的顿号本来就不切，括注里写多长不代表这一项是复句
  //（实测「专病库管理系统（含高质量数据集、随访库）」去括注后只有 7 字，是标准短项）。
  if (items.some((x) => !x || bareLength(x) > ENUM_ITEM_MAX_CHARS)) return null

  // 判据⑤：可逐字还原。用「、」拼回必须与原文一字不差
  if (items.join("、") !== s) return null

  return items
}

/** 去掉括注后的长度（全角与半角括号都去）；括注不参与「是不是短项」的判定 */
export function bareLength(item: string): number {
  return stripParens(item).length
}

/** 去掉全部括号及其内容 */
function stripParens(s: string): string {
  let out = ""
  let depth = 0
  for (const ch of s) {
    if (ch === "（" || ch === "(") {
      depth++
      continue
    }
    if (ch === "）" || ch === ")") {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0) out += ch
  }
  return out.trim()
}

/**
 * 整章正文转换：逐行、逐句处理，只对满足判据的单句做分行。
 * 只把「可切的顿号」换成换行，其余任何字符都不动。
 *
 * @returns converted 修改后的正文；hits 转换的句子数；skipped 命中长度但未达安全条件的句子数（如实上报）
 */
export function listifyEnumeration(content: string): {
  converted: string
  hits: number
  skipped: number
} {
  const src = content ?? ""
  if (!src) return { converted: src, hits: 0, skipped: 0 }

  let hits = 0
  let skipped = 0
  const outLines: string[] = []

  for (const rawLine of src.split("\n")) {
    if (!rawLine.trim() || isNonProseLine(rawLine.trim())) {
      outLines.push(rawLine)
      continue
    }
    const pieces = splitKeepingEnds(rawLine)
    const rebuilt: string[] = []
    let changedHere = false
    for (const piece of pieces) {
      if (piece.trim().length >= ENUM_MIN_SENT_CHARS) {
        const lines = listifySentence(piece.trim())
        if (lines) {
          rebuilt.push(lines.join("\n"))
          hits++
          changedHere = true
          continue
        }
        skipped++
      }
      rebuilt.push(piece)
    }
    outLines.push(changedHere ? rebuilt.join("") : rawLine)
  }

  return { converted: outLines.join("\n"), hits, skipped }
}

/** 按句末标点切句，标点留在句尾（不丢弃任何字符） */
export function splitKeepingEnds(text: string): string[] {
  const out: string[] = []
  let buf = ""
  for (const ch of text) {
    buf += ch
    if (ch === "。" || ch === "！" || ch === "？" || ch === "!" || ch === "?") {
      out.push(buf)
      buf = ""
    }
  }
  if (buf) out.push(buf)
  return out
}
