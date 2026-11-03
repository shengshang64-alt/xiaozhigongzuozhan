import { describe, expect, it } from "vitest"
import type { Slide } from "./pptQuoteTypes"
import { extractNumbers, hasVisual, reshapeTextHeavySlides } from "./deckReshape"

// ---------------------------------------------------------------------------
// 生成后自动整形回归（2026-10-30）
//
// 背景：用户反馈「文字占很大篇幅、没有美观性」，实测 29 页里 20 页是纯文字。
// 提示词约束执行率低，故补确定性整形层。本测试锁住两条底线：
//   ① 该转形态的能转（chart/kpi/architecture/flow/table）
//   ② **绝不造假数据**——抽不出数字就不转，原文数值必须原样保留
// ---------------------------------------------------------------------------

function mk(partial: Partial<Slide> & { title: string; bullets: string[] }): Slide {
  return { id: partial.title, notes: "", ...partial }
}

describe("extractNumbers", () => {
  it("抽出「标签 + 数值 + 单位」", () => {
    expect(extractNumbers("病历完整率 82%")).toMatchObject({ value: 82, raw: "82%" })
    expect(extractNumbers("门诊量：3500 人次")).toMatchObject({ value: 3500 })
    expect(extractNumbers("服务三级医院 38 家")).toMatchObject({ value: 38 })
  })

  it("无数字返回 null", () => {
    expect(extractNumbers("系统间靠手工导数")).toBeNull()
    expect(extractNumbers("")).toBeNull()
  })
})

describe("reshapeTextHeavySlides：形态转换", () => {
  it("含 ≥3 个数值 → chart，且数值原样保留", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "关键指标现状",
        bullets: ["病历完整率 82%", "医嘱闭环率 65%", "影像调阅率 40%", "数据共享率 30%"],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    const hit = out[1]
    expect(hit.chart).toBeTruthy()
    expect(hit.layout).toBe("chart")
    expect(hit.chart?.series[0].data).toEqual([82, 65, 40, 30])
    expect(stats.byRule.chart).toBe(1)
  })

  it("3-4 条纯数值要点 → kpi", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({ title: "公司实力", bullets: ["累计交付项目 260 项", "覆盖城市 30 个", "服务医院 120 家"] }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out } = reshapeTextHeavySlides(slides)
    expect(out[1].kpi).toHaveLength(3)
    // 数值必须原样保留（单位跟着走）
    expect(out[1].kpi?.map((k) => k.value)).toEqual(["260项", "30个", "120家"])
  })

  it("架构类标题 + 3 条要点 → architecture 图示", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "总体技术架构分层设计",
        bullets: ["业务应用层，门诊系统、住院系统、医技系统", "平台支撑层，集成平台、主索引、数据中心", "基础设施层，服务器、存储、网络设备"],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.[0].type).toBe("architecture")
    expect(stats.byRule.architecture).toBe(1)
  })

  it("流程类标题 + 3 条要点 → flow 图示", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "项目实施路径与阶段",
        bullets: ["第一阶段：调研与蓝图设计", "第二阶段：系统建设与集成", "第三阶段：试运行与验收"],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.[0].type).toBe("flow")
    expect(stats.byRule.flow).toBe(1)
  })

  it("「A：B」形式 2-4 条 → table(compare)", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "现状与目标对照",
        bullets: ["电子病历：4 级 → 5 级", "互联互通：未测评 → 四甲", "数据治理：无中台 → 有中台"],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.[0].type).toBe("table")
    expect(stats.byRule.table).toBe(1)
  })
})

describe("reshapeTextHeavySlides：绝不造假", () => {
  it("没有数字的论述页 → 转图标矩阵（不编数据，只做形态视觉化）", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({ title: "我们的理念", bullets: ["以患者为中心", "以数据为驱动", "以质量为底线"] }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    // 2026-10-30 行为变更：以前保持纯文字（那就是"文字墙"的来源），现在用 iconGrid 视觉化。
    // 底线不变：**不能凭空造 chart/kpi 数值**，只能改形态。
    expect(out[1].chart).toBeUndefined()
    expect(out[1].kpi).toBeUndefined()
    expect(out[1].figures?.[0].type).toBe("iconGrid")
    expect(stats.byRule.iconGrid).toBe(1)
  })

  it("已有视觉形态的页一律不动", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "关键指标",
        bullets: ["病历完整率 82%", "医嘱闭环率 65%"],
        chart: { type: "bar", title: "t", categories: ["a"], series: [{ name: "s", data: [1] }] },
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const before = JSON.stringify(slides[1])
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    expect(JSON.stringify(out[1])).toBe(before)
    expect(stats.reshaped).toBe(0)
  })

  it("数值量级差 >50 倍时不转 chart（避免柱图失真）", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({ title: "混合指标", bullets: ["很小的 1%", "中等 5%", "很大的 99%"].map((s, i) => s + "".padEnd(i, " ")) }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    // 1 / 99 = 99 倍 → 应放弃 chart（但可能命中 kpi 规则，故只断言不产生 chart）
    const { slides: out } = reshapeTextHeavySlides(slides)
    expect(out[1].chart).toBeUndefined()
  })

  it("section 章节过渡页不整形", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({ title: "第一部分 现状分析", bullets: ["a：1", "b：2", "c：3"], layout: "section" }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out } = reshapeTextHeavySlides(slides)
    expect(out[1].layout).toBe("section")
  })
})

describe("reshapeTextHeavySlides：配额控制", () => {
  it("整形数量受 maxTextOnlyRatio 约束", () => {
    // 10 页内容，预算 = 10 * 0.4 = 4 页最多被整形
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      ...Array.from({ length: 8 }, (_, i) =>
        mk({ title: `指标页${i}`, bullets: ["病历完整率 60%", "医嘱闭环率 50%", "影像调阅率 40%"] }),
      ),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { stats } = reshapeTextHeavySlides(slides, { maxTextOnlyRatio: 0.4 })
    expect(stats.reshaped).toBeLessThanOrEqual(4)
    expect(stats.reshaped).toBeGreaterThan(0)
  })
})

describe("hasVisual", () => {
  it("识别各类视觉形态", () => {
    expect(hasVisual(mk({ title: "a", bullets: [] }))).toBe(false)
    expect(hasVisual(mk({ title: "a", bullets: [], kpi: [{ value: "1%", label: "x" }] }))).toBe(true)
    expect(
      hasVisual(mk({ title: "a", bullets: [], figures: [{ type: "flow", title: "t", steps: [{ name: "s" }] }] })),
    ).toBe(true)
  })
})
