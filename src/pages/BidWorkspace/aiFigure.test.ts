import { describe, expect, it } from "vitest"
import { buildAiImagePrompt, AI_IMAGE_MODEL, AI_IMAGE_PAGE } from "./prompts/aiImage"
import { applyAiFigureToChapters, collectAiFigureTargets, leafTitleOf } from "./aiFigure"
import { normalizeAiImageStyle, ORCHESTRATION_FIGURE_TYPE_LABEL } from "./bidTypes"
import { sanitizeOrchestrationBatch, normalizeOrchestration, mergeLeafOrchestrations } from "./bidTypes"
import { buildOrchestrationMessages } from "./prompts/orchestration"
import type { Chapter, FigureSpec, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { BidOrchestration } from "./bidTypes"

// T17 第三批测试：AI 位图（编排 ai 型 schema / 生图 prompt 口径 / 补图清单收集与写回）

describe("normalizeAiImageStyle + 标签", () => {
  it("非法值归一 engineering_diagram；两档标签齐全", () => {
    expect(normalizeAiImageStyle("realistic_photo")).toBe("realistic_photo")
    expect(normalizeAiImageStyle("engineering_diagram")).toBe("engineering_diagram")
    expect(normalizeAiImageStyle("other")).toBe("engineering_diagram")
    expect(normalizeAiImageStyle(undefined)).toBe("engineering_diagram")
    expect(ORCHESTRATION_FIGURE_TYPE_LABEL.ai).toBe("AI 配图")
  })
})

describe("buildAiImagePrompt（易标口径）", () => {
  it("含图题/风格提示语/场景/铁律；实景与工程图示两档提示语不同", () => {
    const p1 = buildAiImagePrompt({
      title: "数据中心机房布局",
      caption: "机房功能分区示意",
      scene: "数据中心机房与网络机柜部署",
      style: "realistic_photo",
      sectionText: "本项目在主机房部署 12 台机柜，双路供电。",
    })
    expect(p1).toContain("数据中心机房布局")
    expect(p1).toContain("实景照片风格")
    expect(p1).toContain("数据中心机房与网络机柜部署")
    expect(p1).toContain("双路供电")
    expect(p1).toContain("禁止编造")
    expect(p1).toContain("16:9")
    const p2 = buildAiImagePrompt({ title: "架构概念图", style: "engineering_diagram" })
    expect(p2).toContain("工程图示风格")
    expect(p2).not.toContain("实景照片风格")
    expect(AI_IMAGE_MODEL).toBe("nano-banana-pro")
    expect(AI_IMAGE_PAGE).toBe("bid-figure")
  })
})

describe("编排 ai 型 schema", () => {
  const idSet = new Set(["n1"])
  it("sanitizeOrchestrationBatch 收 ai 型 + image_style/scene（非法风格归一）", () => {
    const raw = JSON.stringify({
      items: [
        {
          node_id: "n1",
          figure: { needed: true, type: "ai", title: "机房实景", caption: "机房布局", priority: 4, reason: "具象场景", image_style: "realistic_photo", scene: "数据中心机房部署" },
        },
      ],
    })
    const out = sanitizeOrchestrationBatch(raw, idSet)
    expect(out.n1?.figure?.type).toBe("ai")
    expect(out.n1?.figure?.image_style).toBe("realistic_photo")
    expect(out.n1?.figure?.scene).toBe("数据中心机房部署")
    const bad = sanitizeOrchestrationBatch(
      JSON.stringify({ items: [{ node_id: "n1", figure: { needed: true, type: "ai", title: "x", priority: 4, reason: "", image_style: "weird" } }] }),
      idSet,
    )
    expect(bad.n1?.figure?.image_style).toBe("engineering_diagram")
  })

  it("normalizeOrchestration 容错存量 ai 型编排", () => {
    const orch = {
      leaves: { n1: { figure: { needed: true, type: "ai", title: "图", priority: 3, reason: "", selected: true, image_style: "realistic_photo", scene: "机房" } } },
      generated_at: "",
    }
    const norm = normalizeOrchestration(JSON.parse(JSON.stringify(orch)))
    expect(norm?.leaves.n1?.figure?.type).toBe("ai")
    expect(norm?.leaves.n1?.figure?.image_style).toBe("realistic_photo")
    expect(norm?.leaves.n1?.figure?.scene).toBe("机房")
  })

  it("编排提示词条件块：aiImageEnabled 不传时不出现 ai 规则，传入时含风格与 scene 要求", () => {
    const base = buildOrchestrationMessages([{ nodeId: "n1", title: "t", chapter: "c" }], "brief")
    expect(String(base[0].content)).not.toContain('"ai"')
    const ext = buildOrchestrationMessages([{ nodeId: "n1", title: "t", chapter: "c" }], "brief", { aiImageEnabled: true })
    const sys = String(ext[0].content)
    expect(sys).toContain('"ai"')
    expect(sys).toContain("engineering_diagram")
    expect(sys).toContain("realistic_photo")
    expect(sys).toContain("scene")
  })
})

describe("collectAiFigureTargets + applyAiFigureToChapters", () => {
  const outline: OutlineNode[] = [
    {
      id: "ch1",
      title: "数据中心建设",
      part: "tech",
      children: [
        { id: "leaf1", title: "机房工程", children: [] },
        { id: "leaf2", title: "需求分析", children: [] },
      ],
    },
    { id: "ch2", title: "第二章", part: "tech", children: [{ id: "leaf3", title: "运维服务", children: [] }] },
  ]
  const orch: BidOrchestration = {
    leaves: {
      leaf1: { figure: { needed: true, type: "ai", title: "机房布局图", priority: 4, reason: "", selected: true, image_style: "realistic_photo", scene: "机房部署" } },
      leaf2: { figure: { needed: true, type: "architecture", title: "架构图", priority: 4, reason: "", selected: true } },
      leaf3: { figure: { needed: true, type: "ai", title: "运维现场", priority: 3, reason: "", selected: false } },
    },
    generated_at: "",
  }

  it("只收 selected 且 type=ai 的图，并定位顶层章", () => {
    const targets = collectAiFigureTargets(orch, outline)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ nodeId: "leaf1", chapterNodeId: "ch1", title: "机房布局图", style: "realistic_photo", scene: "机房部署" })
    expect(leafTitleOf(outline, "leaf1")).toBe("机房工程")
  })

  const mkChapter = (id: string): Chapter => ({ node_id: id, title: id, sections: [], content: "正文", gen_status: "done", figures: [] })

  it("applyAiFigureToChapters：image 图写回所在章；同名替换；AI 图上限 3 张丢最早", () => {
    const fig: FigureSpec = { type: "image", title: "机房布局图", url: "http://x/1.png" }
    let chapters = [mkChapter("ch1")]
    let byNode = applyAiFigureToChapters(chapters, [{ chapterNodeId: "ch1", figure: fig }])
    expect(byNode.get("ch1")).toHaveLength(1)
    // 同名替换不堆叠
    chapters = [{ ...chapters[0], figures: byNode.get("ch1") }]
    byNode = applyAiFigureToChapters(chapters, [{ chapterNodeId: "ch1", figure: { ...fig, url: "http://x/2.png" } }])
    expect(byNode.get("ch1")).toHaveLength(1)
    expect((byNode.get("ch1")?.[0] as { url: string }).url).toBe("http://x/2.png")
    // AI 图第 4 张挤掉最早一张（非 image 型不受影响）
    let cur = chapters[0]
    for (let i = 2; i <= 5; i++) {
      const next = applyAiFigureToChapters([cur], [{ chapterNodeId: "ch1", figure: { type: "image", title: `图${i}`, url: `http://x/${i}.png` } }])
      cur = { ...cur, figures: next.get("ch1") }
    }
    const images = (cur.figures ?? []).filter((f) => f.type === "image")
    expect(images).toHaveLength(3)
    expect(images.some((f) => f.title === "图2")).toBe(false) // 最早的 图2 被挤出
  })

  it("章不存在时跳过（不抛错）", () => {
    const byNode = applyAiFigureToChapters([mkChapter("ch1")], [{ chapterNodeId: "ghost", figure: { type: "image", title: "x", url: "u" } }])
    expect(byNode.size).toBe(0)
  })
})

describe("mergeLeafOrchestrations 兼容 ai 型", () => {
  it("选中 ai 图正常进 merged.figure（type 透传）", () => {
    const orch: BidOrchestration = {
      leaves: { a: { figure: { needed: true, type: "ai", title: "机房实景", priority: 4, reason: "", selected: true } } },
      generated_at: "",
    }
    const merged = mergeLeafOrchestrations(orch, ["a"])
    expect(merged.figure).toMatchObject({ type: "ai", title: "机房实景" })
  })
})
