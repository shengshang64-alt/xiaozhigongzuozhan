// Author: loop-R189
// R189（r169 切片二）保真计划层单测：钉死「标题+正文页进保真通道、图表/KPI/图文页整册回退现通道」
// 契约，以及封面/目录/末页文案与 deckExports 现通道逐字一致。纯逻辑，node 下直接跑。
import { describe, expect, it } from "vitest"
import { deckTypeLabel, type Slide } from "./pptQuoteTypes"
import { effectiveLayout, isFidelityEligibleSlide, planFidelityExport } from "./deckFidelityPlan"

function mkSlide(o: Partial<Slide> = {}): Slide {
  return { id: "s", title: "标题", bullets: ["要点一", "要点二"], notes: "", ...o }
}
function mkDeck(slides: Slide[]) {
  return { deck_name: "智慧园区方案汇报", deck_type: "solution", audience: "院领导", duration_min: 20, slides }
}

describe("isFidelityEligibleSlide / effectiveLayout（R189）", () => {
  it("纯要点/章节页合格", () => {
    expect(isFidelityEligibleSlide(mkSlide())).toBe(true)
    expect(isFidelityEligibleSlide(mkSlide({ layout: "section" }))).toBe(true)
  })

  it("图表/KPI/真实配图/AI 图示不合格", () => {
    expect(isFidelityEligibleSlide(mkSlide({ chart: { type: "bar", categories: ["a"], series: [] } }))).toBe(false)
    expect(isFidelityEligibleSlide(mkSlide({ kpi: [{ value: "1", label: "床位数" }] }))).toBe(false)
    expect(isFidelityEligibleSlide(mkSlide({ image: "data:image/png;base64,x" }))).toBe(false)
    expect(isFidelityEligibleSlide(mkSlide({ figures: [{} as never] }))).toBe(false)
  })

  it("显式图文/图表/KPI 版式但缺数据时按现口径降级为要点、仍合格", () => {
    expect(effectiveLayout(mkSlide({ layout: "image-right" }), false)).toBe("bullets")
    expect(effectiveLayout(mkSlide({ layout: "chart" }), false)).toBe("bullets")
    expect(effectiveLayout(mkSlide({ layout: "kpi" }), false)).toBe("bullets")
    expect(isFidelityEligibleSlide(mkSlide({ layout: "banner" }))).toBe(true)
  })

  it("空 categories 的 chart 数据不算图表页（与 effectiveLayout 现口径一致）", () => {
    expect(isFidelityEligibleSlide(mkSlide({ chart: { type: "pie", categories: [], series: [] } }))).toBe(true)
  })
})

describe("planFidelityExport（R189）", () => {
  const slides = [
    mkSlide({ id: "1", title: "现状", bullets: ["甲"], notes: "讲稿甲" }),
    mkSlide({ id: "2", title: "分区", bullets: ["乙", "丙"], layout: "section" }),
  ]
  const specs = planFidelityExport(mkDeck(slides), "2026 年 10 月")

  it("封面/目录/逐页/致谢结构齐全，文案与现通道逐字一致", () => {
    expect(specs).not.toBeNull()
    const list = specs!
    expect(list.length).toBe(slides.length + 3)
    expect(list[0].title).toBe("智慧园区方案汇报")
    expect(list[0].lines![0]).toBe(`${deckTypeLabel("solution")}  |  汇报对象：院领导  |  时长约 20 分钟`)
    expect(list[0].lines![1]).toBe("2026 年 10 月")
    expect(list[1].title).toBe("目录")
    expect(list[1].lines).toEqual(["01   现状", "02   分区"])
    expect(list[list.length - 1]).toEqual({ title: "谢谢聆听", lines: ["欢迎交流指正"] })
  })

  it("要点页 notes 逐字透传；section 页要点以全角间隔点合并为一行", () => {
    const list = specs!
    expect(list[2].title).toBe("现状")
    expect(list[2].lines).toEqual(["甲"])
    expect(list[2].notes).toBe("讲稿甲")
    expect(list[3].lines).toEqual(["乙\u3000·\u3000丙"])
    expect(list[3].notes).toBeUndefined()
  })

  it("空 bullets 的要点页用「—」占位（与现通道一致）；纯空白 notes 归一为 undefined", () => {
    const list = planFidelityExport(mkDeck([mkSlide({ bullets: [], notes: "   " })]), "t")
    expect(list).not.toBeNull()
    expect(list![2].lines).toEqual(["\u2014"])
    expect(list![2].notes).toBeUndefined()
  })

  it("任一页不合格（KPI/配图）→ 整册返回 null 走现通道", () => {
    expect(planFidelityExport(mkDeck([mkSlide(), mkSlide({ kpi: [{ value: "1", label: "L" }] })]), "t")).toBeNull()
    expect(planFidelityExport(mkDeck([mkSlide({ image: "data:image/png;base64,x" })]), "t")).toBeNull()
  })

  it("无页 → null；deck_name 空 → 「汇报 PPT」兜底", () => {
    expect(planFidelityExport(mkDeck([]), "t")).toBeNull()
    const list = planFidelityExport({ ...mkDeck([mkSlide()]), deck_name: "" }, "t")
    expect(list).not.toBeNull()
    expect(list![0].title).toBe("汇报 PPT")
  })
})
