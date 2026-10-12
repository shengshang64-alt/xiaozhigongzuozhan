import { describe, expect, it } from "vitest"
import { applyMustWrite, judgeMustWrite } from "./bidMustWrite"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const CTX = { techScoringNames: ["售后服务方案", "技术培训方案", "总体设计方案", "技术参数"] }

function node(title: string, part?: "biz" | "tech", description?: string): OutlineNode {
  return { id: title, title, children: [], part, description }
}

describe("R-020 商务/技术按评分办法判定 + mustWrite 解耦", () => {
  it("①评分办法含该技术评分项 → 必写 tech", () => {
    const r = judgeMustWrite(node("售后服务"), CTX)
    expect(r.mustWrite).toBe(true)
    expect(r.verdict).toBe("tech")
    expect(r.reason).toContain("评分办法")
  })

  it("被误标 biz 但命中必写强信号 → applyMustWrite 回收（rescued）", () => {
    const { nodes, rescued } = applyMustWrite(
      [node("技术参数响应表", "biz"), node("投标函", "biz"), node("售后服务方案", "biz")],
      CTX,
    )
    expect(nodes[0].mustWrite).toBe(true) // 技术参数命中评分项 + 技术关键词
    expect(nodes[2].mustWrite).toBe(true) // 评分办法命中
    expect(nodes[1].mustWrite).toBe(false) // 投标函商务骨架
    expect(rescued.map((x) => x.title)).toEqual(["技术参数响应表", "售后服务方案"])
  })

  it("④★▲实质性条款 → 必写", () => {
    const r = judgeMustWrite(node("★实质性要求响应", "tech"), CTX)
    expect(r.mustWrite).toBe(true)
  })

  it("⑥要求性表述兜底（非商务专属）→ mustWrite + uncertain", () => {
    const r = judgeMustWrite(node("其他配套要求", "tech", "投标人须提供完整说明"), CTX)
    expect(r.mustWrite).toBe(true)
    expect(r.verdict).toBe("uncertain")
  })

  it("商务骨架（资质/业绩/承诺）无技术信号 → 不必写 biz", () => {
    expect(judgeMustWrite(node("企业资质与业绩", "biz"), CTX).mustWrite).toBe(false)
    expect(judgeMustWrite(node("商务条款承诺函", "biz"), CTX).verdict).toBe("biz")
  })

  it("缺省无强信号：标书页无 part 按 tech 兼容但不强制必写", () => {
    const r = judgeMustWrite(node("封面"), CTX)
    expect(r.mustWrite).toBe(false)
    expect(r.verdict).toBe("tech")
  })

  it("②R-017 必备清单命中（非商务专属）→ 必写 tech", () => {
    const r = judgeMustWrite(node("数据治理与共享", "tech"), { ...CTX, requiredKeywords: ["数据治理"] })
    expect(r.mustWrite).toBe(true)
    expect(r.verdict).toBe("tech")
    expect(r.reason).toContain("必备技术内容清单")
  })

  it("②R-017 必备清单命中但属商务专属词 → 不覆盖商务判定（bizHit 优先）", () => {
    const r = judgeMustWrite(node("商务条款", "biz"), { ...CTX, requiredKeywords: ["商务条款"] })
    expect(r.mustWrite).toBe(false)
    expect(r.verdict).toBe("biz")
  })
})
