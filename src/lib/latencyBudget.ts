// ---------------------------------------------------------------------------
// R180（r177-followup 残项落地）：按模型实测延迟自适应首轮生成预算。
// 背景：R177 的超时降级重试以「先交一次红线超时」为代价发现可用预算——慢模型
// 每个长小节首轮都要白烧约 120s 网关超时（model_gateway.pb.js 红线），整本逐节
// 串行时首轮税极高；而同一模型在一次会话内的超时与其降级后可用档位高度可复现。
// 本模块按模型记录实测结论（超时次数、贴红线成功、降级后验证过的可用档位），
// suggestInitialBudget 把 120s 红线经验值编码为自适应上限：有超时/偏慢证据的模型
// 直接从已知可用档位起步并同步关闭思考；无证据模型（首调或快模型）原样放行，
// 行为与 R177 后完全一致。纯会话内存状态：零持久化、零 collection、刷新即清零。
// ---------------------------------------------------------------------------

import { TIMEOUT_RETRY_MIN_TOKENS, nextDegradedBudget } from "@/lib/modelGateway"

/**
 * 实测延迟安全窗：网关服务端转发上限约 120s（红线），客户端兜底 abort 150s。
 * 一次调用耗时达到该窗仍成功，说明同档调用贴近红线、下轮大概率越线，应预降级。
 */
export const SAFE_LATENCY_MS = 100_000

export interface ModelBudgetSuggestion {
  /** 本轮首调输出预算（无证据或请求不高于已知档时原样返回 requested） */
  tokens: number
  /** 首调预算被下调时同步关闭思考（与 R177 降级重试同档口径） */
  disableThinking: boolean
}

interface ModelLatencyRecord {
  /** 超时证据计数：快成功逐步释放，归零后仅靠已知档位继续约束 */
  timeouts: number
  /** 曾超时后成功返回正文的 max_tokens 档位（只升不降：更大档成功即上调验证位） */
  knownGood: number | null
  /** 贴红线慢证据：一次成功但耗时达到安全窗 */
  slow: boolean
  /**
   * Q28 切片E：该模型「开思考却返回空正文」的证据位。推理型模型把 max_tokens 耗在
   * 思考上时，网关表现为 ok:false「返回格式异常，回复内容为空」——单次白烧 85s 级耗时，
   * 批量并发下还会把密钥推到 429。置位后同模型首调直接关思考（预算不变），不再逐次交税。
   */
  thinkingEmpty: boolean
}

const records = new Map<string, ModelLatencyRecord>()

function ensureRecord(key: string): ModelLatencyRecord {
  let rec = records.get(key)
  if (!rec) {
    rec = { timeouts: 0, knownGood: null, slow: false, thinkingEmpty: false }
    records.set(key, rec)
  }
  return rec
}

/** 调用级实测观察：timeout 增证据；success 按耗时判慢或释放既有证据 */
export function observeModelCall(key: string, latencyMs: number, outcome: "success" | "timeout"): void {
  const rec = ensureRecord(key)
  if (outcome === "timeout") {
    rec.timeouts += 1
    return
  }
  if (latencyMs >= SAFE_LATENCY_MS) {
    rec.slow = true
  } else {
    rec.slow = false
    if (rec.timeouts > 0) rec.timeouts -= 1
  }
}

/** 成功返回正文后验证过的档位：记为模型已知可用预算（只升不降，防小档成功拉回保守位） */
export function noteKnownGoodBudget(key: string, tokens: number): void {
  const rec = ensureRecord(key)
  rec.knownGood = rec.knownGood === null ? tokens : Math.max(rec.knownGood, tokens)
}

/**
 * Q28 切片E：登记「该模型开思考却返回空正文」证据。由 llmGenerate 在空回复检测点调用一次，
 * 之后同模型所有调用首调即关思考（R192 对长文分块已按模型侧实测把块调用统一关思考，此处把
 * 同一结论泛化到未显式声明的路径）。只关思考、不动输出预算档，正文长度口径与提示词均不变。
 */
export function noteThinkingEmptyReply(key: string): void {
  ensureRecord(key).thinkingEmpty = true
}

/**
 * 自适应上限：无证据模型原样放行；有超时/偏慢证据时从已知可用档起步（无已知档
 * 按 nextDegradedBudget 折半），且仅当建议档真低于请求时才关思考——2048 及以下的
 * 请求（解析类小档）因下限护栏天然不受损。
 */
export function suggestInitialBudget(key: string, requested: number): ModelBudgetSuggestion {
  const rec = records.get(key)
  if (!rec) return { tokens: requested, disableThinking: false }
  // Q28 切片E：已证实「开思考 → 空正文」的模型，首调直接关思考，预算档位原样保留
  if (rec.thinkingEmpty) return { tokens: requested, disableThinking: true }
  const degraded = rec.timeouts > 0 || rec.slow
  const known = rec.knownGood
  if (!degraded && (known === null || known >= requested)) {
    return { tokens: requested, disableThinking: false }
  }
  const floor = known !== null && known < requested ? known : nextDegradedBudget(requested)
  const tokens = Math.min(requested, Math.max(floor, TIMEOUT_RETRY_MIN_TOKENS))
  return { tokens, disableThinking: tokens < requested }
}

/** 清空按模型实测记录（单测边界用；会话内模型重配无需调用——key 含 configId 天然隔离） */
export function resetModelLatencyRecords(): void {
  records.clear()
}
