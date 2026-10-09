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
