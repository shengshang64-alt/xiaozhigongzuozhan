import { describe, expect, it } from "vitest"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import {
  DEMO_OFFLINE_HINT,
  findDemoScoreNodes,
  isDemoScoreTitle,
  summarizeDemoNodes,
} from "./demoSection"

describe("R-019/R-024 演示分节点治理（纯本地）", () => {
  it("isDemoScoreTitle：演示 / 答辩 / 讲标 / 演示视频命中", () => {
    expect(isDemoScoreTitle("功能演示一")).toBe(true)
    expect(isDemoScoreTitle("现场答辩")).toBe(true)
    expect(isDemoScoreTitle("讲标与演示")).toBe(true)
    expect(isDemoScoreTitle("演示视频")).toBe(true)
    expect(isDemoScoreTitle("视频讲解")).toBe(true)
  })

  it("isDemoScoreTitle：真实技术章不误判（视频监控 / 会议等）、空值兜底", () => {
    expect(isDemoScoreTitle("视频监控系统集成方案")).toBe(false)
    expect(isDemoScoreTitle("视频会议系统")).toBe(false)
    expect(isDemoScoreTitle("系统总体设计")).toBe(false)
    expect(isDemoScoreTitle("")).toBe(false)
    expect(isDemoScoreTitle(null)).toBe(false)
  })

  it("findDemoScoreNodes：只收技术顶层章，跳过商务骨架", () => {
    const nodes = [
      { id: "a", title: "功能演示一", part: "tech" },
      { id: "b", title: "投标函", part: "biz" },
      { id: "c", title: "现场演示二", part: "tech" },
      { id: "d", title: "系统架构", part: "tech" },
    ] as unknown as OutlineNode[]
    expect(findDemoScoreNodes(nodes).map((f) => f.id)).toEqual(["a", "c"])
    expect(findDemoScoreNodes(null)).toEqual([])
  })

  it("summarizeDemoNodes：hasDemo / count / titles", () => {
    const s = summarizeDemoNodes([{ id: "a", title: "答辩", part: "tech" }] as unknown as OutlineNode[])
    expect(s.hasDemo).toBe(true)
    expect(s.count).toBe(1)
    expect(s.titles).toEqual(["答辩"])
    expect(summarizeDemoNodes([]).hasDemo).toBe(false)
  })

  it("线下准备提示语非空且含演示", () => {
    expect(DEMO_OFFLINE_HINT.length).toBeGreaterThan(10)
    expect(DEMO_OFFLINE_HINT).toContain("演示")
  })
})

// 2026-10-23（用户口径：演示不该出现在技术方案大纲里，演示只要准备好就行）
import { stripDemoNodes } from "./demoSection"

describe("stripDemoNodes：演示/答辩节点从大纲剔除", () => {
  it("去掉演示类顶层章，保留普通技术章与商务章", () => {
    const nodes = [
      { id: "1", title: "可视化业务流程编排演示", children: [] },
      { id: "2", title: "总体技术解决方案", children: [] },
      { id: "3", title: "投标函", children: [], part: "biz" as const },
      { id: "4", title: "包01 演示2", children: [] },
    ]
    const r = stripDemoNodes(nodes)
    expect(r.removed).toEqual(["可视化业务流程编排演示", "包01 演示2"])
    expect(r.nodes.map((n) => n.title)).toEqual(["总体技术解决方案", "投标函"])
  })

  it("没有演示节点时原样返回", () => {
    const nodes = [{ id: "1", title: "总体技术解决方案", children: [] }]
    expect(stripDemoNodes(nodes).removed).toEqual([])
    expect(stripDemoNodes(null).nodes).toEqual([])
  })
})
