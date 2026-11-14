import { describe, expect, it } from "vitest"
import {
  isComboPresetActive,
  isComboTargetsActive,
  normalizeLevel,
  RATING_COMBO_PRESETS,
  tagsHitNormalized,
  toggleComboPreset,
  toggleComboTargets,
} from "./ratingTags"

describe("normalizeLevel 单一真源", () => {
  it("电子病历：列头原文与标准码折叠到同一码", () => {
    expect(normalizeLevel("emr", "病历五级")).toBe("5")
    expect(normalizeLevel("emr", "电子病历五级")).toBe("5")
    expect(normalizeLevel("emr", "5")).toBe("5")
    expect(normalizeLevel("emr", "病历七级")).toBe("7")
  })

  it("互联互通：四甲/四乙原文能对上 4A/4B", () => {
    expect(normalizeLevel("hpc", "互联互通四甲")).toBe("4A")
    expect(normalizeLevel("hpc", "互联互通四乙")).toBe("4B")
    expect(normalizeLevel("hpc", "四甲")).toBe("4A")
    expect(normalizeLevel("hpc", "4A")).toBe("4A")
    expect(normalizeLevel("hpc", "互联互通五乙")).toBe("5B")
  })

  it("智慧服务五级可归一；智慧管理不再把五级四甲当成 3 级", () => {
    expect(normalizeLevel("ss", "智慧服务五级")).toBe("5")
    expect(normalizeLevel("ss", "5")).toBe("5")
    expect(normalizeLevel("sm", "五级四甲")).not.toBe("3")
    expect(normalizeLevel("sm", "六级四甲")).not.toBe("3")
    expect(normalizeLevel("sm", "智慧管理三级")).toBe("3")
  })
})

describe("组合预设 五级四甲 = 病历五级 OR 互联互通四甲", () => {
  const p5a = RATING_COMBO_PRESETS.find((x) => x.label === "五级四甲")!

  it("预设口径正确", () => {
    expect(p5a.emr).toBe("5")
    expect(p5a.hpc).toBe("4A")
    const p5b = RATING_COMBO_PRESETS.find((x) => x.label === "五级四乙")!
    expect(p5b).toEqual({ key: "l5-4b", label: "五级四乙", emr: "5", hpc: "4B" })
    expect(RATING_COMBO_PRESETS.find((x) => x.label === "六级四甲")).toMatchObject({ emr: "6", hpc: "4A" })
    expect(RATING_COMBO_PRESETS.find((x) => x.label === "六级五乙")).toMatchObject({ emr: "6", hpc: "5B" })
  })

  it("一键选中/取消等于同时点病历档和互联互通档", () => {
    const on = toggleComboPreset({}, p5a)
    expect(on).toEqual({ emr: ["5"], hpc: ["4A"] })
    expect(isComboPresetActive(on, p5a)).toBe(true)
    const off = toggleComboPreset(on, p5a)
    expect(off.emr).toBeUndefined()
    expect(off.hpc).toBeUndefined()
  })

  it("建设清单目标码同样可一键组合", () => {
    const on = toggleComboTargets([], p5a)
    expect(on.sort()).toEqual(["emr:5", "hpc:4A"].sort())
    expect(isComboTargetsActive(on, p5a)).toBe(true)
    expect(toggleComboTargets(on, p5a)).toEqual([])
  })
})

describe("tagsHitNormalized 路径 A 与筛选共用", () => {
  it("库存原文「病历五级」能命中目标 emr:5，不会因编码不一致漏勾", () => {
    const tags = { emr: ["病历四级", "病历五级"] }
    expect(tagsHitNormalized(tags, ["emr:5"])).toEqual(["emr:5"])
    expect(tagsHitNormalized(tags, ["emr:6"])).toEqual([])
    expect(tagsHitNormalized({ hpc: ["互联互通四甲"] }, ["hpc:4A"])).toEqual(["hpc:4A"])
  })

  it("五级四甲并集：病历五级或互联互通四甲任一命中即可", () => {
    const targets = ["emr:5", "hpc:4A"]
    expect(tagsHitNormalized({ emr: ["病历五级"] }, targets)).toEqual(["emr:5"])
    expect(tagsHitNormalized({ hpc: ["互联互通四甲"] }, targets)).toEqual(["hpc:4A"])
    expect(tagsHitNormalized({ emr: ["病历四级"], sm: ["五级四甲"] }, targets)).toEqual([])
  })
})
