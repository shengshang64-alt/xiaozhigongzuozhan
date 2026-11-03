import { describe, expect, it } from "vitest"
import { isGenTargetChapter, normalizeBidScope, type GenOptions } from "../bidTypes"
import { buildOutlineLevel1Messages } from "./outlineLevel1"
import { buildBidOutlineMessages } from "./bidOutline"
import type { LlmMessage } from "@/lib/llm"

// R206 切片 1（R-002）：内容范围三模式——纯逻辑向后兼容 + 提示词三分支回归。
// 关键约束：缺省（无 scope）时行为与存量完全一致（both 含商务骨架、include_biz:false 派生 tech）。

const go = (o: Partial<GenOptions>): GenOptions => o as GenOptions

describe("normalizeBidScope（R-002 三模式向后兼容）", () => {
  it("显式 scope 原样返回", () => {
    expect(normalizeBidScope(go({ scope: "biz" }))).toBe("biz")
    expect(normalizeBidScope(go({ scope: "tech" }))).toBe("tech")
    expect(normalizeBidScope(go({ scope: "both" }))).toBe("both")
  })
  it("缺省 scope 由 include_biz 派生（存量零变化）", () => {
    expect(normalizeBidScope(go({ include_biz: false }))).toBe("tech")
    expect(normalizeBidScope(go({ include_biz: true }))).toBe("both")
    expect(normalizeBidScope(go({}))).toBe("both")
    expect(normalizeBidScope(null)).toBe("both")
    expect(normalizeBidScope(undefined)).toBe("both")
  })
})

describe("isGenTargetChapter（R-002 生成目标判定）", () => {
  const biz = { part: "biz" }
  const tech = { part: "tech" }
  it("both/tech：技术章是目标、商务章非；biz：反之", () => {
    expect(isGenTargetChapter(tech, "both")).toBe(true)
    expect(isGenTargetChapter(biz, "both")).toBe(false)
    expect(isGenTargetChapter(tech, "tech")).toBe(true)
    expect(isGenTargetChapter(biz, "tech")).toBe(false)
    expect(isGenTargetChapter(biz, "biz")).toBe(true)
    expect(isGenTargetChapter(tech, "biz")).toBe(false)
    // 非 biz（含缺省 part/null）在 both/tech 下视为技术目标，与存量 !isBizPart 口径一致
    expect(isGenTargetChapter(null, "both")).toBe(true)
    expect(isGenTargetChapter({ part: "tech" }, "both")).toBe(true)
  })
})

const joined = (m: LlmMessage[]) => m.map((x) => x.content ?? "").join(String.fromCharCode(10))

describe("大纲提示词三分支（R-002）", () => {
  it("biz：仅商务、禁止技术章节", () => {
    const l1 = joined(buildOutlineLevel1Messages("P", "H", null, { scope: "biz" }))
    expect(l1).toContain("全部为商务")
    expect(l1).toContain("不输出任何技术")
    const whole = joined(buildBidOutlineMessages("P", "H", null, false, 0, undefined, { scope: "biz" }))
    expect(whole).toContain("全部为商务")
    expect(whole).toContain("不输出任何技术")
  })
  it("tech：仅技术、禁止商务章节", () => {
    const text = joined(buildOutlineLevel1Messages("P", "H", null, { scope: "tech" }))
    expect(text).toContain("全部为技术")
    expect(text).toContain("不输出任何商务")
  })
  it("both：商务+技术并存", () => {
    const text = joined(buildOutlineLevel1Messages("P", "H", null, { scope: "both" }))
    expect(text).toContain("商务章在前")
    expect(text).toContain("技术部分")
  })
  it("缺省 = both；includeBiz:false 派生 tech（向后兼容）", () => {
    expect(joined(buildOutlineLevel1Messages("P", "H", null))).toContain("商务章在前")
    expect(joined(buildOutlineLevel1Messages("P", "H", null, { includeBiz: false }))).toContain("不输出任何商务")
  })
})
