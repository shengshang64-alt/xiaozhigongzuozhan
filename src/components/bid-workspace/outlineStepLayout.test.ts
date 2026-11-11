// ③ 大纲编制 三栏结构守卫（UX-v2：prototype/bid/outline.html）
//
// 钉住三件事，防止后续回退成「两栏 + 中栏缺失」的塌陷布局：
//   ① 三栏齐全：左大纲树 / 中章节编辑 / 右评分点覆盖；
//   ② 中栏是真表单（标题可改 / 字数预算 / 评分点关联 / 子节清单），不是占位；
//   ③ 评分点关联读节点真标注（[响应:Rx]），字数预算读 chapterBudgets，不写演示值。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

const COMPOSE = readSrc("./ComposeStep.tsx")
const EDITOR = readSrc("./OutlineNodeEditor.tsx")
const TREE = readSrc("../solution-studio/OutlineTreeEditor.tsx")

describe("① 三栏齐全（原型 split--3col）", () => {
  it("网格是三栏：300px 左树 / 中主区 / 340px 右栏", () => {
    expect(COMPOSE).toContain("xl:grid-cols-[300px_minmax(0,1fr)_340px]")
  })

  it("中栏挂章节编辑 + 编号与层级，右栏挂评分点覆盖", () => {
    expect(COMPOSE).toContain("<OutlineNodeEditor")
    expect(COMPOSE).toContain("编号与层级")
    expect(COMPOSE).toContain("<ScoreCoverageRail")
    // 顺序：编辑器在评分点覆盖之前（左→中→右）
    expect(COMPOSE.indexOf("<OutlineNodeEditor")).toBeLessThan(COMPOSE.indexOf("<ScoreCoverageRail"))
  })
})

describe("② 中栏是真表单（不是占位）", () => {
  it("含章节标题输入 / 层级 / 字数预算 / 是否必写 / 关联评分点 / 子节清单", () => {
    for (const part of ["章节标题", "层级", "字数预算", "是否必写", "关联评分点", "子节"]) {
      expect(EDITOR.includes(part), `中栏缺字段：${part}`).toBe(true)
    }
  })

  it("标题改动接既有 onRename（即时生效，不另起写库通道）", () => {
    expect(EDITOR).toContain("onRename(node.id")
  })

  it("未选中节点时给空态而非空白页", () => {
    expect(EDITOR).toContain("在左侧大纲树里点选一章或一节")
  })
})

describe("③ 接真数据，不写演示值", () => {
  it("评分点关联读节点 description 的 [响应:Rx] 真标注", () => {
    expect(EDITOR).toContain("响应|Response")
    expect(EDITOR).toContain("responseCodesOf")
  })

  it("字数预算来自 chapterBudgets（不是硬编码演示数字）", () => {
    expect(COMPOSE).toContain("p.chapterBudgets[")
  })

  it("中栏不含原型演示值", () => {
    for (const fake of ["8,000", "2,600", "2,700", "缺 2", "缺 1"]) {
      expect(EDITOR.includes(fake), `中栏出现演示值：${fake}`).toBe(false)
    }
  })

  it("左树支持点选（未传 onSelect 时保持原行为）", () => {
    expect(TREE).toContain("selectedId")
    expect(TREE).toContain("onSelect")
  })
})
