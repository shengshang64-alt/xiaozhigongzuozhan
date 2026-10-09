import { describe, expect, it, vi } from "vitest"
import {
  buildAvailableModels,
  buildFailoverCandidates,
  costTextForModel,
  PERSONAL_TIMEOUT_MSG,
  personalTimeoutError,
  nextDegradedBudget,
  shouldDegradeRetry,
  TIMEOUT_RETRY_MIN_TOKENS,
  modelRefKey,
  modelRefLabel,
  type AvailableModels,
  type GatewayConfig,
  type GatewayConfigModel,
  type ModelRef,
} from "./modelGateway"

// R203：modelGateway 因「回退成功的可见提示」开始 import sonner；
// node 测试环境无 DOM，按项目既有惯例（clipboard.test.ts / globalErrorCatch.test.ts）mock 掉。
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))

const mkCfg = (over: Partial<GatewayConfig> & { id: string }): GatewayConfig => ({
  config_name: over.id,
  base_url: "https://example.test/v1",
  api_key_masked: "sk-****",
  has_key: true,
  models: [],
  default_model: "",
  is_platform: false,
  last_check_status: "",
  last_check_error: "",
  last_checked_at: "",
  created: "",
  updated: "",
  ...over,
})

const en = (id: string): GatewayConfigModel => ({ id, enabled: true })

describe("buildAvailableModels", () => {
  it("空配置返回空集合", () => {
    expect(buildAvailableModels([])).toEqual({ models: [], defaultRef: null, platformRef: null })
  })

  it("跳过未启用与空模型", () => {
    const cfg = mkCfg({
      id: "c1",
      models: [en("gpt-a"), { id: "gpt-b", enabled: false }, null as unknown as GatewayConfigModel],
    })
    const r = buildAvailableModels([cfg])
    expect(r.models.map((m) => m.modelId)).toEqual(["gpt-a"])
  })

  it("平台配置映射 source=platform 且成为 platformRef", () => {
    const cfg = mkCfg({ id: "plat", is_platform: true, models: [en("gpt-5.5")] })
    const r = buildAvailableModels([cfg])
    expect(r.platformRef?.source).toBe("platform")
    expect(r.models[0]).toMatchObject({ source: "platform", configId: "plat", modelId: "gpt-5.5" })
  })

  it("无显式默认时 defaultRef 回退到平台模型", () => {
    const cfg = mkCfg({ id: "plat", is_platform: true, default_model: "", models: [en("gpt-5.5")] })
    const r = buildAvailableModels([cfg])
    expect(r.defaultRef?.modelId).toBe("gpt-5.5")
    expect(r.defaultRef).toEqual(r.platformRef)
  })

  it("个人配置的 default_model 命中该模型且优先于平台回退", () => {
    const plat = mkCfg({ id: "plat", is_platform: true, models: [en("gpt-5.5")] })
    const personal = mkCfg({
      id: "p1",
      config_name: "myacct",
      default_model: "deepseek-chat",
      models: [en("deepseek-chat")],
    })
    const r = buildAvailableModels([plat, personal])
    expect(r.defaultRef?.source).toBe("personal")
    expect(r.defaultRef?.modelId).toBe("deepseek-chat")
    expect(r.platformRef?.modelId).toBe("gpt-5.5")
  })

  it("默认模型未启用则不入选（defaultRef 与 models 皆空）", () => {
    const cfg = mkCfg({ id: "p1", default_model: "off", models: [{ id: "off", enabled: false }] })
    const r = buildAvailableModels([cfg])
    expect(r.models).toHaveLength(0)
    expect(r.defaultRef).toBeNull()
  })
})

describe("modelRefKey / modelRefLabel / costTextForModel", () => {
  const personal: ModelRef = { source: "personal", configId: "c1", configName: "myacct", modelId: "deepseek-chat" }
  const platform: ModelRef = { source: "platform", configId: "plat", configName: "platform", modelId: "gpt-5.5" }

  it("modelRefKey 拼三段唯一键", () => {
    expect(modelRefKey(personal)).toBe("personal:c1:deepseek-chat")
    expect(modelRefKey(platform)).toBe("platform:plat:gpt-5.5")
  })

  it("modelRefLabel 平台/个人两种文案", () => {
    const platLabel = modelRefLabel(platform)
    expect(platLabel).toContain("gpt-5.5")
    expect(platLabel).toContain("\u5e73\u53f0\u5185\u7f6e")
    const perLabel = modelRefLabel(personal)
    expect(perLabel).toContain("myacct")
    expect(perLabel).toContain("deepseek-chat")
  })

  it("costTextForModel 个人承担 vs 平台扣费", () => {
    expect(costTextForModel(personal)).toContain("\u8d39\u7528\u7531\u8be5\u8d26\u6237\u627f\u62c5")
    expect(costTextForModel(platform)).toContain("token")
    expect(costTextForModel(null)).toBe(costTextForModel(platform))
  })
})

