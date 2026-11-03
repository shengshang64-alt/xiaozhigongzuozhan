import { describe, expect, it } from "vitest"
import { buildDefenseHandbookBlocks, handbookFileName, type HandbookBlock } from "./defenseHandbook"
import { emptyBidDefense, type BidDefense, type DefenseQuestion } from "./bidTypes"

function textOf(blocks: HandbookBlock[], kind: HandbookBlock["kind"]): string[] {
  return blocks.filter((b) => b.kind === kind).map((b) => b.text)
}

function question(over: Partial<DefenseQuestion> = {}): DefenseQuestion {
  return {
    id: over.id ?? "q1",
    question: over.question ?? "系统如何保障数据安全？",
    intent: over.intent ?? "",
    answer_points: over.answer_points ?? [],
    ref_chapters: over.ref_chapters ?? [],
    full_answer: over.full_answer ?? "",
    edited: over.edited ?? false,
  }
}

function defenseWith(over: Partial<BidDefense> = {}): BidDefense {
  return { ...emptyBidDefense(), ...over }
}

describe("buildDefenseHandbookBlocks", () => {
  it("三块全空时抛友好提示（不产生半成品手册）", () => {
    expect(() => buildDefenseHandbookBlocks("某医院项目", defenseWith())).toThrow(/尚未生成讲标答辩内容/)
  })

  it("speech_notes 存在但全为空白也算空内容", () => {
    const emptySpeech = { opening: "  ", closing: "", sections: [] }
    expect(() => buildDefenseHandbookBlocks("x", defenseWith({ speech_notes: emptySpeech }))).toThrow(/尚未生成/)
  })

  it("问题池章：题号顺序与章节编号", () => {
    const blocks = buildDefenseHandbookBlocks(
      "X医院项目",
      defenseWith({ questions: [question(), question({ id: "q2", question: "实施周期如何保证？" })] }),
    )
    expect(textOf(blocks, "title")[0]).toBe("X医院项目 · 讲标答辩手册")
    expect(textOf(blocks, "heading")).toContain("一、专家问题池")
    expect(textOf(blocks, "subheading")).toEqual(["问题 1 · 系统如何保障数据安全？", "问题 2 · 实施周期如何保证？"])
  })

  it("考察点/可引用章节/答辩要点按有无渲染", () => {
    const blocks = buildDefenseHandbookBlocks(
      "",
      defenseWith({
        questions: [question({ intent: "考察安全合规", ref_chapters: ["安全章", "实施章"], answer_points: ["等保三级", "国产加密"] })],
      }),
    )
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain("考察点：考察安全合规")
    expect(texts).toContain("可引用章节：安全章、实施章")
    expect(textOf(blocks, "bullet")).toEqual(["等保三级", "国产加密"])
  })

  it("无考察点时不产出空行", () => {
    const blocks = buildDefenseHandbookBlocks("", defenseWith({ questions: [question()] }))
    expect(blocks.some((b) => b.text.startsWith("考察点："))).toBe(false)
    expect(blocks.some((b) => b.text.startsWith("可引用章节："))).toBe(false)
  })

  it("完整答案按行拆分并去空白行；未备答案给占位提示", () => {
    const blocks = buildDefenseHandbookBlocks(
      "",
      defenseWith({
        questions: [
          question({ full_answer: "第一句。\n\n  第二句。  \n" }),
          question({ id: "q2", full_answer: "   " }),
        ],
      }),
    )
    const texts = blocks.map((b) => b.text)
    expect(texts).toContain("第一句。")
    expect(texts).toContain("第二句。")
    expect(texts).toContain("（尚未准备完整答案，现场请结合答辩要点谨慎应答）")
  })

  it("待备答案自查章：只点名未答题号，全备时整章消失", () => {
    const partial = buildDefenseHandbookBlocks(
      "",
      defenseWith({ questions: [question({ full_answer: "已备" }), question({ id: "q2" })] }),
    )
    expect(textOf(partial, "heading")).toContain("二、待备答案自查")
    expect(partial.map((b) => b.text).join("\n")).toContain("尚未准备完整答案：问题 2。")
    const full = buildDefenseHandbookBlocks(
      "",
      defenseWith({ questions: [question({ full_answer: "已备" }), question({ id: "q2", full_answer: "已备" })] }),
    )
    expect(textOf(full, "heading")).not.toContain("二、待备答案自查")
  })

  it("章节动态编号：仅大纲时大纲就是第一章", () => {
    const blocks = buildDefenseHandbookBlocks(
      "",
      defenseWith({ defense_outline: [{ page_title: "项目理解", bullets: ["痛点", "目标"] }] }),
    )
    expect(textOf(blocks, "heading")).toEqual(["一、讲标大纲"])
    expect(textOf(blocks, "subheading")).toEqual(["第 1 页 · 项目理解"])
    expect(textOf(blocks, "bullet")).toEqual(["痛点", "目标"])
  })

  it("讲标稿：开场白/每页要点/收尾按序产出", () => {
    const blocks = buildDefenseHandbookBlocks(
      "",
      defenseWith({
        speech_notes: {
          opening: "各位领导好。",
          sections: [{ title: "总体方案", points: ["先讲架构", "再讲亮点"] }, { title: "", points: ["兜底页名"] }],
          closing: "谢谢大家。",
        },
      }),
    )
    expect(textOf(blocks, "heading")).toEqual(["一、讲标稿要点"])
    const subs = textOf(blocks, "subheading")
    expect(subs).toEqual(["开场白", "总体方案", "第 2 页", "收尾"])
    expect(textOf(blocks, "bullet")).toEqual(["先讲架构", "再讲亮点", "兜底页名"])
  })

  it("meta 行汇总题数与已备答案数", () => {
    const blocks = buildDefenseHandbookBlocks(
      "",
      defenseWith({
        questions: [question({ full_answer: "已备" }), question({ id: "q2" })],
        defense_outline: [{ page_title: "a", bullets: [] }, { page_title: "b", bullets: [] }],
      }),
    )
    const meta = textOf(blocks, "meta")[0]
    expect(meta).toContain("问题 2 个（已备答案 1）")
    expect(meta).toContain("讲标大纲 2 页")
  })
})

describe("handbookFileName", () => {
  it("清洗非法字符并固定 .docx 后缀", () => {
    const name = handbookFileName("市一院/数据:平台", "2026-10-03")
    expect(name.endsWith(".docx")).toBe(true)
    expect(name).toContain("讲标答辩手册-2026-10-03")
    expect(name).not.toContain("/")
    expect(name).not.toContain(":")
  })

  it("空项目名兜底为投标项目", () => {
    expect(handbookFileName("   ", "2026-10-03")).toBe("投标项目-讲标答辩手册-2026-10-03.docx")
  })
})
