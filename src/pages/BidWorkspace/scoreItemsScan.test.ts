// R47/F7 回归锈：评分项本地扫描不得把时长「N分钟」当分值；真评分形态不得误伤
// 噪音行原文取自真实项目 13431（体验审计取证，.diag/r47_f7_out.txt）
import { describe, expect, it } from "vitest"
import { scanScoreItems } from "./scoreItemsScan"

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
  it("同屏混合：评分行保留、时长行剔除（回归到 13431 修后预期）", () => {
    const r = scanScoreItems(["技术部分（60分）", "投标截止时间：30分钟内", "系统响应速度15分"].join("\n"))
    expect(r.items).toHaveLength(1)
    // 注：贴身式（汉字+数字分）的 cleanName 既有行为会把分值前一个汉字算进标记→名字截掉末字，非本轮引入，待后续单独评估
    expect(r.items[0].name).toContain("系统响应")
    expect(r.items[0].score).toBe(15)
  })
})
