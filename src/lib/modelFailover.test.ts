// ---------------------------------------------------------------------------
// R203（docs/13 §3.3）：模型通道级自动回退决策内核单测。
// 失败分类逐条采用 pocketbase/pb_hooks/model_gateway.pb.js doChat 的真实文案（红线区，
// 文案即稳定契约），保证「网关说什么」与「前端怎么判」永远对齐；编排用注入 fake deps，
// 零网络 / 零 DOM（environment=node）。
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmCallResult } from "@/lib/llm"
import {
  channelCoolingRemainingMs,
  channelCoolingStrikes,
  classifyCallFailure,
  configCoolingKey,
  coolingKeysForFailure,
  isChannelCooling,
  isFailoverEligible,
  markChannelCooling,
  pickFailoverCandidate,
  resetChannelCooling,
  resetFailoverNotice,
  shouldShowFailoverNotice,
  tryFailoverCall,
  type FailoverCandidate,
  type FailoverDeps,
  type FailoverRefLite,
} from "./modelFailover"

const mkRef = (over: Partial<FailoverRefLite> & { modelId: string }): FailoverRefLite => ({
  source: "personal",
  configId: "c1",
  configName: "配置一",
  ...over,
})

const mkCand = (r: FailoverRefLite, isConfigDefault = false): FailoverCandidate => ({
  key: `${r.source}:${r.configId}:${r.modelId}`,
  ref: r,
  configId: r.configId,
  isConfigDefault,
})

const okRes = (text: string): LlmCallResult => ({ ok: true, status: "success", text })
const failRes = (error: string): LlmCallResult => ({
  ok: false,
  status: "failed",
  text: "",
  error,
})

beforeEach(() => {
  resetChannelCooling()
  resetFailoverNotice()
})

describe("classifyCallFailure —— 逐字对齐网关真实文案", () => {
  it("账号级不可用四类各自命中", () => {
    expect(classifyCallFailure("所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型")).toBe("rate_limit")
    expect(classifyCallFailure("认证失败，请检查所配置模型的 API Key 是否有效")).toBe("auth")
    expect(classifyCallFailure("所配置模型的服务暂时不可用（HTTP 503），请稍后重试")).toBe("unavailable")
    expect(classifyCallFailure("模型「deepseek-chat」已停用，请在模型配置页启用或改用其他模型")).toBe("model_disabled")
  })

  it("「限流或连接被对方关闭（EOF）」按限流处理（同为账号级，可回退）", () => {
    expect(classifyCallFailure("所配置模型的接口限流或连接被对方关闭（EOF），请稍后重试或切换模型")).toBe("rate_limit")
    expect(classifyCallFailure("接口地址无法连通，请检查模型配置")).toBe("unavailable")
  })

  it("超时优先于泛化判定（交给标书侧 R177/R180 降级阶梯，不在此回退）", () => {
    expect(classifyCallFailure("请求超时，对方接口未在限定时间内返回，可稍后重试或切换模型")).toBe("timeout")
    expect(
      classifyCallFailure(
        "该模型本次响应超时（网关单次请求上限约 120 秒，偏慢的模型或超长小节容易触发）。请在顶部切换到更快的已配置模型后点「继续生成」重试。",
      ),
    ).toBe("timeout")
  })

  it("空回复 / 解析异常归 empty_reply（F1 关思考重试独占，不在此回退）", () => {
    expect(classifyCallFailure("返回格式异常，回复内容为空")).toBe("empty_reply")
    expect(classifyCallFailure("返回格式异常，无法解析回复内容")).toBe("empty_reply")
  })

  it("取消与需登录是专用哨兵，绝不参与回退", () => {
    expect(classifyCallFailure("user_cancelled")).toBe("cancelled")
    expect(classifyCallFailure("rh_login_required")).toBe("login_required")
  })

  it("R208：个人配置不可用（网关 fallback_to_platform 内部哨兵）归 config_broken 且参与回退", () => {
    expect(classifyCallFailure("personal_config_unavailable")).toBe("config_broken")
    expect(classifyCallFailure("fallback_to_platform")).toBe("config_broken")
    expect(isFailoverEligible("config_broken")).toBe(true)
  })


  it("平台通道与前端兜底文案", () => {
    // R301：insufficient_balance 归 quota_exhausted 而非 rate_limit——
    // 全项目（llmError / aigc / modelGateway）对它的定义都是「余额不足，请充值」，
    // 归rate_limit 会把一个必须充值的问题当成等一会就好。
    expect(classifyCallFailure("insufficient_balance")).toBe("quota_exhausted")
    expect(classifyCallFailure("Upstream rate limit exceeded (TPM)")).toBe("rate_limit")
    expect(classifyCallFailure("网络异常，请稍后重试")).toBe("unavailable")
    expect(classifyCallFailure("服务异常（HTTP 500），请稍后重试")).toBe("unavailable")
  })

  // R301：额度耗尽与速率限制同为 429，但处置相反，必须分开
  it("R301 额度耗尽与速率限制严格分开（实测原文逐字）", () => {
    // 实测原文：退避 25s 即成功 → 速率限制
    expect(classifyCallFailure("对方接口请求频率超限（HTTP 429），请稍后重试")).toBe("rate_limit")
    expect(classifyCallFailure("inference exceeds tpm/rpm limit")).toBe("rate_limit")
    // 实测原文：退避 3 次全败 → 额度耗尽
    expect(classifyCallFailure("接口额度或余额不足（HTTP 429），请到该模型平台充值或提高配额后重试")).toBe("quota_exhausted")
    expect(classifyCallFailure("quota exhausted")).toBe("quota_exhausted")
    expect(classifyCallFailure("quota exceeded")).toBe("quota_exhausted")
    // 旧版网关的二选一句式不是真判定，归回rate_limit，绝不误挂「需充值」
    expect(classifyCallFailure("所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型")).toBe("rate_limit")
    expect(classifyCallFailure("对方接口限流或余额不足（HTTP 429），请稍后重试")).toBe("rate_limit")
  })

  // R301：额度耗尽是账号级（换模型无用），冷却整配置 + 该模型；且参与自动回退

})

