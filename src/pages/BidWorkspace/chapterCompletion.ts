// R170：章节「是否真正生成完成」判定（纯函数，可单测）。
//
// 背景 bug：小节级串行生成在 cancelBulkRef（用户停止批量 / 返回列表 / 生成中刷新）触发时，
// for 循环 break 掉剩余小节，但调用方仍把「只产出了部分小节」的章节按 gen_status="done" 落库，
// 造成「完成 x/y 虚高、批量重跑按 done 跳过、用户误以为整章已生成」——表现为一份大章只出了
// 开头一小节（约几页）就再也不动。这里把两处判定收敛成纯函数并补单测。

import { sliceSectionPieces } from "./bidTypes"

export interface SectionChapterLike {
  gen_status?: string
  sections?: unknown[]
  section_stats?: { chars?: number }[]
}

/**
 * 小节级串行生成被中断（cancelledMid=true）时，即便已有部分正文也不得标记 done——
 * 用 failed 保留已生成小节、且让「继续生成」能按断点续跑补足剩余小节。
 */
export function sectionGenStatus(o: { cancelledMid: boolean }): "done" | "failed" {
  return o.cancelledMid ? "failed" : "done"
}

/**
 * 章节是否存在「尚未生成的小节」：走过小节级生成（section_stats 非空）且 小节总数 > 已产出统计数。
 * 与 gen_status 无关——历史误标 done 或本轮新标 failed 的残缺小节章都命中；
 * 单次生成章（section_stats 空）与完整小节章（stats 覆盖全部小节且每节均有产出）都不误伤。
 * R179 收紧：stats 数==小节数但含 chars<=0 的空产出占位小节，同样判为有待补小节。
 */
export function hasPendingSections(ch: SectionChapterLike | null | undefined): boolean {
  if (!ch) return false
  const stats = ch.section_stats ?? []
  const secs = ch.sections?.length ?? 0
  if (stats.length === 0) return false
  // R179 收紧：小节级生成对空产出小节记 chars:0 占位（与小节列表下标对齐）——这类章 stats 数==小节数、
  // 旧判据按「完整小节章」漏网，实际正文缺了具名小节，且「继续生成」会走整章 blob 路径把洞永远跳过。
  // 凡存在以 0 记空的小节，一律视为仍有待补小节。
  return secs > stats.length || stats.some((s) => !(s.chars && s.chars > 0))
}

/**
 * 识别「被误标 done、但小节并未全部生成」的历史章节（用于批量重跑自愈）：
 * = done 且仍有未生成小节。单次生成章与完整小节章都不误伤。
 */
export function isIncompleteSectionChapter(ch: SectionChapterLike | null | undefined): boolean {
  return ch?.gen_status === "done" && hasPendingSections(ch)
}

/**
 * R174：断点续跑「正文种子」的安全裁剪上限（纯函数，可单测）。
 *
 * 背景 bug：小节级串行生成的正文 = 各小节片段按 \n\n 拼接，section_stats.chars 逐段对齐，故正常章
 * content.length ≈ Σ(chars) + 分隔符。但历史「整章 blob 续写 / 补足」路径（runContinueChapter /
 * runSupplementLoop）只更新 content 与 gen_status="done"、从不回写 section_stats——于是出现「done
 * 但 section_stats 只覆盖开头一小节、content 却远超该小节」的不一致态（实测多章 content 17548 而
 * stats 仅 [3131]）。此时 R171 的「继续生成」仍按 hasPendingSections 走小节断点续跑，种子取整段 content
 * （含未跟踪的 blob 尾巴），再往后追加缺失小节 → 内容重复膨胀。
 *
 * 语义：返回续跑种子应保留的字符上限（已跟踪小节正文 + 小节间 \n\n 分隔）。
 * - 小节已全部跟踪（resumeFrom >= sectionCount）：返回 Infinity，沿用整章正文、不裁剪（行为不变）；
 * - 仍有未跟踪小节（resumeFrom < sectionCount）：只保留前 resumeFrom 个已跟踪小节的正文字符上限，裁掉
 *   其后的未跟踪尾巴，续跑即可干净地在其后补足缺失小节而不重复。健康的中断章（content 恰等于已生成小节）
 *   该上限 ≈ content 全长，裁剪无副作用。
 */
