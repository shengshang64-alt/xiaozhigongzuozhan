// 2026-10-23（P0 整改）：招标原文有效性 + ★/▲ 数量对账 + 第 3 步门控
import { describe, expect, it } from "vitest"
import { declaredSymbolCount, parsedSymbolCount, reconcileStarClauses, scanTenderText } from "./tenderTextQuality"
import { stepEntryMissing, type ParseReport } from "./bidTypes"

const TEMPLATE = [
  "项目名称：三明市中西医结合医院信息化整体提升项目",
  "项目编号：[350000]SMZC[GK]2026-XXX号",
  "采购代理机构：（按实际委托填写）",
  "预算金额（最高限价）：人民币XXXX万元。",
].join("\n")

const REAL = [
  "政府采购项目公开招标文件示范文本（服务类）",
  "项目编号：[350401]SMGX[GK]2026004",
  "预算金额（最高限价）：2348 万元",
  "第一章 招标公告",
].join("\n")

describe("招标原文有效性（P0）", () => {
  it("① 模板稿（编号 XXX / 金额 XXXX / 按实际填写）判为可疑", () => {
    const q = scanTenderText(TEMPLATE)
    expect(q.suspicious).toBe(true)
    expect(q.hits.join()).toContain("XXX")
    expect(q.summary).toContain("模板稿")
  })

  it("② 真实稿只带「示范文本」页眉不算可疑（政府采购常见页眉）", () => {
    const q = scanTenderText(REAL)
    expect(q.suspicious).toBe(false)
    expect(q.summary).toContain("未发现占位符")
  })

  it("③ 空文本按缺失处理", () => {
    expect(scanTenderText("").suspicious).toBe(true)
  })
})

describe("★/▲ 条款对账", () => {
  it("④ 从原文声明句读条数", () => {
    expect(declaredSymbolCount("评分办法明确：以 ★ 标示的内容（共 4 项）为关键评分项", "★")).toBe(4)
    expect(declaredSymbolCount("标记 ▲ 号为重点评分项（共 4 项）", "▲")).toBe(4)
    expect(declaredSymbolCount("没有任何声明", "★")).toBeNull()
  })

  it("⑤ 按条款头计数（同一符号在正文里重复不重复计）", () => {
    const report = {
      scope: "full",
      sections: [{ key: "star_clauses", title: "★/▲", content: "★1、支持国产数据库\n★2、并发≥5000\n▲1、接口开放" }],
    } as unknown as ParseReport
    expect(parsedSymbolCount(report, "★")).toBe(2)
    expect(parsedSymbolCount(report, "▲")).toBe(1)
  })

  it("⑥ 声明 4 项、解析 0 条 → 判缺并在结论里点名", () => {
    const report = { scope: "full", sections: [] } as unknown as ParseReport
    const r = reconcileStarClauses(report, "以 ★ 标示的内容（共 4 项）为关键评分项；▲（共 4 项）")
    expect(r.missing).toBe(true)
    expect(r.summary).toContain("★ 声明 4 项、实际解析 0 条")
  })
})

describe("第 3 步门控（P0-4）", () => {
  it("⑦ 必选项解析失败 → 不允许进入编制", () => {
    const report = {
      scope: "full",
      sections: [{ key: "overview", title: "项目概述", content: "有内容" }],
    } as unknown as ParseReport
    const msg = stepEntryMissing(3, { parse_report: report })
    expect(msg).toContain("必选项解析失败")
    expect(msg).toContain("重新解析")
  })

  it("⑧ 必选项齐全 → 放行", () => {
    const sections = [
      "overview",
      "tech_score",
      "project_info",
      "purchaser_info",
      "delivery_req",
      "response_req",
      "qualification",
      "compliance",
      "void_items",
      "biz_score",
      "bid_outline_req",
    ].map((key) => ({ key, title: key, content: "有内容".repeat(5) }))
    expect(stepEntryMissing(3, { parse_report: { scope: "full", sections } as unknown as ParseReport })).toBe("")
  })
})
