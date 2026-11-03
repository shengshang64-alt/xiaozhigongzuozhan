import { describe, expect, it } from "vitest"
import { extractRequiredPoints, mergeRequiredSections } from "./bidTypes"

// 问题2（2026-10-12）：评分 criteria 里的「包括但不限于①…②…③…」必答要点须逐点独立成节。
describe("extractRequiredPoints（必答要点抽取）", () => {
  it("①②③④ 枚举抽取为四个要点", () => {
    const scoring = [
      {
        item: "项目实施方案",
        score: 2,
        criteria: "方案完整可行，包括但不限于①项目实施计划及进度管理②项目人员组成及职责安排③项目管理④项目质量保障措施",
      },
    ]
    expect(extractRequiredPoints(scoring)).toEqual([
      "项目实施计划及进度管理",
      "项目人员组成及职责安排",
      "项目管理",
      "项目质量保障措施",
    ])
  })
  it("顿号分隔且句末带标点也能清洗成标题", () => {
    const scoring = [
      {
        item: "售后服务方案",
        score: 2,
        criteria: "①售后服务内容、②机构便捷性、③故障响应方式/时间。",
      },
    ]
    expect(extractRequiredPoints(scoring)).toEqual(["售后服务内容", "机构便捷性", "故障响应方式/时间"])
  })
  it("无带圈序号返回空数组", () => {
    expect(extractRequiredPoints([{ item: "培训", score: 2, criteria: "方案完善得2分" }])).toEqual([])
  })
  it("跨评分项去重", () => {
    const scoring = [
      { item: "A", score: 1, criteria: "①项目管理②质量保障" },
      { item: "B", score: 1, criteria: "①项目管理③人员职责" },
    ]
    expect(extractRequiredPoints(scoring)).toEqual(["项目管理", "质量保障", "人员职责"])
  })
})

describe("mergeRequiredSections（要点并入小节·去重幂等）", () => {
  it("既有小节已语义覆盖的要点不重复补", () => {
    const sections = ["项目管理方案", "人员配置"]
    const points = ["项目管理", "进度计划"]
    expect(mergeRequiredSections(sections, points)).toEqual(["项目管理方案", "人员配置", "进度计划"])
  })
  it("无要点时原样返回", () => {
    expect(mergeRequiredSections(["A", "B"], [])).toEqual(["A", "B"])
  })
  it("幂等：并入后的列表再并一次不增长", () => {
    const once = mergeRequiredSections(["概述"], ["进度管理", "质量保障"])
    expect(mergeRequiredSections(once, ["进度管理", "质量保障"])).toEqual(once)
  })
})