export function trackedPrefixLength(
  stats: { chars?: number }[],
  resumeFrom: number,
  sectionCount: number,
  separator = 2,
): number {
  if (!stats || stats.length === 0) return 0
  if (resumeFrom >= sectionCount) return Number.POSITIVE_INFINITY
  const tracked = stats.slice(0, Math.max(0, resumeFrom)).reduce((a, s) => a + Math.max(0, s.chars ?? 0), 0)
  const seps = Math.max(0, Math.min(resumeFrom, sectionCount) - 1) * separator
  return tracked + seps
}

/**
 * R175：章节「真正完成」判据（纯函数，可单测）——gen_status=done 且不存在未生成小节。
 *
 * 背景 bug：生成总览「完成 x/y」的分子此前只按 gen_status==="done" 计数（useBidWorkspace 5766），
 * 完全不看小节是否补齐。于是「1 章 11 小节、只产出开头 1 小节却被历史整章 blob 追加标成 done」的残缺章，
 * 会被计入「完成」——总览显示「完成 1/1」，可用户打开一看正文才几页，正是本轮用户「标书才 6 页却像已完成」
 * 核心反馈的直接元凶。这里把「完成」口径收敛为纯函数：残缺章（isIncompleteSectionChapter 命中）不算完成。
 * 单次生成章（section_stats 空 → hasPendingSections=false）仍算完成，不误伤。
 */
export function isTrulyDoneChapter(ch: SectionChapterLike | null | undefined): boolean {
  return ch?.gen_status === "done" && !hasPendingSections(ch)
}

/**
 * R173：瞬时失败重试核心（纯函数、依赖注入、可单测）。
 *
 * 背景 bug：标书小节级串行生成里单个小节的模型调用一旦抛错（网络抖动 / 偶发超时 / 网关 5xx），
 * 异常会冒泡中断整章、本轮已生成小节的增量丢失，用户须反复手点「继续生成」。代码库既有韧性口径
 * （见 deckBatchRecovery：「单批失败重试 1 次后跳过、不让一批拖垮全局」）在小节循环里未落实。
 *
 * 语义：
 * - call(attempt) 抛「非致命」异常 → 自动重试（默认共 2 试）；
 * - isFatal(e) 命中（如登录失效 AuthRequiredError）→ 立即上抛，绝不重试；
 * - shouldStop() 命中（如用户取消 cancelBulkRef）→ 本试失败后不再重试，直接上抛该错误；
 * - 全部尝试都失败 → 重抛最后一次错误（保留网关 / 模型侧已本地化的中文文案，交调用方既有 catch 兜底）。
 */
export async function withTransientRetry<T>(
  call: (attempt: number) => Promise<T>,
  opts: { maxAttempts?: number; isFatal?: (e: unknown) => boolean; shouldStop?: () => boolean } = {},
): Promise<T> {
  const max = Math.max(1, opts.maxAttempts ?? 2)
  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt += 1) {
    try {
      return await call(attempt)
    } catch (e) {
      if (opts.isFatal?.(e)) throw e
      lastErr = e
      if (opts.shouldStop?.()) throw e
    }
  }
  throw lastErr
}

/**
 * R179：整章 blob 续写/补足后重排 section_stats（纯函数，可单测）。
 *
 * 背景 bug（r175-followup 点名的生产端脏数据源）：runContinueChapter / runSupplementLoop 追加正文后
 * 只更新 content 与 gen_status=done、从不回写 section_stats，逐节 chars 之和与正文长度脱钩——
 * 「done+stats 陈旧」记录持续新增。追加文本落在章末，按 sliceSectionPieces「末片吸收到正文末尾」的
 * 既有口径本应归属最后一个非空小节；本函数按该口径把增量并入末片 chars，恢复不变式
 * Σ(chars) + 2×(非空小节数-1) == merged.length（即切片/重组对正文无损往返）。
 * 返回 null 表示「不回写」：stats 为空（单次生成章）、无已产出小节或正文短到无法容纳结构，
 * 避免写入明显错误的统计。
 */
