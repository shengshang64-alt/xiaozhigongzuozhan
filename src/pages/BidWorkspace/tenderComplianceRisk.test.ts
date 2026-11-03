import { describe, it, expect } from "vitest"
import {
  scanTenderComplianceRisk,
  summarizeComplianceRisk,
  parseAiRiskFindings,
  mergeRiskFindings,
  sortRiskFindings,
  flattenRiskSection,
  REDLINE,
  type RiskFinding,
} from "./tenderComplianceRisk"

const hit = (text: string, id: string) =>
  scanTenderComplianceRisk(text).some((f) => f.ruleId === id)

describe("scanTenderComplianceRisk 八大禁止情形", () => {
  it("规模条件作资格 DIS-scale", () => {
    expect(hit("投标人注册资本 5000 万元以上。", "DIS-scale")).toBe(true)
  })
  it("地域业绩 DIS-region", () => {
    expect(hit("提供本省三甲医院业绩不少于 3 个加 2 分。", "DIS-region")).toBe(true)
  })
  it("指定品牌 DIS-brand", () => {
    expect(hit("服务器须采用指定品牌，不接受兼容产品。", "DIS-brand")).toBe(true)
  })
  it("厂家授权作资格 DIS-authorize", () => {
    expect(hit("须出具原厂授权书，否则资格无效。", "DIS-authorize")).toBe(true)
  })
  it("所有制/所在地限定 DIS-ownership", () => {
    expect(hit("投标人为国有企业须为本地注册企业。", "DIS-ownership")).toBe(true)
  })
})

describe("scanTenderComplianceRisk 七条红线", () => {
  it("版权归属甲方 RL-copyright", () => {
    expect(hit("项目全部知识产权归甲方所有。", "RL-copyright")).toBe(true)
  })
  it("源代码交付 RL-sourcecode", () => {
    expect(hit("验收时须交付系统源代码。", "RL-sourcecode")).toBe(true)
  })
  it("范围模糊 RL-scope", () => {
    expect(hit("实施范围包括但不限于上述模块。", "RL-scope")).toBe(true)
  })
  it("接口无限制 RL-api", () => {
    expect(hit("中标人须免费提供全部接口不限调用次数。", "RL-api")).toBe(true)
  })
  it("过级项目 RL-grade", () => {
    expect(hit("本项目目标为电子病历五级、互联互通四甲测评。", "RL-grade")).toBe(true)
  })
  it("首付款低于红线 RL-payment", () => {
    const f = scanTenderComplianceRisk("合同签订后预付货款 10%。").find((x) => x.ruleId === "RL-payment")
    expect(f).toBeTruthy()
    expect(f!.level).toBe("red")
  })
  it("首付款达标不误报", () => {
    expect(hit("合同签订后预付货款 30%。", "RL-payment")).toBe(false)
  })
  it("维护费率严拒 RL-maint-reject", () => {
    expect(hit("第三年起每年维护费为合同额 5%。", "RL-maint-reject")).toBe(true)
  })
  it("维护费率低于底线 RL-maint-floor", () => {
    const f = scanTenderComplianceRisk("每年运维费 9%。").find((x) => x.ruleId === "RL-maint-floor")
    expect(f).toBeTruthy()
    expect(f!.level).toBe("yellow")
  })
  it("维护费率正常区间不误报", () => {
    expect(hit("每年维护费 12%。", "RL-maint-reject")).toBe(false)
    expect(hit("每年维护费 12%。", "RL-maint-floor")).toBe(false)
  })
})

describe("scanTenderComplianceRisk 六类陷阱与阈值常量", () => {
  it("模糊验收 TRAP-accept", () => {
    expect(hit("最终验收以甲方满意为准。", "TRAP-accept")).toBe(true)
  })
  it("阈值常量取自附录 F", () => {
    expect(REDLINE.firstPaymentPctMin).toBe(30)
    expect(REDLINE.maintenancePctReject).toBe(8)
    expect(REDLINE.maintenancePctFloor).toBe(10)
  })
})

describe("误报防护", () => {
  it("视频监控不触发品牌指定", () => {
    expect(hit("建设全院视频监控与远程会诊系统。", "DIS-brand")).toBe(false)
  })
  it("质保期不少于2年不触发规模条件", () => {
    expect(hit("免费质保期不少于 2 年。", "DIS-scale")).toBe(false)
  })
  it("空文本返回空", () => {
    expect(scanTenderComplianceRisk("")).toEqual([])
    expect(scanTenderComplianceRisk(null)).toEqual([])
  })
  it("同一条款去重", () => {
    const t = "注册资本 1000 万元以上。\n注册资本 1000 万元以上。"
    const n = scanTenderComplianceRisk(t).filter((f) => f.ruleId === "DIS-scale").length
    expect(n).toBe(1)
  })
})

describe("summarize / merge / sort / ai 兜底 / 落库", () => {
  const mk = (o: Partial<RiskFinding>): RiskFinding => ({
    ruleId: "X", category: "trap", level: "yellow", origin: "rule",
    title: "t", excerpt: "e", reason: "r", legalBasis: "b", suggestion: "s", line: 0, ...o,
  })
  it("汇总红黄与分类", () => {
    const s = summarizeComplianceRisk([
      mk({ level: "red", category: "redline" }),
      mk({ level: "yellow", category: "discrimination" }),
      mk({ level: "yellow", category: "trap", origin: "ai" }),
    ])
    expect(s.total).toBe(3)
    expect(s.red).toBe(1)
    expect(s.yellow).toBe(2)
    expect(s.aiCount).toBe(1)
    expect(s.ruleCount).toBe(2)
    expect(s.hasRisk).toBe(true)
  })
  it("AI 兜底归一 origin=ai", () => {
    const a = parseAiRiskFindings([{ title: "参数指向单一产品", category: "discrimination", level: "red", excerpt: "…某型号…" }])
    expect(a[0].origin).toBe("ai")
    expect(a[0].category).toBe("discrimination")
    expect(a[0].level).toBe("red")
    expect(a[0].line).toBe(0)
  })
  it("AI 非法 category 回落 trap、缺 title 兜底", () => {
    const a = parseAiRiskFindings([{ category: "bogus", excerpt: "只有证据" }])
    expect(a[0].category).toBe("trap")
    expect(a[0].title).toBe("AI 提示的合规风险")
  })
  it("合并去重规则优先", () => {
    const rule = [mk({ ruleId: "DIS-region", excerpt: "本省业绩加分" })]
    const ai = [mk({ ruleId: "DIS-region", excerpt: "本省业绩加分", origin: "ai" }), mk({ ruleId: "AI-1", origin: "ai" })]
    const m = mergeRiskFindings(rule, ai)
    expect(m.length).toBe(2)
    expect(m[0].origin).toBe("rule")
  })
  it("排序红在前", () => {
    const s = sortRiskFindings([mk({ level: "yellow", line: 1 }), mk({ level: "red", line: 9 })])
    expect(s[0].level).toBe("red")
  })
  it("落库文本含红黄标记与建议", () => {
    const txt = flattenRiskSection([mk({ level: "red", category: "redline", title: "源代码交付", suggestion: "不交付核心码" })])
    expect(txt).toContain("[红]")
    expect(txt).toContain("源代码交付")
    expect(txt).toContain("不交付核心码")
  })
})
