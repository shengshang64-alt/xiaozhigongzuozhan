// R47/F7 回归锈：评分项本地扫描不得把时长「N分钟」当分值；真评分形态不得误伤
// 噪音行原文取自真实项目 13431（体验审计取证，.diag/r47_f7_out.txt）
import { describe, expect, it } from "vitest"
import { crossCheckScores, scanScoreItems } from "./scoreItemsScan"
import type { ParseReport } from "./bidTypes"

describe("scanScoreItems · 分钟≠分值（R47/F7）", () => {
  it("「投标截止时间：30分钟内…」不再被误判为 30 分评分项", () => {
    const r = scanScoreItems("投标截止时间：30分钟内（以电子交易系统解密倒计时为准）")
    expect(r.items).toHaveLength(0)
    expect(r.categorySums.other).toBe(0)
  })
  it("纯时长句不误报：解密时间90分钟 / 时长 30 分钟（带空格）", () => {
    expect(scanScoreItems("每家医院的解密时间90分钟").items).toHaveLength(0)
    expect(scanScoreItems("演示 30 分钟").items).toHaveLength(0)
  })
  it("真评分形态不误伤：括号式 /  colon 式 / 中文贴身式", () => {
    const r = scanScoreItems(["技术方案（20分）", "实施团队：15分", "售后服务质量10分"].join("\n"))
    expect(r.items.map((i) => i.score).sort((a, b) => a - b)).toEqual([10, 15, 20])
  })
  it("R61/r47-scan-name-trunc-06：中文贴身式行项名不再截掉末字", () => {
    const r = scanScoreItems(["3.系统响应速度15分", "4.数据备份能力10分"].join("\n"))
    expect(r.items.map((i) => i.name)).toEqual(["系统响应速度", "数据备份能力"])
    // 贴身假阳性字（值得/加分/扣分）与括号/冒号式不受影响
    const r2 = scanScoreItems(["技术方案（20分）", "实施团队：15分", "每答对一项得5分"].join("\n"))
    expect(r2.items.map((i) => i.name)).toEqual(["技术方案", "实施团队"])
  })
  it("同屏混合：评分行保留、时长行剔除（回归到 13431 修后预期）", () => {
    const r = scanScoreItems(["技术部分（60分）", "投标截止时间：30分钟内", "系统响应速度15分"].join("\n"))
    expect(r.items).toHaveLength(1)
    // R61 起贴身式不再截尾（r47-scan-name-trunc-06）：整名保留，钉死防回归
    expect(r.items[0].name).toBe("系统响应速度")
    expect(r.items[0].score).toBe(15)
  })
})

describe("crossCheckScores · 双向交叉核对（漏抽 + 待复核）", () => {
  const reportWith = (content: string): ParseReport =>
    ({
      scope: "key",
      sections: [{ key: "tech_score", title: "技术评分", content, status: "ok", snippet: "" }],
    }) as ParseReport

  it("原文有/报告无 → missingInReport；报告有/原文无 → extraInReport", () => {
    const tender = ["技术方案（20分）", "售后服务质量10分"].join("\n")
    const report = reportWith(["技术方案（20分）", "项目团队配置（8分）"].join("\n"))
    const cc = crossCheckScores(tender, report)
    expect(cc.missingInReport.map((m) => m.name)).toEqual(["售后服务质量"])
    expect(cc.extraInReport.map((e) => e.name)).toEqual(["项目团队配置"])
    expect(cc.extraInReport[0].section).toBe("tech_score")
  })

  it("名称互相包含视为匹配，不重复计入双向差异", () => {
    const cc = crossCheckScores("系统响应速度15分", reportWith("响应速度（15分）：优者得满分"))
    expect(cc.missingInReport).toHaveLength(0)
    expect(cc.extraInReport).toHaveLength(0)
  })
})

describe("scanScoreItems · 总分口径（R154/r151-score-scan-206）", () => {
  it("建设范围行「合计约206个系统/子系统模块」不再误报总分（真实文档回归）", () => {
    const r = scanScoreItems(
      "本项目建设范围包括智慧医疗、智慧服务、智慧管理、传承创新、大数据服务与应用、评级咨询服务、信创升级与改造、接口服务、运维服务共九大类，合计约206个系统/子系统模块（详见第七章技术参数要求，两者内容一一对应）：",
    )
    expect(r.total.value).toBeNull()
    expect(r.total.raw).toBe("")
  })
  it("显式带「分」单位的总分行正常采信：冒号式/贴身式/括号式", () => {
    expect(scanScoreItems("总分：100分").total.value).toBe(100)
    expect(scanScoreItems("满分100分").total.value).toBe(100)
    expect(scanScoreItems("评分合计（60分）").total.value).toBe(60)
  })
  it("只采信第一条总分，后续不覆盖", () => {
    const r = scanScoreItems(["总分：100分", "技术合计60分"].join("\n"))
    expect(r.total.value).toBe(100)
  })
})

