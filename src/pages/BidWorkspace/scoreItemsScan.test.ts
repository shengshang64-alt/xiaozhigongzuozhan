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
