// 模型网关「推理模型输出预算耗尽」修复的回归测试（R216，2026-10-12）
//
// 被测对象：pocketbase/pb_hooks/model_gateway.pb.js 中 chat / test 两个路由内的
// chatOnce / testChatOnce / doChat / testDoChat 响应解析与重试决策。
//
// 为什么必须测这里（真实踩坑数据）：
//   2026-10-12 实测：同一模型同一问题，max_tokens=30 时 5/5 全失败，
//   max_tokens=40 即成功；usage 显示 reasoning_tokens=106——推理模型把输出预算
//   全吃掉做思考，content 恒空。原实现直接 return「返回格式异常，回复内容为空」，
//   文案掩盖真实成因、不自动恢复，在投标 deadline 前夜表现为"随机失败"。
//
// 提取方式与 intelShared.test.ts 同构：读取钩子源码 → 截取目标函数声明 → eval 到受控作用域，
// 注入 $http / $app 桩。好处是测试与运行时永远同一份实现，钩子改了算法而测试未更新时这里立刻红。
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const HOOK_PATH = join(__dirname, "..", "pocketbase", "pb_hooks", "model_gateway.pb.js")

interface ChatResult {
  ok: boolean
  text?: string
  elapsed_ms?: number
  usage?: unknown
  retryReasoning?: boolean
  reasoning_tokens?: number
  message?: string
}

type ChatFn = (
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: unknown[],
  maxTokens: number,
  temperature: number | null,
  timeoutSec: number,
  disableThinking: boolean,
) => ChatResult

interface Harness {
  chatOnce: ChatFn
  doChat: ChatFn
  sentPayloads: Array<Record<string, unknown>>
}

/**
 * 从钩子源码抽出 chat 路由的 chatOnce + doChat 两个函数声明并求值。
 * @param responder 模拟上游：按 (url, 第几次调用) 返回 {statusCode, raw}
 */
function loadChatHarness(responder: (url: string, callIndex: number) => { statusCode: number; raw: string }): Harness {
  const src = readFileSync(HOOK_PATH, "utf8")
  // chat 路由的 chatOnce / doChat 两个函数声明（注意 test 路由也有同名 doChat，取靠后的一对）。
  // 锚点用函数声明首行 + chat 路由专属的 maxTokens 解析行，三者皆随钩子结构变化而失效，
  // 失效时本测试立即红，不会静默测错函数。
  const begin = src.indexOf("var chatOnce = function")
  const doChatAt = src.indexOf("var doChat = function", begin)
  const end = src.indexOf("var body = e.requestInfo().body || {}", doChatAt)
  expect(begin, "未能定位 chatOnce（钩子结构可能已变，请同步本测试）").toBeGreaterThan(-1)
  expect(doChatAt, "未能定位 chat 路由的 doChat").toBeGreaterThan(begin)
  expect(end, "未能定位 chatOnce/doChat 区段终点").toBeGreaterThan(doChatAt)

  const section = src.slice(begin, end)
  const sentPayloads: Array<Record<string, unknown>> = []
  let callIndex = 0
  const scope = {
    // 桩：$http.send 记录出站请求体并交给用例注入的 responder 决定响应
    $http: {
      send: (req: { url: string; body: string }) => {
        sentPayloads.push(JSON.parse(req.body) as Record<string, unknown>)
        const r = responder(req.url, callIndex)
        callIndex += 1
        return { statusCode: r.statusCode, raw: r.raw }
      },
    },
    $app: {
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    },
  }
  // 源码里含「${」的正则字面量，必须用普通字符串拼接进 new Function，不能用模板字符串
  const body = [
    "var MAX_CHAT_TOKENS = 16384;",
    "var MIN_REASONING_RETRY_TOKENS = 1024;",
    "var REASONING_RETRY_FACTOR = 4;",
    section,
    "return { chatOnce: chatOnce, doChat: doChat };",
  ].join("\n")
  const fn = new Function("$http", "$app", body) as (
    http: unknown,
    app: unknown,
  ) => { chatOnce: ChatFn; doChat: ChatFn }
  const r = fn(scope.$http, scope.$app)
  return { chatOnce: r.chatOnce, doChat: r.doChat, sentPayloads }
}