// R193：区间/上限/逐条带上限评分行的漏报与误报修复
describe("scanScoreItems · 区间与上限权重归一（R193）", () => {
  it("区间式「技术方案比选 10-20分」不再整行漏报，取上界 20", () => {
    const r = scanScoreItems("1. 技术方案比选 10-20分")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("技术方案比选")
    expect(r.items[0].score).toBe(20)
  })
  it("逐条带上限「…（每项2分，最高20分）」取上限 20 且项名不再截残", () => {
    const r = scanScoreItems("技术参数逐条响应（每项2分，最高20分）")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("技术参数逐条响应")
    expect(r.items[0].score).toBe(20)
  })
  it("「每个5分，满分15分」是评分行（上限 15）而非总分，total 保持 null", () => {
    const r = scanScoreItems("同类项目业绩：每个5分，满分15分")
    expect(r.total.value).toBeNull()
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("同类项目业绩")
    expect(r.items[0].score).toBe(15)
  })
  it("上限式「演示效果（最高10分）」直接取上限入项", () => {
    const r = scanScoreItems("演示效果最高10分")
    expect(r.items.map((i) => i.score)).toEqual([10])
  })
  it("括号带评述「整体方案（25分）：优秀15-25分」仍以净括号 25 为权重（区间不夺优先级）", () => {
    const r = scanScoreItems("整体方案（25分）：优秀15-25分，良好10-14分")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("整体方案")
    expect(r.items[0].score).toBe(25)
  })
  it("回归护栏：时长「30-40分钟」仍不误报为区间分值", () => {
    expect(scanScoreItems("答辩时长控制在 30-40分钟").items).toHaveLength(0)
  })
  it("回归护栏：真总分「总分：100分」「满分100分」仍正常采信", () => {
    expect(scanScoreItems("总分：100分").total.value).toBe(100)
    expect(scanScoreItems("满分100分").total.value).toBe(100)
  })
})

describe("scanScoreItems · 跨行断裂与表格行归一（R194）", () => {
  it("pdfjs 列拆分跨行：项名行 + 纯分值行回并为一条评分项", () => {
    const r = scanScoreItems("技术方案比选\n20分\n售后服务质量\n10分")
    expect(r.items).toHaveLength(2)
    expect(r.items[0].name).toBe("技术方案比选")
    expect(r.items[0].score).toBe(20)
    expect(r.items[1].name).toBe("售后服务质量")
    expect(r.items[1].score).toBe(10)
  })
  it("护栏：纯页码行（无「分」）不被当作分值回并", () => {
    const r = scanScoreItems("售后服务质量\n12")
    expect(r.items).toHaveLength(0)
  })
  it("竖线 Markdown 表格行归一后可提取评分项", () => {
    const r = scanScoreItems("| 技术方案比选 | 20分 |")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("技术方案比选")
    expect(r.items[0].score).toBe(20)
  })
  it("制表符 TSV 行归一后可提取评分项", () => {
    const r = scanScoreItems("技术方案比选\t20分")
    expect(r.items).toHaveLength(1)
    expect(r.items[0].score).toBe(20)
  })
  it("表头标签行「序号 评审因素 分值」不产出评分项", () => {
    const r = scanScoreItems("序号\t评审因素\t分值\n1\t技术方案比选\t20分")
    expect(r.items.map((i) => i.name)).toEqual(["技术方案比选"])
  })
  it("跨行总分行：「总分」独行 + 「100分」独行 → total=100", () => {
    const r = scanScoreItems("总分\n100分")
    expect(r.total.value).toBe(100)
  })
  it("整表场景：多行评分项逐条产出且顺序稳定", () => {
    const r = scanScoreItems(
      "| 序号 | 评审因素 | 分值 |\n| 1 | 技术方案 | 20分 |\n| 2 | 售后服务 | 10分 |"
    )
    expect(r.items.map((i) => [i.name, i.score])).toEqual([
      ["技术方案", 20],
      ["售后服务", 10],
    ])
  })
  it("回归护栏：时长行跨行不误报（「答辩时长」+「30分钟」）", () => {
    const r = scanScoreItems("答辩时长\n30分钟")
    expect(r.items).toHaveLength(0)
  })
})

