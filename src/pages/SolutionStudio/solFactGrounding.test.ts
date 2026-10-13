// R-033 方案事实 grounding 单测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import type { Chapter } from "./solutionTypes"
import { detectUngroundedNumbers, groundingSummary } from "./solFactGrounding"

const ch = (node_id: string, title: string, content: string): Chapter =>
  ({ node_id, title, sections: [], content, gen_status: "done" }) as Chapter

describe("R-033 detectUngroundedNumbers", () => {
  it("数值在 source 中存在→不报", () => {
    const chapters = [ch("c1", "概述", "系统可用性达到99.5%，支持15000人次")]
    const sources = ["招标要求可用性99.5%，日均门诊15000人次以上"]
    expect(detectUngroundedNumbers(chapters, sources)).toHaveLength(0)
  })
  it("数值在 source 中不存在→报 ungrounded", () => {
    const chapters = [ch("c1", "概述", "承诺可用性99.99%")]
    const sources = ["招标要求可用性99.5%"]
    const r = detectUngroundedNumbers(chapters, sources)
    expect(r).toHaveLength(1)
    expect(r[0].value).toContain("99.99")
    expect(r[0].kind).toBe("percentage")
  })
  it("无 source 文本→不报（防误伤）", () => {
    const chapters = [ch("c1", "概述", "投入100台服务器")]
    expect(detectUngroundedNumbers(chapters, [])).toHaveLength(0)
  })
})

describe("R-033 groundingSummary", () => {
  it("全 grounded→ratio=1", () => {
    const chapters = [ch("c1", "A", "99.5% 可用性")]
    const summary = groundingSummary(chapters, ["99.5%"])
    expect(summary.ratio).toBe(1)
    expect(summary.ungrounded).toHaveLength(0)
  })
})
