import { describe, expect, it } from "vitest"
import { extractScoringFromText } from "../bidTypes"
import {
  buildSegmentMergeMessages,
  buildWholeFileContent,
  buildWholeParseMessages,
  buildWholeParseTask,
  flattenParseItemJson,
  isJsonParseItem,
  PARSE_WHOLE_SYSTEM_PROMPT,
} from "./wholeParse"

// T14 整文直读通道测试：消息结构（跨项同前缀是缓存命中的前提）+ JSON 摊平与下游消费格式的对齐

describe("buildWholeParseMessages", () => {
  it("消息结构为 system → user 文件 → user 任务", () => {
    const msgs = buildWholeParseMessages("tech_score", "招标文件全文……")
    expect(msgs).toHaveLength(3)
    expect(msgs[0].role).toBe("system")
    expect(msgs[0].content).toBe(PARSE_WHOLE_SYSTEM_PROMPT)
    expect(msgs[1].role).toBe("user")
    expect(String(msgs[1].content)).toContain("招标文件全文……")
    expect(msgs[2].role).toBe("user")
  })

  it("跨项前缀逐字节一致（system + 文件 message 不随 key 变化）——提示词缓存的前提", () => {
    const a = buildWholeParseMessages("overview", "同一份文件")
    const b = buildWholeParseMessages("tech_score", "同一份文件")
    expect(a[0]).toEqual(b[0])
    expect(a[1]).toEqual(b[1])
    expect(a[2].content).not.toBe(b[2].content)
  })

  it("分段头对同段各项一致、段间不同，且包含段序与分段说明", () => {
    const seg1 = buildWholeFileContent("内容", { index: 1, total: 3 })
    const seg1Again = buildWholeFileContent("内容", { index: 1, total: 3 })
    const seg2 = buildWholeFileContent("内容", { index: 2, total: 3 })
    expect(seg1).toBe(seg1Again)
    expect(seg1).not.toBe(seg2)
    expect(seg1).toContain("第 1/3 段")
    expect(seg1).toContain("按段解析")
  })

  it("JSON 项任务含「只修改 value」契约与 JSON 模板；叙述项不含 JSON 约束", () => {
    expect(buildWholeParseTask("tech_score")).toContain("只修改 value，禁止修改 key 和结构")
    expect(buildWholeParseTask("tech_score")).toContain('"score_composition"')
    expect(buildWholeParseTask("tech_score")).toContain("只抄原文声明的数字")
    expect(buildWholeParseTask("void_items")).not.toContain("仅输出 JSON")
    expect(buildWholeParseTask("void_items")).toContain("条款：")
    // P0 解析根因（2026-11-01）：收录三条铁律须落进整文通道，与检索通道同口径
    expect(buildWholeParseTask("void_items")).toContain("一句完整的话")
    expect(buildWholeParseTask("void_items")).toContain("明确后果表述")
    expect(buildWholeParseTask("void_items")).toContain("禁止输出任何标题行")
    expect(buildWholeParseTask("qualification")).toContain("[强制]")
  })

  it("isJsonParseItem 划分：17 个结构化项走 JSON，void_items/qualification/compliance 走 markdown", () => {
    for (const key of ["overview", "tech_score", "biz_score", "project_info", "purchaser_info", "agency_info", "delivery_req", "response_req", "bid_nodes", "bid_deposit", "bid_open_req", "eval_req", "contract_terms", "compilation_basis", "purchase_list", "lots", "bid_outline_req"]) {
      expect(isJsonParseItem(key)).toBe(true)
    }
    for (const key of ["void_items", "qualification", "compliance", "unknown_key"]) {
      expect(isJsonParseItem(key)).toBe(false)
    }
  })
})

