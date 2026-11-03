// R191：长文生成的「单次调用输出预算」分块（纯函数，可单测）。
//
// 背景 bug（用户反馈「标书还是生成不了 / 补充生成 0 字」的直接根因）：
// 标书正文四条长文路径都把「还差多少字」一次性交给单次模型调用——
//   小节级串行生成 wordBudget = 章预算 / 小节数（实测某项目 59500/11 = 5409 字）、
//   自动补足 remain = 预算 - 已有正文、手动「继续生成」同口径（实测 53849 字）、
//   「一键补齐」remain = 距治理下限的整段缺口（实测 47900 字）。
// 而网关单次请求上限约 120s（model_gateway.pb.js 红线，不可改）。2026-10-06 本地实测
// （/api/model-gw/chat，模型 Intern deepseek-v4-flash-vision）：
//   要求 5000 字 / max_tokens 8192 → 120.0s 超时、0 字（开思考与关思考同样超时）；
//   要求 2000 字 / max_tokens 4096（关思考，另带约 9k 字上下文）→ 75.3s 成功、实出 4480 字。
// 即：目标越大越必然超时，而超时的表现是「整章 0 字 + 标 failed」，不是「少写一点」——
// 于是章节长期停在 1-2 个小节，补齐链路每次都汇报「新增约 0 字」。
//
// 语义：把一个不可能在红线内完成的大目标，拆成若干「红线内可完成」的小目标依序调用、
// 逐次累加（单次字数封顶、token 档随之封顶、超安全档的长调用关闭思考）。
// 本模块只做数值规划与确定性文本处理，零 AI、零副作用。

/** 单次长文调用请求的目标产出字数上限（实测该档可在 120s 红线内稳定完成） */
export const LONGFORM_CALL_MAX_CHARS = 2000
/** 单次调用值得再发请求的最小字数（余额小于该值并入前一块，不为几十个字再花一次调用） */
export const LONGFORM_CALL_MIN_CHARS = 400
/** 单个用户操作内同一章最多分次调用次数（防无上限烧额度；剩余缺口提示再点一次继续） */
export const LONGFORM_CHUNK_MAX_ROUNDS = 6
/** 长文调用的输出 token 封顶档（8192 档实测必撞红线，4096 档实测可完成） */
export const LONGFORM_CALL_MAX_TOKENS = 4096
/** 输出 token 下限（过小档位会被思考开销挤空，沿用既有解析类下限口径） */
export const LONGFORM_CALL_MIN_TOKENS = 1024
/** 中文字 → 输出 token 的换算余量（实测 2683 token 产出 4480 字 ≈ 1.67 字/token，取紧值留余量） */
export const LONGFORM_TOKENS_PER_CHAR = 1.7
/**
 * 长文块首调关闭思考的字数门槛。R192 实测收紧为 0（= 所有块一律关思考）：
 * 5409 字小节拆 [2000,2000,1409]，前两块关思考正常产出，尾块 1409 字按旧口径保持开思考，
 * 推理型模型（Intern deepseek-v4-flash-vision）把 2396 token 配额耗在思考上、content 返回空 →
 * 网关 ok:false「返回格式异常，回复内容为空」，单块失败中断整条补齐链路（用户实机 2026-10-06 复现）。
 * 关思考只影响输出前置推理、不影响正文质量口径（提示词与字数目标不变）。
 */
export const LONGFORM_THINK_SAFE_CHARS = 0

export type LongformChunkPlan = { maxCharsPerCall?: number; maxChunks?: number }

/**
 * 把总目标字数规划为「逐次调用」的目标字数序列。
 * - 每块不超过单次上限；块数不超过单次操作上限（覆盖不到的缺口由调用方如实汇报，不假装补齐）；
 * - 末块小于最小请求字数时并入前一块（避免为几十次字符再发一次请求）。
 */
export function planLongformChunks(targetChars: number, opts: LongformChunkPlan = {}): number[] {
  const per = Math.max(LONGFORM_CALL_MIN_CHARS, Math.round(opts.maxCharsPerCall ?? LONGFORM_CALL_MAX_CHARS))
  const maxRounds = Math.max(1, Math.round(opts.maxChunks ?? LONGFORM_CHUNK_MAX_ROUNDS))
  const total = Math.max(0, Math.round(Number(targetChars) || 0))
  if (total <= 0) return []
  const rounds = Math.min(maxRounds, Math.ceil(total / per))
  const out: number[] = []
  let left = total
  for (let i = 0; i < rounds; i++) {
    const c = Math.min(per, left)
    if (c <= 0) break
    out.push(c)
    left -= c
  }
  if (out.length >= 2 && out[out.length - 1] < LONGFORM_CALL_MIN_CHARS) {
    out[out.length - 2] += out[out.length - 1]
    out.pop()
  }
  return out
}

/** 某一块的输出 token 档：按字数换算并夹在安全档区间内（永不请求 8192 那种必超时档） */
export function longformCallTokens(chunkChars: number): number {
  const c = Math.max(0, Math.round(Number(chunkChars) || 0))
  const want = Math.ceil(c * LONGFORM_TOKENS_PER_CHAR)
  return Math.min(LONGFORM_CALL_MAX_TOKENS, Math.max(LONGFORM_CALL_MIN_TOKENS, want))
}

/** 该块是否应关闭思考（R192：长文块全部首调关思考——开思考的中小块实测返回空回复；0 字块不发请求故不关） */
export function shouldDisableThinking(chunkChars: number): boolean {
  return Math.round(Number(chunkChars) || 0) > LONGFORM_THINK_SAFE_CHARS
}

/**
 * 同一个小节分次生成时，去掉后续块重复输出的小节标题行（形如「3.2 总体建设方案」）。
 * 提示词要求每块都以小节标题行开头，直接拼接会让正文出现两次同一标题；
 * 判定保持保守：仅当首行是短行、且去掉编号/标点后与小节名相同或包含小节名时才删。
 */
export function stripDuplicateSectionHead(raw: string, sectionNo: string, sectionName: string): string {
  const src = (raw ?? "").replace(/^\s+/, "")
  const name = (sectionName ?? "").trim()
  if (!src || !name) return src
  const nl = src.indexOf("\n")
  const head = (nl === -1 ? src : src.slice(0, nl)).trim()
  if (!head || head.length > 60) return src
  const norm = (s: string) => s.replace(/[\s、.．:：()（）]/g, "")
  const headKey = norm(head)
  const nameKey = norm(name)
  if (!headKey || !nameKey) return src
  const numbered = new RegExp(`^\\s*${sectionNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(head)
  const sameName = headKey === nameKey || (numbered && headKey.includes(nameKey))
  if (!sameName) return src
  return nl === -1 ? "" : src.slice(nl + 1).replace(/^\s+/, "")
}
