import { describe, expect, it } from "vitest"
import type { ModuleChapterDraft, StandardChapterPreview } from "@/pages/SolutionStudio/standardChapters"
import {
  GAP_SLIDE_BODY,
  bulletsFromChapter,
  isGapSlidePlan,
  standardChaptersToDeckPlan,
} from "./standardChaptersToDeckPlan"

function draft(partial: Partial<ModuleChapterDraft> & Pick<ModuleChapterDraft, "moduleKey" | "moduleTitle" | "status">): ModuleChapterDraft {
  return {
    productName: partial.productName ?? partial.moduleTitle,
    moduleName: partial.moduleName ?? "",
    body: partial.body ?? "",
    sources: partial.sources ?? [],
    gapReason: partial.gapReason,
    ...partial,
  }
}

function preview(modules: ModuleChapterDraft[], title = "合成建设清单"): StandardChapterPreview {
  return {
    title,
    typeKey: "standard",
    outline: [],
    modules,
    stats: {
      ok: modules.filter((m) => m.status === "ok").length,
      thin: modules.filter((m) => m.status === "thin").length,
      missing: modules.filter((m) => m.status === "missing").length,
      truncated: 0,
    },
    warnings: [],
  }
}

describe("standardChaptersToDeckPlan", () => {
  it("已整理页带来源或要点，缺项页只标缺、不编造正文", () => {
    const { topic, plan } = standardChaptersToDeckPlan(
      preview([
        draft({
          moduleKey: "emr",
          moduleTitle: "电子病历系统",
          status: "ok",
          sources: [
            {
              kind: "atom",
              id: "a1",
              title: "门诊病历书写",
              docName: "某医院建设方案",
              quote: "电子病历应覆盖门急诊书写、质控与归档。",
              body: "电子病历应覆盖门急诊书写、质控与归档。",
            },
          ],
        }),
        draft({
          moduleKey: "int",
          moduleTitle: "集成平台",
          status: "thin",
          sources: [
            {
              kind: "atom",
              id: "a2",
              title: "集成平台互联",
              docName: "技术方案",
              quote: "集成平台承担系统间互联互通。",
              body: "集成平台承担系统间互联互通。",
            },
          ],
        }),
        draft({
          moduleKey: "xyz",
          moduleTitle: "尚无素材的演示模块XYZ",
          status: "missing",
          gapReason: "知识库中未找到已审核的相关素材，未编造正文。",
        }),
      ]),
      { topic: "合成建设清单" },
    )
    expect(topic).toBe("合成建设清单")
    const emr = plan.find((p) => p.title.includes("电子病历"))
    const plat = plan.find((p) => p.title.includes("集成平台"))
    const gap = plan.find((p) => /XYZ/.test(p.title))
    expect(emr).toBeTruthy()
    expect(emr?.gap).toBeFalsy()
    expect((emr?.sourceRefs?.length ?? 0) + (emr?.intent ? 1 : 0)).toBeGreaterThan(0)
    expect(emr?.sourceRefs?.some((r) => r.excerpt.includes("门急诊书写") || r.materialName.includes("建设方案"))).toBe(true)
    expect(plat).toBeTruthy()
    expect(plat?.gap).toBeFalsy()
    expect(gap).toBeTruthy()
    expect(gap?.gap).toBe(true)
    expect(gap?.title).toContain("缺项")
    expect(isGapSlidePlan(gap!)).toBe(true)
    const gapText = `${gap?.intent ?? ""}`
    expect(gapText).toMatch(/缺项|暂无足够依据|未编造|未找到/)
    expect(gapText).not.toMatch(/智能补全|生成一段完整方案/)
    expect(gap?.sourceRefs ?? []).toEqual([])
  })

  it("要点只来自已有来源，不另写新段落", () => {
    const bullets = bulletsFromChapter(
      draft({
        moduleKey: "emr",
        moduleTitle: "电子病历系统",
        status: "ok",
        sources: [
          {
            kind: "atom",
            id: "a1",
            title: "t",
            docName: "d",
            quote: "电子病历覆盖门急诊书写。",
            body: "电子病历覆盖门急诊书写。",
          },
        ],
      }),
    )
    expect(bullets.join("")).toContain("电子病历覆盖门急诊书写")
    expect(bullets.join("")).not.toContain("我们建议采购")
  })
})

describe("isGapSlidePlan", () => {
  it("按 gap 标记或标题中的缺项识别", () => {
    expect(isGapSlidePlan({ title: "集成平台", gap: false })).toBe(false)
    expect(isGapSlidePlan({ title: "演示模块（缺项）" })).toBe(true)
    expect(isGapSlidePlan({ title: "演示模块", gap: true })).toBe(true)
    expect(GAP_SLIDE_BODY).toContain("未用模型编造")
  })
})
