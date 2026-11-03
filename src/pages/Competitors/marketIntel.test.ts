// marketIntel 数据集与派生纯函数的回归测试：口径数量、归一化边界、结论生成、CSV 导出。
import { describe, expect, it } from "vitest"
import {
  VENDOR_ORDERS,
  SELF_NAME,
  coreVendors,
  extendedVendors,
  orderRankOf,
  orderScores,
  vendorByName,
  defaultBenchmarkPicks,
  buildOrderTakeaways,
  buildOrderCompareCsv,
  ORDER_DIMS,
  fmtYi,
} from "./marketIntel"

describe("marketIntel · 数据集完整性", () => {
  it("23 家厂商、15 家核心订单口径、8 家扩展参考层", () => {
    expect(VENDOR_ORDERS).toHaveLength(23)
    expect(coreVendors()).toHaveLength(15)
    expect(extendedVendors()).toHaveLength(8)
  })
  it("核心层按五年中标金额降序，卫宁第一、智业第十五", () => {
    const core = coreVendors()
    expect(core[0].name).toBe("卫宁健康")
    expect(orderRankOf(SELF_NAME)).toBe(15)
    expect(orderRankOf("不存在的厂商")).toBe(0)
  })
  it("名称唯一且 PROFILE 键都在数据集内", () => {
    const names = new Set(VENDOR_ORDERS.map((v) => v.name))
    expect(names.size).toBe(VENDOR_ORDERS.length)
  })
})

describe("marketIntel · 订单能力六维归一化", () => {
  it("满分锚：卫宁五年规模=5，各维不超过 5", () => {
    const winning = vendorByName("卫宁健康")!
    const scores = orderScores(winning)
    expect(scores[0]).toBe(5)
    expect(scores).toHaveLength(ORDER_DIMS.length)
    for (const s of scores) expect(s).toBeLessThanOrEqual(5)
  })
  it("我方中段交付（37% 封顶 40 内）得 4.63 分", () => {
    const self = vendorByName(SELF_NAME)!
    expect(orderScores(self)[4]).toBeCloseTo((37 / 40) * 5, 2)
  })
  it("无订单厂商以软著做 2 分封顶参考位，其余维度为 0", () => {
    const scores = orderScores(vendorByName("久远银海")!)
    expect(scores[1]).toBeCloseTo((1316 / 2860) * 2, 2)
    expect(scores[0]).toBe(0)
    expect(scores[5]).toBe(0)
  })
})

describe("marketIntel · 对标默认集与对比重点", () => {
  it("默认对标=我方+金额前三", () => {
    expect(defaultBenchmarkPicks()).toEqual([SELF_NAME, "卫宁健康", "东软集团", "东华医为"])
  })
  it("我方入选时产出机会/差距/防三条，差距倍数按真实数据算", () => {
    const picks = defaultBenchmarkPicks().map((n) => vendorByName(n)!)
    const out = buildOrderTakeaways(picks)
    expect(out.map((t) => t.kind)).toEqual(["opportunity", "gap", "defense"])
    expect(out[1].text).toContain("第 15")
    expect(out[1].text).toContain("约 26 倍")
  })
  it("未勾选我方时不产出结论（不臆造）", () => {
    const picks = ["卫宁健康", "东软集团"].map((n) => vendorByName(n)!)
    expect(buildOrderTakeaways(picks)).toEqual([])
  })
})

describe("marketIntel · CSV 导出与金额格式化", () => {
  it("CSV 带 BOM、表头含对标对象、行数=六维", () => {
    const csv = buildOrderCompareCsv([{ name: "智业软件", scores: [1, 2, 3, 4, 5, 0.5] }])
    expect(csv.startsWith("\uFEFF")).toBe(true)
    const lines = csv.trim().split("\r\n")
    expect(lines[0]).toBe("订单能力维度,智业软件")
    expect(lines).toHaveLength(1 + ORDER_DIMS.length)
    expect(lines[1]).toContain("1")
  })
  it("厂商名含逗号时按 CSV 转义加引号，不窜列", () => {
    const csv = buildOrderCompareCsv([{ name: "智业,软件", scores: [1, 2, 3, 4, 5, 0.5] }])
    const lines = csv.trim().split("\r\n")
    expect(lines[0]).toBe('订单能力维度,"智业,软件"')
  })
  it("fmtYi 万元转亿，null 显示破折号", () => {
    expect(fmtYi(587710)).toBe("58.77 亿")
    expect(fmtYi(587710, 1)).toBe("58.8 亿")
    expect(fmtYi(null)).toBe("—")
  })
})
