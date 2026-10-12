// ---------------------------------------------------------------------------
// R203（docs/13 §3.3）：模型通道级自动回退决策内核单测。
// 失败分类逐条采用 pocketbase/pb_hooks/model_gateway.pb.js doChat 的真实文案（红线区，
// 文案即稳定契约），保证「网关说什么」与「前端怎么判」永远对齐；编排用注入 fake deps，
// 零网络 / 零 DOM（environment=node）。
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmCallResult } from "@/lib/llm"
import {
  BASE_COOL_MS_FOR_TEST,
  MAX_COOL_MS_FOR_TEST,
  channelCoolingRemainingMs,
  channelCoolingStrikes,
  classifyCallFailure,
  clearChannelCooling,
  configCoolingKey,
  coolingKeysForFailure,
  isChannelCooling,
  isFailoverEligible,
  markChannelCooling,
  onCoolingChange,
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

  it("R208：config_broken 按账号级失败冷却「整配置 + 该模型」，把坏配置从后续候选中剔除", () => {
    const cand = mkCand(mkRef({ modelId: "deepseek-chat", configId: "c1" }))
    expect(coolingKeysForFailure("config_broken", cand).sort()).toEqual(
      [cand.key, configCoolingKey("c1")].sort(),
    )
  })

  it("平台通道与前端兜底文案", () => {
    expect(classifyCallFailure("insufficient_balance")).toBe("rate_limit")
    expect(classifyCallFailure("Upstream rate limit exceeded (TPM)")).toBe("rate_limit")
    expect(classifyCallFailure("网络异常，请稍后重试")).toBe("unavailable")
    expect(classifyCallFailure("服务异常（HTTP 500），请稍后重试")).toBe("unavailable")
  })

  it("内容审核 / 参数错误等明确失败判 other（不盲目换通道，也不打冷却）", () => {
    expect(classifyCallFailure("内容审核未通过，请调整措辞后重试")).toBe("other")
    expect(classifyCallFailure("接口返回异常（HTTP 400）：max_tokens 超出上限")).toBe("other")
    expect(classifyCallFailure("")).toBe("other")
    expect(classifyCallFailure(undefined)).toBe("other")
  })
})

