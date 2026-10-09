// 资质台账纯函数单测（分档口径是「废标风险预警」的地基，必须锁死）
import { describe, expect, it } from "vitest"
import { qualBucket, summarizeQuals, qualDueLabel, parseDay, qualRiskView } from "./qualsCore"

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
