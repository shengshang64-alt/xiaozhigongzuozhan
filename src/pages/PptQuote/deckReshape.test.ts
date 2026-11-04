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

  it("「三步走 + 一期/二期/三期」→ flow（序数词兜底）", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "三步走分期实施",
        bullets: [
          "一期（3-6个月）：基础平台上线与主数据治理",
          "二期（7-12个月）：核心业务系统集成",
          "三期（13-18个月）：智慧应用与运营优化",
        ],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.[0].type).toBe("flow")
    expect(stats.byRule.flow).toBe(1)
  })

  it("「一体化平台」标题 + 3 条要点 → architecture（不等架构字样也能出框）", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "智慧医院一体化信息平台",
        bullets: [
          "统一门户：面向患者、医护、管理者提供统一入口",
          "数据中心：汇聚临床与管理数据形成统一主数据",
          "业务中台：支撑预约、诊疗、随访等业务复用",
        ],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out, stats } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.[0].type).toBe("architecture")
    expect(stats.byRule.architecture).toBe(1)
  })

  it("拆不出多模块时压成 1 个模块（不整页放弃）", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "一体化信息平台总体架构",
        bullets: [
          "以统一标准与主数据为核心的一体化底座支撑全院业务协同与数据共享",
          "覆盖门诊住院医技体检等全部临床业务场景并沉淀过程数据",
          "对上提供运营决策分析、对下连接各类终端与设备",
        ],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.[0].type).toBe("architecture")
    const fig = out[1].figures?.[0] as unknown as { layers?: { modules: string[] }[] } | undefined
    expect(fig?.layers?.[0].modules).toHaveLength(1)
  })

  it("纯痛点清单（短板/瓶颈）不转架构", () => {
    const slides = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({
        title: "信息平台现状短板",
        bullets: ["数据标准不统一，药名不互通", "系统间靠手工导数", "缺少统一主索引"],
      }),
      mk({ title: "致谢", bullets: ["x"] }),
    ]
    const { slides: out } = reshapeTextHeavySlides(slides)
    expect(out[1].figures?.some((f) => f.type === "architecture")).toBe(false)
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
  // 10 页 = 封面 + 8 页内容 + 致谢
  const mkBatch = () => [
    mk({ title: "封面", bullets: ["x"] }),
    ...Array.from({ length: 8 }, (_, i) =>
      mk({ title: `指标页${i}`, bullets: ["病历完整率 60%", "医嘱闭环率 50%", "影像调阅率 40%"] }),
    ),
    mk({ title: "致谢", bullets: ["x"] }),
  ]

  it("默认只保留约 25% 纯文字：8 页内容最多整形 6 页", () => {
    // contentCount = 10 − 2 = 8；允许留 floor(8*0.25)=2 页纯文字 → 预算 6
    const { stats } = reshapeTextHeavySlides(mkBatch())
    expect(stats.reshaped).toBe(6)
  })

  it("maxTextOnlyRatio=0 时内容页全部整形", () => {
    const { stats } = reshapeTextHeavySlides(mkBatch(), { maxTextOnlyRatio: 0 })
    expect(stats.reshaped).toBe(8)
  })

  it("maxTextOnlyRatio=1 时一页都不转（显式关闭整形）", () => {
    const { stats } = reshapeTextHeavySlides(mkBatch(), { maxTextOnlyRatio: 1 })
    expect(stats.reshaped).toBe(0)
  })
})

