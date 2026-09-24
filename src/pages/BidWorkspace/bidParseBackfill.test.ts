// R45 回归锈：displayStageLabel（F4「待解析」与解析报告并存矛盾）与 parseBackfillFields（F5 保守回填口径）
// 真实形态来自项目 13431 的 parse_report（体验审计 R44 取证），fixture 不带原文敏感内容。
import { describe, expect, it } from "vitest"
import { displayStageLabel, effectiveHospital, parseBackfillFields } from "./bidTypes"
import type { ParseReport } from "./bidTypes"

const report = (content: string): ParseReport =>
  ({ scope: "key", sections: [{ key: "purchaser_info", title: "采购人", content }] }) as unknown as ParseReport

describe("displayStageLabel（R45/F4）", () => {
  it("pending_parse 且解析报告已存在 → 显示「已解析 · 待编制」（消卡片矛盾文案）", () => {
    expect(displayStageLabel({ stage: "pending_parse", parse_report: report("采购人名称：A院") })).toBe("已解析 · 待编制")
  })
  it("pending_parse 未解析仍「待解析」；空 sections 不算已解析；后续阶段与归档不受影响", () => {
    expect(displayStageLabel({ stage: "pending_parse", parse_report: null })).toBe("待解析")
    expect(displayStageLabel({ stage: "pending_parse", parse_report: { scope: "key", sections: [] } as unknown as ParseReport })).toBe("待解析")
    expect(displayStageLabel({ stage: "composing", parse_report: report("x") })).toBe("编制中")
    expect(displayStageLabel({ stage: "archived" })).toBe("已归档")
  })
})

describe("parseBackfillFields（R45/F5）", () => {
  it("真实形态「采购人名称：XX（出处：…）」抽出医院名并剔除出处后缀", () => {
    const bf = parseBackfillFields(report("采购人名称：安徽中医药大学第一附属医院（出处：第一章一）\n联系人：张老师"))
    expect(bf.hospital).toBe("安徽中医药大学第一附属医院")
  })
  it("编号占位写法「某编号」不取；正式编号取；无「项目编号：」标签留空（原文「编号某编号」句式不误抽）", () => {
    expect(parseBackfillFields(report("项目编号：某编号")).tender_no).toBe("")
    expect(parseBackfillFields(report("项目编号：AHZC-2026-134（出处：第一章）")).tender_no).toBe("AHZC-2026-134")
    expect(parseBackfillFields(report("项目基本信息：……编号某编号，服务类")).tender_no).toBe("")
  })
  it("开标日期归一 ISO；「投标截止同开标时间，具体详见招标公告」类模糊表述不产出日期", () => {
    expect(parseBackfillFields(report("开标时间：2026年10月15日 09:30")).bid_open_date).toBe("2026-10-15")
    expect(parseBackfillFields(report("时间安排：合同履行期36个月，投标截止同开标时间，具体详见招标公告")).bid_open_date).toBe("")
  })
  it("空报告/无标签报告 → 全空白（下游据此不写任何字段）", () => {
    expect(parseBackfillFields(null)).toEqual({ hospital: "", tender_no: "", bid_open_date: "" })
    expect(parseBackfillFields(report(""))).toEqual({ hospital: "", tender_no: "", bid_open_date: "" })
  })
})

describe("effectiveHospital（R45/F5 存量展示兜底）", () => {
  it("hospital 为空时从解析报告 purchaser_info 派生（零写入）", () => {
    expect(effectiveHospital({ hospital: "", parse_report: report("采购人名称：安徽中医药大学第一附属医院（出处：第一章一）") })).toBe("安徽中医药大学第一附属医院")
  })
  it("已存 hospital 优先（不被报告覆盖）；两者皆空才返回空串（卡片才显「采购人未填写」）", () => {
    expect(effectiveHospital({ hospital: "用户已填医院", parse_report: report("采购人名称：报告里的") })).toBe("用户已填医院")
    expect(effectiveHospital({ hospital: "", parse_report: null })).toBe("")
    expect(effectiveHospital({ hospital: "", parse_report: report("无任何标签的一行") })).toBe("")
  })
})
