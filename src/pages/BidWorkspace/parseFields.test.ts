import { describe, expect, it } from "vitest"
import { buildFieldsStructured, buildParseStructured, buildScoringStructured, PARSE_FIELD_LABELS } from "./parseSchemas"
import { flattenParseItemJson } from "./prompts/wholeParse"
import { parseSectionFieldValue, parseSectionFields, type ParseReport, type ParseSection } from "./bidTypes"

/**
 * R55（对标易标「结构化项 = 固定字段」契约）：整文 JSON 项落库时不再只留摊平文本，
 * 同时保留字段结构供展示与下游取值。本文件锁三件事：
 *  ① 字段抽取口径（缺值/「没有提及」不建行）；
 *  ② 分派正确（评分项仍走 scoring 块，逐条项不给字段块）；
 *  ③ **单一真源**：摊平文本的行首标签与结构化字段的 label 必须逐字一致（防两条路各改一处漂移）。
 */

describe("buildFieldsStructured：信息卡类字段抽取", () => {
  it("固定字段项：按中文标签成对，顺序与契约一致", () => {
    const b = buildFieldsStructured("bid_deposit", {
      amount: "人民币 50,000 元",
      payment_method: "银行转账或投标保函",
      account: "开户行：某某银行合肥分行",
      deadline: "2026-10-20 17:00",
      refund_conditions: "中标通知书发出后 5 个工作日内退还",
    })
    expect(b?.kind).toBe("fields")
    expect(b?.fields).toEqual([
      { label: "保证金金额", value: "人民币 50,000 元" },
      { label: "缴纳形式", value: "银行转账或投标保函" },
      { label: "收款账户", value: "开户行：某某银行合肥分行" },
      { label: "缴纳截止", value: "2026-10-20 17:00" },
      { label: "退还条件", value: "中标通知书发出后 5 个工作日内退还" },
    ])
  })

  it("缺失值与「没有提及」不建行（与摊平文本同口径）", () => {
    const b = buildFieldsStructured("bid_deposit", { amount: "", payment_method: "转账", account: "没有提及", deadline: "-", refund_conditions: null })
    expect(b?.fields).toEqual([{ label: "缴纳形式", value: "转账" }])
  })

  it("全部缺失 → undefined（调用方落「原文未提及」走 miss 态，行为不变）", () => {
    expect(buildFieldsStructured("bid_deposit", { amount: "", payment_method: "没有提及" })).toBeUndefined()
  })

  it("bid_nodes 是动态列表：标签取原文节点名，值取时间", () => {
    const b = buildFieldsStructured("bid_nodes", {
      nodes: [
        { node: "报名及下载招标文件", time: "2026-10-08 至 2026-10-14" },
        { node: "投标文件递交截止", time: "2026-10-20 09:00" },
        { node: "", time: "2026-10-21" },
      ],
    })
    expect(b?.fields).toEqual([
      { label: "报名及下载招标文件", value: "2026-10-08 至 2026-10-14" },
      { label: "投标文件递交截止", value: "2026-10-20 09:00" },
    ])
  })

  it("数组字段逐条成对（如编制依据多条标准）", () => {
    const b = buildFieldsStructured("compilation_basis", { standards: ["GB/T 22239-2019 信息安全技术", "", "WS 445-2014"] })
    expect(b?.fields).toEqual([
      { label: "编制依据", value: "GB/T 22239-2019 信息安全技术" },
      { label: "编制依据", value: "WS 445-2014" },
    ])
  })

  it("逐条条款类项（void_items 等）不给字段块——它们本质是条款列表，不是信息卡", () => {
    expect(buildFieldsStructured("void_items", { items: ["未密封", "未盖章"] })).toBeUndefined()
    expect(buildFieldsStructured("lots", { lots: [{ name: "A 包" }] })).toBeUndefined()
  })
})

describe("buildParseStructured：分派", () => {
  it("评分项走 scoring 块（行为与改造前一致）", () => {
    const b = buildParseStructured("tech_score", { score_composition: "总分 20 分", items: [{ name: "总体方案", score: "5", criteria: "优", source: "第三章" }] })
    expect(b?.kind).toBe("scoring")
    expect(buildParseStructured("tech_score", { items: [] })).toBeUndefined()
    expect(buildScoringStructured("tech_score", { items: [{ name: "x", score: 1 }] })?.kind).toBe("scoring")
  })

  it("信息卡类走 fields 块；逐条类两者都不给", () => {
    expect(buildParseStructured("bid_deposit", { amount: "5 万" })?.kind).toBe("fields")
    expect(buildParseStructured("bid_nodes", { nodes: [{ node: "开标", time: "10-20" }] })?.kind).toBe("fields")
    expect(buildParseStructured("void_items", { items: ["未密封"] })).toBeUndefined()
  })
})

