import { describe, expect, it } from "vitest"
import {
  buildAvailableModels,
  costTextForModel,
  modelRefKey,
  modelRefLabel,
  type GatewayConfig,
  type GatewayConfigModel,
  type ModelRef,
} from "./modelGateway"

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
