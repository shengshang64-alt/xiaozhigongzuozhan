import { describe, expect, it } from "vitest"
import { selectOrchestrationFigures, type LeafOrchestration, type OrchestrationFigureType } from "./bidTypes"

/** 2026-10-07 高配图需求模式：上限 ≥20 时邻接同类型保留（数量承诺优先），默认口径无替代仍弃选 */
function mkLeaves(types: OrchestrationFigureType[]): { leafOrder: string[]; leaves: Record<string, LeafOrchestration> } {
  const leafOrder: string[] = []
  const leaves: Record<string, LeafOrchestration> = {}
  types.forEach((type, i) => {
    const id = `leaf-${i}`
    leafOrder.push(id)
    leaves[id] = {
      figure: { needed: true, type, title: `图${i}`, priority: 3, reason: "t", selected: false },
    }
  })
  return { leafOrder, leaves }
}

describe("selectOrchestrationFigures 邻接同类型策略", () => {
  it("默认口径：相邻同类型且无替代时弃选", () => {
    const { leafOrder, leaves } = mkLeaves(["architecture", "architecture", "architecture"])
    const n = selectOrchestrationFigures(leafOrder, leaves, 6)
    expect(n).toBe(1)
  })

  it("高配图模式（上限≥20）：相邻同类型保留，候选全收", () => {
    const { leafOrder, leaves } = mkLeaves(["architecture", "architecture", "architecture"])
    const n = selectOrchestrationFigures(leafOrder, leaves, 40)
    expect(n).toBe(3)
  })

  it("高配图模式下候选超过上限时仍按上限截断", () => {
    const { leafOrder, leaves } = mkLeaves(Array.from({ length: 10 }, (_, i) => (i % 2 ? "flow" : "architecture") as OrchestrationFigureType))
    const n = selectOrchestrationFigures(leafOrder, leaves, 4)
    expect(n).toBe(4)
  })

  it("默认口径：候选数 ≤ 上限时类型不同则全选（既有行为回归）", () => {
    const { leafOrder, leaves } = mkLeaves(["architecture", "flow", "demo"])
    const n = selectOrchestrationFigures(leafOrder, leaves, 6)
    expect(n).toBe(3)
  })
})