export function reflowStatsAfterAppend(
  stats: { title: string; chars: number }[],
  merged: string,
): { title: string; chars: number }[] | null {
  if (!stats || stats.length === 0 || !merged) return null
  let lastIdx = -1
  for (let i = stats.length - 1; i >= 0; i--) {
    if ((stats[i]?.chars ?? 0) > 0) {
      lastIdx = i
      break
    }
  }
  if (lastIdx < 0) return null
  let otherChars = 0
  let nonEmptyCount = 0
  for (let i = 0; i < stats.length; i++) {
    const c = stats[i]?.chars ?? 0
    if (c > 0) {
      nonEmptyCount += 1
      if (i !== lastIdx) otherChars += c
    }
  }
  const newLast = merged.length - otherChars - Math.max(0, nonEmptyCount - 1) * 2
  if (newLast <= 0) return null
  return stats.map((s, i) => (i === lastIdx ? { ...s, chars: newLast } : { ...s }))
}

/** R276：断点续跑种子规划结果 */
export type SectionResumePlan = {
  /** 每小节保留片段（长度=sections.length，未产出为 ""），按小节序重建即得续跑正文 */
  pieces: string[]
  /** 与 pieces 对齐的小节统计（title 取小节名，chars 为种子片段长度；待补小节记 0 占位） */
  stats: { title: string; chars: number }[]
  /** 需要（重新）生成的小节下标：空洞 + 尾部未覆盖 */
  pendingIndices: number[]
}

/**
 * R276：细粒度断点续跑规划（纯函数，可单测）。
 *
 * 背景缺口：旧续跑以「首个失败小节的连续前缀」为界（resumeFrom=firstEmpty），界之后的已产出小节
 * 全部推倒重生成——一份章若第 3 节瞬时失败、第 4/5 节已成功，续跑会把 4/5 也重新付费生成并冲掉
 * 用户对其的手工修补。本函数把「哪些小节已完成可保留」与「哪些仍需补」拆成显式集合：
 * - 已完成小节（种子切片非空且 chars>0）保留原文，即便位于某个空洞之后；
 * - 空洞（chars<=0）与未覆盖尾部（下标 >= priorStats.length）计入待补；
 * - 全新章节 / 空正文 / 小节 title 与 stats 错位 / fresh → 全部待补（与原逐章串行行为一致）。
 * 沿用 R174 口径：续跑种子只保留「已跟踪小节正文」，裁掉历史整章 blob 追加留下的未跟踪尾巴，
 * 防续跑把未跟踪内容当既有正文继续往后追加缺失小节而重复膨胀。
 */
export function planSectionResume(
  content: string,
  priorStats: { title: string; chars?: number }[],
  sections: string[],
  opts: { fresh?: boolean } = {},
): SectionResumePlan {
  const k = sections.length
  const pieces = new Array<string>(Math.max(0, k)).fill("")
  const stats = sections.map((t) => ({ title: t, chars: 0 }))
  const ps = priorStats ?? []
  const aligned =
    !opts?.fresh &&
    (content ?? "").trim().length > 0 &&
    ps.length > 0 &&
    ps.length <= k &&
    ps.every((st, i) => st.title === sections[i])
  if (!aligned) {
    return { pieces, stats, pendingIndices: Array.from({ length: k }, (_, i) => i) }
  }
  // sliceSectionPieces / trackedPrefixLength 要求 chars 必填，规整缺省 undefined 的统计为 0
  const statsReq = ps.map((x) => ({ title: x.title, chars: Math.max(0, x.chars ?? 0) }))
  // 未跟踪 blob 尾巴裁剪口径同 R174：trackedPrefixLength 全部小节已跟踪时返回 Infinity（不裁），
  // 否则截到「已跟踪小节正文 + 小节间分隔符」，历史整章 blob 追加留下的多余尾巴不进种子。
  const limit = trackedPrefixLength(statsReq, statsReq.length, k)
  const priorPieces = sliceSectionPieces((content ?? "").slice(0, limit), statsReq)
  const pending: number[] = []
  for (let i = 0; i < k; i++) {
    const piece = (priorPieces[i] ?? "").trim() ? priorPieces[i] : ""
    if (piece && (statsReq[i]?.chars ?? 0) > 0) {
      pieces[i] = piece
      stats[i] = { title: statsReq[i].title, chars: piece.length }
    } else {
      pending.push(i)
    }
  }
  return { pieces, stats, pendingIndices: pending }
}
