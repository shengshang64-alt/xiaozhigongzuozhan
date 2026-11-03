import { describe, expect, it } from "vitest"
import {
  PARSE_MAX_SEGMENTS,
  PARSE_MAX_SEGMENTS_CRITICAL,
  isFullCoverageParseItem,
  parseSegmentCap,
} from "./wholeParse"

// R-038 Slice B（R260）：废标/评分关键项整文全量覆盖的分层切段上限（纯函数、零模型）

describe("R-038 Slice B 分层切段上限", () => {
  it("废标/评分关键项被识别为需整文全量覆盖", () => {
    for (const k of ["tech_score", "biz_score", "void_items", "qualification", "compliance"]) {
      expect(isFullCoverageParseItem(k)).toBe(true)
    }
  })

  it("其余解析项（叙述/信息类）不放宽，超限走检索回落控成本", () => {
    for (const k of ["overview", "project_info", "purchase_list", "lots", "delivery_req", "purchaser_info"]) {
      expect(isFullCoverageParseItem(k)).toBe(false)
    }
  })

  it("关键项段数上限放宽到 CRITICAL，其余沿用通用上限", () => {
    expect(parseSegmentCap("tech_score")).toBe(PARSE_MAX_SEGMENTS_CRITICAL)
    expect(parseSegmentCap("void_items")).toBe(PARSE_MAX_SEGMENTS_CRITICAL)
    expect(parseSegmentCap("overview")).toBe(PARSE_MAX_SEGMENTS)
    expect(parseSegmentCap("purchase_list")).toBe(PARSE_MAX_SEGMENTS)
  })

  it("CRITICAL 严格大于通用上限（放宽才有意义）且为有界整数（绝不无界放大调用数）", () => {
    expect(PARSE_MAX_SEGMENTS_CRITICAL).toBeGreaterThan(PARSE_MAX_SEGMENTS)
    expect(Number.isInteger(PARSE_MAX_SEGMENTS_CRITICAL)).toBe(true)
    expect(PARSE_MAX_SEGMENTS_CRITICAL).toBeLessThanOrEqual(24)
  })
})
