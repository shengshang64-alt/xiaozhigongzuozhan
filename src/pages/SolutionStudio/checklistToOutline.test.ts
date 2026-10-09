import { describe, expect, it } from "vitest"
import { checklistToOutlineSkeleton, SKELETON_TEMPLATES } from "./checklistToOutline"

describe("checklistToOutlineSkeleton", () => {
  it("标准方案：核心功能模块介绍章按清单系统逐条铺子节，其余为固定标准章节", () => {
    const nodes = checklistToOutlineSkeleton(["EMR", "LIS", "PACS"], "standard")
    expect(nodes.map((n) => n.title)).toEqual([
      "产品总体介绍与价值主张",
      "总体技术架构",
      "核心功能模块介绍",
      "产品亮点与差异化优势",
      "实施方案与服务体系",
      "典型落地案例",
      "投资估算与服务报价",
      "效益分析",
    ])
    const sys = nodes.find((n) => n.title === "核心功能模块介绍")!
    expect(sys.children.map((c) => c.title)).toEqual(["EMR", "LIS", "PACS"])
  })

  it("systems 为空：仍产出固定骨架，systems 章子节为空", () => {
    const nodes = checklistToOutlineSkeleton([], "standard")
    expect(nodes.length).toBe(SKELETON_TEMPLATES.standard.length)
    expect(nodes.find((n) => n.title === "核心功能模块介绍")!.children).toEqual([])
  })

  it("去空 + trim + 首次出现去重", () => {
    const nodes = checklistToOutlineSkeleton([" EMR ", "", "LIS", "EMR", "   "], "preliminary")
    const sys = nodes.find((n) => n.title === "各分系统初步设计")!
    expect(sys.children.map((c) => c.title)).toEqual(["EMR", "LIS"])
  })

  it("未知 typeKey 回落 standard 模板", () => {
    const nodes = checklistToOutlineSkeleton(["HIS"], "unknown-type" as never)
    expect(nodes[0].title).toBe("产品总体介绍与价值主张")
  })

  it("每个节点都有唯一 id 且 children 为数组（可直接进向导树编辑）", () => {
    const nodes = checklistToOutlineSkeleton(["A", "B"], "planning")
    const ids = new Set<string>()
    const walk = (ns: typeof nodes): void => {
      for (const n of ns) {
        expect(n.id).toBeTruthy()
        expect(Array.isArray(n.children)).toBe(true)
        ids.add(n.id)
        walk(n.children)
      }
    }
    walk(nodes)
    // planning 11 章 + 重点应用系统规划下 2 个系统子节
    expect(ids.size).toBe(13)
  })

  it("五类模板各存在且含且仅含一个 systemsChapter 章", () => {
    for (const key of Object.keys(SKELETON_TEMPLATES)) {
      const tpl = SKELETON_TEMPLATES[key as keyof typeof SKELETON_TEMPLATES]
      expect(tpl.length).toBeGreaterThan(0)
      expect(tpl.filter((d) => d.systemsChapter).length).toBe(1)
    }
  })
})
