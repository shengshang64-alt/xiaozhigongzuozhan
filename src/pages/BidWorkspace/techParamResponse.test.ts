import { describe, expect, it } from "vitest"
import {
  buildParamResponseRows,
  checkParamResponseCoverage,
  locateTenderSection,
  resolveTechParamSource,
  summarizeParamResponse,
} from "./techParamResponse"
import type { ParseReport } from "./bidTypes"

/**
 * R53（2026-10-15 用户裁定）：技术参数响应表的素材层——
 * ① 来源不固定（采购需求/技术规格，偶尔附件），且使用者可以自己描述 → 先描述、再标题、最后解析分区兜底；
 * ② ★/▲ 重点条款先扫出来在表头汇总；
 * ③ 其余参数一一响应（原文响应 + 只调整要求类字眼，转换由 paramRewrite 负责）。
 */

const TENDER = [
  "第五章 采购需求",
  "5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓",
  "5.2 ▲ 要求提供三年免费质保与 7×24 小时运维响应",
  "5.3 【评审项】系统可用性不得低于 99.9%",
  "5.4 应提供不少于 3 场用户培训",
  "注：以“★”标示的为实质性条款，负偏离即废标。",
  "第六章 评标办法",
  "6.1 技术方案（20 分）：优（15-20 分）",
].join("\n")

describe("locateTenderSection：按标题定位，到下个同级/更高级标题为止", () => {
  it("第五章 采购需求 取到 第六章 之前，正文不含评标办法", () => {
    const hit = locateTenderSection(TENDER, "采购需求")
    expect(hit?.heading).toBe("第五章 采购需求")
    expect(hit?.body).toContain("5.1")
    expect(hit?.body).toContain("5.4")
    expect(hit?.body).not.toContain("6.1")
  })

  it("找不到就返回 null（绝不猜一段正文出来）", () => {
    expect(locateTenderSection(TENDER, "不存在的章节")).toBeNull()
  })
})

describe("resolveTechParamSource：描述 → 标题 → 解析分区，三层兜底且来源可见", () => {
  it("按使用者描述定位时标明是描述命中的", () => {
    const s = resolveTechParamSource(TENDER, null, "采购需求")
    expect(s.how).toBe("custom")
    expect(s.label).toContain("按你的描述定位")
    expect(s.text).toContain("5.1")
  })

  it("描述没命中时不静默：label 写清「你的描述没找到 + 实际用了哪一处」", () => {
    const s = resolveTechParamSource(TENDER, null, "附件三 技术规格书")
    expect(s.how).toBe("heading")
    expect(s.label).toContain("未在招标原文里找到「附件三 技术规格书」")
    expect(s.label).toContain("第五章 采购需求")
  })

  it("招标原文里没有参数章节时回退解析报告分区，并说明是回退", () => {
    const report = {
      scope: "full",
      sections: [{ key: "delivery_req", title: "交货和服务要求", content: "系统须支持国产化数据库，兼容主流国产操作系统" }],
    } as ParseReport
    const s = resolveTechParamSource("第一章 招标公告\n本项目采用公开招标方式。", report)
    expect(s.how).toBe("parse")
    expect(s.label).toContain("已回退解析报告分区")
    expect(s.text).toContain("国产化数据库")
  })

  it("哪儿都没有时 how=none（面板据此提示先补解析或补描述）", () => {
    const s = resolveTechParamSource("", null)
    expect(s.how).toBe("none")
    expect(s.text).toBe("")
  })
})

describe("buildParamResponseRows：逐条建行 + 字眼转换，行序保持招标原文顺序", () => {
  const rows = buildParamResponseRows(resolveTechParamSource(TENDER, null, "采购需求").text)

  it("只建参数行：标记说明行（注：以★标示…）不建行", () => {
    expect(rows.map((r) => r.no)).toEqual(["5.1", "5.2", "5.3", "5.4"])
    expect(rows.some((r) => r.original.includes("负偏离即废标"))).toBe(false)
  })

  it("招标要求列是原文逐字（含 ★/▲ 标记），响应列只调整要求类字眼", () => {
    expect(rows[0].original).toBe("5.1 ★ 系统须支持国产化数据库，兼容达梦、人大金仓")
    expect(rows[0].response).toBe("5.1 ★ 系统支持国产化数据库，兼容达梦、人大金仓")
    expect(rows[1].response).toBe("5.2 ▲ 提供三年免费质保与 7×24 小时运维响应")
    expect(rows[3].response).toBe("5.4 提供不少于 3 场用户培训")
  })

  it("量化边界（不得低于 99.9%）原样保留，且不误报为需人工确认", () => {
    expect(rows[2].response).toBe("5.3 【评审项】系统可用性不得低于 99.9%")
    expect(rows[2].needs_review).toBe(false)
  })

  it("权重分类沿用既有口径：【评审项】/★▲/一般项", () => {
    expect(rows.map((r) => r.kind)).toEqual(["star", "star", "review", "general"])
  })
})

describe("summarizeParamResponse：★/▲ 先扫出来做表头汇总", () => {
  const rows = buildParamResponseRows(resolveTechParamSource(TENDER, null, "采购需求").text)
  const sum = summarizeParamResponse(rows)

  it("计数分类正确", () => {
    expect(sum.total).toBe(4)
    expect(sum.star).toBe(2)
    expect(sum.review).toBe(1)
    expect(sum.general).toBe(1)
  })

  it("表头汇总列出的重点条款带原编号、按原文顺序、逐字（便于按招标文件响应）", () => {
    expect(sum.starClauses.map((c) => c.no)).toEqual(["5.1", "5.2", "5.3"])
    expect(sum.starClauses[0].text).toContain("★")
  })

  it("改写条数与需人工确认条数分开报（禁止类/许可类不混进改写数）", () => {
    expect(sum.rewritten).toBe(3)
    expect(sum.needs_review).toBe(0)
  })
})

describe("checkParamResponseCoverage：抽到的条款 ↔ 参数表行，缺的要点名", () => {
  const rows = buildParamResponseRows(resolveTechParamSource(TENDER, null, "采购需求").text)

  it("条款都能对上时不点名", () => {
    const cov = checkParamResponseCoverage(["系统须支持国产化数据库", "应提供不少于 3 场用户培训"], rows)
    expect(cov.missing).toEqual([])
    expect(cov.clause_count).toBe(2)
    expect(cov.row_count).toBe(4)
  })

  it("抽到但表里没有的条款被点名（行数应等于条款数）", () => {
    const cov = checkParamResponseCoverage(["系统须支持国产化数据库", "须提供移动护理终端 30 台"], rows)
    expect(cov.missing).toEqual(["须提供移动护理终端 30 台"])
  })
})