describe("单一真源：摊平文本的行首标签 == 结构化字段的 label", () => {
  const samples: Record<string, Record<string, unknown>> = {
    bid_deposit: { amount: "5 万元", payment_method: "转账", account: "某银行", deadline: "10-20", refund_conditions: "5 个工作日" },
    project_info: { project_background: "背景", construction_content: "内容", duration: "36 个月", funding: "财政" },
    contract_terms: { award_notice: "公示 3 天", signing_deadline: "30 日内", performance_bond: "5%", termination: "违约解除", warranty_linkage: "质保衔接", disputes: "仲裁" },
    compilation_basis: { standards: ["GB/T 1", "WS 2"] },
  }

  it("两侧标签同源：文本侧「标签：」行首的标签集合与顺序 == 结构侧标签（数组字段续行不带标签，属既有契约）", () => {
    for (const [key, obj] of Object.entries(samples)) {
      const text = flattenParseItemJson(key, obj)
      const fields = buildFieldsStructured(key, obj)?.fields ?? []
      const fieldLabels = [...new Set(fields.map((f) => f.label))]
      const textLabels = text
        .split("\n")
        .map((l) => l.split("：")[0])
        .filter((l) => fieldLabels.includes(l))
      expect(textLabels, key).toEqual(fieldLabels)
    }
  })

  it("数组字段的两侧口径差异是明确契约：文本侧首元素带标签、其余续行；结构侧每条都带标签", () => {
    const obj = { standards: ["GB/T 1", "WS 2"] }
    expect(flattenParseItemJson("compilation_basis", obj)).toBe("编制依据：GB/T 1\nWS 2")
    expect(buildFieldsStructured("compilation_basis", obj)?.fields).toEqual([
      { label: "编制依据", value: "GB/T 1" },
      { label: "编制依据", value: "WS 2" },
    ])
  })

  it("标签表覆盖整文 JSON 契约的键名（漏一个就等于该字段没有结构化）", () => {
    expect(Object.keys(PARSE_FIELD_LABELS)).toEqual(
      expect.arrayContaining(["project_info", "purchaser_info", "agency_info", "bid_deposit", "bid_open_req", "eval_req", "contract_terms", "compilation_basis", "delivery_req", "response_req"]),
    )
  })
})

describe("parseSectionFields / parseSectionFieldValue：读取入口", () => {
  const sec = (over: Partial<ParseSection>): ParseSection => ({ key: "bid_deposit", title: "投标保证金", content: "保证金金额：5 万", status: "ok", snippet: "", ...over }) as ParseSection

  it("按形状读 fields（不 import parseSchemas，避免环依赖）", () => {
    const s = sec({ structured: { kind: "fields", fields: [{ label: "保证金金额", value: "5 万" }, { label: "缴纳截止", value: "10-20" }] } })
    expect(parseSectionFields(s)).toEqual([{ label: "保证金金额", value: "5 万" }, { label: "缴纳截止", value: "10-20" }])
  })

  it("老报告/检索通道产物（无 structured 或 kind 不符）→ 空数组，调用方回退文本", () => {
    expect(parseSectionFields(sec({}))).toEqual([])
    expect(parseSectionFields(sec({ structured: { kind: "scoring", items: [] } }))).toEqual([])
    expect(parseSectionFields(null)).toEqual([])
  })

  it("按标签取值：同标签多条取首条（与摊平文本「首行携带标签」口径一致）", () => {
    const report = {
      scope: "full",
      sections: [sec({ structured: { kind: "fields", fields: [{ label: "编制依据", value: "GB/T 1" }, { label: "编制依据", value: "WS 2" }] } })],
    } as ParseReport
    expect(parseSectionFieldValue(report, "bid_deposit", "编制依据")).toBe("GB/T 1")
    expect(parseSectionFieldValue(report, "bid_deposit", "不存在")).toBe("")
    expect(parseSectionFieldValue(null, "bid_deposit", "编制依据")).toBe("")
  })
})
