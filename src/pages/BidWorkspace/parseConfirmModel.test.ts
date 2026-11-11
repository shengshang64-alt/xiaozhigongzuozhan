import { describe, expect, it } from "vitest"
import {
  bidNodePairs,
  buildParseConfirmModel,
  citationOf,
  qualityStatsOf,
  scoreSplitOf,
} from "./parseConfirmModel"
import type { ParseReport, ParseSection } from "./bidTypes"

// UX-v2 ② 解析确认：本屏所有数字都是解析报告 / 招标原文的本地派生。
// 这组测试锁定三件事：
//   ① 没有真值时必须「—」而不是 0（0 会被读成「系统查过，确实没有」）；
//   ② 三根评分柱互斥（价格分从商务合计里剔除，不能一根柱子数两遍）；
//   ③ 出处只认可定位信息，不能把「按无效投标处理」当成页码。

const sec = (key: string, content: string, extra: Partial<ParseSection> = {}): ParseSection => ({
  key,
  title: key,
  content,
  status: "ok",
  snippet: "",
  ...extra,
})

const report = (sections: ParseSection[]): ParseReport => ({ scope: "key", sections })

describe("citationOf · 只认可定位出处", () => {
  it("「（第 12 条）」是出处", () => {
    expect(citationOf("投标人须提供有效期内证书（第 12 条）")).toBe("第 12 条")
  })

  it("「（投标无效）」不是出处——那是后果描述，不是定位信息", () => {
    expect(citationOf("未提供证书的（按无效投标处理）")).toBe("—")
  })

  it("没有括号出处时给「—」，不编页码", () => {
    expect(citationOf("投标文件须逐页加盖公章")).toBe("—")
  })
})

describe("scoreSplitOf · 技术 / 商务 / 价格三栏互斥", () => {
  const rep = report([
    sec("tech_score", ["技术方案（45 分）：完整详实得 40-45 分", "实施能力（10 分）：满足得 10 分"].join("\n")),
    sec("biz_score", ["价格分（30 分）：评标基准价/投标报价×30", "类似业绩（5 分）：每提供 1 个得 1 分"].join("\n")),
  ])

  it("价格分从商务合计剔除，三栏相加等于全部评分项", () => {
    const s = scoreSplitOf(rep)
    expect(s.itemCount).toBe(4)
    expect(s.techSum).toBe(55)
    expect(s.priceSum).toBe(30)
    // 商务只剩「类似业绩 5 分」——若把价格分也算进来会变成 35，同一分值数两遍
    expect(s.bizSum).toBe(5)
    expect(s.techSum + s.bizSum + (s.priceSum ?? 0)).toBe(90)
  })

  it("主观分按评分标准识别，并给出分值合计", () => {
    const s = scoreSplitOf(rep)
    expect(s.subjectiveCount).toBeGreaterThanOrEqual(1)
    expect(s.subjectiveScore).toBeGreaterThan(0)
  })

  it("没有评分办法时 hasScoring=false，三项合计为 0（不是凭空的 100）", () => {
    const s = scoreSplitOf(report([]))
    expect(s.hasScoring).toBe(false)
    expect(s.techSum + s.bizSum + (s.priceSum ?? 0)).toBe(0)
  })
})

describe("bidNodePairs · 结构化字段优先，老报告回退文本行", () => {
  it("structured.kind=fields 时取结构化字段", () => {
    const rep = report([
      sec("bid_nodes", "", {
        structured: { kind: "fields", fields: [{ label: "报名", value: "2026-11-12 17:00" }] },
      }),
    ])
    expect(bidNodePairs(rep)).toEqual([{ label: "报名", value: "2026-11-12 17:00" }])
  })

  it("老报告没有 structured 时按「节点：时间」行解析", () => {
    const rep = report([sec("bid_nodes", ["报名：2026-11-12 17:00", "开标：2026-12-02 09:30"].join("\n"))])
    expect(bidNodePairs(rep)).toHaveLength(2)
    expect(bidNodePairs(rep)[1]).toEqual({ label: "开标", value: "2026-12-02 09:30" })
  })
})

