import { describe, expect, it } from "vitest"
import {
  bidIssuesFromFindings,
  buildVerdict,
  deckIssuesFromLint,
  moduleLabel,
  quoteIssuesFromRecord,
  solutionIssuesFromReport,
  type DeliverIssue,
} from "./deliverability"

const sev = (issues: DeliverIssue[], c: string) => issues.find((x) => x.criterion === c)?.severity

describe("solutionIssuesFromReport", () => {
  it("占位/失败/空章映射为阻断，偏短与跨章重复映射为提醒", () => {
    const issues = solutionIssuesFromReport({
      hits: [
        { rule: "meta_leftover" },
        { rule: "placeholder_leftover" },
        { rule: "failed_chapter" },
        { rule: "empty_chapter" },
        { rule: "underlength_chapter" },
        { rule: "intra_dup" },
      ],
    })
    expect(sev(issues, "placeholder_leftover")).toBe("blocker")
    expect(sev(issues, "incomplete_artifact")).toBe("blocker") // failed/empty 阻断压过 underlength 的 warn
    expect(sev(issues, "verbatim_fidelity")).toBe("warn") // 仅 intra_dup
  })

  it("承诺不够归入实质性条款判据且为阻断", () => {
    const issues = solutionIssuesFromReport({ hits: [{ rule: "deviation_undercommit" }] })
    expect(sev(issues, "star_unanswered")).toBe("blocker")
  })

  it("与可发送无关的禁则不纳入", () => {
    expect(solutionIssuesFromReport({ hits: [{ rule: "no_hyperlink" }, { rule: "wording_scan" }] })).toEqual([])
  })

  it("数值口径类命中聚合为逐字一致判据（阻断）", () => {
    const issues = solutionIssuesFromReport({
      hits: [{ rule: "over_price_ceiling" }, { rule: "amount_case_mismatch" }],
    })
    const it0 = issues.find((x) => x.criterion === "verbatim_fidelity")
    expect(it0?.severity).toBe("blocker")
    expect(it0?.count).toBe(2)
  })
})

describe("bidIssuesFromFindings", () => {
  it("并入 ★漏答数到实质性条款判据并计阻断", () => {
    const issues = bidIssuesFromFindings([{ rule: "number_conflict" }], { starUnansweredCount: 3 })
    const star = issues.find((x) => x.criterion === "star_unanswered")
    expect(star?.severity).toBe("blocker")
    expect(star?.count).toBe(3)
    expect(sev(issues, "verbatim_fidelity")).toBe("blocker")
  })

  it("已有 deviation_undercommit 命中时与漏答数累加", () => {
    const issues = bidIssuesFromFindings([{ rule: "deviation_undercommit" }], { starUnansweredCount: 2 })
    const star = issues.find((x) => x.criterion === "star_unanswered")
    expect(star?.count).toBe(3)
  })

  it("编造嫌疑作为提醒条目并入", () => {
    const issues = bidIssuesFromFindings([], { fabricationSuspectCount: 5 })
    const fab = issues.find((x) => x.criterion === "fabrication_suspect")
    expect(fab?.severity).toBe("warn")
    expect(fab?.count).toBe(5)
  })
})

describe("deckIssuesFromLint", () => {
  it("占位残留与空页为阻断、图表长度不符为提醒、纯排版项忽略", () => {
    const issues = deckIssuesFromLint([
      { code: "placeholder_leftover" },
      { code: "empty_page" },
      { code: "chart_len_mismatch" },
      { code: "too_many_bullets" },
      { code: "duplicate_title" },
      { code: "noun_title" },
    ])
    expect(sev(issues, "placeholder_leftover")).toBe("blocker")
    expect(sev(issues, "incomplete_artifact")).toBe("blocker")
    expect(sev(issues, "verbatim_fidelity")).toBe("warn")
    expect(issues.find((x) => x.detail && /too_many|duplicate/.test(x.detail))).toBeUndefined()
  })
})