describe("classifyCallFailure —— R296 模型不存在（404）盲区修复", () => {

  it("404 与停用 / 限流互不吞：停用仍归 model_disabled，限流仍归 rate_limit", () => {
    expect(classifyCallFailure("模型「deepseek-chat」已停用，请在模型配置页启用或改用其他模型")).toBe("model_disabled")
    expect(classifyCallFailure("所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型")).toBe("rate_limit")
  })

  it("回归守卫：HTTP 400 参数错误、配置不存在都不是模型不存在（绝不误挂账）", () => {
    expect(classifyCallFailure("接口返回异常（HTTP 400）：max_tokens 超出上限")).toBe("other")
    expect(classifyCallFailure("配置不存在或无权访问")).toBe("other")
    expect(classifyCallFailure("内容审核未通过，请调整措辞后重试")).toBe("other")
    // 正文里的四位数不得被 \b404\b 之外的泛化命中：这条既无 404 也无模型缺失语义
    expect(classifyCallFailure("请求已完成，用量 4040 tokens")).toBe("other")
  })

  it("model_missing 参与自动回退（这一路必然零产出，换一路才有结果）", () => {
    expect(isFailoverEligible("model_missing")).toBe(true)
  })

})

describe("isFailoverEligible —— 可回退真值表", () => {
  it("账号级不可用五类 + 模型不存在为真（R296：404 纳入可回退）", () => {
    for (const cls of ["rate_limit", "auth", "model_disabled", "model_missing", "unavailable"] as const) {
      expect(isFailoverEligible(cls)).toBe(true)
    }
  })

  it("超时 / 空回复 / 取消 / 需登录 / 其它一律假", () => {
    for (const cls of ["timeout", "empty_reply", "cancelled", "login_required", "other"] as const) {
      expect(isFailoverEligible(cls)).toBe(false)
    }
  })
})

describe("会话通道冷却登记", () => {


  it("配置级键独立于模型级键（同账号换模型同样撞窗）", () => {
    expect(configCoolingKey("c1")).toBe("cfg:c1")
    const c = mkCand(mkRef({ modelId: "a" }))
    expect(coolingKeysForFailure("rate_limit", c)).toEqual(["cfg:c1", "personal:c1:a"])
    expect(coolingKeysForFailure("auth", c)).toEqual(["cfg:c1", "personal:c1:a"])
  })

})

