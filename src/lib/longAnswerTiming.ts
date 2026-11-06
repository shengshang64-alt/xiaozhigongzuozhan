/**
 * 助手「长答」体验的**时间口径**（纯函数，零 React / 零计时器）。
 *
 * 背景（R3 · D4 /assistant 🟡「长答易撞 120s」+ 开工令「超时/取消/重试体感；
 * 少误报『服务不可用』」）：
 *
 *   三个数字很容易被写错，而且写错了用户看不出原因，只觉得「助手坏了」：
 *     ① **什么时候该提示「这次会比较久」**——太早 = 每次提问都在喊狼来了；
 *        太晚 = 用户已经开始怀疑卡死并重复点发送（每次都是真金白银）。
 *     ② **什么时候该提示「可以取消」**——取消是对「已付费但还没出结果」的唯一出口。
 *     ③ **什么时候该说「这次是真的超时了」**——说早了会把「慢但在跑」误报成失败。
 *
 *   实测口径（来自本仓真实链路，不是拍的）：
 *     · 网关单次出站上限 300s（model_gateway.pb.js 红线）；
 *     · 前端客户端上限 330s（modelGateway.PERSONAL_CHAT_TIMEOUT_MS，留 30s 余量）；
 *     · 一串「取数回填」最多 2 轮（useAssistant 的 fetchCount<2），每轮都是一次完整
 *       模型调用——所以**一轮长答可能是 3 次调用串起来**，用户等待时间远大于单次。
 *
 *   把这些数字集中在这里，是为了让「提示阈值」与「真实超时点」有关系可核对：
 *   提示阈值必须**远小于**超时点，否则提示出现时已经失败了。
 */

/** 网关服务端单次出站上限（秒），与 pb_hooks/model_gateway.pb.js 的 300s 同源 */
export const GATEWAY_SINGLE_CALL_LIMIT_SEC = 300

/** 前端客户端上限（秒），与 modelGateway.PERSONAL_CHAT_TIMEOUT_MS 同源 */
export const CLIENT_TIMEOUT_SEC = 330

/** 助手一轮最多串几次模型调用（取数回填 2 轮 + 最终回答 1 次），与 useAssistant 同源 */
export const MAX_CALLS_PER_TURN = 3

/** 提示「这次会比较久」的阈值（秒）：30s。常规短问实测 <10s，30s 是用户开始怀疑卡死的点 */
export const LONG_ANSWER_HINT_SEC = 30

/** 提示「已接近单次上限，可取消」的阈值（秒）：120s。此时已过半，取消是合理选择 */
export const CANCEL_HINT_SEC = 120

/**
 * 本次等待相对「最坏情况」的进度分档。
 *
 * 注意分母是 **CLIENT_TIMEOUT_SEC × MAX_CALLS_PER_TURN**（一轮可能串三次调用），
 * 不是单次上限——否则第二次调用刚开始就会显示「已 100%」，比不显示更误导。
 */
export type LongAnswerPhase = "normal" | "long" | "very_long" | "near_limit"

export interface LongAnswerHintInput {
  /** 已等待秒数（页面上显示的 tick） */
  elapsedSec: number
}

export interface LongAnswerHint {
  phase: LongAnswerPhase
  /** 是否应该显示「这次会比较久」的安抚文案 */
  showLongHint: boolean
  /** 是否应该把「取消」入口强调出来 */
  emphasizeCancel: boolean
  /** 是否已经接近上限（此时不该再让用户「再等等」，而要给出可执行动作） */
  nearLimit: boolean
  /** 已等待相对最坏情况的百分比（0-100，仅用于给用户一个「在动」的进度感） */
  worstCasePct: number
}

/** 计算长答提示状态。纯函数：同样的秒数永远同样的结论，便于单测钉阈值。 */
export function longAnswerHint(input: LongAnswerHintInput): LongAnswerHint {
  const sec = Math.max(0, Math.floor(Number(input.elapsedSec) || 0))
  const worst = CLIENT_TIMEOUT_SEC * MAX_CALLS_PER_TURN
  const pct = Math.min(100, Math.round((sec / worst) * 100))
  if (sec >= CANCEL_HINT_SEC) {
    return { phase: "near_limit", showLongHint: true, emphasizeCancel: true, nearLimit: true, worstCasePct: pct }
  }
  if (sec >= LONG_ANSWER_HINT_SEC * 2) {
    return { phase: "very_long", showLongHint: true, emphasizeCancel: true, nearLimit: false, worstCasePct: pct }
  }
  if (sec >= LONG_ANSWER_HINT_SEC) {
    return { phase: "long", showLongHint: true, emphasizeCancel: false, nearLimit: false, worstCasePct: pct }
  }
  return { phase: "normal", showLongHint: false, emphasizeCancel: false, nearLimit: false, worstCasePct: pct }
}

/**
 * 长答阶段的用户可见文案（带「正在做什么」与「可以做什么」）。
 *
 * 纪律：**不出现「服务不可用」「模型挂了」这类判断词**——那是最常见的误报来源：
 * 慢 ≠ 挂。这里只描述「还在等 / 已等多久 / 能做什么」。
 */
export function longAnswerHintText(input: LongAnswerHintInput): string {
  const h = longAnswerHint(input)
  const sec = Math.max(0, Math.floor(Number(input.elapsedSec) || 0))
  switch (h.phase) {
    case "long":
      return `回答较长，仍在生成中（已等 ${sec}s）。可以继续等，也可以点「取消」改用更短的问法。`
    case "very_long":
      return `已等 ${sec}s，这轮问题可能需要多步取数（最多 3 次模型调用）。如不需要完整答案，可点「取消」后换个更具体的问题。`
    case "near_limit":
      return `已等 ${sec}s，接近单次上限（单次约 ${CLIENT_TIMEOUT_SEC}s）。建议点「取消」后换一个响应更快的模型，或把问题拆成几步问。`
    default:
      return ""
  }
}

/**
 * 取消语义的说明：用户点「取消」后到底发生了什么。
 *
 * 背景：取消是 abort 当前 fetch，**已发出的那次模型调用不能撤回**（钱已经花了）。
 * 旧界面只说「取消」，用户以为退钱了；实际是「停止后续步骤、回到输入态」。
 * 说清楚这一点，用户才会在真正不需要时果断取消，而不会反复点了等。
 */
export const CANCEL_SEMANTICS_TEXT = "取消会停止本轮后续步骤并回到输入框；已经发出的这一次模型调用无法撤回（不再继续发起新的调用）。"
