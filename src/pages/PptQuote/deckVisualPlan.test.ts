import { describe, expect, it } from "vitest"
import {
  buildDeckVisualPlan,
  decideSlideVisual,
  decideTone,
  groupByVisualType,
  isConcreteScene,
  pagesNeedingAssets,
  VISUAL_TYPES,
  type VisualTone,
} from "./deckVisualPlan"
import type { Slide } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// 补齐 6 验收测试：全册视觉计划
//
// 需求原文（§六.1）：
//   「系统必须先理解整份 PPT 的主题、受众、叙事逻辑、公司模板和参考素材，
//     再制定全册视觉计划，禁止只根据单页标题随机搜图。」
//
// 本测试锁住三个关键点：
//   ① 配图决策按**内容语义**（架构页不能配医院大楼照片）
//   ② 不为"图文并茂"强行配图（论述页应 none）
//   ③ 产品界面/Logo 绝不 AI 编（只能用户上传）
// ---------------------------------------------------------------------------

function mk(p: Partial<Slide> & { title?: string }): Slide {
  return { id: p.title ?? "s", title: p.title ?? "页", bullets: [], notes: "", ...p
  } as Slide
}

describe("decideSlideVisual：单页决策按内容语义", () => {
  const tone: VisualTone = "photographic"

  it("架构页 → 自绘图示（不能配照片，照片说不清系统关系）", () => {
    const s = mk({
      title: "技术架构分层设计",
      figures: [{ type: "architecture", title: "架构", layers: [] } as never],
    })
    const p = decideSlideVisual(s, tone)
    expect(p.visualType).toBe("vectorDiagram")
    expect(p.reason).toContain("架构图")
  })

  it("流程页 → 自绘流程图", () => {
    const s = mk({ title: "实施路径", figures: [{ type: "flow", title: "流程", steps: [] } as never] })
    expect(decideSlideVisual(s, tone).visualType).toBe("vectorDiagram")
  })

  it("有真实图表数据 → chart（图表本身即视觉主体，不再配位图）", () => {
    const s = mk({
      title: "年度指标趋势",
      chart: { type: "bar", title: "t", categories: ["a", "b"], series: [{ name: "s", data: [1, 2] }] },
    })
    expect(decideSlideVisual(s, tone).visualType).toBe("chart")
  })

  it("KPI 数字页 → none（数字已是焦点，配图分散注意力）", () => {
    const s = mk({ title: "关键成效", kpi: [{ value: "5级", label: "病历" }] })
    const p = decideSlideVisual(s, tone)
    expect(p.visualType).toBe("none")
    expect(p.reason).toContain("分散注意力")
  })

  it("论述页按标题推导检索词配图（2026-10-30 行为变更）", () => {
    // 变更原因：用户反馈「PPT 还是没有生图」。原实现在这里返回 none，
    // 而模型生成的页面绝大多数是 bullets 且不填 imageHint → 全册 0 页配图。
    // 现改为：论述页也按「标题+首条要点」推导检索词。
    // 「不强行配图」的约束由**配额控制**保证（见 buildDeckVisualPlan 的 maxImageRatio），
    // 不再靠单页一律返回 none 实现。
    const s = mk({ title: "我们的三个坚持", bullets: ["以患者为中心", "以数据为驱动", "以质量为底线"] })
    const p = decideSlideVisual(s, tone)
    expect(["stockPhoto", "aiIllustration"]).toContain(p.visualType)
    expect(p.query).toBeTruthy()
    expect(p.reason).toContain("推导检索词")
  })

  it("完全无信息可推导时才返回 none（不硬凑）", () => {
    const s = mk({ title: "", bullets: [] })
    expect(decideSlideVisual(s, tone).visualType).toBe("none")
  })

  it("配额控制保证不会每页都配图", () => {
    const slides = Array.from({ length: 20 }, (_, i) => mk({ title: `要点页 ${i}`, bullets: ["内容"] }))
    const plan = buildDeckVisualPlan({ deck_type: "planning", slides })
    const imagePages = plan.slides.filter((x) => x.visualType === "stockPhoto" || x.visualType === "aiIllustration").length
    // 20 页 × 35% ≈ 7 页配额
    expect(imagePages).toBeLessThanOrEqual(Math.round(20 * 0.35) + 1)
    expect(imagePages).toBeGreaterThan(0)
  })

  it("已有配图的页 → 保持不动", () => {
    const s = mk({ title: "已有图", image: "data:image/png;base64,xxx" })
    expect(decideSlideVisual(s, tone).visualType).toBe("companyAsset")
  })

  it("具体场景关键词 → 实拍照片", () => {
    const s = mk({ title: "走进医院", imageHint: "医院门诊大厅", layout: "image-right" })
    const p = decideSlideVisual(s, "photographic")
    expect(p.visualType).toBe("stockPhoto")
    expect(p.query).toBe("医院门诊大厅")
  })

  it("抽象概念关键词在摄影基调下仍走实拍（基调优先）", () => {
    const s = mk({ title: "数字化转型", imageHint: "数字化未来", layout: "image-right" })
    expect(decideSlideVisual(s, "photographic").visualType).toBe("stockPhoto")
  })

  it("抽象概念关键词在插画基调下走 AI 插画", () => {
    const s = mk({ title: "数字化转型", imageHint: "数字化未来", layout: "image-right" })
    const p = decideSlideVisual(s, "illustrative")
    expect(p.visualType).toBe("aiIllustration")
  })

  it("章节页 → 背景图", () => {
    const s = mk({ title: "第一部分 现状分析", layout: "section" })
    const p = decideSlideVisual(s, tone)
    expect(p.placement).toBe("background")
  })

  it("每页决策都带 reason（可审计，用户能看出判断对错）", () => {
    const cases = [
      mk({ title: "a", figures: [{ type: "flow", title: "f", steps: [] } as never] }),
      mk({ title: "b", kpi: [{ value: "1", label: "l" }] }),
      mk({ title: "c", bullets: ["x"] }),
      mk({ title: "d", imageHint: "机房", layout: "image-right" }),
    ]
    for (const s of cases) {
      expect(decideSlideVisual(s, tone).reason.length).toBeGreaterThan(5)
    }
  })
})

