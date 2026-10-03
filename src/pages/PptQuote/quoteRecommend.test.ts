import { describe, expect, it } from "vitest"
import {
  bedsRatio,
  buildRange,
  jaccard,
  levelSimilarity,
  median,
  parseLevel,
  recommendFromHistory,
} from "./quoteRecommend"
import type { QuoteRecord } from "./pptQuoteTypes"

const item = (product_name: string, price: number) => ({
  id: "i-" + product_name + price,
  item_name: product_name,
  product_name,
  price,
  qty: 1,
  discount: 100,
  unit: "套",
  spec: "",
  category: product_name,
  source: "external" as const,
  remark: "",
  rating_hits: [],
})

const mkRec = (over: Partial<QuoteRecord>): QuoteRecord =>
  ({
    id: "r",
    quote_name: "报价",
    hospital_level: "",
    beds_total: 0,
    won_sample: true,
    groups: [],
    ...over,
  }) as unknown as QuoteRecord

describe("parseLevel", () => {
  it("识别全称与简称", () => {
    expect(parseLevel("三级甲等")).toEqual({ tier: 3, grade: "甲" })
    expect(parseLevel("三甲")).toEqual({ tier: 3, grade: "甲" })
    expect(parseLevel("二级乙等")).toEqual({ tier: 2, grade: "乙" })
    expect(parseLevel("三乙")).toEqual({ tier: 3, grade: "乙" })
  })
  it("无法识别 → tier 0", () => {
    expect(parseLevel("未定级")).toEqual({ tier: 0, grade: "" })
    expect(parseLevel("")).toEqual({ tier: 0, grade: "" })
    expect(parseLevel(null)).toEqual({ tier: 0, grade: "" })
  })
})

describe("levelSimilarity", () => {
  it("同级同甲乙=same，仅同级=near，跨级/缺级=diff", () => {
    expect(levelSimilarity("三甲", "三级甲等")).toBe("same")
    expect(levelSimilarity("三甲", "三乙")).toBe("near")
    expect(levelSimilarity("三甲", "二甲")).toBe("diff")
    expect(levelSimilarity("", "三甲")).toBe("diff")
  })
})

describe("bedsRatio / jaccard / median / buildRange", () => {
  it("床位比取 min/max，缺数据记 0", () => {
    expect(bedsRatio(1000, 800)).toBeCloseTo(0.8, 5)
    expect(bedsRatio(0, 500)).toBe(0)
    expect(bedsRatio(500, 0)).toBe(0)
  })
  it("Jaccard 交并比，空集为 0", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1)
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0)
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0)
  })
  it("中位数奇偶", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBe(0)
  })
  it("buildRange 过滤 <=0，空返回 null", () => {
    expect(buildRange([0, -5, 10, 20])).toEqual({ count: 2, low: 10, median: 15, high: 20 })
    expect(buildRange([0, -1])).toBeNull()
  })
})

describe("recommendFromHistory", () => {
  const cur = { hospital_level: "三级甲等", beds_total: 1000, modules: ["软件", "硬件"] }
  const A = mkRec({
    id: "A",
    quote_name: "甲医院项目",
    hospital_level: "三甲",
    beds_total: 800,
    groups: [
      { id: "g1", name: "软件", items: [item("HIS", 500000)] },
      { id: "g2", name: "硬件", items: [item("服务器", 300000)] },
    ],
  })
  const B = mkRec({
    id: "B",
    quote_name: "乙医院项目",
    hospital_level: "二甲",
    beds_total: 200,
    groups: [{ id: "g1", name: "软件", items: [item("HIS", 100000)] }],
  })
  const NOT_WON = mkRec({ id: "C", won_sample: false, groups: [{ id: "g1", name: "软件", items: [item("HIS", 999999)] }] })
  const EMPTY = mkRec({ id: "D", groups: [] })

  it("空样本池 → available=false", () => {
    const r = recommendFromHistory(cur, [])
    expect(r.available).toBe(false)
    expect(r.matches).toEqual([])
  })

  it("筛样本：排除非成交/零总价/当前单；按分排序命中相似项", () => {
    const r = recommendFromHistory(cur, [A, B, NOT_WON, EMPTY, mkRec({ id: "SELF", groups: [{ id: "g", name: "软件", items: [item("x", 1)] }] })], "SELF")
    expect(r.available).toBe(true)
    // A 高分（同三甲+床位近+模块全重合）达阈值；B 分低（跨级）未达 1.5
    expect(r.matches.map((m) => m.id)).toEqual(["A"])
    expect(r.matches[0].level).toBe("same")
    expect(r.total_range).not.toBeNull()
    expect(r.total_range!.low).toBe(800000)
    expect(r.total_range!.high).toBe(800000)
    expect(r.note).toContain("相似项目较少")
  })

  it("无达标相似项 → 降级为全部成交总价分布", () => {
    const noDims = { hospital_level: "", beds_total: 0, modules: [] }
    const r = recommendFromHistory(noDims, [A, B])
    expect(r.matches).toHaveLength(0)
    expect(r.available).toBe(true)
    expect(r.note).toContain("未找到足够相似")
    expect(r.total_range).toEqual({ count: 2, low: 100000, median: 450000, high: 800000 })
  })

  it("逐模块单价区间：仅保留出现>=2次的模块", () => {
    const r = recommendFromHistory(cur, [A, B])
    const his = r.module_ranges.find((m) => m.name === "HIS")
    expect(his).toBeTruthy()
    expect(his!.count).toBe(2)
    expect(his!.low).toBe(100000)
    expect(his!.high).toBe(500000)
    // 服务器只在 A 出现 1 次 → 不进区间
    expect(r.module_ranges.find((m) => m.name === "服务器")).toBeUndefined()
  })

  it("传 items：当前报价涉及模块优先置顶并标记 in_current", () => {
    const curItems = { hospital_level: "三级甲等", beds_total: 1000, modules: ["软件", "硬件"], items: ["服务器", "HIS"] }
    const D = mkRec({
      id: "D",
      quote_name: "丁医院",
      hospital_level: "三甲",
      beds_total: 900,
      groups: [{ id: "g1", name: "硬件", items: [item("服务器", 300000), item("HIS", 480000), item("办公桌椅", 5000)] }],
    })
    const E = mkRec({
      id: "E",
      quote_name: "戊医院",
      hospital_level: "三甲",
      beds_total: 950,
      groups: [{ id: "g1", name: "硬件", items: [item("服务器", 320000), item("办公桌椅", 6000)] }],
    })
    const r = recommendFromHistory(curItems, [A, D, E])
    // 服务器(3)、HIS(2) 均在当前 items 内 → 排到无关的 办公桌椅 之前
    const names = r.module_ranges.map((m) => m.name)
    expect(names.slice(0, 2)).toEqual(["服务器", "HIS"])
    expect(r.module_ranges[0].in_current).toBe(true)
    expect(r.module_ranges.find((m) => m.name === "办公桌椅")!.in_current).toBe(false)
    expect(r.note).toContain("已优先展示当前报价涉及模块")
  })

  it("不传 items：in_current 全为 false 且不追加相关度提示（向后兼容）", () => {
    const r = recommendFromHistory(cur, [A, B])
    expect(r.module_ranges.every((m) => m.in_current === false)).toBe(true)
    expect(r.note).not.toContain("已优先展示")
  })
})
