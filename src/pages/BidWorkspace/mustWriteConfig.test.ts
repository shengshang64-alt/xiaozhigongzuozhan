import { describe, expect, it } from "vitest"
import {
  DEFAULT_REQUIRED_TECH_KEYWORDS,
  mergeRequiredKeywords,
  parseRequiredKeywords,
} from "./mustWriteConfig"

describe("R-017 必备技术内容清单（可配置）", () => {
  it("parse：多分隔符切分、去空去重保序", () => {
    expect(parseRequiredKeywords("售后,运维、培训；应急\n培训 ,")).toEqual(["售后", "运维", "培训", "应急"])
    expect(parseRequiredKeywords("")).toEqual([])
    expect(parseRequiredKeywords(null)).toEqual([])
  })

  it("merge：用户追加在前 + 默认下限，去重", () => {
    const merged = mergeRequiredKeywords(["数据治理", "售后"])
    expect(merged[0]).toBe("数据治理")
    expect(merged[1]).toBe("售后")
    // 默认全部并入且不重复
    expect(new Set(merged).size).toBe(merged.length)
    for (const d of DEFAULT_REQUIRED_TECH_KEYWORDS) expect(merged).toContain(d)
  })

  it("默认清单非空且全为去空白词", () => {
    expect(DEFAULT_REQUIRED_TECH_KEYWORDS.length).toBeGreaterThan(0)
    expect(DEFAULT_REQUIRED_TECH_KEYWORDS.every((k) => k && k === k.trim())).toBe(true)
  })
})
