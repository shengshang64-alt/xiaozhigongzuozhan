import { describe, expect, it } from "vitest"
import { isBidTechChapter, parseSegmentsFailedMessage, summarizeBidGenFailures } from "./bidGenFailure"
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


const OPENCODE_400 =
  "接口返回异常（HTTP 400）：Request is missing x-opencode-session and cannot be routed efficiently. " +
  "Please see https://opencode.ai/docs/go/#where-can-i-use-it"

describe("R39 解析分段全灭的透出文案（真因不再被吞）", () => {
  it("实测的 OpenCode GO 400 原文要出现在文案里，并给「换模型再逐项重新解析」的下一步", () => {
    const msg = parseSegmentsFailedMessage([OPENCODE_400, "同样的第二句"])
    expect(msg).toContain("x-opencode-session")
    expect(msg).toContain("不接受本次请求")
    expect(msg).toContain("换一路模型")
  })

  it("限流与超时按 R282 归类给对应引导（复用单源，不另立口径）", () => {
    expect(parseSegmentsFailedMessage(["对方接口请求频率超限（HTTP 429），请稍后重试"])).toContain("额度/余额不足")
    expect(parseSegmentsFailedMessage(["上游 504 Gateway Timeout"])).toContain("响应超时")
    expect(parseSegmentsFailedMessage(["LLM 接口 401 unauthorized"])).toContain("API Key")
  })

  it("一条原因都没有时退回原口径，绝不编造原因", () => {
    expect(parseSegmentsFailedMessage([])).toBe("分段解析全部失败，请重试")
    expect(parseSegmentsFailedMessage(["", "   ", undefined])).toBe("分段解析全部失败，请重试")
  })

  it("超长上游原文截到 140 字内，避免整段灌进分区正文", () => {
    const msg = parseSegmentsFailedMessage(["E".repeat(400)])
    expect(msg).toContain("E".repeat(140))
    expect(msg).not.toContain("E".repeat(141))
  })
})
