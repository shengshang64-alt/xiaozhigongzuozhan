// 资质台账纯函数单测（分档口径是「废标风险预警」的地基，必须锁死）
import { describe, expect, it } from "vitest"
import { isAutoDerivedValidity, qualBucket, summarizeQuals, qualDueLabel, parseDay, qualRiskView } from "./qualsCore"

// 固定时钟：2026-09-28
const TODAY = new Date("2026-09-28T00:00:00").getTime()

describe("qualBucket · 到期三档分档", () => {
  it("已过期（valid_to 早于今天）", () => {
    expect(qualBucket("2026-09-27", TODAY)).toBe("expired")
    expect(qualBucket("2024-01-01", TODAY)).toBe("expired")
  })
  it("critical：0-30 天（含今天到期）", () => {
    expect(qualBucket("2026-09-28", TODAY)).toBe("critical") // 今天
    expect(qualBucket("2026-10-28", TODAY)).toBe("critical") // 30 天
  })
  it("warning：31-90 天", () => {
    expect(qualBucket("2026-10-29", TODAY)).toBe("warning") // 31 天
    expect(qualBucket("2026-12-27", TODAY)).toBe("warning") // 90 天
  })
  it("ok：>90 天", () => {
    expect(qualBucket("2026-12-28", TODAY)).toBe("ok")
    expect(qualBucket("2027-10-20", TODAY)).toBe("ok") // CMMI5 实例
  })
  it("未登记有效期 → unknown（不瞎猜）", () => {
    expect(qualBucket("", TODAY)).toBe("unknown")
    expect(qualBucket("2026/10/01", TODAY)).toBe("unknown") // 非标准格式
    expect(qualBucket(null, TODAY)).toBe("unknown")
  })
})

describe("summarizeQuals · 汇总与预警排序", () => {
  it("分档计数正确，预警按 过期→剩余天数 升序", () => {
    const rows = [
      { id: "1", cert_name: "A", category: "硬资质", valid_to: "2026-12-28" }, // ok
      { id: "2", cert_name: "B", category: "体系认证", valid_to: "2026-11-12" }, // warning 45天
      { id: "3", cert_name: "C", category: "硬资质", valid_to: "2026-09-20" }, // expired
      { id: "4", cert_name: "D", category: "人员证书", valid_to: "" }, // unknown
      { id: "5", cert_name: "E", category: "体系认证", valid_to: "2026-10-20" }, // critical 22天
    ]
    const s = summarizeQuals(rows, TODAY)
    expect(s.total).toBe(5)
    expect(s.buckets).toEqual({ expired: 1, critical: 1, warning: 1, ok: 1, unknown: 1 })
    expect(s.alerts.map((a) => a.id)).toEqual(["3", "5", "2"]) // 过期→critical→warning
    expect(s.alerts[1].days_left).toBe(22)
  })
})

describe("qualDueLabel · 人类可读到期描述", () => {
  it("过期/当天/临界/远期四态", () => {
    expect(qualDueLabel("2026-09-20", TODAY)).toBe("已过期 8 天")
    expect(qualDueLabel("2026-09-28", TODAY)).toBe("今天到期")
    expect(qualDueLabel("2026-10-28", TODAY)).toBe("剩 30 天")
    expect(qualDueLabel("2027-10-20", TODAY)).toBe("剩 13 个月")
  })
  it("未登记", () => {
    expect(qualDueLabel("", TODAY)).toBe("未登记有效期")
  })
})

describe("parseDay · 日期解析", () => {
  it("标准格式可解析，其余 NaN", () => {
    expect(Number.isNaN(parseDay("2026-09-28"))).toBe(false)
    expect(Number.isNaN(parseDay("2026-9-28"))).toBe(true)
    expect(Number.isNaN(parseDay("abc"))).toBe(true)
  })
})

describe("qualRiskView · 驾驶舱/台账/导出统一风险口径（O-006）", () => {
  it("urgent=已过期+30天内，watch=90天内，total=urgent+watch", () => {
    const v = qualRiskView({ expired: 1, critical: 0, warning: 3 })
    expect(v.urgent).toBe(1)
    expect(v.watch).toBe(3)
    expect(v.total).toBe(4)
  })
  it("line 逐档明细与台账分档标签逐字一致，仅列非零档", () => {
    expect(qualRiskView({ expired: 1, critical: 0, warning: 3 }).line).toBe("已过期 1 · 90 天内到期 3")
    expect(qualRiskView({ expired: 2, critical: 4, warning: 0 }).line).toBe("已过期 2 · 30 天内到期 4")
  })
  it("空/缺失分档 → 全 0 空串，不报错（拉取失败或未建台账时静默）", () => {
    expect(qualRiskView(null)).toEqual({ urgent: 0, watch: 0, total: 0, line: "" })
    expect(qualRiskView({}).total).toBe(0)
    expect(qualRiskView({ expired: 0, critical: 0, warning: 0 }).line).toBe("")
  })
})