/** 构造 OpenAI 兼容响应体（content 正常有值时用） */
function okBody(content: string, finish = "stop") {
  return JSON.stringify({
    choices: [{ message: { role: "assistant", content }, finish_reason: finish }],
    usage: { completion_tokens: 12 },
  })
}

/**
 * 构造「思考耗尽预算」响应体：content 空、finish_reason=length、usage 报 reasoning_tokens。
 * 注意 reasoning_content 刻意留空——实测真实场景里模型把预算全花在思考上、
 * 正文根本没生成出来（content 与 reasoning_content 同时为空，只有 usage 留下痕迹）。
 * 若在 reasoning_content 里填真实文本，兜底①会（正确地）把它当正文取用，那就测不到本条路径了。
 */
function exhaustedBody(reasoningTokens = 106) {
  return JSON.stringify({
    choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
    usage: { completion_tokens: reasoningTokens, completion_tokens_details: { reasoning_tokens: reasoningTokens } },
  })
}

/** 只带 reasoning_content、content 为空的响应（验证兜底①取思考字段作正文） */
function reasoningOnlyBody(reasoning: string) {
  return JSON.stringify({
    choices: [{ message: { role: "assistant", content: "", reasoning_content: reasoning }, finish_reason: "stop" }],
    usage: { completion_tokens: 20 },
  })
}

const ARGS = ["https://api.example.test", "sk-test", "sensenova-6.8-flash-lite", [{ role: "user", content: "回复：可用" }]] as const

describe("R216 网关响应解析：正文提取（正常路径不回退）", () => {
  it("content 有值时直接取用，不触发任何重试", () => {
    const h = loadChatHarness(() => ({ statusCode: 200, raw: okBody("可用") }))
    const r = h.doChat(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(true)
    expect(r.text).toBe("可用")
    expect(h.sentPayloads).toHaveLength(1)
  })

  it("兜底①：content 空但 reasoning_content 有正文时，取 reasoning_content（不误报失败）", () => {
    const h = loadChatHarness(() => ({ statusCode: 200, raw: reasoningOnlyBody("思考后给出的正文") }))
    const r = h.chatOnce(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(true)
    expect(r.text).toBe("思考后给出的正文")
  })

  it("上游用 reasoning 字段（非 reasoning_content）时同样兜底", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "", reasoning: "备用字段的正文" }, finish_reason: "stop" }],
      usage: {},
    })
    const h = loadChatHarness(() => ({ statusCode: 200, raw }))
    const r = h.chatOnce(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(true)
    expect(r.text).toBe("备用字段的正文")
  })
})

describe("R216 网关重试决策：思考耗尽预算必须可自动恢复", () => {
  it("判定为预算耗尽时打上 retryReasoning 标记（供上层升预算重试）", () => {
    // content 空 + finish_reason=length + reasoning_tokens=106 —— 实测 30 token 时的真实形态
    const h = loadChatHarness(() => ({ statusCode: 200, raw: exhaustedBody(106) }))
    const r = h.chatOnce(...ARGS, 30, null, 60, false)
    expect(r.ok).toBe(false)
    expect(r.retryReasoning).toBe(true)
    expect(r.reasoning_tokens).toBe(106)
  })

  it("端到端恢复：首次预算耗尽 → doChat 自动升预算重试 → 第二次成功（用户无感）", () => {
    const h = loadChatHarness((_url, i) =>
      i === 0 ? { statusCode: 200, raw: exhaustedBody() } : { statusCode: 200, raw: okBody("可用") },
    )
    const r = h.doChat(...ARGS, 30, null, 60, false)
    expect(r.ok).toBe(true)
    expect(r.text).toBe("可用")
    // 第二次请求的 max_tokens 必须已提升，且不低于下限 1024
    expect(h.sentPayloads).toHaveLength(2)
    const second = h.sentPayloads[1].max_tokens as number
    expect(second).toBeGreaterThan(30)
    expect(second).toBeGreaterThanOrEqual(1024)
  })

  it("升预算倍数口径：max(原值×4, 1024)，且不超过 16384 上限", () => {
    // 原值 2000 → 8000
    const h1 = loadChatHarness((_u, i) => (i === 0 ? { statusCode: 200, raw: exhaustedBody() } : { statusCode: 200, raw: okBody("OK") }))
    h1.doChat(...ARGS, 2000, null, 60, false)
    expect(h1.sentPayloads[1].max_tokens).toBe(8000)

    // 原值 100（低于下限）→ 抬到 1024
    const h2 = loadChatHarness((_u, i) => (i === 0 ? { statusCode: 200, raw: exhaustedBody() } : { statusCode: 200, raw: okBody("OK") }))
    h2.doChat(...ARGS, 100, null, 60, false)
    expect(h2.sentPayloads[1].max_tokens).toBe(1024)

    // 原值已达上限 16384 → 不再重试（无升档空间，避免无意义重复计费）
    const h3 = loadChatHarness(() => ({ statusCode: 200, raw: exhaustedBody() }))
    const r3 = h3.doChat(...ARGS, 16384, null, 60, false)
    expect(r3.ok).toBe(false)
    expect(h3.sentPayloads).toHaveLength(1)
  })

  it("只重试一次：第二次仍耗尽则返回失败，不做无界重试", () => {
    const h = loadChatHarness(() => ({ statusCode: 200, raw: exhaustedBody() }))
    const r = h.doChat(...ARGS, 30, null, 60, false)
    expect(r.ok).toBe(false)
    expect(h.sentPayloads).toHaveLength(2)
  })
})