describe("isFailoverEligible —— 可回退真值表", () => {
  it("仅账号级不可用四类为真", () => {
    for (const cls of ["rate_limit", "auth", "model_disabled", "unavailable"] as const) {
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
  it("首击 60s；连击在窗内逐次拉长并封顶", () => {
    const k = "personal:c1:deepseek-chat"
    expect(markChannelCooling(k, 0)).toBe(BASE_COOL_MS_FOR_TEST)
    expect(markChannelCooling(k, 1_000)).toBe(BASE_COOL_MS_FOR_TEST * 2)
    expect(channelCoolingStrikes(k)).toBe(2)
    expect(isChannelCooling(k, 2_000)).toBe(true)
    // 第二个窗（2000 + 120000）之后到期：条目自动清、连击归零
    expect(isChannelCooling(k, 130_000)).toBe(false)
    expect(channelCoolingStrikes(k)).toBe(0)
    for (let i = 0; i < 12; i++) markChannelCooling(k, i * 10)
    expect(markChannelCooling(k, 1_000)).toBe(MAX_COOL_MS_FOR_TEST)
    expect(channelCoolingStrikes(k)).toBe(13)
  })

  it("窗过自动清；显式清除即时生效", () => {
    const k = "personal:c1:glm-4.5"
    markChannelCooling(k, 0)
    expect(isChannelCooling(k, 10_000)).toBe(true)
    clearChannelCooling(k)
    expect(isChannelCooling(k, 10_000)).toBe(false)
  })

  it("R233 剩余倒计时：窗内为剩余毫秒、窗外归零、显式清除即返回 0（纯读不剪枝）", () => {
    const k = "personal:c1:deepseek-chat"
    expect(channelCoolingRemainingMs(k, 0)).toBe(0)
    markChannelCooling(k, 1000) // 首击 60s → until = 61000
    expect(channelCoolingRemainingMs(k, 1000)).toBe(BASE_COOL_MS_FOR_TEST - 0)
    expect(channelCoolingRemainingMs(k, 31_000)).toBe(30_000)
    // 纯读不剪枝：窗已过返回 0，但连击计数仍在（区别于 isChannelCooling 会自动清）
    expect(channelCoolingRemainingMs(k, 100_000)).toBe(0)
    expect(channelCoolingStrikes(k)).toBe(1)
    clearChannelCooling(k)
    expect(channelCoolingRemainingMs(k, 1000)).toBe(0)
  })

  it("R233 onCoolingChange：打戳 / 清除 / 复位都通知，退订后不再收到", () => {
    const k = "personal:c9:glm-4.5"
    resetChannelCooling()
    let hits = 0
    const off = onCoolingChange(() => hits++)
    markChannelCooling(k, 0)
    expect(hits).toBe(1)
    clearChannelCooling(k)
    expect(hits).toBe(2)
    // 清除不存在的键不应空通知
    clearChannelCooling(k)
    expect(hits).toBe(2)
    off()
    markChannelCooling(k, 0)
    expect(hits).toBe(2)
    resetChannelCooling()
  })

  it("配置级键独立于模型级键（同账号换模型同样撞窗）", () => {
    expect(configCoolingKey("c1")).toBe("cfg:c1")
    const c = mkCand(mkRef({ modelId: "a" }))
    expect(coolingKeysForFailure("rate_limit", c)).toEqual(["cfg:c1", "personal:c1:a"])
    expect(coolingKeysForFailure("auth", c)).toEqual(["cfg:c1", "personal:c1:a"])
  })

  it("模型已停用只冷却那一路；不可回退类与无失败通道不打冷却", () => {
    const c = mkCand(mkRef({ modelId: "a" }))
    expect(coolingKeysForFailure("model_disabled", c)).toEqual(["personal:c1:a"])
    expect(coolingKeysForFailure("timeout", c)).toEqual([])
    expect(coolingKeysForFailure("other", c)).toEqual([])
    expect(coolingKeysForFailure("rate_limit", null)).toEqual([])
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

  it("冷却中的通道 / 冷却中的配置整条被排除", () => {
    markChannelCooling(otherDefault.key, 0)
    expect(pickFailoverCandidate({ candidates: all, ...base })?.key).toBe(otherPlain.key)
    clearChannelCooling(otherDefault.key)
    markChannelCooling(configCoolingKey("c2"), 0)
    expect(pickFailoverCandidate({ candidates: all, ...base })?.key).toBe(sameCfgOther.key)
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

  it("超时不回退，也不给通道打冷却（留给 R177/R180 降级阶梯）", async () => {
    const chat = vi.fn(async () => okRes("备用通道正文"))
    const deps = mkDeps({ chat })
    const first = failRes("请求超时，对方接口未在限定时间内返回，可稍后重试或切换模型")
    expect(await tryFailoverCall({ first, failed, deps })).toBeNull()
    expect(chat).not.toHaveBeenCalled()
    expect(isChannelCooling(failed.key, 2_000)).toBe(false)
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
    expect(out).toMatchObject({ ok: true, text: "备用通道正文", actualModelRefKey: spare.key })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat).toHaveBeenCalledWith(spare.ref)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toEqual(failed.ref)
    expect(notify.mock.calls[0][1]).toEqual(spare.ref)
    // 失败通道（含整条配置）被打冷却，备用通道被证实可用不留账
    expect(isChannelCooling(failed.key, 6_000)).toBe(true)
    expect(isChannelCooling(configCoolingKey("c1"), 6_000)).toBe(true)
    expect(isChannelCooling(spare.key, 6_000)).toBe(false)
  })

  it("备用通道也失败：返回 null 交回首调错误，并按第二路错误类别补打冷却、不提示", async () => {
    const notify = vi.fn()
    const deps = mkDeps({
      chat: vi.fn(async () => failRes("所配置模型的服务暂时不可用（HTTP 503），请稍后重试")),
      notify,
    })
    const first = failRes("认证失败，请检查所配置模型的 API Key 是否有效")
    expect(await tryFailoverCall({ first, failed, deps })).toBeNull()
    expect(notify).not.toHaveBeenCalled()
    expect(isChannelCooling(spare.key, 2_000)).toBe(true)
    expect(isChannelCooling(configCoolingKey("c2"), 2_000)).toBe(true)
  })

  it("无可用候选时仍给失败通道打冷却（后续调用不再重复撞窗）", async () => {
    const chat = vi.fn(async () => okRes("备用通道正文"))
    const deps = mkDeps({ chat, candidates: vi.fn(async () => [failed]) })
    expect(await tryFailoverCall({ first: failRes("接口地址无法连通，请检查模型配置"), failed, deps })).toBeNull()
    expect(chat).not.toHaveBeenCalled()
    expect(isChannelCooling(failed.key, 2_000)).toBe(true)
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
