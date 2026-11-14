import { describe, expect, it, vi } from "vitest"
import { generateSlidesByPage, gapSlideFromPlan } from "./deckPageGen"
import { GAP_SLIDE_BODY, isGapSlidePlan } from "./standardChaptersToDeckPlan"
import type { SlidePlan } from "./pptQuoteTypes"

const sourced: SlidePlan = { id: "m1", title: "电子病历系统", intent: "覆盖门急诊书写", kind: "bullets" }
const gap: SlidePlan = { id: "g1", title: "尚无素材的演示模块XYZ（缺项）", intent: "知识库中未找到已审核的相关素材，未编造正文。", kind: "bullets", gap: true }

describe("generateSlidesByPage 缺项页不走 LLM", () => {
  it("gap 页直接落标缺说明，不调用 callLlm", async () => {
    const builtIds: string[] = []
    const callLlm = vi.fn(async () => JSON.stringify({
      slides: [{ title: "电子病历系统", kind: "bullets", bullets: ["覆盖门急诊书写"], notes: "" }],
    }))
    const results = await generateSlidesByPage({
      plan: [sourced, gap],
      allTitles: [sourced.title, gap.title],
      concurrency: 1,
      maxAttempts: 2,
      buildMessages: (plan) => {
        builtIds.push(plan.id)
        return [{ role: "user", content: "gen" }]
      },
      callLlm,
    })
    expect(builtIds.length).toBeGreaterThanOrEqual(1)
    expect(builtIds.every((id) => id === "m1")).toBe(true)
    expect(builtIds).not.toContain("g1")
    expect(callLlm.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(results).toHaveLength(2)
    const gapRes = results.find((r) => r.plan.id === "g1")
    expect(gapRes?.slide).toBeTruthy()
    expect(gapRes?.attempts).toBe(0)
    expect(gapRes?.slide?.title).toContain("缺项")
    expect((gapRes?.slide?.bullets ?? []).join("")).toMatch(/未编造|暂无足够依据|未找到/)
    expect((gapRes?.slide?.bullets ?? []).join("")).not.toContain("我们建议采购")
    const okRes = results.find((r) => r.plan.id === "m1")
    expect(okRes).toBeTruthy()
    expect(okRes?.plan.title).toContain("电子病历")
  })

  it("gapSlideFromPlan 只保留标缺说明", () => {
    const slide = gapSlideFromPlan(gap)
    expect(isGapSlidePlan(gap)).toBe(true)
    expect(slide.bullets.join("")).toContain("未编造")
    expect(slide.notes).toBe(GAP_SLIDE_BODY)
  })
})