describe("pickFailoverCandidate —— 候选排序与边界", () => {
  const failed = mkCand(mkRef({ configId: "c1", configName: "配置一", modelId: "deepseek-chat" }))
  const otherDefault = mkCand(
    mkRef({ configId: "c2", configName: "配置二", modelId: "sensernova-flash-lite" }),
    true,
  )
  const otherPlain = mkCand(mkRef({ configId: "c2", configName: "配置二", modelId: "glm-4.5" }))
  const sameCfgOther = mkCand(mkRef({ configId: "c1", modelId: "kimi-k2" }))
  const platform = mkCand(
    mkRef({ source: "platform", configId: "plat", configName: "平台内置", modelId: "gpt-5.5" }),
    true,
  )
  const all = [failed, otherPlain, otherDefault, sameCfgOther, platform]
  const base = {
    failedKey: failed.key,
    failedConfigId: failed.configId,
    failedSource: "personal" as const,
    localDeploy: false,
    now: 1_000,
  }

  it("优先别的配置的默认模型", () => {
    expect(pickFailoverCandidate({ candidates: all, ...base })?.key).toBe(otherDefault.key)
  })

  it("别的配置整体优先于同配置其它模型，同配置再优先于平台内置", () => {
    const noOtherCfg = [failed, sameCfgOther, platform]
    expect(pickFailoverCandidate({ candidates: noOtherCfg, ...base })?.key).toBe(sameCfgOther.key)
    const onlyPlatform = [failed, platform]
    expect(pickFailoverCandidate({ candidates: onlyPlatform, ...base })?.key).toBe(platform.key)
  })

  it("本地自用域不选平台内置（平台令牌恒空必然 412，与 ModelSelect 禁用口径一致）", () => {
    const onlyPlatform = [failed, platform]
    expect(pickFailoverCandidate({ candidates: onlyPlatform, ...base, localDeploy: true })).toBeNull()
    expect(
      pickFailoverCandidate({ candidates: all, ...base, localDeploy: true })?.key,
    ).toBe(otherDefault.key)
  })


  it("失败通道自身绝不入选；无可用候选返回 null", () => {
    expect(pickFailoverCandidate({ candidates: [failed], ...base })).toBeNull()
    expect(pickFailoverCandidate({ candidates: [], ...base })).toBeNull()
  })

  it("平台内置通道自身失败绝不跨源回退到个人通道（不静默改用用户付费账户）", () => {
    expect(
      pickFailoverCandidate({
        candidates: all,
        ...base,
        failedKey: platform.key,
        failedConfigId: "plat",
        failedSource: "platform",
      }),
    ).toBeNull()
    expect(pickFailoverCandidate({ candidates: all, ...base, failedSource: null })).toBeNull()
  })
})

describe("shouldShowFailoverNotice —— 30s 去重窗", () => {
  it("窗内只说一次，过窗后可再说", () => {
    expect(shouldShowFailoverNotice(10_000)).toBe(true)
    expect(shouldShowFailoverNotice(20_000)).toBe(false)
    expect(shouldShowFailoverNotice(41_000)).toBe(true)
  })
})

describe("tryFailoverCall —— 编排", () => {
  const failed = mkCand(mkRef({ configId: "c1", modelId: "deepseek-chat" }))
  const spare = mkCand(mkRef({ configId: "c2", configName: "配置二", modelId: "glm-4.5" }), true)

  const mkDeps = (over: Partial<FailoverDeps> = {}): FailoverDeps => ({
    chat: vi.fn(async () => okRes("备用通道正文")),
    candidates: vi.fn(async () => [failed, spare]),
    notify: vi.fn(),
    localDeploy: () => false,
    now: () => 1_000,
    ...over,
  })

  it("成功 / 需登录的首调直接结束，不出第二枪", async () => {
    const chat = vi.fn(async () => okRes("备用通道正文"))
    const deps = mkDeps({ chat })
    expect(await tryFailoverCall({ first: okRes("正文"), failed, deps })).toBeNull()
    expect(await tryFailoverCall({ first: { ...failRes("rh_login_required"), needsLogin: true }, failed, deps })).toBeNull()
    expect(chat).not.toHaveBeenCalled()
  })


  it("限流换通道成功：返回备用结果并带 actualModelRefKey，提示一次并清备用通道旧账", async () => {
    const chat = vi.fn(async () => okRes("备用通道正文"))
    const notify = vi.fn()
    const deps = mkDeps({ chat, notify })
    const out = await tryFailoverCall({
      first: failRes("所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型"),
      failed,
      deps,
    })
    // 冷却机制已停用（用户裁定 2026-10-15）：本用例只锁「限流 → 换道成功」的回退主链路行为
    expect(out).not.toBeNull()
    expect(out?.text).toBe("备用通道正文")
    expect(out?.actualModelRefKey).toBeTruthy()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it("备用通道成功但正文为空视作未产出，不回退判定、不打扰用户", async () => {
    const notify = vi.fn()
    const deps = mkDeps({ chat: vi.fn(async () => okRes("   ")), notify })
    const out = await tryFailoverCall({
      first: failRes("所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型"),
      failed,
      deps,
    })
    expect(out).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })
})

// 冷却机制已按用户裁定停用（2026-10-15）：实测无任何真实失败也会显示「冷却中 · 约 115s ×2」
// 并盖住整条配置下所有模型。这里锁死"停用后的口径"：打戳无效、查询恒为空、候选不再因冷却被排除。
describe("通道冷却已停用（用户裁定 2026-10-15）", () => {
  it("打戳无效：查询恒为非冷却、剩余恒为 0、连击恒为 0", () => {
    resetChannelCooling()
    expect(markChannelCooling("k1")).toBe(0)
    expect(isChannelCooling("k1")).toBe(false)
    expect(channelCoolingRemainingMs("k1")).toBe(0)
    expect(channelCoolingStrikes("k1")).toBe(0)
  })
})
