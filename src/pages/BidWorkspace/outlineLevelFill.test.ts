import { describe, expect, it } from "vitest"
import {
  outlineMaxDepth,
  techChaptersMissingChildren,
  trimOutlineDepth,
  validateOutlineShape,
} from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// 层级补齐（本轮修复）：层级设 2/3 时「只有大章、没有小节」必须被判为未完成并被补齐。
// 起因（实测）：「安中医项目」生成时落了 10 章 / 深度 1 的扁平大纲，层级设置却是 3 级，
// 用户只看到一条容易被忽略的提示，于是以为"小章节丢了"。
// 本文件锁死两件事：① 补齐的挑选用什么口径；② 层级校验确实会把扁平树判为不符。

function node(title: string, children: OutlineNode[] = []): OutlineNode {
  return { id: `n-${title}`, title, children }
}

function bizNode(title: string, children: OutlineNode[] = []): OutlineNode {
  return { ...node(title, children), part: "biz" }
}

describe("techChaptersMissingChildren（层级补齐的挑选口径）", () => {
  it("扁平树：所有技术章都算未完成", () => {
    const flat = [node("第1章", []), node("第2章", []), node("第3章", [])]
    expect(techChaptersMissingChildren(flat).map((n) => n.title)).toEqual(["第1章", "第2章", "第3章"])
  })

  it("已有小节的章不再挑出来（避免覆盖已生成/已编辑内容）", () => {
    const mixed = [node("第1章", [node("1.1", [])]), node("第2章", []), node("第3章", [node("3.1", [node("3.1.1", [])])])]
    expect(techChaptersMissingChildren(mixed).map((n) => n.title)).toEqual(["第2章"])
  })

  it("商务骨架章不计入（它们本就只有一级小节）", () => {
    const tree = [node("第1章", []), bizNode("投标函", []), bizNode("开标一览表", [])]
    expect(techChaptersMissingChildren(tree).map((n) => n.title)).toEqual(["第1章"])
  })

  it("空树/全商务树都不挑", () => {
    expect(techChaptersMissingChildren([])).toEqual([])
    expect(techChaptersMissingChildren([bizNode("投标函", [])])).toEqual([])
  })
})

describe("validateOutlineShape 对层级的判定（补齐之后的兜底门禁）", () => {
  it("三级目录下扁平树被判不符（级数 + 章缺节）", () => {
    const flat = [node("第1章", []), node("第2章", [])]
    const issues = validateOutlineShape(flat, 3, 0)
    expect(issues.join("；")).toContain("级数应为 3 级")
    expect(issues.join("；")).toContain("每个技术章都必须有节")
  })

  it("三级目录下每章有节、每节有条才通过", () => {
    const ok = [node("第1章", [node("1.1", [node("1.1.1", [])])]), node("第2章", [node("2.1", [node("2.1.1", [])])])]
    expect(validateOutlineShape(ok, 3, 0)).toEqual([])
  })

  it("章节齐但节下无条仍被判不符", () => {
    const shallow = [node("第1章", [node("1.1", [])])]
    expect(validateOutlineShape(shallow, 3, 0).join("；")).toContain("每个节都必须有至少 1 个条级节点")
  })

  it("二级目录：章下有节即通过（不要求三级）", () => {
    const two = [node("第1章", [node("1.1", [])]), node("第2章", [node("2.1", [])])]
    expect(validateOutlineShape(two, 2, 0)).toEqual([])
  })

  it("层级=0（自动）时不校验级数，只按叶子规模", () => {
    const flat = [node("第1章", []), node("第2章", [])]
    expect(validateOutlineShape(flat, 0, 0)).toEqual([])
    expect(validateOutlineShape(flat, 0, 100).join("；")).toContain("偏离目标规模")
  })
})

describe("层级补齐后的深度与裁剪口径", () => {
  it("补齐到三级后深度为 3；trimOutlineDepth 按设定级数裁到对应深度", () => {
    const filled = [node("第1章", [node("1.1", [node("1.1.1", [])])])]
    expect(outlineMaxDepth(filled)).toBe(3)
    expect(outlineMaxDepth(trimOutlineDepth(filled, 3))).toBe(3)
    expect(outlineMaxDepth(trimOutlineDepth(filled, 2))).toBe(2)
    expect(outlineMaxDepth(trimOutlineDepth(filled, 1))).toBe(1)
  })
})
