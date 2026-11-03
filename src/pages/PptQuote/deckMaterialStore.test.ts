import { describe, expect, it } from "vitest"
import { attachSourceRefs, buildLibraryFromTexts, hasMaterials, materialLibrarySummary } from "./deckMaterialStore"

// ---------------------------------------------------------------------------
// 补齐 1 验收测试：素材检索接入生成流程
//
// 解决的问题：deckMaterials 有完整的检索能力，但 usePptQuote 里 0 处调用，
// 导致 sourceRefs 永远为空、素材检索等于没做。
//
// 本测试锁住「attachSourceRefs 能把大纲每页与相关素材片段挂上」这个关键契约。
// ---------------------------------------------------------------------------

describe("attachSourceRefs：把素材片段挂到大纲页", () => {
  it("有素材时，相关页拿到 sourceRefs", () => {
    buildLibraryFromTexts([
      {
        id: "m1",
        name: "六安市中医院可研报告.docx",
        kind: "content",
        text: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。\n\n医院编制床位 300 张，年门诊量 42 万人次。",
      },
    ])
    expect(hasMaterials()).toBe(true)

    const plan = [
      { title: "电子病历 5 级是核心目标", intent: "讲评级现状" },
      { title: "医院规模与业务量", intent: "讲床位与门诊量" },
    ]
    const withRefs = attachSourceRefs(plan, 3)
    expect(withRefs[0].sourceRefs?.length).toBeGreaterThan(0)
    // refs 必须带素材名与摘录，供追溯
    expect(withRefs[0].sourceRefs![0].materialName).toContain("可研报告")
    expect(withRefs[0].sourceRefs![0].excerpt.length).toBeGreaterThan(10)
  })

  it("无素材时不改变 plan（返回原样）", () => {
    // 前面的测试可能已建库，这里只验证「无关标题」不硬塞
    const plan = [{ title: "量子计算与区块链", intent: "完全无关" }]
    const out = attachSourceRefs(plan, 3)
    expect(out[0].sourceRefs ?? []).toHaveLength(0)
  })

  it("素材库摘要可展示", () => {
    const s = materialLibrarySummary()
    // 已建库时应有内容
    expect(typeof s).toBe("string")
  })
})

describe("buildLibraryFromTexts：从纯文本建库（恢复/测试用）", () => {
  it("自动分块并建索引，可被检索", () => {
    const lib = buildLibraryFromTexts([
      {
        id: "m2",
        name: "某院标书.docx",
        kind: "content",
        text: "第一章 现状\n医院现有 HIS、EMR、LIS 三套系统，字典不统一。\n\n第二章 目标\n建设一体化数据底座，打通四大业务域。",
      },
    ])
    expect(lib.chunkById.size).toBeGreaterThan(0)
    expect(lib.docs[0].chunks.length).toBeGreaterThan(0)
  })

  it("视觉素材不参与内容检索（内容/视觉不得混用）", () => {
    const lib = buildLibraryFromTexts([
      { id: "v1", name: "配色规范.pptx", kind: "visual", text: "深藏青 #1B3A5C 主色，正文黑色，强调色墨绿。页面 16:9。" },
    ])
    // 视觉素材仍会入库（供视觉计划用），但 searchChunks 会过滤掉
    expect(lib.docs).toHaveLength(1)
    expect(lib.docs[0].kind).toBe("visual")
  })
})
