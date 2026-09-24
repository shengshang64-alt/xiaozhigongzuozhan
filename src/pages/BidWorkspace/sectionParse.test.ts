import { describe, expect, it } from "vitest"
import {
  buildBidOutlineMessages,
  buildOutlineFixMessages,
  buildSectionParseMessages,
  dedupeAcrossSections,
  extractScoringFromText,
  extractScoringSectionExcerpt,
  extractStarClauses,
  requestedKeys,
  type ParseReport,
} from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// Issue 2（逐项独立提示词重构）锈死网：
// - buildSectionParseMessages 为每个解析项产出专属 System/User，overview/tech_score 采用参考口径；
// - extractScoringFromText 在既有单行格式外，额外兼容参考实现的【评分项名称】分块格式（解析侧安全网）。
// 2026-09-23 用户反馈轮追加：评分章节本地定位（修「评分办法解析不到」）、关键项 8 项档、跨项近似行去重、大纲事实来源排他。

describe("buildSectionParseMessages（逐项独立提示词）", () => {
  const text = "XX医院信息化建设项目招标文件全文……"

  it("返回 system + user 消息，且 JSON 契约只含当前项 key", () => {
    const msgs = buildSectionParseMessages("overview", text)
    expect(msgs[0].role).toBe("system")
    expect(msgs.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes(text))).toBe(true)
    expect(msgs[0].content).toContain(`只含一个键 "overview"`)
  })

  it("overview：七维度 + 尽量用原文 + 不提取商务（参考口径）", () => {
    const sys = buildSectionParseMessages("overview", text)[0].content
    expect(sys).toContain("项目概述")
    expect(sys).toContain("项目名称和基本信息")
    expect(sys).toContain("主要技术特点")
    expect(sys).toContain("尽量使用招标文件原文")
    expect(sys).toContain("不提取商务信息")
  })

  it("tech_score：定位技术评分 + 忽略商务价格资质 + 单行可解析格式（含档位/出处）", () => {
    const sys = buildSectionParseMessages("tech_score", text)[0].content
    expect(sys).toContain("技术评分")
    expect(sys).toContain("忽略商务、价格、资质")
    // 输出格式必须是下游 extractScoringFromText 可解析的单行「评分项名称（N 分）：…」
    expect(sys).toContain("评分项名称（N 分）")
    expect(sys).toContain("自检")
  })

  it("其余项沿用自身 guide 口径", () => {
    const sys = buildSectionParseMessages("project_info", text)[0].content
    expect(sys).toContain("项目信息")
    expect(sys).toContain("项目背景、建设内容")
  })

  it("void_items：概念边界 + 同义归并 + 原文/经验补充分层（OpenBidKit 口径）", () => {
    const sys = buildSectionParseMessages("void_items", text)[0].content
    expect(sys).toContain("无效投标")
    expect(sys).toContain("废标项")
    expect(sys).toContain("否决投标")
    expect(sys).toContain("重点补充：")
    expect(sys).toContain("最多 3 条")
    expect(sys).toContain("电子标")
  })
})

describe("buildOutlineFixMessages（承接标注保留与补齐，OpenBidKit 评审→修复闭环）", () => {
  it("现有大纲带 [响应:Rx] description 原样传出，修复规则含承接保留/补齐条款", () => {
    const nodes: OutlineNode[] = [
      {
        id: "1",
        title: "售后服务方案",
        children: [
          { id: "1.1", title: "运维保障机制", children: [], description: "[响应:R2]" },
        ],
      },
    ]
    const msgs = buildOutlineFixMessages(nodes, 2, 10, 800, ["评分项未承接（R3）"])
    const system = msgs[0].content as string
    expect(system).toContain("承接标注是评分覆盖对账依据")
    expect(system).toContain("逐条解决问题清单：评分项未承接（R3）")
    // 现有大纲 JSON 必须携带 description，否则修复后承接标注丢失
    expect(msgs[1].content as string).toContain("[响应:R2]")
  })
})