describe("R177 个人模型超时文案与归一", () => {
  it("PERSONAL_TIMEOUT_MSG 给可执行 remedy，且不再把用户推向本地禁用的平台内置模型", () => {
    expect(PERSONAL_TIMEOUT_MSG).toContain("更快的已配置模型")
    expect(PERSONAL_TIMEOUT_MSG).toContain("120")
    expect(PERSONAL_TIMEOUT_MSG).not.toContain("切换平台内置模型")
    expect(PERSONAL_TIMEOUT_MSG).toMatch(/[一-鿿]/)
  })

  it("personalTimeoutError 命中客户端/服务端超时串一律归一", () => {
    expect(personalTimeoutError("个人模型请求超时（可能网络波动或服务重启）")).toBe(PERSONAL_TIMEOUT_MSG)
    expect(personalTimeoutError("请求超时，对方接口未在限定时间内返回，可稍后重试或切换模型")).toBe(PERSONAL_TIMEOUT_MSG)
    expect(personalTimeoutError("Upstream request timed out after 120s")).toBe(PERSONAL_TIMEOUT_MSG)
  })

  it("非超时返回 null，保留原始可读信息", () => {
    expect(personalTimeoutError("内容审核未通过，请调整措辞后重试")).toBeNull()
    expect(personalTimeoutError("")).toBeNull()
    expect(personalTimeoutError()).toBeNull()
  })
})

describe("R178 超时降级重试恢复契约（纯函数，锁死 R177 修复防回退）", () => {
  it("nextDegradedBudget 逐次折半且不低于下限", () => {
    expect(nextDegradedBudget(8192)).toBe(4096)
    expect(nextDegradedBudget(4096)).toBe(TIMEOUT_RETRY_MIN_TOKENS)
    expect(nextDegradedBudget(TIMEOUT_RETRY_MIN_TOKENS)).toBe(TIMEOUT_RETRY_MIN_TOKENS)
    expect(nextDegradedBudget(1024)).toBe(TIMEOUT_RETRY_MIN_TOKENS)
  })

  it("shouldDegradeRetry 仅对超时失败为真", () => {
    expect(shouldDegradeRetry(false, PERSONAL_TIMEOUT_MSG)).toBe(true)
    expect(shouldDegradeRetry(false, "请求超时，对方接口未在限定时间内返回，可稍后重试")).toBe(true)
    expect(shouldDegradeRetry(false, "Upstream request timed out after 120s")).toBe(true)
  })

  it("成功 / 取消 / 非超时失败一律不触发降级（避免无谓重试计费）", () => {
    expect(shouldDegradeRetry(true, "")).toBe(false)
    expect(shouldDegradeRetry(false, "user_cancelled")).toBe(false)
    expect(shouldDegradeRetry(false, "内容审核未通过，请调整措辞后重试")).toBe(false)
  })
})

describe("R203 buildFailoverCandidates（自动回退候选口径，纯函数）", () => {
  const avOf = (configs: GatewayConfig[]): AvailableModels => ({
    configs,
    ...buildAvailableModels(configs),
  })

  it("只保留文本生成模型：向量 / 图像 / 视频 / 语音模型绝不作为回退候选", () => {
    const cfg = mkCfg({
      id: "p1",
      models: [
        en("deepseek-chat"),
        en("bge-m3"),
        en("jimeng-4k"),
        en("sora-v"),
        en("cosyvoice-v1"),
        en("whisper"),
      ],
    })
    const items = buildFailoverCandidates(avOf([cfg]))
    expect(items.map((c) => c.ref.modelId)).toEqual(["deepseek-chat"])
    expect(items[0].key).toBe("personal:p1:deepseek-chat")
    expect(items[0].configId).toBe("p1")
  })

  it("未启用的模型不入选（沿用 buildAvailableModels 单一真源口径）", () => {
    const cfg = mkCfg({
      id: "p1",
      models: [en("deepseek-chat"), { id: "glm-4.5", enabled: false }],
    })
    expect(buildFailoverCandidates(avOf([cfg])).map((c) => c.ref.modelId)).toEqual(["deepseek-chat"])
  })

  it("标记各配置自身的默认模型，平台配置同样按 platform: 前缀命中", () => {
    const plat = mkCfg({
      id: "plat",
      is_platform: true,
      default_model: "gpt-5.5",
      models: [en("gpt-5.5"), en("gpt-4")],
    })
    const p1 = mkCfg({
      id: "p1",
      config_name: "myacct",
      default_model: "glm-4.5",
      models: [en("glm-4.5"), en("deepseek-chat")],
    })
    const items = buildFailoverCandidates(avOf([plat, p1]))
    const hit = (key: string) => items.find((c) => c.key === key)?.isConfigDefault
    expect(hit("personal:p1:glm-4.5")).toBe(true)
    expect(hit("personal:p1:deepseek-chat")).toBe(false)
    expect(hit("platform:plat:gpt-5.5")).toBe(true)
    expect(hit("platform:plat:gpt-4")).toBe(false)
  })

  it("都没设默认模型时全为 false（不抛错、不影响候选可用性）", () => {
    const cfg = mkCfg({ id: "p1", default_model: "", models: [en("deepseek-chat")] })
    const items = buildFailoverCandidates(avOf([cfg]))
    expect(items).toHaveLength(1)
    expect(items[0].isConfigDefault).toBe(false)
  })

  it("空清单返回空数组（无备用通道时上层原样透出首调错误）", () => {
    expect(buildFailoverCandidates(avOf([]))).toEqual([])
  })
})
