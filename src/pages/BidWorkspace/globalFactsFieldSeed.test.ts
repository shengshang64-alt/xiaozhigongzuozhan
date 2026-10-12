// R282 回归锈（bid-fact-refetch-failed · 门禁归责③系统可回取）：
// 自动事实表必须包含 bid_projects 上已确认的项目名称/招标编号——
// 实测贵港项目 tender_no=GXKLG202630843 在正文全文 0 次出现，而同源同编号项目出现 3 次，
// 差别只在解析报告里是否恰好有「项目编号：…」这一行。fixture 不带招标原文内容。
import { describe, expect, it } from "vitest"
import { effectiveGlobalFacts, effectiveGlobalFactsLines, wrapGlobalFactsBlock } from "./bidTypes"
import type { ParseReport } from "./bidTypes"

const report = (key: string, content: string): ParseReport =>
  ({ scope: "key", sections: [{ key, title: "项目基本信息", content }] }) as unknown as ParseReport

/** 贵港形态：报告里没有任何「键：值」事实行，但项目字段已确认编号 */
const noFactReport = report("project_info", "一、项目概述\n本项目为贵港市某医院信息化建设项目，具体见附件。")
/** 同源另一项目形态：报告里就有「项目编号：…」行 */
const hasFactReport = report("project_info", "项目编号：GXKLG202630843\n项目名称：贵港项目\n预算金额：500万元")

describe("effectiveGlobalFacts 项目字段兜底（R282）", () => {
  it("报告无可抽事实行、但 tender_no/project_name 已确认 → 编号与项目名仍进事实表（修「注入链路不稳定」）", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: noFactReport,
      project_name: "贵港项目",
      tender_no: "GXKLG202630843",
    })
    expect(lines).toEqual(["项目名称=贵港项目", "招标编号=GXKLG202630843"])
  })

  it("字段值为空 → 不产出占位行；报告抽取口径保持原样（老项目零行为变化）", () => {
    expect(
      effectiveGlobalFactsLines({ global_facts: "", parse_report: hasFactReport, project_name: "", tender_no: "" }),
    ).toEqual(["项目编号=GXKLG202630843", "项目名称=贵港项目", "预算金额=500万元"])
  })

  it("字段与报告同值 → 只留一条（同值去重，防事实表被同一编号刷屏）", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: hasFactReport,
      project_name: "贵港项目",
      tender_no: "GXKLG202630843",
    })
    expect(lines).toEqual(["项目名称=贵港项目", "招标编号=GXKLG202630843", "预算金额=500万元"])
  })

  it("人工编辑版事实表优先且原样（字段兜底不得静默改写已保存事实）", () => {
    const lines = effectiveGlobalFactsLines({
      global_facts: "项目名称=以人工为准的名称",
      parse_report: hasFactReport,
      project_name: "贵港项目",
      tender_no: "GXKLG202630843",
    })
    expect(lines).toEqual(["项目名称=以人工为准的名称"])
  })

  it("注入块前言与格式不变；长值（>60 字，疑似脏数据）不注入", () => {
    const block = effectiveGlobalFacts({
      global_facts: "",
      parse_report: null,
      project_name: "X".repeat(61),
      tender_no: "GXKLG202630843",
    })
    expect(block.startsWith(wrapGlobalFactsBlock(["招标编号=GXKLG202630843"]))).toBe(true)
    expect(block).not.toContain("项目名称=")
  })

  it("字段行占用计入 800 字预算：报告事实再多也不会把编号挤掉，合计仍 ≤800 字", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `联系人电话${i}：0599-888800${i}`).join("\n")
    const lines = effectiveGlobalFactsLines({
      global_facts: "",
      parse_report: report("purchaser_info", filler),
      project_name: "建阳项目",
      tender_no: "GXKLG202630843",
    })
    expect(lines[0]).toBe("项目名称=建阳项目")
    expect(lines[1]).toBe("招标编号=GXKLG202630843")
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.join("\n").length).toBeLessThanOrEqual(800 + 2 * 30)
  })
})