describe("extractScoringFromText（兼容【】分块格式）", () => {
  it("参考实现的【评分项名称】分块被还原为评分项", () => {
    const block = [
      "【评分项名称】：系统可用性",
      "【权重/分值】：25分",
      "【评分标准】：年平均故障时间≤1小时得满分；每增加1小时扣2分。",
      "【数据来源】：附件4-技术评分细则（第3页）",
      "",
      "【评分项名称】：响应时间",
      "【权重/分值】：15分",
      "【评分标准】：≤50ms得满分；每增加10ms扣1分。",
      "【数据来源】：第6.1.2条",
    ].join("\n")
    const items = extractScoringFromText(block)
    expect(items).toHaveLength(2)
    expect(items[0].item).toBe("系统可用性")
    expect(items[0].score).toBe(25)
    expect(items[0].criteria).toContain("年平均故障时间")
    expect(items[0].criteria).toContain("出处：附件4-技术评分细则")
    expect(items[1].item).toBe("响应时间")
    expect(items[1].score).toBe(15)
  })

  it("既有单行格式仍解析（回归保护）", () => {
    const lines = "响应时间（15 分）：≤50ms得满分\n数据安全：10 分"
    const items = extractScoringFromText(lines)
    expect(items.map((i) => i.item)).toEqual(["响应时间", "数据安全"])
    expect(items[0].score).toBe(15)
    expect(items[1].score).toBe(10)
  })
})

describe("extractScoringSectionExcerpt（评分章节本地定位，修「评分办法解析不到」）", () => {
  it("命中「第X章 评标办法」：取到下一个章级标题为止，不串入下一章内容", () => {
    const tender = [
      "第一章 招标公告",
      "项目名称：某医院信息化项目。",
      "第二章 评标办法（综合评分法）",
      "一、技术评分",
      "系统可用性（25 分）：年平均故障时间≤1小时得满分",
      "三、商务评分",
      "同类业绩（10 分）：每个合同得2分",
      "第三章 合同条款",
      "质保期：验收后 5 年。",
    ].join("\n")
    const excerpt = extractScoringSectionExcerpt(tender)
    expect(excerpt).toContain("评标办法")
    expect(excerpt).toContain("系统可用性（25 分）")
    expect(excerpt).toContain("同类业绩（10 分）")
    expect(excerpt).not.toContain("质保期")
    expect(excerpt).not.toContain("项目名称")
  })

  it("附件评分表也能命中；全文无评分相关标题时返回空串（调用方回退全文分段）", () => {
    const withAnnex = ["目录", "附件1：技术评分细则表", "架构能力（10 分）：完整得满分", "附件2：投标文件格式", "格式要求如下"]
    const excerpt = extractScoringSectionExcerpt(withAnnex.join("\n"))
    expect(excerpt).toContain("架构能力（10 分）")
    expect(excerpt).not.toContain("格式要求如下")
    expect(extractScoringSectionExcerpt(["第一章 总则", "本项目无任何评审内容", "第二段"].join("\n"))).toBe("")
  })

  it("正文叙述句（含句读/行长）不误判为评分标题", () => {
    expect(extractScoringSectionExcerpt("本项目评标办法详见后续通知，评标办法相关正文描述超过六十字时才不参与判定参与判定判定判定判定判定判定判定判定判定判定判定判定判定判定")).toBe("")
  })

  it("R48b 真实第四章结构：目录行不占槽 + 章内多个小标题切碎后，章后半的逐条分值表仍能被扫进节选", () => {
    // 复现 13431 病灶：目录里先出现一次「第四章…\t32」，正文里评分章被「评审标准/评分标准」切成多块，
    // 真正的技术资信/价格分值表在章的后半（旧 4 块上限轮不到，AI 误报「缺失」）
    const tender = [
      "目录",
      "第四章  评标方法和标准（综合评分法）\t32", // 目录页码行：必须跳过，不占块槽位
      "第五章  政府采购合同\t60",
      "...",
      "第四章  评标方法和标准（综合评分法）", // 正文真章标题
      "一、总则", // 中文序号不作边界
      "本项目按照招标文件第二章的规定执行。",
      "评审标准", // 章内小标题→断块（格式审查，非综合评分）
      "格式及材料要求：开标一览表符合规定。",
      "评审标准", // 又一个小标题→断块
      "异常低价投标审查：报价低于均值判定。",
      "2.4.2本项目综合评分满分为100分，其中：技术资信分值占总分值的权重为90%，价格分值占总分值的权重为10%。具体评分细则如下：", // 带句号，当不了锚点，但应落在上一块里
      "评分标准", // 真·技术资信分值表起点
      "分值范围",
      "技术资信分（90分）",
      "总体技术解决方案（5分）：理解精准得5分",
      "系统响应（5分）：架构完整得满分",
      "评分标准：", // 运维评分块
      "运维服务（5分）：SLA承诺严苛得满分",
      "评分标准：", // 风险/价格评分块（章后半，旧上限够不到）
      "价格分（10分）：采用低价优先法，最低报价得满分10分",
      "★技术参数每满足一项得1分，满分20分",
      "第五章  政府采购合同", // 章边界，必须停在这之前
      "合同价款：人民币伍佰万元。",
    ].join("\n")
    const excerpt = extractScoringSectionExcerpt(tender)
    // 真分值表的关键行必须全部进节选（旧逻辑因 4 块上限全部丢失）
    expect(excerpt).toContain("满分为100分")
    expect(excerpt).toContain("技术资信分（90分）")
    expect(excerpt).toContain("总体技术解决方案（5分）")
    expect(excerpt).toContain("价格分（10分）")
    expect(excerpt).toContain("★技术参数")
    // 下一章正文不得串入
    expect(excerpt).not.toContain("合同价款")
  })
})

