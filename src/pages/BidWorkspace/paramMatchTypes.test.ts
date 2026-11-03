import { describe, expect, it } from "vitest"
import {
  applyChoices,
  extractParamCandidates,
  judgeParam,
  PARAM_MATCH,
  summarizeParams,
  type ParamRow,
} from "./paramMatchTypes"

function row(over: Partial<ParamRow>): ParamRow {
  return { key: "L1", param: "x", substantive: false, keyMark: false, matchType: null, ...over }
}

describe("PARAM_MATCH 四类元数据（规范 4.1）", () => {
  it("四类齐全、序号 01-04 且各含应对策略", () => {
    expect(Object.keys(PARAM_MATCH).sort()).toEqual(["alternative", "full", "none", "partial"])
    expect(PARAM_MATCH.full.code).toBe("01")
    expect(PARAM_MATCH.none.code).toBe("04")
    for (const m of Object.values(PARAM_MATCH)) {
      expect(m.strategies.length).toBeGreaterThan(0)
      expect(m.definition.length).toBeGreaterThan(0)
    }
  })
})

describe("judgeParam ★红线冲突推导", () => {
  it("未研判 → caution 待研判", () => {
    const v = judgeParam(row({}))
    expect(v.level).toBe("caution")
    expect(v.conflict).toBeNull()
  })
  it("完全满足 → ok", () => {
    expect(judgeParam(row({ matchType: "full" })).level).toBe("ok")
  })
  it("部分不满足 + ★ → danger，提示不允许负偏离", () => {
    const v = judgeParam(row({ substantive: true, matchType: "partial" }))
    expect(v.level).toBe("danger")
    expect(v.conflict).toContain("★")
  })
  it("部分不满足 + 非★ → caution", () => {
    expect(judgeParam(row({ substantive: false, matchType: "partial" })).level).toBe("caution")
  })
  it("替代方案 + ★ → danger，提示不接受替代", () => {
    const v = judgeParam(row({ substantive: true, matchType: "alternative" }))
    expect(v.level).toBe("danger")
    expect(v.conflict).toContain("不接受替代")
  })
  it("完全不满足 + ★ → danger 建议放弃；非★ → caution 评估风险", () => {
    expect(judgeParam(row({ substantive: true, matchType: "none" })).level).toBe("danger")
    expect(judgeParam(row({ substantive: true, matchType: "none" })).conflict).toContain("放弃投标")
    expect(judgeParam(row({ substantive: false, matchType: "none" })).level).toBe("caution")
  })
})

describe("extractParamCandidates 标注识别", () => {
  it("仅收 ★/▲ 行并置 substantive/keyMark", () => {
    const rows = extractParamCandidates(
      ["★ 质保期不少于3年", "普通说明文字一行", "▲ 支持 HL7 FHIR R4 接口", "3.▲ 支持 HL7 FHIR R4 接口", "短"].join("\n"),
    )
    expect(rows.length).toBe(3)
    expect(rows[0].substantive).toBe(true)
    expect(rows[1].keyMark).toBe(true)
    expect(rows[2].keyMark).toBe(true)
    expect(rows[1].key).toBe("L3")
    expect(rows[2].key).toBe("L4")
  })
  it("空文本返回空数组", () => {
    expect(extractParamCandidates("")).toEqual([])
  })
})

describe("summarizeParams 综合决策", () => {
  it("★完全不满足 → reject 一票否决", () => {
    const s = summarizeParams([row({ substantive: true, matchType: "none" })])
    expect(s.overall).toBe("reject")
    expect(s.starReject).toBe(1)
  })
  it("★部分不满足 → caution", () => {
    const s = summarizeParams([row({ substantive: true, matchType: "partial" })])
    expect(s.overall).toBe("caution")
    expect(s.starOpen).toBe(1)
  })
  it("存在待研判 → pending", () => {
    const s = summarizeParams([row({ matchType: "full" }), row({})])
    expect(s.untyped).toBe(1)
    expect(s.overall).toBe("pending")
  })
  it("全为无风险 → bid", () => {
    const s = summarizeParams([row({ substantive: true, matchType: "full" })])
    expect(s.overall).toBe("bid")
    expect(s.byType.full).toBe(1)
  })
})

describe("applyChoices 回填持久化选择", () => {
  it("命中合法值才回填，非法值忽略", () => {
    const rows = [row({ key: "L1" }), row({ key: "L2" })]
    const applied = applyChoices(rows, { L1: "full", L2: "bogus" })
    expect(applied[0].matchType).toBe("full")
    expect(applied[1].matchType).toBeNull()
  })
})
