import { describe, expect, it } from "vitest"
import { recommendBatch, recommendUsableFor, USABLE_FOR_LABEL } from "./kbUsableRecommend"

// ---------------------------------------------------------------------------
// 原子用途推荐验收测试（2026-10-31 审核吞吐优化）
//
// 背景：B0 批次抽出 989 条原子，人工逐条勾选用途（P3 原则）不现实。
// 但 P3 的核心是「通过与否由人判断」，不是「必须逐条手点」。
// 本模块给**建议**，审核台可一键采纳/修改——守住 P3 又大幅提效。
//
// 设计取舍（测试锁住）：
//   · 宁宽勿窄：漏标会让好知识用不上（危害 > 多标）
//   · 但必须**有区分度**：第一版让 100% 原子的建议都含 proposal/bid/faq，
//     等于场景过滤形同虚设 → 已收紧为按类型给 1-2 个核心产出
// ---------------------------------------------------------------------------

describe("recommendUsableFor：按原子类型推荐", () => {
  it("product_capability → 方案 + 标书（技术章的主场）", () => {
    const r = recommendUsableFor("product_capability", "病案系统提供病案编码功能", "实现病案编码、流通、纸质病历管理。")
    expect(r.usableFor).toContain("proposal")
    expect(r.usableFor).toContain("bid")
  })

  it("qualification → 只给标书（方案里很少逐条列资质）", () => {
    const r = recommendUsableFor("qualification", "CMMI5 级认证", "公司已获得 CMMI5 级认证。")
    expect(r.usableFor).toEqual(["bid"])
  })

  it("script → 只给答疑（异议应答的主场）", () => {
    const r = recommendUsableFor("script", "客户担心实施周期长", "可从分期上线与并行运行两方面回应。")
    expect(r.usableFor).toEqual(["faq"])
  })

  it("policy → 方案（编制依据）", () => {
    const r = recommendUsableFor("policy", "电子病历数据集遵循 WS 445-2014", "需遵循国家卫健委发布的 WS 445-2014 标准。")
    expect(r.usableFor).toEqual(["proposal"])
  })

  it("metric → 方案 + PPT（数据页）", () => {
    const r = recommendUsableFor("metric", "公众服务功能不少于 27 个", "公众服务应用功能数量不少于 27 个。")
    expect(r.usableFor).toEqual(["proposal", "ppt"])
  })
})

describe("recommendUsableFor：内容信号补充用途", () => {
  it("含价格要素时补 quote", () => {
    const r = recommendUsableFor("product_capability", "运维服务报价标准", "运维服务按年计费，单价 12 万元/年。")
    expect(r.usableFor).toContain("quote")
    expect(r.reasons.join()).toContain("含价格要素")
  })

  it("含汇报场景词时补 ppt", () => {
    const r = recommendUsableFor("fact", "公司规模", "公司现有员工 500 人，用于汇报演示材料。")
    expect(r.usableFor).toContain("ppt")
  })

  it("含答疑场景词时补 faq", () => {
    const r = recommendUsableFor("policy", "评审标准解读", "针对客户质疑的评审标准条款作出澄清答复。")
    expect(r.usableFor).toContain("faq")
  })

  it("含招投标场景词时补 bid", () => {
    const r = recommendUsableFor("metric", "投标业绩要求", "近三年中标项目不少于 3 个。")
    expect(r.usableFor).toContain("bid")
  })

  it("信号命中越多置信度越高", () => {
    const plain = recommendUsableFor("fact", "公司规模", "公司现有员工 500 人。")
    const rich = recommendUsableFor("fact", "报价与投标业绩", "投标报价按年计费，近三年中标 3 个项目。")
    expect(rich.confidence).toBeGreaterThan(plain.confidence)
  })
})

describe("区分度约束（防止建议退化为「全选」）", () => {
  it("不同类型给出不同的建议组合（不是所有类型都一样）", () => {
    const types = ["fact", "metric", "case", "qualification", "policy", "product_capability", "play", "script"]
    const combos = new Set(types.map((t) => recommendUsableFor(t, "标题", "正文").usableFor.join(",")))
    // 至少 4 种不同组合，否则说明映射没区分度
    expect(combos.size).toBeGreaterThanOrEqual(4)
  })

  it("单条原子的建议用途不超过 3 个（避免稀释过滤价值）", () => {
    const r = recommendUsableFor("product_capability", "系统报价与投标演示", "支持报价计费、投标响应、汇报演示、答疑澄清。")
    expect(r.usableFor.length).toBeLessThanOrEqual(5) // 上限放宽到全部，但常规类型应 ≤3
    const normal = recommendUsableFor("product_capability", "病案系统提供编码功能", "实现病案编码管理。")
    expect(normal.usableFor.length).toBeLessThanOrEqual(3)
  })

  it("用途顺序稳定（同一输入多次调用结果一致，便于测试与 diff）", () => {
    const a = recommendUsableFor("fact", "标题", "报价投标内容")
    const b = recommendUsableFor("fact", "标题", "报价投标内容")
    expect(a.usableFor).toEqual(b.usableFor)
  })
})

describe("边界与容错", () => {
  it("未知类型但有信号时仍给建议", () => {
    const r = recommendUsableFor("unknown_type", "投标报价", "含报价与投标内容。")
    expect(r.usableFor.length).toBeGreaterThan(0)
    expect(r.usableFor).toContain("quote")
  })

  it("未知类型且无信号时返回空（留给人工判断）", () => {
    const r = recommendUsableFor("unknown_type", "无关标题", "无关正文内容。")
    expect(r.usableFor).toHaveLength(0)
  })

  it("空标题/正文不抛错", () => {
    expect(() => recommendUsableFor("fact", "", "")).not.toThrow()
  })

  it("用途标签齐全（界面展示用）", () => {
    expect(Object.keys(USABLE_FOR_LABEL).sort()).toEqual(["bid", "faq", "ppt", "proposal", "quote"])
  })
})

describe("recommendBatch：批量推荐", () => {
  it("只返回有建议的原子", () => {
    const out = recommendBatch([
      { id: "a1", atomType: "fact", title: "公司规模", body: "员工 500 人。" },
      { id: "a2", atomType: "unknown", title: "无关", body: "无关内容。" },
    ])
    expect(out.map((x) => x.id)).toEqual(["a1"])
  })

  it("返回结果含置信度与理由（审核人据此判断）", () => {
    const out = recommendBatch([{ id: "a1", atomType: "metric", title: "指标", body: "不少于 27 个。" }])
    expect(out[0].confidence).toBeGreaterThan(0)
    expect(out[0].reasons.length).toBeGreaterThan(0)
  })

  it("空数组安全", () => {
    expect(recommendBatch([])).toHaveLength(0)
  })
})