describe("quoteIssuesFromRecord", () => {
  it("合计为 0 或无明细 -> 交付不完整阻断", () => {
    const a = quoteIssuesFromRecord({ quote_name: "X", groups: [] }, 0)
    expect(sev(a, "incomplete_artifact")).toBe("blocker")
    const b = quoteIssuesFromRecord({ groups: [{ name: "g", items: [{ item_name: "HIS", qty: 1, price: 0 }] }] }, 0)
    expect(sev(b, "incomplete_artifact")).toBe("blocker")
  })

  it("个别明细缺名称仅为提醒，不影响阻断判据缺失", () => {
    const issues = quoteIssuesFromRecord({ groups: [{ items: [{ item_name: "LIS" }, { item_name: "  " }] }] }, 1000)
    const inc = issues.find((x) => x.criterion === "incomplete_artifact")
    expect(inc?.severity).toBe("warn")
    expect(inc?.count).toBe(1)
  })

  it("报价名/明细名残留模板占位 -> 占位残留阻断（复用 findPlaceholderLeftovers）", () => {
    const issues = quoteIssuesFromRecord(
      { quote_name: "XX医院报价", groups: [{ items: [{ item_name: "待补充" }] }] },
      500,
    )
    expect(sev(issues, "placeholder_leftover")).toBe("blocker")
  })

  it("干净报价不产出任何条目", () => {
    const issues = quoteIssuesFromRecord({ quote_name: "人民医院信息化报价", groups: [{ items: [{ item_name: "HIS 授权", qty: 1, price: 800000 }] }] }, 800000)
    expect(issues).toEqual([])
  })

  it("R40（B8）：折扣写成「几折」的行出提醒不出阻断（维持只报不拦）", () => {
    const issues = quoteIssuesFromRecord(
      { quote_name: "人民医院报价", groups: [{ items: [{ item_name: "HIS 授权", qty: 1, price: 990000, discount: 0.9 }] }] },
      891,
    )
    const v = issues.find((x) => x.criterion === "verbatim_fidelity")
    expect(v?.severity).toBe("warn")
    expect(v?.count).toBe(1)
    expect(v?.detail).toContain("疑似按「几折」")
    expect(buildVerdict("quote", issues).sendable).toBe(true)
  })

  it("R40（B8）：正常折扣与缺省 discount 不新增任何条目", () => {
    const issues = quoteIssuesFromRecord(
      {
        quote_name: "人民医院报价",
        groups: [{ items: [{ item_name: "HIS 授权", qty: 1, price: 800000, discount: 90 }, { item_name: "LIS", qty: 1, price: 100000 }] }],
      },
      820000,
    )
    expect(issues).toEqual([])
  })
})

describe("buildVerdict", () => {
  it("存在阻断项则 sendable=false 且摘要建议暂缓", () => {
    const v = buildVerdict("quote", [{ criterion: "incomplete_artifact", severity: "blocker", title: moduleLabel("quote"), count: 1 }])
    expect(v.sendable).toBe(false)
    expect(v.summary).toContain("建议暂缓发送")
    expect(v.blockers).toHaveLength(1)
  })

  it("仅提醒项则 sendable=true", () => {
    const v = buildVerdict("solution", [{ criterion: "incomplete_artifact", severity: "warn", title: "偏短", count: 2 }])
    expect(v.sendable).toBe(true)
    expect(v.summary).toContain("可发送")
  })

  it("编造嫌疑即使被误传为 blocker 也强制降为 warn、绝不阻断（只报不拦裁定代码级锁）", () => {
    const v = buildVerdict("bid", [{ criterion: "fabrication_suspect", severity: "blocker", title: "编造", count: 1 }])
    expect(v.blockers).toHaveLength(0)
    expect(v.warnings).toHaveLength(1)
    expect(v.warnings[0].severity).toBe("warn")
    expect(v.sendable).toBe(true)
  })

  it("无任何条目摘要标注未发现阻断项", () => {
    const v = buildVerdict("deck", [])
    expect(v.sendable).toBe(true)
    expect(v.summary).toContain("未发现阻断项")
  })
})
