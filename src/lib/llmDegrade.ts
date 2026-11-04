/**
 * 超时降级的**阶梯规划**（纯函数，零网络 / 零 React）。
 *
 * 背景：网关单次出站上限 300s（model_gateway.pb.js 红线，前端改不了）。
 * 标书侧早已有「命中超时 → 关闭思考 + 逐次折半输出预算 → 同一个小节在红线内跑完」的恢复链
 * （useBidWorkspace 里的 shouldDegradeRetry / nextDegradedBudget 循环），实测把
 * 「慢模型整章 failed」救回成「降档能出正文」。
 *
 * 但**方案侧一直没有**（studioLlm.llmGenerate 只发一次，超时即整章 failed）——
 * 同一份 8192 token 的长文预算，同样撞 300s 红线，标书能跑完、方案必失败，
 * 用户会认为「方案工作室坏了」。本模块把那条阶梯的**规划部分**抽出来，
 * 让两侧共用同一套口径（阈值只在 modelGateway 定义一次）。
 *
 * 为什么只抽规划、不抽执行：
 *   两侧的「怎么发请求」并不一样（标书侧带 skills 块与模型健康记账，方案侧带技能注入）。
 *   抽执行会逼出一堆回调参数，反而更难读。**真正会写错、也最该被钉住的是阶梯数字**：
 *   从多少起步、折几次、到哪里停、什么时候不该重试——这些做成纯函数最合适。
 */

import { shouldDegradeRetry, nextDegradedBudget, TIMEOUT_RETRY_MIN_TOKENS } from "./modelGateway"

export type DegradePlan = {
  /** 是否应该走降级重试（仅「失败且原因命中超时」为真） */
  retry: boolean
  /** 逐次尝试的输出预算序列（从首次折半开始，末档不低于下限） */
  budgets: number[]
  /** 为什么重试 / 为什么不重试（给日志与用户提示用的人话） */
  reason: string
}

/**
 * 规划超时降级阶梯。
 *
 * @param firstOk       首调是否成功（成功就完全不降级）
 * @param firstError    首调失败时的错误串
 * @param firstBudget   首调用的输出预算（阶梯从它继续往下折）
 */
export function planTimeoutDegrade(firstOk: boolean, firstError: string | undefined, firstBudget: number): DegradePlan {
  if (firstOk) return { retry: false, budgets: [], reason: "首调成功，无需降级" }
  // 只看「是否超时」：内容审核 / 余额不足 / 鉴权失败这类明确失败盲目重试是白花钱
  // （这是标书侧 R178 就定下的口径，方案侧沿用同一条，避免两边判断分叉）
  if (!shouldDegradeRetry(firstOk, firstError)) {
    return { retry: false, budgets: [], reason: "不是超时类失败，直接透出真实原因（不盲目重试，避免重复计费）" }
  }
  const start = Math.max(Math.floor(Number(firstBudget) || 0), 0)
  if (start <= TIMEOUT_RETRY_MIN_TOKENS) {
    // 首调预算已经在下限：再折就是空转，直接给可执行文案更有用
    return { retry: false, budgets: [], reason: "输出预算已在下限，再降级没有意义，直接提示换更快的模型或分章生成" }
  }
  const budgets: number[] = []
  let budget = start
  // 上限保护：即使传入异常巨大值也不会规划出上百次请求（每次都是真金白银）
  let guard = 0
  while (budget > TIMEOUT_RETRY_MIN_TOKENS && guard < 8) {
    budget = nextDegradedBudget(budget)
    budgets.push(budget)
    guard += 1
  }
  return {
    retry: budgets.length > 0,
    budgets,
    reason: `命中超时，按 ${budgets.join(" → ")} token 逐档降级重试（关闭思考，让长文在网关红线内跑完）`,
  }
}