describe("isConcreteScene：具体场景 vs 抽象概念", () => {
  it("医院/设备/人物等具体词 → true", () => {
    expect(isConcreteScene("医院门诊大厅")).toBe(true)
    expect(isConcreteScene("机房服务器")).toBe(true)
    expect(isConcreteScene("护士站")).toBe(true)
    expect(isConcreteScene("CT 设备")).toBe(true)
  })

  it("数字化/赋能/生态等抽象词 → false", () => {
    expect(isConcreteScene("数字化转型")).toBe(false)
    expect(isConcreteScene("赋能生态")).toBe(false)
    expect(isConcreteScene("一体化体系")).toBe(false)
  })

  it("短词偏具体，长句偏抽象（兜底规则）", () => {
    expect(isConcreteScene("大厅")).toBe(true) // 短词
    expect(isConcreteScene("通过数字化手段实现全院业务协同与数据共享的完整体系")).toBe(false)
  })
})

describe("decideTone：全册基调", () => {
  it("架构/流程页占比高 → diagrammatic", () => {
    const slides = [
      mk({ title: "a", figures: [{ type: "architecture", title: "x", layers: [] } as never] }),
      mk({ title: "b", figures: [{ type: "flow", title: "y", steps: [] } as never] }),
      mk({ title: "c", bullets: ["x"] }),
    ]
    expect(decideTone("planning", slides)).toBe("diagrammatic")
  })

  it("规划类 → photographic（要真实可信感）", () => {
    const slides = [mk({ title: "a", bullets: ["x"] }), mk({ title: "b", bullets: ["y"] })]
    expect(decideTone("planning", slides)).toBe("photographic")
  })

  it("专题类 → illustrative（现代感）", () => {
    const slides = [mk({ title: "a", bullets: ["x"] })]
    expect(decideTone("topic", slides)).toBe("illustrative")
  })
})

describe("buildDeckVisualPlan：全册计划", () => {
  const slides = [
    mk({ title: "封面", layout: "section" }),
    mk({ title: "技术架构", figures: [{ type: "architecture", title: "x", layers: [] } as never] }),
    mk({ title: "年度趋势", chart: { type: "bar", title: "t", categories: ["a", "b"], series: [{ name: "s", data: [1, 2] }] } }),
    mk({ title: "关键成效", kpi: [{ value: "5级", label: "病历" }] }),
    mk({ title: "我们的理念", bullets: ["以患者为中心", "以数据为驱动"] }),
    mk({ title: "走进医院", imageHint: "医院门诊大厅", layout: "image-right" }),
  ]

  it("生成每页计划且页码连续", () => {
    const plan = buildDeckVisualPlan({ deck_type: "planning", slides })
    expect(plan.slides).toHaveLength(6)
    plan.slides.forEach((p, i) => expect(p.page).toBe(i + 1))
  })

  it("统计各 visualType 数量，总和等于页数", () => {
    const plan = buildDeckVisualPlan({ deck_type: "planning", slides })
    const total = VISUAL_TYPES.reduce((n, vt) => n + plan.stats[vt], 0)
    expect(total).toBe(slides.length)
  })

  it("摘要说明基调与各类配图数量", () => {
    const plan = buildDeckVisualPlan({ deck_type: "planning", slides })
    expect(plan.summary).toContain("基调")
    expect(plan.summary.length).toBeGreaterThan(10)
  })

  it("需要执行配图的页不含 none/vectorDiagram/chart", () => {
    const plan = buildDeckVisualPlan({ deck_type: "planning", slides })
    const need = pagesNeedingAssets(plan)
    for (const p of need) {
      expect(["stockPhoto", "aiIllustration", "companyAsset"]).toContain(p.visualType)
    }
  })

  it("按类型分组可用（界面批量确认）", () => {
    const plan = buildDeckVisualPlan({ deck_type: "planning", slides })
    const grouped = groupByVisualType(plan)
    const total = VISUAL_TYPES.reduce((n, vt) => n + grouped[vt].length, 0)
    expect(total).toBe(slides.length)
  })

  it("空 deck 不崩", () => {
    const plan = buildDeckVisualPlan({ slides: [] })
    expect(plan.slides).toHaveLength(0)
    expect(plan.summary).toContain("基调")
  })
})

describe("关键约束：绝不 AI 编造真实界面/Logo", () => {
  it("productScreenshot 类型只可能来自用户上传（决策引擎不会自动选它）", () => {
    // 用一个带产品界面关键词的页测试：决策引擎应选择 stockPhoto 或 aiIllustration，
    // 而**不会**选 productScreenshot（需求：真实产品界面只能用户上传）
    const s = mk({ title: "系统界面展示", imageHint: "HIS 系统界面", layout: "image-right" })
    const p = decideSlideVisual(s, "photographic")
    expect(p.visualType).not.toBe("productScreenshot")
  })
})