describe("qualityStatsOf · 拿不到的真值写「未接入 / —」", () => {
  it("页码可回溯现网无落库字段，如实写未接入", () => {
    const stats = qualityStatsOf({ report: report([]), tenderText: "招标原文".repeat(100) })
    const page = stats.find((s) => s.id === "pagetrace")
    expect(page?.value).toBe("未接入")
    expect(page?.tone).toBe("muted")
  })

  it("没有招标原文时覆盖率与疑似漏抽都是「—」，不是 0%", () => {
    const stats = qualityStatsOf({ report: report([sec("tech_score", "技术方案（10 分）：齐全")]), tenderText: "" })
    expect(stats.find((s) => s.id === "coverage")?.value).toBe("—")
    expect(stats.find((s) => s.id === "missing")?.value).toBe("—")
  })

  it("没有还原表格时表格识别是「—」并说明原因", () => {
    const stats = qualityStatsOf({ report: report([]), tenderText: "原文", tenderTables: null })
    const tables = stats.find((s) => s.id === "tables")
    expect(tables?.value).toBe("—")
    expect(tables?.note).toContain("没有可还原表格")
  })
})

describe("buildParseConfirmModel · 四卡与逐条确认", () => {
  const rep = report([
    sec("void_items", ["未按格式密封的，按无效投标处理（第 20 条）", "投标报价超过预算的（第 21 条）"].join("\n")),
    sec("qualification", ["[强制] 须提供营业执照（第 3 条）"].join("\n")),
    sec("compliance", ["★ 条款任一负偏离即无效投标（第 34 条）"].join("\n")),
    sec("star_clauses", ["★1", "系统可用性不低于 99.9%"].join("\n")),
    sec("bid_nodes", ["报名：2026-11-12", "开标：2026-12-02"].join("\n")),
    sec("tech_score", "技术方案（45 分）：完整得 40-45 分"),
    sec("biz_score", "价格分（30 分）：评标基准价/投标报价×30"),
  ])
  const tenderText = ["★ 系统可用性不低于 99.9%", "▲ 支持多院区部署"].join("\n")

  it("四张卡的主数字都来自真实派生，且废标卡 = 废标 + 资格 + 符合性 + ★▲", () => {
    const m = buildParseConfirmModel({ report: rep, tenderText, progress: {} })
    const voidCard = m.cards.find((c) => c.id === "void")
    expect(voidCard?.value).toBe(m.totalRows)
    expect(m.totalRows).toBe(5) // 2 废标 + 1 资格 + 1 符合性 + 1 ★
    expect(m.cards.find((c) => c.id === "score")?.value).toBe(2)
    expect(m.cards.find((c) => c.id === "param")?.value).toBe(2) // ★ + ▲ 两条参数行
    expect(m.cards.find((c) => c.id === "node")?.value).toBe(2)
  })

  it("没有任何可确认条款时主数字为 null（UI 渲染「—」），不是 0", () => {
    const m = buildParseConfirmModel({ report: report([]), tenderText: "", progress: {} })
    expect(m.cards.every((c) => c.value === null)).toBe(true)
    expect(m.totalRows).toBe(0)
  })

  it("已确认 / 未确认按覆盖进度算，未确认排在前", () => {
    const m0 = buildParseConfirmModel({ report: rep, tenderText, progress: {} })
    expect(m0.pendingCount).toBe(m0.totalRows)
    expect(m0.confirmedCount).toBe(0)

    const first = m0.rows[0].id
    const m1 = buildParseConfirmModel({
      report: rep,
      tenderText,
      progress: { [first]: { status: "covered", ref: "", note: "资质响应" } },
    })
    expect(m1.confirmedCount).toBe(1)
    expect(m1.pendingCount).toBe(m1.totalRows - 1)
    // 已确认的那条被排到末尾
    expect(m1.rows[m1.rows.length - 1].id).toBe(first)
  })

  it("「不适用」也算已确认（与矩阵口径一致）", () => {
    const m0 = buildParseConfirmModel({ report: rep, tenderText, progress: {} })
    const target = m0.rows[0].id
    const m1 = buildParseConfirmModel({
      report: rep,
      tenderText,
      progress: { [target]: { status: "na", ref: "", note: "" } },
    })
    expect(m1.confirmedCount).toBe(1)
  })

  it("解析目录按类计数，条目都能指回解析分区", () => {
    const m = buildParseConfirmModel({ report: rep, tenderText, progress: {} })
    const dir = Object.fromEntries(m.directory.map((d) => [d.id, d]))
    expect(dir.void.count).toBe(2)
    expect(dir.qual.count).toBe(1)
    expect(dir.comp.count).toBe(1)
    expect(dir.star.count).toBe(1)
    expect(dir.void.focusKey).toBe("void_items")
    expect(dir.contract.focusKey).toBe("contract_terms")
  })
})
