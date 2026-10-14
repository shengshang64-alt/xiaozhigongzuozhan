import { describe, expect, it } from "vitest"
import { ANBID_REGION_PRESETS, getAnbidRegionPreset } from "./anbidRegionPresets"
import { resolveLineSpacingReq, resolveSizeHalfPt } from "../rules/format"

describe("anbidRegionPresets · 地区暗标格式预置", () => {
  it("三套预置且 id 唯一、名称齐全", () => {
    expect(ANBID_REGION_PRESETS.map((p) => p.id)).toEqual(["neimenggu", "hebei", "sichuan"])
    expect(ANBID_REGION_PRESETS.map((p) => p.name)).toEqual(["内蒙古", "河北", "四川"])
  })

  it("每套预置的字体/字号/行距/边距都能被现有解析器识别（否则填了也不判）", () => {
    for (const p of ANBID_REGION_PRESETS) {
      const s = p.standard
      expect(s.bodyFont).toBe("宋体")
      // 四号 = 14pt = 半点 28
      expect(resolveSizeHalfPt(s.bodySize ?? "")).toBe(28)
      const ls = resolveLineSpacingReq(s.lineSpacing ?? "")
      expect(ls?.type).toBe("exact")
      expect([560, 600]).toContain(ls?.line) // 固定 28 磅 / 30 磅
      expect(s.margins).toBeTruthy()
      expect(s.margins!.top).toBeGreaterThan(0)
      expect(s.margins!.left).toBeGreaterThan(0)
    }
  })

  it("三套均要求全黑白 + 禁止页码（原文口径一致）", () => {
    for (const p of ANBID_REGION_PRESETS) {
      expect(p.standard.allowColor).toBe(false)
      expect(p.standard.allowPageNumber).toBe(false)
    }
  })

  it("原文未明确的字段保持 null（不编造页数上限/交付形态）", () => {
    for (const p of ANBID_REGION_PRESETS) {
      expect(p.standard.maxPages).toBeNull()
      expect(p.standard.requireSeparateBooklet).toBeNull()
    }
  })

  it("note 保留原文可识别条款，供人工比对", () => {
    for (const p of ANBID_REGION_PRESETS) {
      expect(p.note).toContain("页码")
      expect(p.note).toContain("宋体")
    }
  })

  it("未知 id 返回 null（不误回落某个地区标准）", () => {
    expect(getAnbidRegionPreset("no-such-region")).toBeNull()
    expect(getAnbidRegionPreset("hebei")?.name).toBe("河北")
  })
})
