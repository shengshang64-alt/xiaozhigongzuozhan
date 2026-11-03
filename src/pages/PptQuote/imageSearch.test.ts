import { describe, expect, it } from "vitest"
import { buildSearchQuery, translateQuery } from "./imageSearch"

// ---------------------------------------------------------------------------
// 联网搜图/自动配图相关的纯函数回归（不发网络请求；key 走 localStorage 不在此覆盖）
// ---------------------------------------------------------------------------

describe("translateQuery", () => {
  it("中文关键词按词表回退到英文，命中优先", () => {
    expect(translateQuery("医院门诊大楼")).toMatch(/hospital/i)
    expect(translateQuery("医院门诊大楼")).toMatch(/outpatient/i)
    expect(translateQuery("医院门诊大楼")).toMatch(/building/i)
  })

  it("英文原样透传，不做二次加工", () => {
    expect(translateQuery("operating room")).toBe("operating room")
  })

  it("中英混排：保留英文，未命中中文剥离", () => {
    const out = translateQuery("智慧医院 PACS")
    expect(out).toMatch(/PACS/)
    expect(out).toMatch(/smart/i)
    expect(out).toMatch(/hospital/i)
  })

  it("空串返回空，不抛错", () => {
    expect(translateQuery("   ")).toBe("")
  })
})

describe("buildSearchQuery", () => {
  it("优先使用 imageHint", () => {
    expect(buildSearchQuery({ imageHint: "医院门诊", title: "不相关", firstBullet: "无关" })).toBe("医院门诊")
  })

  it("无 imageHint 时拼接 title + firstBullet", () => {
    const q = buildSearchQuery({ title: "统一数据底座", firstBullet: "对接 42 个科室" })
    expect(q).toContain("统一数据底座")
    expect(q).toContain("对接")
  })

  it("空输入返回空串", () => {
    expect(buildSearchQuery({})).toBe("")
  })

  it("结果不超 60 字", () => {
    const long = "一".repeat(120)
    const q = buildSearchQuery({ title: long, firstBullet: long })
    expect(q.length).toBeLessThanOrEqual(60)
  })
})