// R195：三列式评分表（项目 | 分值 | 描述）——分值单独成列且不带「分」字，单行启发式与 R194
// 的分隔符归一都拿不到（厦门海沧/信息化两份真实标书整表提取 0 项）。改为表头锚定的列模板提取，
// 并以「列数严格一致 + 分值数值域 + 描述格评分语汇」三道护栏守住不误读同形状的非评分表。
describe("scanScoreItems · 表头锚定的列模板（R195）", () => {
  it("三列评分表（分值列裸数字不带「分」）整表逐项提取", () => {
    const r = scanScoreItems(
      ["评标项目 | 评标分值 | 评标方法描述", "技术方案 | 20 | 完全响应得20分，否则不得分", "售后服务 | 10 | 每满足一项得5分，满分10分"].join("\n"),
    )
    expect(r.items.map((i) => [i.name, i.score])).toEqual([
      ["技术方案", 20],
      ["售后服务", 10],
    ])
    expect(r.total.value).toBeNull()
  })
  it("编号独立成列（1-1 / 1-2）：项名取描述格主题并回挂编号，逐条不互相覆盖", () => {
    const r = scanScoreItems(
      [
        "评标项目 | 评标分值 | 评标方法描述",
        "1-1 | 2 | 技术功能响应情况：完全满足第五章要求的得2分，否则不得分",
        "1-2 | 2 | 技术功能响应情况：完全满足共享文档标准化要求的得2分，否则不得分",
      ].join("\n"),
    )
    expect(r.items.map((i) => i.name)).toEqual([
      "技术功能响应情况（1-1）",
      "技术功能响应情况（1-2）",
    ])
    expect(r.items.map((i) => i.score)).toEqual([2, 2])
  })
  it("名称格自带编号前缀（「T1、技术服务响应程度」）项名不再只剩「T1」", () => {
    const r = scanScoreItems(
      [
        "评标项目\t评标分值\t评标方法描述",
        "T1、技术服务响应程度\t39\t根据所投设备技术性能逐项响应情况由评委评议评分，优者得39分",
      ].join("\n"),
    )
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("技术服务响应程度")
    expect(r.items[0].score).toBe(39)
  })
  it("名称格含顿号的复合评审因素（节能、环境标志产品）不被切成半个名字", () => {
    const r = scanScoreItems(
      [
        "评标项目 | 评标分值 | 评标方法描述",
        "节能、环境标志产品 | 20.78 | 属于清单内产品的给予相应评标项总分值一定幅度的加分，最高得20.78分",
      ].join("\n"),
    )
    expect(r.items.map((i) => i.name)).toEqual(["节能、环境标志产品"])
  })
  it("护栏：描述格不像评分标准的同形表不入项（采购/参数表分值列是数量或单价）", () => {
    const r = scanScoreItems(
      ["评标项目 | 评标分值 | 备注", "服务器 | 20 | 用于生产环境部署"].join("\n"),
    )
    expect(r.items).toHaveLength(0)
  })
  it("护栏：无评分表表头授权时不按列取分值（目录「第五章 政府采购合同 | 39」不读成 39 分）", () => {
    const r = scanScoreItems(["第五章 政府采购合同 | 39", "第六章 投标文件格式 | 52"].join("\n"))
    expect(r.items).toHaveLength(0)
  })
  it("护栏：列数不符即模板失效，其后的同形表不被继续按列吞", () => {
    const r = scanScoreItems(
      [
        "评标项目 | 评标分值 | 评标方法描述",
        "技术方案 | 20 | 完全响应得20分",
        "序号 | 名称 | 数量 | 单价",
        "1 | 应用服务器 | 4 | 30000",
        "售后服务 | 10 | 每满足一项得5分",
      ].join("\n"),
    )
    expect(r.items).toHaveLength(1)
    expect(r.items[0].name).toBe("技术方案")
  })
  it("类目继承：同表内描述格无类目关键词的行沿用上一行类目，不把同名项劈成两类", () => {
    const r = scanScoreItems(
      [
        "评标项目 | 评标分值 | 评标方法描述",
        "技术方案 | 3 | 架构完整、可落地的得3分",
        "标准解读 | 3 | 能够确保内容真实可靠的得2分",
      ].join("\n"),
    )
    expect(r.items.map((i) => i.cat)).toEqual(["tech", "tech"])
  })
})

describe("scanScoreItems · 总分口径不再被类目小计与逐条规则冒充（R195）", () => {
  it("「①价格项（F1×A1）满分为30分」是类目小计，不冒充全表总分，且切换类目上下文", () => {
    const r = scanScoreItems(["①价格项（F1×A1）满分为30分。", "总分：100分", "技术方案（20分）"].join("\n"))
    expect(r.total.value).toBe(100)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].cat).toBe("price")
  })
  it("「得满分N分」是逐条评分规则：不认作总分，交回评分项抽取逐条入项", () => {
    const r = scanScoreItems("若评标价格与评标基准价相同，得满分10分；")
    expect(r.total.value).toBeNull()
    expect(r.items).toHaveLength(1)
    expect(r.items[0].score).toBe(10)
  })
  it("真总分行仍正常采信（回归护栏：总分/满分/合计三式）", () => {
    expect(scanScoreItems("总分：100分").total.value).toBe(100)
    expect(scanScoreItems("满分100分").total.value).toBe(100)
    expect(scanScoreItems("评分合计（60分）").total.value).toBe(60)
  })
})
