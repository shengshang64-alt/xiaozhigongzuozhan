// ---------------------------------------------------------------------------
// Q28 切片F：个人模型密钥 TPM 限流（HTTP 429）的会话内冷却闸门。
// 背景：标书正文「章间并发 2 + 单请求 2.4~2.6 万字」的负载实测会在上游被秒拒
// （~0.7s 返回「接口限流或余额不足（HTTP 429）」），而生成链路既有的韧性只有
// R173 的 withTransientRetry——零间隔立即重发，按分钟滚动的限流窗必然再次命中，
// 于是一次限流把整章打成 0 字 failed（实测「9 章批量 7 章 failed、正文停在几十页」）。
// 解析链路的 T12b 早已用「退避 20s 重试一次」解决同一问题，本模块把该结论泛化成
// 全链路共享的闸门：命中 429 即开冷却窗并随连击逐次拉长，所有并发 worker 取号排队
// 发请求（正常态也保留最小间隔错峰），成功返回则清零连击计数。
// 纯会话内存：零持久化、零 collection、刷新即清零；不改提示词与输出预算，正文长度口径不变。
// ---------------------------------------------------------------------------

/** 健康态的最小请求间隔：并发 worker 由此天然错峰，杜绝同秒撞限流窗 */
export const MIN_CALL_GAP_MS = 2_000

/** 单次限流的基准冷却窗：与解析链路 T12b 的 20s 退避同口径（上游 TPM 多按分钟滚动） */
const BASE_COOLDOWN_MS = 20_000

/** 连击冷却窗上限：再长就该由用户介入（换模型），不在一次调用里干等 */
const MAX_COOLDOWN_MS = 90_000

/** 单次调用最长可等待时长：超出即放行，避免闸门制造无限挂起（上层失败口径仍可见） */
const MAX_WAIT_MS = 75_000

let gateUntil = 0
let strikes = 0

/**
 * 取一个发号时隙：返回「还需等待多少毫秒」，并把闸门往后推一格。
 * 冷却窗未过时按窗尾排队；正常态也只留 MIN_CALL_GAP_MS 的错峰余量（时钟可注入，便于单测）。
 */
export function takeCallSlot(now: number = Date.now()): number {
  const at = Math.max(now, gateUntil)
  gateUntil = at + MIN_CALL_GAP_MS
  return Math.min(Math.max(0, at - now), MAX_WAIT_MS)
}

/**
 * 登记一次限流：冷却窗从本次限流起算并随连击次数线性拉长（20s / 40s / 60s…封顶 MAX_COOLDOWN_MS），
 * 返回本次生效的窗长。取 max 而非累加，保证多 worker 同轮命中时窗不会互相叠加成分钟级干等。
 */
export function noteRateLimited(now: number = Date.now()): number {
  strikes += 1
  const cooldown = Math.min(BASE_COOLDOWN_MS * strikes, MAX_COOLDOWN_MS)
  gateUntil = Math.max(gateUntil, now + cooldown)
  return cooldown
}

/** 成功返回即认定限流窗已过去：清零连击计数，冷却不再逐次叠加（时隙尾保留，不影响后续错峰） */
export function noteCallSucceeded(): void {
  strikes = 0
}

/** 当前连击计数（诊断与单测用） */
export function rateLimitStrikes(): number {
  return strikes
}

/** 清空闸门（单测边界用；会话内无需调用——闸门本就是全局瞬时状态） */
export function resetRateLimitGate(): void {
  gateUntil = 0
  strikes = 0
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 取号并等窗：调用点直接 await 的版本。等待为 0 时同步返回，不产生微任务以外的开销。
 * @returns 实际等待的毫秒数（已封顶 MAX_WAIT_MS）
 */
export async function waitCallSlot(
  sleep: (ms: number) => Promise<void> = defaultSleep,
  now: number = Date.now(),
): Promise<number> {
  const wait = takeCallSlot(now)
  if (wait > 0) await sleep(wait)
  return wait
}
