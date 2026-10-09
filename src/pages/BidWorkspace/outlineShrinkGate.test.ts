// Q28 切片D：大纲整树重写防缩水闸门
import { describe, expect, it } from "vitest"
import { acceptRewrittenOutline, techOutlineLeafCount } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const leaf = (id: string, title: string): OutlineNode => ({ id, title, children: [] })
const chapter = (id: string, title: string, kids: OutlineNode[], part?: "biz"): OutlineNode =>
  part ? { id, title, part, children: kids } : { id, title, children: kids }

/** 造 n 个技术章、每章 m 个叶子 */
function tree(chapters: number, perChapter: number): OutlineNode[] {
  const out: OutlineNode[] = []
  for (let c = 0; c < chapters; c++) {
    const kids: OutlineNode[] = []
    for (let s = 0; s < perChapter; s++) kids.push(leaf(`c${c}s${s}`, `第${c}章小节${s}`))
    out.push(chapter(`c${c}`, `第${c}章`, kids))
  }
  return out
}

describe("techOutlineLeafCount / acceptRewrittenOutline（整树重写防缩水）", () => {
  it("只数技术章叶子：商务骨架章及其子树不计入", () => {
    const nodes: OutlineNode[] = [
      chapter("c0", "总体设计方案", [leaf("a", "需求分析"), leaf("b", "架构设计")]),
      chapter("biz", "投标函", [leaf("z1", "投标函附录"), leaf("z2", "资质清单")], "biz"),
    ]
    expect(techOutlineLeafCount(nodes)).toBe(2)
  })

  it("截断残缺树（70 叶 → 1 章 5 叶）被拒绝采纳", () => {
    const prev = tree(9, 8) // 72 叶
    const truncated = [chapter("c0", "项目理解与现状需求分析", [leaf("x1", "背景"), leaf("x2", "现状"), leaf("x3", "需求分解")])]
    expect(techOutlineLeafCount(prev)).toBe(72)
    expect(acceptRewrittenOutline(prev, truncated)).toBe(false)
  })

  it("空结果一律拒绝；等量或增量重写放行", () => {
    const prev = tree(9, 8)
    expect(acceptRewrittenOutline(prev, [])).toBe(false)
    expect(acceptRewrittenOutline(prev, tree(9, 8))).toBe(true)
    expect(acceptRewrittenOutline(prev, tree(10, 8))).toBe(true)
  })

  it("20% 以内的正常重构容差放行（合并小节等）", () => {
    const prev = tree(10, 5) // 50 叶，阈值 ceil(50*0.8)=40
    expect(acceptRewrittenOutline(prev, tree(8, 5))).toBe(true) // 40 叶
    expect(acceptRewrittenOutline(prev, tree(7, 5))).toBe(false) // 35 叶
  })

  it("原树无技术叶（首次修复/存量残缺）不设阻，交给后续非空判断", () => {
    const prev: OutlineNode[] = [chapter("biz", "投标函", [leaf("z", "附录")], "biz")]
    expect(acceptRewrittenOutline(prev, [chapter("c0", "总体设计", [leaf("a", "架构")])])).toBe(true)
  })
})
