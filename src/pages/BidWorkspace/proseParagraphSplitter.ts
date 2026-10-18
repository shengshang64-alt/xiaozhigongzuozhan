// ---------------------------------------------------------------------------
// REQ-025 长段落本地重排（纯字符串、零 AI、零失真）
//
// 为什么不用模型拆段：
//   REQ-023 做过真跑——把超长段交给模型「只断段不改字」，三道校验全过才采纳，
//   但代价是每段一次调用（批量喂 6 段模型只回 2 段，静默丢段），45 万字整本要几百次调用。
//   而长段落这件事**根本不需要理解语义**：段落在哪断，取决于句末标点在哪。
//   纯本地拆段：毫秒级、零成本、字符 100% 守恒、数字一个不动。
//
// 与 paramRewrite.ts 同一设计范式：宁可漏拆，不可拆坏。
//
// 实测（用户 45.1 万字真生成稿 bid_projects d3c35o7axkw34wo）：
//   | 口径                        | 长段落(>300) | 段长中位 |
//   |-----------------------------|--------------|----------|
//   | 拆前                        |    608       |   272    |
//   | 只在 。！？ 切（本实现）     |     61       |   202    |
//   | 连 ； 也切                   |     43       |   207    |
//   差别只有 18 段，但**分号是并列分句的连接符**——「一是…；二是…；三是…」被切到
//   两段里，读者会以为并列项没说完。18 段换一次结构性误拆，不值。故**不切分号**。
//
//   残留 61 段是「单句 >300 字」的枚举句（系统名/功能点罗列，如「新系统与实验室信息
//   系统、输血管理信息系统、…」），换行拆不动——拆开就是半句话。这类只能交给模型
//   改写，故本模块对其**原样返回**并计数上报，绝不硬拆。
// ---------------------------------------------------------------------------

import { isTableRow, LONG_PARAGRAPH_MAX_CHARS } from "./bidProseLinter"

/** 拆段目标上限：超过它才考虑断开（比病灶阈值宽松，避免拆出碎片）。
 *
 *  取 260 而不是 300：拆段是"在够长的段里找切点"，若切点判断用 300 会经常
 *  切出一个 290 字的段（仍然超标却没被算作问题，两侧都不满意）。
 *  260 让每段留出 40 字余量，真实语料实测拆完段长中位 202（真实标书 82-122 区间上方）。 */
const SPLIT_TARGET_MAX = 260

/** 句子切分：**只在句末句号/问号/感叹号处切**。
 *
 *  ⚠️ 两条硬约束，每条都有实测依据：
 *  ① **不含分号**：分号连接并列分句（「一是…；二是…」），在此断开会把并列结构切散。
 *     实测真实稿 1358 处含分号片段，多为「一是/二是/三是」并列链。
 *     变异验证：加上分号后「并列结构不得被切散」用例立刻变红（M1 杀死）。
 *  ② **不要加「后面不能是数字」的保护**（本模块第一版加了 `(?![0-9])`，实测后删除）：
 *     · 原理上它是死条件——切点字符是**中文句号 。**，而小数点是**半角 .**，
 *       「3.5」中间那个点永远不满足 `(?<=[。！？])`，该前瞻既不保护小数、也不保护数字；
 *     · 实测上它还有害——608 个超长段里有 **3 段**因此少断一次
 *       （「…直接衔接。6.4节已明确…」被粘连成一句，本可在此断开）。
 *     删掉是纯收益。真实稿另有 149 处「。」后紧跟编号的形态（「。1.2 统一与特色…」），
 *     它们本来就该是句子边界。
 *  句子按原文顺序原样拼接，**一个字不增、不删、不改**。 */
const SENTENCE_SPLIT_RE = /(?<=[。！？])/u

/** 切出一段的句子数组（不改变任何字符，只按句末标点分割） */
function splitSentences(para: string): string[] {
  const parts = para.split(SENTENCE_SPLIT_RE)
  return parts.filter((s) => s.length > 0)
}

/**
 * 把单个超长段落按句子边界重排为 2-N 段。
 *
 * **不增删任何字符**：所有片段按原顺序拼回去必须逐字等于原段落（verifySplit 会自证）。
 * 单句段（拆不动）原样返回。
 */
export function splitLongParagraph(para: string, targetMax = SPLIT_TARGET_MAX): string[] {
  if (para.length <= LONG_PARAGRAPH_MAX_CHARS) return [para]
  const sents = splitSentences(para)
  // 只有一句 = 拆不动（枚举句）。原样返回，由调用方计数上报，绝不硬拆。
  if (sents.length <= 1) return [para]

  const out: string[] = []
  let cur = ""
  for (const s of sents) {
    if (!cur) {
      cur = s
    } else if (cur.length + s.length <= targetMax) {
      cur += s
    } else {
      out.push(cur)
      cur = s
    }
  }
  if (cur) out.push(cur)

  // 兜底自证：拼回去必须逐字等于原文，否则放弃拆段（宁可不改，不可改坏）
  if (out.join("") !== para) return [para]
  return out
}

export type SplitResult = {
  /** 重排后的全文 */
  content: string
  /** 实际被拆开的段数 */
  splitParagraphs: number
  /** 拆完仍超阈值、且拆不动的段数（单句枚举句，需模型介入） */
  unsplittable: number
  /** 拆前超阈值段数 */
  longBefore: number
  /** 拆后超阈值段数 */
  longAfter: number
}

/**
 * 对整章正文做长段落重排。
 *
 * ⚠️ 表格行**不进段落池**（与 lintProse.splitParagraphs 同口径）：
 *   参数响应表每行 200+ 字，若参与拆段会把表格拆散。
 * ⚠️ 只处理「整行」段落：本工具的正文约定是**每行一个自然段**，故逐行处理即可，
 *   不需要跨行合并（跨行合并会把误把空行分隔的小节标题并进正文）。
 */
export function splitLongParagraphs(content: string): SplitResult {
  if (!content || !content.trim()) {
    return { content, splitParagraphs: 0, unsplittable: 0, longBefore: 0, longAfter: 0 }
  }
  const lines = content.split("\n")
  const out: string[] = []
  let splitParagraphs = 0
  let unsplittable = 0
  let longBefore = 0
  let longAfter = 0

  for (const raw of lines) {
    const t = raw.trim()
    // 空行 / 表格行 / 围栏行原样保留
    if (!t || isTableRow(t) || /^```/.test(t)) {
      out.push(raw)
      continue
    }
    if (t.length <= LONG_PARAGRAPH_MAX_CHARS) {
      out.push(raw)
      continue
    }
    longBefore += 1
    const parts = splitLongParagraph(t)
    if (parts.length > 1) {
      splitParagraphs += 1
      out.push(...parts)
      for (const p of parts) if (p.length > LONG_PARAGRAPH_MAX_CHARS) longAfter += 1
    } else {
      // 拆不动：原样保留并计数（不硬拆）
      unsplittable += 1
      longAfter += 1
      out.push(raw)
    }
  }

  return { content: out.join("\n"), splitParagraphs, unsplittable, longBefore, longAfter }
}
