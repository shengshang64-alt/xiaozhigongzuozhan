import { describe, expect, it } from "vitest"
import { buildBidChapterMessages, buildBidOutlineMessages, buildBidSectionMessages } from "../bidTypes"

// R47（B20）商务模板自动识别 · 提示词消费侧回归：
// ① 未上传模板（不传 / 空数组）时输出必须与旧版逐字一致——存量项目的 prompt 与前缀缓存不受影响；
// ② 上传模板识别出要求行后，大纲 / 章级 / 小节级三条链路都要把要求带进 prompt。

const outlineNodes = [{ id: "n1", title: "第一章 技术方案", children: [], part: "tech" }]
const chapters = [
  { title: "第一章 技术方案", node_id: "n1", sections: ["1.1 总体架构"], gen_status: "done", content: "……" },
]
const toText = (nodes: { title: string }[] | undefined) => (nodes ?? []).map((n) => n.title).join("\n")

const REQS = ["须包含项目实施方案章节与进度计划", "应列明售后服务响应时限与备件供应方式"]

function textOf(msgs: unknown): string {
  return (msgs as { role: string; content: string }[]).map((m) => m.content).join("\n")
}

function outline(reqs?: string[]) {
  return buildBidOutlineMessages("医院一体化核心业务系统", "安徽中医药大学第一附属医院", null, false, 2, undefined, {
    globalFacts: "【全局事实】本项目工期：90 天",
    ...(reqs ? { templateRequirements: reqs } : {}),
  })
}

function chapter(reqs?: string[]) {
  return buildBidChapterMessages(
    "医院一体化核心业务系统",
    "安徽中医药大学第一附属医院",
    null,
    outlineNodes as never,
    chapters as never,
    0,
    toText as never,
    {
      globalFacts: "【全局事实】本项目工期：90 天",
      wordBudget: 2000,
      figures: false,
      ...(reqs ? { templateRequirements: reqs } : {}),
    } as never,
  )
}

function section(reqs?: string[]) {
  return buildBidSectionMessages(
    "医院一体化核心业务系统",
    "安徽中医药大学第一附属医院",
    null,
    outlineNodes as never,
    chapters as never,
    0,
    toText as never,
    {
      globalFacts: "【全局事实】本项目工期：90 天",
      wordBudget: 1500,
      figures: false,
      sectionName: "1.1 总体架构",
      sectionNo: "1.1",
      sectionIndex: 0,
      sectionCount: 1,
      ...(reqs ? { templateRequirements: reqs } : {}),
    } as never,
  )
}

describe("R47（B20）商务模板要求注入提示词", () => {
  it("未上传模板：不传 / 空数组输出逐字一致，且不出现模板要求块", () => {
    for (const build of [outline, chapter, section]) {
      const absent = textOf(build())
      const empty = textOf(build([]))
      expect(empty).toBe(absent)
      expect(absent).not.toContain("商务模板要求")
    }
  })

  it("大纲 builder：注入硬约束条 + 稳定块里的逐条要求行", () => {
    const text = textOf(outline(REQS))
    expect(text).toContain("【商务模板要求】共 2 条")
    expect(text).toContain("【商务模板要求（商务同事提供模板里明写的要求，大纲逐条须有章节落点）】")
    expect(text).toContain("1. 须包含项目实施方案章节与进度计划")
    expect(text).toContain("2. 应列明售后服务响应时限与备件供应方式")
  })

  it("章级 builder：注入规则条与稳定块里的逐条要求行", () => {
    const text = textOf(chapter(REQS))
    expect(text).toContain("下面【商务模板要求】共 2 条")
    expect(text).toContain("【商务模板要求（商务同事提供模板里明写的要求，涉及即须满足）】")
    expect(text).toContain("1. 须包含项目实施方案章节与进度计划")
  })

  it("小节级 builder：注入规则条与稳定块里的逐条要求行", () => {
    const text = textOf(section(REQS))
    expect(text).toContain("下面【商务模板要求】共 2 条")
    expect(text).toContain("【商务模板要求（商务同事提供模板里明写的要求，涉及即须满足）】")
    expect(text).toContain("1. 须包含项目实施方案章节与进度计划")
  })

  it("注入上限 20 条：超出的要求行被裁掉", () => {
    const many = Array.from({ length: 25 }, (_, i) => `要求 ${i + 1}`)
    const text = textOf(outline(many))
    expect(text).toContain("共 20 条")
    expect(text).toContain("20. 要求 20")
    expect(text).not.toContain("21. 要求 21")
  })
})
