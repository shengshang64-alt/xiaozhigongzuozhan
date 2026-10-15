import { describe, expect, it } from "vitest"
import { buildParseSummary, summarizeParseHealth } from "./parseSummary"
import type { ParseReport, ParseSection } from "./bidTypes"

/**
 * R56（对标喜鹊解析首屏）：三栏摘要的分组与取样口径。
 * 锁三件事：① 分组不丢项（未列出的 key 兜底进「招标需求」）；
 * ② 有结构化字段的信息卡类出字段、逐条类出样本 + 总数；③ 评分项出项数与合计分。
 */

const sec = (key: string, title: string, content: string, over: Partial<ParseSection> = {}): ParseSection =>
  ({ key, title, content, status: "ok", snippet: "", ...over }) as ParseSection

const report = (sections: ParseSection[]): ParseReport => ({ scope: "full", sections })

describe("buildParseSummary：分组", () => {
  const rep = report([
    sec("project_info", "项目信息", "工期要求：36 个月"),
    sec("tech_score", "技术评分要求", "总体方案（5 分）：优（4-5 分）\n实施保障（3 分）：良"),
    sec("delivery_req", "交货和服务要求", "技术需求：微服务架构\n性能：并发 2000"),
  ])
  const cols = buildParseSummary(rep)

  it("三栏固定为 基本信息 / 评分要求 / 招标需求", () => {
    expect(cols.map((c) => c.id)).toEqual(["basic", "scoring", "requirements"])
    expect(cols.map((c) => c.title)).toEqual(["基本信息", "评分要求", "招标需求"])
  })

  it("按 key 落到对应栏", () => {
    expect(cols[0].cards.map((c) => c.key)).toContain("project_info")
    expect(cols[1].cards.map((c) => c.key)).toContain("tech_score")
    expect(cols[2].cards.map((c) => c.key)).toContain("delivery_req")
  })

  it("未在分组表里列出的 key 兜底进「招标需求」——不丢项", () => {
    const cols2 = buildParseSummary(report([sec("some_future_key", "未来新项", "内容")]))
    expect(cols2[2].cards.map((c) => c.key)).toEqual(["some_future_key"])
  })

  it("空报告返回三栏空壳，不抛错", () => {
    const cols3 = buildParseSummary(null)
    expect(cols3).toHaveLength(3)
    expect(cols3.every((c) => c.cards.length === 0)).toBe(true)
  })
})

describe("buildParseSummary：卡片内容", () => {
  it("有结构化字段的信息卡类：出字段、不出样本（字段就是全部信息）", () => {
    const rep = report([
      sec("bid_deposit", "投标保证金", "保证金金额：5 万元\n缴纳形式：转账", {
        structured: { kind: "fields", fields: [{ label: "保证金金额", value: "5 万元" }, { label: "缴纳形式", value: "转账" }] },
      }),
    ])
    const card = buildParseSummary(rep)[0].cards[0]
    expect(card.fields.map((f) => f.label)).toEqual(["保证金金额", "缴纳形式"])
    expect(card.lines).toEqual([])
  })

  it("逐条条款类：出前 N 条样本 + 总条数（让「还有多少条」看得见）", () => {
    const many = Array.from({ length: 9 }, (_, i) => `条款 ${i + 1}`).join("\n")
    const card = buildParseSummary(report([sec("void_items", "无效标与废标项", many)]), { sample: 3 })[2].cards[0]
    expect(card.lines).toEqual(["条款 1", "条款 2", "条款 3"])
    expect(card.count).toBe(9)
  })

  it("评分项：count 为项数、meta 给「N 项 · 合计 X 分」", () => {
    const rep = report([sec("tech_score", "技术评分要求", "总体方案（5 分）：优\n实施保障（3 分）：良")])
    const card = buildParseSummary(rep)[1].cards[0]
    expect(card.count).toBe(2)
    expect(card.meta).toBe("2 项 · 合计 8 分")
  })

  it("状态沿用既有口径（miss/失败/未解析都能看出来）", () => {
    const rep = report([
      sec("overview", "项目概述", "原文未提及", { status: "ok" }),
      sec("compliance", "符合性检查", "", { status: "failed" }),
    ])
    const cols = buildParseSummary(rep)
    expect(cols[0].cards[0].status).toBe("miss")
    expect(cols[2].cards[0].status).toBe("failed")
  })
})

describe("summarizeParseHealth", () => {
  it("计数与文案", () => {
    const rep = report([
      sec("overview", "项目概述", "内容"),
      sec("compliance", "符合性检查", "", { status: "failed" }),
      // 真实报告里未解析项落 pending（既有契约：显式 ok 优先，故夹具不能随手默认 ok）
      sec("void_items", "无效标与废标项", "", { status: "pending" }),
    ])
    const h = summarizeParseHealth(rep)
    expect({ total: h.total, ok: h.ok, failed: h.failed, missing: h.missing }).toEqual({ total: 3, ok: 1, failed: 1, missing: 1 })
    expect(h.text).toContain("共 3 项")
    expect(h.text).toContain("失败 1 项")
  })

  it("空报告不抛错", () => {
    expect(summarizeParseHealth(null).text).toBe("共 0 项 · 已解析 0 项")
  })
})
