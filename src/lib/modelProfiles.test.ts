// R-038 模型擅长知识表单测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import { KNOWN_MODEL_PROFILES, inferFromName, resolveModelProfile } from "./modelProfiles"

describe("R-038 KNOWN_MODEL_PROFILES", () => {
  it("覆盖截图里的 10 个 opencode 常见模型", () => {
    for (const id of [
      "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-flash",
      "deepseek-v4.1-flash", "deepseek-v4-pro",
      "glm-5.1", "glm-5.2", "glm-5.3",
      "grok-4.6", "grok-4.7",
    ]) {
      expect(KNOWN_MODEL_PROFILES[id], `内置表应覆盖 ${id}`).toBeDefined()
      expect(KNOWN_MODEL_PROFILES[id].specialty.length).toBeGreaterThan(0)
    }
  })
})

describe("R-038 inferFromName 名称推断兜底", () => {
  it("含 vision 词根→视觉", () => {
    expect(inferFromName("some-vision-model")?.tags).toContain("视觉")
    expect(inferFromName("qwen2-vl-7b")?.tags).toContain("视觉")
  })
  it("含 flash/mini→快速", () => {
    expect(inferFromName("moe-flash")?.tags).toContain("快速")
    expect(inferFromName("gpt-mini")?.tags).toContain("快速")
  })
  it("含 pro/max→旗舰", () => {
    expect(inferFromName("unknown-pro")?.tags).toContain("旗舰")
    expect(inferFromName("moe-max")?.tags).toContain("旗舰")
  })
  it("空/无词根→null", () => {
    expect(inferFromName("")).toBeNull()
    expect(inferFromName("xyzabc")).toBeNull()
  })
})

describe("R-038 resolveModelProfile 三层合并", () => {
  it("用户标注优先级最高", () => {
    const r = resolveModelProfile("deepseek-v4-flash", "用户自定义擅长", ["a"])
    expect(r.source).toBe("user")
    expect(r.profile?.specialty).toBe("用户自定义擅长")
  })
  it("无用户标注 + 内置命中→known", () => {
    const r = resolveModelProfile("deepseek-v4-flash")
    expect(r.source).toBe("known")
  })
  it("内置未命中 + 名称可推断→inferred", () => {
    const r = resolveModelProfile("brandnew-vision-1")
    expect(r.source).toBe("inferred")
    expect(r.profile?.tags).toContain("视觉")
  })
  it("三层全空→none", () => {
    const r = resolveModelProfile("xyzabc")
    expect(r.source).toBe("none")
    expect(r.profile).toBeNull()
  })
  it("前缀匹配：deepseek-v4-flash-2026-01 命中 deepseek-v4-flash", () => {
    const r = resolveModelProfile("deepseek-v4-flash-2026-01")
    expect(r.source).toBe("known")
  })
})