describe("flattenParseItemJson", () => {
  it("tech_score 摊平为「评分构成 + 名称（N 分）：标准（出处：…）」行式文本，可被 extractScoringFromText 回读", () => {
    const flat = flattenParseItemJson("tech_score", {
      score_composition: "总分 100 分（技术 60 分、商务 20 分、价格 20 分）",
      items: [
        { name: "系统技术方案", score: "20", criteria: "方案完整先进，≥95%得满分，每低1%扣0.5分", source: "第四章 评分办法 4.2" },
        { name: "实施团队", score: "10 分", criteria: "项目经理具有PMP证书得满分", source: "" },
        { name: "没有提及", score: "没有提及", criteria: "没有提及", source: "没有提及" },
      ],
    })
    const lines = flat.split("\n")
    expect(lines[0]).toBe("评分构成：总分 100 分（技术 60 分、商务 20 分、价格 20 分）")
    expect(lines[1]).toBe("系统技术方案（20 分）：方案完整先进，≥95%得满分，每低1%扣0.5分（出处：第四章 评分办法 4.2）")
    expect(lines[2]).toBe("实施团队（10 分）：项目经理具有PMP证书得满分")
    expect(lines).toHaveLength(3) // 「没有提及」项整行跳过
    // 下游零改动验收：摊平行可被既有评分项解析器消费
    const items = extractScoringFromText(lines.slice(1).join("\n"))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ item: "系统技术方案", score: 20 })
    expect(items[0].criteria).toContain("出处：第四章 评分办法 4.2")
    expect(items[1].score).toBe(10)
  })

  it("overview 摊平六维度字段行，schedule 逐条成行，「没有提及」字段跳过", () => {
    const flat = flattenParseItemJson("overview", {
      project_name: "某医院信息化系统",
      tender_no: "没有提及",
      budget: "500万元",
      schedule: [
        { node: "投标截止", time: "2026年10月9日9:00" },
        { node: "开标", time: "同投标截止时间" },
        { node: "无效节点", time: "没有提及" },
      ],
    })
    const lines = flat.split("\n")
    expect(lines[0]).toBe("项目名称：某医院信息化系统")
    expect(lines).toContain("预算金额：500万元")
    expect(lines.some((l) => l.includes("招标编号"))).toBe(false)
    expect(lines).toContain("时间安排：投标截止：2026年10月9日9:00")
    expect(lines).toContain("时间安排：开标：同投标截止时间")
    expect(lines.some((l) => l.includes("无效节点"))).toBe(false)
  })

  it("全字段「没有提及」/空 → 返回空串（调用方落「原文未提及」走 miss 态）", () => {
    expect(flattenParseItemJson("purchaser_info", { purchaser_name: "没有提及", contact_person: "", contact_phone: "没有提及", address: "" })).toBe("")
  })

  it("bid_outline_req 保留编号与层级缩进", () => {
    const flat = flattenParseItemJson("bid_outline_req", {
      outline: [
        { no: "一", title: "投标函部分", level: 1 },
        { no: "1.1", title: "法定代表人身份证明", level: 2 },
      ],
    })
    const lines = flat.split("\n")
    expect(lines[0]).toBe("一 投标函部分")
    expect(lines[1]).toBe("  1.1 法定代表人身份证明")
  })

  it("lots 空数组 → 空串；有包时保留包号/预算/摘要", () => {
    expect(flattenParseItemJson("lots", { lots: [] })).toBe("")
    const flat = flattenParseItemJson("lots", {
      lots: [{ no: "1", title: "第一包 医院核心系统", budget: "300万元", summary: "HIS、EMR 建设" }],
    })
    expect(flat).toBe("1 第一包 医院核心系统（预算：300万元）：HIS、EMR 建设")
  })

  it("bid_nodes / purchase_list / 扁平字段落（delivery_req）按行摊平", () => {
    const nodes = flattenParseItemJson("bid_nodes", { nodes: [{ node: "答疑截止", time: "2026年10月2日17:00" }] })
    expect(nodes).toBe("投标关键节点：答疑截止：2026年10月2日17:00")
    const list = flattenParseItemJson("purchase_list", {
      items: [{ name: "服务器", spec: "2路16核", qty: "2台", note: "没有提及" }],
    })
    expect(list).toBe("名称：服务器｜规格型号：2路16核｜数量：2台")
    const delivery = flattenParseItemJson("delivery_req", {
      implementation_period: "合同签订后90日内",
      warranty: "3年",
      tech_requirements: "没有提及",
    })
    expect(delivery.split("\n")).toEqual(["实施周期：合同签订后90日内", "质保期：3年"])
  })

  it("非对象根输出（数组/原始值）安全返回空串而非抛错", () => {
    expect(flattenParseItemJson("tech_score", ["不是对象"])).toBe("")
    expect(flattenParseItemJson("overview", "文本")).toBe("")
    expect(flattenParseItemJson("overview", null)).toBe("")
  })
})

describe("buildSegmentMergeMessages", () => {
  it("包含分段结果标头、合并要求与原任务契约；JSON 项要求仅输出 JSON", () => {
    const msgs = buildSegmentMergeMessages(
      "tech_score",
      [
        { index: 1, total: 2, content: '{"items":[]}' },
        { index: 2, total: 2, content: "没有提及" },
      ],
      "json",
    )
    expect(msgs[0].role).toBe("system")
    expect(msgs[0].content).toBe(PARSE_WHOLE_SYSTEM_PROMPT)
    const user = String(msgs[1].content)
    expect(user).toContain("## 第 1/2 段解析结果")
    expect(user).toContain("## 第 2/2 段解析结果")
    expect(user).toContain("只修改 value，禁止修改 key 和结构")
    expect(user).toContain("最终只返回一个 JSON 对象")
    expect(user).toContain("score_composition")
  })

  it("markdown 项合并要求为整理后的 Markdown", () => {
    const msgs = buildSegmentMergeMessages("void_items", [{ index: 1, total: 1, content: "条款：…" }], "markdown")
    expect(String(msgs[1].content)).toContain("最终只返回整理后的 Markdown 内容")
  })
})
