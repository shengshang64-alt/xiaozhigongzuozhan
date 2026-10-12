// R-030（R256）必选解析项分级与失败判定 场景自测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import { parseSectionTier, requiredParseFailures, PARSE_KEY_SECTIONS, type ParseSection } from "./bidTypes"

describe("R-030 必选解析项分级与失败判定（R256）", () => {
  it("parseSectionTier：关键项=required、其他项=optional、本地产出区=other", () => {
    expect(parseSectionTier("overview")).toBe("required")
    expect(parseSectionTier("tech_score")).toBe("required")
    expect(parseSectionTier("void_items")).toBe("optional")
    expect(parseSectionTier("lots")).toBe("optional")
    expect(parseSectionTier("star_clauses")).toBe("other")
    expect(parseSectionTier("req_structure")).toBe("other")
  })

  it("8 关键项全部标 required=true（数据驱动既有「必选不可取消」口径）", () => {
    expect(PARSE_KEY_SECTIONS.filter((d) => d.required)).toHaveLength(8)
  })

  it("缺席/空/降级/failed 判失败；正常内容与「原文未提及」不判失败", () => {
    const sections: ParseSection[] = [
      { key: "overview", title: "项目概述", content: "项目基本信息：XX医院信息化项目" },
      { key: "tech_score", title: "技术评分要求", content: "" },
      { key: "project_info", title: "项目信息", content: "〔系统降级〕检索原文占位" },
      { key: "purchaser_info", title: "甲方信息", content: "原文未提及" },
      { key: "delivery_req", title: "交货和服务要求", content: "建设内容：HIS/EMR/LIS" },
      { key: "response_req", title: "响应文件要求", content: "签字盖章要求若干" },
      { key: "biz_score", title: "商务评分要求", content: "商务分 10 分", status: "failed" },
      { key: "bid_outline_req", title: "投标文件目录要求", content: "第一章 投标函" },
    ]
    const keys = requiredParseFailures(sections).map((f) => f.key)
    expect(keys).toContain("tech_score")
    expect(keys).toContain("project_info")
    expect(keys).toContain("biz_score")
    expect(keys).not.toContain("purchaser_info")
    expect(keys).not.toContain("overview")
  })

  it("必选项缺席（整项未产出）判失败", () => {
    const keys = requiredParseFailures([{ key: "overview", title: "项目概述", content: "有内容" }]).map((f) => f.key)
    expect(keys).toContain("tech_score")
    expect(keys).not.toContain("overview")
  })
})