describe("R228 不变量自检：三档之和 == alerts.length == qualRiskView.total", () => {
  // r2-r010 核心需求：驾驶舱和台账两处数字差值=0，由以下不变量保证
  //   不变量 A：summarizeQuals.buckets.expired + critical + warning == alerts.length
  //   不变量 B：qualRiskView(任意 buckets).total == expired + critical + warning

  it("不变量 A：三档之和 == alerts.length（含全量与边界数据）", () => {
    const cases: [Array<{ id: string; cert_name: string; category: string; valid_to: string }>, string][] = [
      // [rows, description]
      [[], "空列表"],
      [[{ id: "1", cert_name: "A", category: "", valid_to: "2026-09-20" }], "全部 expired"],
      [[
        { id: "1", cert_name: "A", category: "", valid_to: "2026-09-20" }, // expired
        { id: "2", cert_name: "B", category: "", valid_to: "2026-10-10" }, // critical ≤30
        { id: "3", cert_name: "C", category: "", valid_to: "2026-11-15" }, // warning ≤90
      ], "各档一个"],
      [[
        { id: "1", cert_name: "A", category: "", valid_to: "2026-09-20" }, // expired
        { id: "2", cert_name: "B", category: "", valid_to: "2026-10-28" }, // critical=30天边界
        { id: "3", cert_name: "C", category: "", valid_to: "2026-10-29" }, // warning=31天
        { id: "4", cert_name: "D", category: "", valid_to: "2026-12-27" }, // warning=90天边界
        { id: "5", cert_name: "E", category: "", valid_to: "2026-12-28" }, // ok
        { id: "6", cert_name: "F", category: "", valid_to: "" },            // unknown
      ], "含 ok 和 unknown（不进 alerts）"],
    ]
    for (const [rows, desc] of cases) {
      const s = summarizeQuals(rows, TODAY)
      const sum = s.buckets.expired + s.buckets.critical + s.buckets.warning
      expect(sum, `A fail: ${desc}`).toBe(s.alerts.length)
    }
  })

  it("不变量 B：qualRiskView.total == expired + critical + warning（任意分档输入）", () => {
    const inputs = [
      { expired: 0, critical: 0, warning: 0 },
      { expired: 1, critical: 0, warning: 0 },
      { expired: 0, critical: 2, warning: 3 },
      { expired: 5, critical: 10, warning: 20 },
      { expired: NaN as unknown as number, critical: 1, warning: 2 },  // NaN 会被 num() 归 0
    ]
    for (const buckets of inputs) {
      const v = qualRiskView(buckets)
      const expected = (Number(buckets.expired) || 0) + (Number(buckets.critical) || 0) + (Number(buckets.warning) || 0)
      expect(v.total).toBe(expected)
    }
  })

  it("不变量 A+B 联合：从同一行数据出发，驾驶舱 total 与台账 alerts.length 完全相等", () => {
    const rows = [
      { id: "1", cert_name: "A", category: "硬资质", valid_to: "2026-09-20" },  // expired
      { id: "2", cert_name: "B", category: "体系认证", valid_to: "2026-10-20" }, // critical
      { id: "3", cert_name: "C", category: "其他", valid_to: "2026-12-01" },   // warning
      { id: "4", cert_name: "D", category: "人员证书", valid_to: "2027-10-20" }, // ok
    ]
    const summary = summarizeQuals(rows, TODAY)
    const riskView = qualRiskView(summary.buckets)
    // 两处数字差值=0（r2-r010 核心验收条件）
    expect(riskView.total).toBe(summary.alerts.length)
    expect(riskView.urgent).toBe(summary.buckets.expired + summary.buckets.critical)
    expect(riskView.watch).toBe(summary.buckets.warning)
  })
})
describe("isAutoDerivedValidity（P3-6）", () => {
  it("notes 含文件名解析/知识库来源等标记 → true", () => {
    expect(isAutoDerivedValidity("批量导入（来源：资质目录文件名解析）")).toBe(true)
    expect(isAutoDerivedValidity("真实有效期（来源：知识库证书文件名）")).toBe(true)
    expect(isAutoDerivedValidity("有效期来自源文件")).toBe(true)
  })
  it("人工登记的备注 → false；空备注 → false", () => {
    expect(isAutoDerivedValidity("原件已核对")).toBe(false)
    expect(isAutoDerivedValidity("")).toBe(false)
    expect(isAutoDerivedValidity(null)).toBe(false)
  })
})
