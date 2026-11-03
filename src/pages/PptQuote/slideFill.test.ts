// Author: loop-R249
// 覆盖 R249 新增的占位/空白页判定与「补全此页」提示词：
// 锁定 isBlankSlide 口径（与 deckLint 的 empty_page 一致），保证 fill 提示词落地，
// 并回归 rewrite/expand/condense 三种既有精修提示词逐字未变（本次仅新增分支，属 B 类「只增不改」）。
import { describe, expect, it } from "vitest"

import {
  buildSlideRefineMessages,
  emptySlide,
  isBlankSlide,
  REFINE_LABEL,
  type DeckRecord,
  type Slide,
} from "./pptQuoteTypes"

function mkSlide(over: Partial<Slide> = {}): Slide {
  return {
    id: over.id ?? "s1",
    title: over.title ?? "标题",
    bullets: over.bullets ?? [],
    notes: over.notes ?? "",
    ...over,
  }
}

const deck: DeckRecord = {
  id: "d1",
  rh_user_id: "u1",
  deck_name: "智慧医院汇报",
  deck_type: "general",
  audience: "院领导",
  duration_min: 15,
  material_ref: "",
  slides: [],
  doc_status: "done",
  created: "2026-10-10",
  updated: "2026-10-10",
}

describe("isBlankSlide", () => {
  it("emptySlide 生成的仅标题占位页判定为空白", () => {
    expect(isBlankSlide(emptySlide("老系统数据孤岛拖慢全院协作"))).toBe(true)
  })

  it("有要点的页不是空白页", () => {
    expect(isBlankSlide(mkSlide({ bullets: ["覆盖全院 42 个科室"] }))).toBe(false)
  })

  it("章节分隔页即使无正文也不算待补全", () => {
    expect(isBlankSlide(mkSlide({ title: "第一章", bullets: [], layout: "section" }))).toBe(false)
  })

  it("仅配图关键词 / 仅图片 / 图表 / KPI / 图示页都不算空白", () => {
    expect(isBlankSlide(mkSlide({ imageHint: "医院门诊大楼" }))).toBe(false)
    expect(isBlankSlide(mkSlide({ image: "data:image/png;base64,AAA" }))).toBe(false)
    expect(isBlankSlide(mkSlide({ chart: { type: "bar", categories: ["一期"], series: [{ data: [10] }] } }))).toBe(false)
    expect(isBlankSlide(mkSlide({ kpi: [{ value: "35%", label: "效率提升" }] }))).toBe(false)
  })

  it("要点全是空白字符串仍判定为空白", () => {
    expect(isBlankSlide(mkSlide({ bullets: ["", "   ", " "] }))).toBe(true)
  })
})

describe("buildSlideRefineMessages fill", () => {
  it("fill 提示词要求为仅标题页补全要点与讲稿", () => {
    const msgs = buildSlideRefineMessages("fill", deck, emptySlide("一体化平台收口临床数据"))
    expect(msgs).toHaveLength(2)
    const sys = msgs[0].content
    expect(sys).toContain("补全")
    expect(sys).toContain("只有标题")
    const user = msgs[1].content
    expect(user).toContain("一体化平台收口临床数据")
    expect(user).toContain("（空）")
  })

  it("REFINE_LABEL 补全此页", () => {
    expect(REFINE_LABEL.fill).toBe("补全此页")
  })

  it("rewrite/expand/condense 既有提示词逐字未变（只新增 fill 分支）", () => {
    const slide = mkSlide({ title: "建设成效", bullets: ["门诊准备时间压缩 40%"] })
    expect(buildSlideRefineMessages("rewrite", deck, slide)[0].content).toContain(
      "重写：保持本页信息定位，换更专业、更有说服力的表达，重组要点顺序",
    )
    expect(buildSlideRefineMessages("expand", deck, slide)[0].content).toContain(
      "扩写：补充医疗行业细节、量化指标与落地举措，要点条数可增加 1-3 条",
    )
    expect(buildSlideRefineMessages("condense", deck, slide)[0].content).toContain(
      "精简：压缩到 3 条以内核心要点，每条 ≤26 字，不丢关键信息",
    )
    for (const k of ["rewrite", "expand", "condense"] as const) {
      expect(buildSlideRefineMessages(k, deck, slide)[0].content).not.toContain("只有标题")
    }
  })
})