describe("R216 网关失败文案：不得再用「格式异常」掩盖真实原因", () => {
  it("预算耗尽时文案直说「思考阶段」并给出可执行动作", () => {
    const h = loadChatHarness(() => ({ statusCode: 200, raw: exhaustedBody() }))
    const r = h.chatOnce(...ARGS, 30, null, 60, false)
    expect(r.message).toContain("思考")
    expect(r.message).not.toContain("格式异常")
  })

  it("真·空响应（无思考痕迹、无截断）才报格式异常，并提示核对模型 ID", () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: {} })
    const h = loadChatHarness(() => ({ statusCode: 200, raw }))
    const r = h.chatOnce(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(false)
    expect(r.retryReasoning).toBeFalsy()
    expect(r.message).toContain("模型 ID")
  })

  it("非 JSON 响应提示「上游响应」而非含糊的「无法解析回复内容」", () => {
    const h = loadChatHarness(() => ({ statusCode: 200, raw: "<html>502 Bad Gateway</html>" }))
    const r = h.chatOnce(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(false)
    expect(r.message).toContain("上游")
  })
})

describe("R216 网关其他失败路径不得被修复带偏（回归护栏）", () => {
  it("401/403 → 认证失败文案不变（不误判为推理问题）", () => {
    const h = loadChatHarness(() => ({ statusCode: 401, raw: "" }))
    const r = h.doChat(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(false)
    expect(r.retryReasoning).toBeFalsy()
    expect(r.message).toContain("认证失败")
  })

  it("429 → 限流文案不变（不触发升预算重试，避免重复计费）", () => {
    const h = loadChatHarness(() => ({ statusCode: 429, raw: "" }))
    const r = h.doChat(...ARGS, 30, null, 60, false)
    expect(r.ok).toBe(false)
    expect(r.retryReasoning).toBeFalsy()
    expect(r.message).toContain("限流")
    expect(h.sentPayloads).toHaveLength(1)
  })

  it("500 → 服务不可用文案不变", () => {
    const h = loadChatHarness(() => ({ statusCode: 500, raw: "" }))
    const r = h.doChat(...ARGS, 2000, null, 60, false)
    expect(r.ok).toBe(false)
    expect(r.message).toContain("服务暂时不可用")
  })

  it("disableThinking 时出站带关闭思考参数（原 T13 能力不得回退）", () => {
    const h = loadChatHarness(() => ({ statusCode: 200, raw: okBody("可用") }))
    h.doChat(...ARGS, 2000, null, 60, true)
    expect(h.sentPayloads[0].thinking).toEqual({ type: "disabled" })
    expect(h.sentPayloads[0].reasoning_effort).toBe("none")
  })

  it("temperature 合法时透传、非法（null）时不传", () => {
    const h1 = loadChatHarness(() => ({ statusCode: 200, raw: okBody("OK") }))
    h1.doChat(...ARGS, 2000, 0.7, 60, false)
    expect(h1.sentPayloads[0].temperature).toBe(0.7)

    const h2 = loadChatHarness(() => ({ statusCode: 200, raw: okBody("OK") }))
    h2.doChat(...ARGS, 2000, null, 60, false)
    expect("temperature" in h2.sentPayloads[0]).toBe(false)
  })
})