describe("关键项 8 项档与配置兼容（2026-09-23 用户反馈轮）", () => {
  it("默认关键项档含商务评分与投标文件目录要求（评分办法整体+目录锚点不再依赖完整档）", () => {
    const keys = requestedKeys({ scope: "key", extra_keys: [] })
    expect(keys).toHaveLength(8)
    expect(keys).toContain("biz_score")
    expect(keys).toContain("bid_outline_req")
  })

  it("老配置 extra_keys 仍含已升档 key 时不重复输出", () => {
    const keys = requestedKeys({ scope: "full", extra_keys: ["biz_score", "bid_outline_req", "void_items"] })
    expect(keys.filter((k) => k === "biz_score")).toHaveLength(1)
    expect(keys.filter((k) => k === "bid_outline_req")).toHaveLength(1)
    expect(keys).toContain("void_items")
  })
})

describe("buildSectionParseMessages 追加口径（2026-09-23）", () => {
  const text = "XX医院信息化建设项目招标文件全文……"

  it("tech_score：同义章节定位线索 + 附表（前附表/附件）提示", () => {
    const sys = buildSectionParseMessages("tech_score", text)[0].content
    expect(sys).toContain("评标办法")
    expect(sys).toContain("前附表")
  })

  it("biz_score：商务+价格专属口径（不再只靠 guide 一句）", () => {
    const sys = buildSectionParseMessages("biz_score", text)[0].content
    expect(sys).toContain("商务评分要求")
    expect(sys).toContain("价格评分公式")
    expect(sys).toContain("忽略技术评分项")
  })

  it("scoringExcerptMode：用户消息标明摘录来源并禁止摘录外补写", () => {
    const msgs = buildSectionParseMessages("tech_score", text, { scoringExcerptMode: true })
    expect(String(msgs[1].content)).toContain("评分办法相关章节摘录")
    expect(String(msgs[2].content)).toContain("禁止凭常识或经验补写")
  })

  it("generic 项带职责互斥条款（修关键信息重复提取）", () => {
    const sys = buildSectionParseMessages("delivery_req", text)[0].content
    expect(sys).toContain("职责互斥")
  })
})

