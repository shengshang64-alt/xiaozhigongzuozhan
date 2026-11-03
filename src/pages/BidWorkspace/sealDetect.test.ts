// Q28 切片B：电子签章存在性检测——合成 opList 验证三判据与 isSealAbsent
import { describe, expect, it } from "vitest"
import { analyzePageOps, isSealAbsent, type PageSealStats } from "./sealDetect"

// OPS codes (mirror)
const OP_TRANSFORM = 12
const OP_CURVE_TO = 15
const OP_CONSTRUCT_PATH = 91
const OP_PAINT_IMAGE_XOBJECT = 85
const OP_PAINT_INLINE_IMAGE_XOBJECT = 86
const OP_SET_FILL_RGB = 59
const OP_SET_FILL_GRAY = 57
const OP_SHOW_TEXT = 44

describe("analyzePageOps", () => {
  it("empty opList → all zeros, hasNonBlackFillText=false", () => {
    const stats = analyzePageOps([], [], 1000)
    expect(stats).toEqual({ imageCount: 0, imageAreaPct: 0, curveCount: 0, hasNonBlackFillText: false })
  })

  it("detects paintImageXObject with preceding transform → imageCount > 0, imageAreaPct > 0", () => {
    // Transform: scale 200x300, then paint image
    const fnArray = [OP_TRANSFORM, OP_PAINT_IMAGE_XOBJECT]
    const argsArray = [[200, 0, 0, 300, 50, 50], ["imgObj"]]
    const pageArea = 612 * 792 // US Letter
    const stats = analyzePageOps(fnArray, argsArray, pageArea)
    expect(stats.imageCount).toBe(1)
    expect(stats.imageAreaPct).toBeGreaterThan(0)
  })

  it("detects inline image with width/height in args", () => {
    const fnArray = [OP_PAINT_INLINE_IMAGE_XOBJECT]
    const argsArray = [[{ width: 100, height: 80 }]]
    const stats = analyzePageOps(fnArray, argsArray, 10000)
    expect(stats.imageCount).toBe(1)
    expect(stats.imageAreaPct).toBe(80) // 100*80 / 10000 * 100
  })

  it("counts curveTo ops", () => {
    const fnArray = [OP_CURVE_TO, OP_CURVE_TO, OP_CURVE_TO]
    const argsArray = [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]]
    const stats = analyzePageOps(fnArray, argsArray, 1000)
    expect(stats.curveCount).toBe(3)
  })

  it("counts curves inside constructPath", () => {
    // constructPath args[0] = types array; 15=curveTo entries count as curves
    const fnArray = [OP_CONSTRUCT_PATH]
    const argsArray = [[[13, 15, 15, 14, 18], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]]
    const stats = analyzePageOps(fnArray, argsArray, 1000)
    expect(stats.curveCount).toBe(2) // two OP_CURVE_TO entries in the path
  })

  it("detects non-black fill text", () => {
    // Red fill + showText
    const fnArray = [OP_SET_FILL_RGB, OP_SHOW_TEXT]
    const argsArray = [[1, 0, 0], [["Hello"]]]
    const stats = analyzePageOps(fnArray, argsArray, 1000)
    expect(stats.hasNonBlackFillText).toBe(true)
  })

  it("black fill text does NOT trigger hasNonBlackFillText", () => {
    const fnArray = [OP_SET_FILL_RGB, OP_SHOW_TEXT]
    const argsArray = [[0, 0, 0], [["Text"]]]
    const stats = analyzePageOps(fnArray, argsArray, 1000)
    expect(stats.hasNonBlackFillText).toBe(false)
  })

  it("gray fill at 0 (black) does NOT trigger", () => {
    const fnArray = [OP_SET_FILL_GRAY, OP_SHOW_TEXT]
    const argsArray = [[0], [["Text"]]]
    const stats = analyzePageOps(fnArray, argsArray, 1000)
    expect(stats.hasNonBlackFillText).toBe(false)
  })

  it("gray fill at 0.5 triggers non-black", () => {
    const fnArray = [OP_SET_FILL_GRAY, OP_SHOW_TEXT]
    const argsArray = [[0.5], [["Text"]]]
    const stats = analyzePageOps(fnArray, argsArray, 1000)
    expect(stats.hasNonBlackFillText).toBe(true)
  })

  it("no pageArea → imageAreaPct=0 even with images", () => {
    const fnArray = [OP_PAINT_IMAGE_XOBJECT]
    const argsArray = [["img"]]
    const stats = analyzePageOps(fnArray, argsArray, 0)
    expect(stats.imageCount).toBe(1)
    expect(stats.imageAreaPct).toBe(0)
  })
})

describe("isSealAbsent", () => {
  it("all three criteria met → true", () => {
    const stats: PageSealStats = { imageCount: 0, imageAreaPct: 0, curveCount: 0, hasNonBlackFillText: false }
    expect(isSealAbsent(stats)).toBe(true)
  })

  it("image present → false (even with small area)", () => {
    const stats: PageSealStats = { imageCount: 1, imageAreaPct: 0.5, curveCount: 0, hasNonBlackFillText: false }
    expect(isSealAbsent(stats)).toBe(false)
  })

  it("curves present → false", () => {
    const stats: PageSealStats = { imageCount: 0, imageAreaPct: 0, curveCount: 5, hasNonBlackFillText: false }
    expect(isSealAbsent(stats)).toBe(false)
  })

  it("non-black fill text → false", () => {
    const stats: PageSealStats = { imageCount: 0, imageAreaPct: 0, curveCount: 0, hasNonBlackFillText: true }
    expect(isSealAbsent(stats)).toBe(false)
  })

  it("imageAreaPct=0 but imageCount>0 (transform too small) → still absent per criteria", () => {
    // Edge: transform found but area rounds to 0 after division
    const stats: PageSealStats = { imageCount: 2, imageAreaPct: 0, curveCount: 0, hasNonBlackFillText: false }
    expect(isSealAbsent(stats)).toBe(true)
  })
})