describe("reshapeTextHeavySlides：按大纲声明 kind 整形（2026-11-04 C 项）", () => {
  it("声明 kind=architecture 但标题是结论句（无架构关键词）→ 仍画成分层架构", () => {
    const { slides } = reshapeTextHeavySlides([
      mk({
        title: "一体化平台把门诊准备时间压缩 40%",
        kind: "architecture",
        bullets: [
          "渠道层：掌上医院、自助机、公众号",
          "业务层：门诊、住院、医技、药事",
          "数据层：业务库、数据仓、主索引",
        ],
      }),
    ])
    const fig = slides[0].figures?.[0]
    expect(fig?.type).toBe("architecture")
    expect(fig && fig.type === "architecture" ? fig.layers.length : 0).toBeGreaterThanOrEqual(3)
  })

  it("「一期夯基二期提质三期创优」这类裸期数标题 → flow（FLOW_WORD_RE 曾缺「期」）", () => {
    const { slides } = reshapeTextHeavySlides([
      mk({
        title: "一期夯基二期提质三期创优",
        bullets: ["一期：平台与主数据", "二期：业务域全覆盖", "三期：评级与智能化"],
      }),
    ])
    expect(slides[0].figures?.[0]?.type).toBe("flow")
  })

  it("声明 kind=flow 但标题是结论句（无流程关键词）→ 仍画成流程图", () => {
    const { slides } = reshapeTextHeavySlides([
      mk({
        title: "三年建成区域医疗高地",
        kind: "flow",
        bullets: ["摸底调研与方案设计", "平台建设与系统集成", "评级冲刺与验收推广"],
      }),
    ])
    expect(slides[0].figures?.[0]?.type).toBe("flow")
  })

  it("声明 kind=kpi 但抽不出数字 → 绝不硬造 KPI（退到能自渲染的其它形态）", () => {
    const { slides } = reshapeTextHeavySlides([
      mk({
        title: "建设成效综述",
        kind: "kpi",
        bullets: ["院内系统全面打通", "数据质量显著提升", "临床体验明显改善", "管理决策有据可依"],
      }),
    ])
    expect(slides[0].kpi).toBeUndefined()
  })

  it("声明 kind=table 且要点是 A：B → 画成对照表", () => {
    const { slides } = reshapeTextHeavySlides([
      mk({
        title: "现状与目标对照",
        kind: "table",
        bullets: ["电子病历：4 级 → 5 级", "互联互通：未测评 → 四级甲等"],
      }),
    ])
    expect(slides[0].figures?.[0]?.type).toBe("table")
  })

  it("声明页型但要点太少（<3 条）→ 不硬画，保持原样不崩", () => {
    const { slides } = reshapeTextHeavySlides([
      mk({ title: "平台架构", kind: "architecture", bullets: ["只说了一句"] }),
    ])
    expect(slides[0].figures).toBeUndefined()
  })

  it("10 页文本册整形后同时具备架构页与流程页（页型配额达标）", () => {
    const src = [
      mk({ title: "封面", bullets: ["x"] }),
      mk({ title: "现状：数据孤岛", bullets: ["系统各自为政", "数据标准不一", "接口重复建设", "运维成本高"] }),
      mk({
        title: "一体化平台总体蓝图",
        kind: "architecture",
        bullets: ["渠道层：掌上医院、自助机", "业务层：门诊、住院、医技", "数据层：数据仓、主索引"],
      }),
      mk({
        title: "三步走建设节奏",
        kind: "flow",
        bullets: ["一期：夯基，完成平台与主数据", "二期：提质，业务域全覆盖", "三期：创优，评级与智能化"],
      }),
      mk({ title: "保障措施", bullets: ["组织保障到位", "资金预算落实", "人才队伍培养", "考核机制健全"] }),
      mk({ title: "投资估算", bullets: ["平台建设投入", "系统改造投入", "运维服务投入"] }),
      mk({ title: "风险与应对", bullets: ["进度风险可控", "质量风险可控", "合规风险可控"] }),
      mk({ title: "下一步安排", bullets: ["确认需求范围", "启动招采流程", "组建实施团队"] }),
      mk({ title: "谢谢聆听", bullets: ["x"] }),
    ]
    const { slides } = reshapeTextHeavySlides(src)
    const figTypes = slides.flatMap((s) => (s.figures ?? []).map((f) => f.type))
    expect(figTypes).toContain("architecture")
    expect(figTypes).toContain("flow")
    const textOnly = slides.filter(
      (s) => !s.chart && !s.kpi?.length && !s.image && !s.figures?.length && s.layout !== "section",
    )
    expect(textOnly.length).toBeLessThanOrEqual(Math.ceil(slides.length * 0.3))
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