describe("dedupeAcrossSections 增强归一（仅出处后缀/全半角标点差异也收敛）", () => {
  it("同义微差重复行保留首条、删除后条；star_clauses 豁免不变", () => {
    const report = {
      scope: "key",
      sections: [
        { key: "overview", title: "", content: "预算金额：3500万元（出处：第一章）", status: "ok" },
        { key: "project_info", title: "", content: "预算金额：3500万元，含运维\n工期：90 日历天", status: "ok" },
        { key: "bid_nodes", title: "", content: "预算金额：3500万元（出处：P3）", status: "ok" },
      ],
    } as unknown as ParseReport
    const out = dedupeAcrossSections(report)
    // 第二行含额外文本「，含运维」不归一相同→保留；bid_nodes 唯一一行与首条仅出处差异→被去重后变空
    expect(out.sections[1].content).toContain("预算金额：3500万元，含运维")
    expect(out.sections[1].content).toContain("工期：90 日历天")
    expect(out.sections[2].content).toBe("")
  })
})

describe("大纲防幻觉注入（2026-09-23 用户反馈轮：目录不一致）", () => {
  it("整份与分步 call1 大纲 prompt 均含事实来源排他条款", () => {
    const report = { scope: "key", sections: [{ key: "tech_score", title: "", content: "总体方案（15 分）：完整得满分", status: "ok" }] } as unknown as ParseReport
    const all = buildBidOutlineMessages("智慧医院项目", "某医院", report, false, 2)
      .map((m) => String(m.content))
      .join("\n")
    expect(all).toContain("事实来源排他")
    expect(all).toContain("禁止编造注入内容中不存在的评分项")
  })
})

// R50/F2 锈死网：★条款本地扫描必须拿到正文（旧逻辑只保留含★的行、正文全丢，13431 实测只剩★1~★10光杆编号）
describe("extractStarClauses（★条款扫描：标记行 + 后续正文行）", () => {
  it("PDF 转译结构：★N 单独占行、正文在其后行（隔空行）→ 条款须含正文与注", () => {
    const tender = [
      "序号",
      "",
      "技术参数及要求",
      "",
      "★1",
      "",
      "软件性能支持处理日均门诊患者人次达15000以上、住院患者人次5000以上。",
      "",
      "注:投标文件中须提供承诺函并盖公章承诺满足此项条件。",
      "",
      "★2",
      "",
      "数据处理能力：承建方须制定并执行历史数据迁移与归档整体方案。",
    ].join("\n")
    const clauses = extractStarClauses(tender)
    expect(clauses.length).toBe(2)
    // 关键断言：条款不再是光杆「★1」，而是带上了真实正文
    expect(clauses[0]).toContain("★1")
    expect(clauses[0]).toContain("日均门诊患者人次达15000")
    expect(clauses[0]).toContain("承诺函")
    expect(clauses[1]).toContain("数据处理能力")
  })

  it("行内式条款（标记与正文同行）不回归；连续标记行各自成条；首个标记前的普通正文被丢弃", () => {
    const clauses = extractStarClauses(
      ["前言与目录说明，不属于任何重点条款", "★ 须本地化服务团队", "★ 质保期不少于3年"].join("\n"),
    )
    expect(clauses).toEqual(["★ 须本地化服务团队", "★ 质保期不少于3年"])
  })

  it("结构边界（章标题/前附表）终止条款，不把后文整段吞进标记条款", () => {
    const tender = [
      "★1",
      "完全满足采购需求所有实质性条款",
      "第四章 评标方法和标准",
      "本节无关评标细则，不应被吞进上一条。",
      "不应被吞进上一条的第二行内容。",
      "不应被吞进上一条的第三行内容。",
      "不应被吞进上一条的第四行内容。",
      "不应被吞进上一条的第五行内容。",
    ].join("\n")
    const clauses = extractStarClauses(tender)
    expect(clauses.length).toBe(1)
    expect(clauses[0]).toContain("实质性条款")
    expect(clauses[0]).not.toContain("评标细则")
    expect(clauses[0]).not.toContain("第四章")
  })
})
