import { describe, expect, it } from "vitest"
import { isBidTechChapter, summarizeBidGenFailures } from "./bidGenFailure"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

function ch(p: Partial<Chapter> & { node_id: string; title: string }): Chapter {
  return { sections: [], content: "", gen_status: "pending", ...p } as Chapter
}

describe("R301 标书生成失败归因（复用 genFailureSummary · 技术章口径过滤）", () => {
  it("biz 商务骨架章不计入技术章，缺省/tech 计入", () => {
    expect(isBidTechChapter(ch({ node_id: "1", title: "t", part: "tech" }))).toBe(true)
    expect(isBidTechChapter(ch({ node_id: "2", title: "b", part: "biz" }))).toBe(false)
    expect(isBidTechChapter(ch({ node_id: "3", title: "no part" }))).toBe(true)
  })

  it("同归类同逐字原因聚合成一组，最可能根因排第一，占比可读", () => {
    const s = summarizeBidGenFailures([
      ch({ node_id: "a", title: "A", gen_status: "failed", genError: "fetch timeout" }),
      ch({ node_id: "b", title: "B", gen_status: "failed", genError: "fetch timeout" }),
      ch({ node_id: "c", title: "C", gen_status: "failed", genError: "invalid api key" }),
      ch({ node_id: "d", title: "D", gen_status: "done", content: "正文" }),
    ])
    expect(s.failedCount).toBe(3)
    expect(s.causes[0].category).toBe("timeout")
    expect(s.causes[0].count).toBe(2)
    expect(s.dominantRatio).toBe(67)
    expect(s.allSameCause).toBeNull()
  })

  it("biz 章即便 failed 也被过滤，不参与归因", () => {
    const s = summarizeBidGenFailures([
      ch({ node_id: "a", title: "A", part: "biz", gen_status: "failed", genError: "模型返回空正文" }),
      ch({ node_id: "b", title: "B", gen_status: "failed", genError: "余额不足 无法调用" }),
    ])
    expect(s.failedCount).toBe(1)
    expect(s.causes[0].category).toBe("quota")
  })

  it("全部失败章同一归类时给出单因主导与 100% 占比", () => {
    const s = summarizeBidGenFailures([
      ch({ node_id: "a", title: "A", gen_status: "failed", genError: "模型返回空正文" }),
      ch({ node_id: "b", title: "B", gen_status: "failed", genError: "模型返回空正文" }),
    ])
    expect(s.allSameCause).toBe("blank")
    expect(s.dominantRatio).toBe(100)
  })

  it("空 / undefined 输入返回零失败，不抛错", () => {
    expect(summarizeBidGenFailures(undefined).failedCount).toBe(0)
    expect(summarizeBidGenFailures([]).causes).toEqual([])
  })
})
