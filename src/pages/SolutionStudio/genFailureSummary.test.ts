import { describe, expect, it } from "vitest"
import {
  GEN_FAILURE_CATEGORY_LABEL,
  LEGACY_GEN_ERROR_NOTE,
  buildGenFailureText,
  classifyGenFailure,
  normalizeGenError,
  summarizeGenFailures,
} from "./genFailureSummary"
import { BLANK_OUTPUT_REASON } from "./genFailureNote"
import type { Chapter } from "./solutionTypes"

// ---------------------------------------------------------------------------
// R282 生成失败归因（闭合 r280-generror-visibility 挂账 · delivery-p0-02 根因定位环）：
// ① 归类判得准（超时/通道/额度/空产出/网络/解析），认不出的老实归 other；
// ② 同一原因的多章聚到一组，不同原因不得混组（否则聚合结论是假的）；
// ③ 只统计 failed 章、旧记录走兜底口径、点名数量有上限（防整本大失败撑爆卡片）。
// ---------------------------------------------------------------------------

function ch(over: Partial<Chapter> = {}): Chapter {
  return { node_id: "n1", title: "章节", sections: [], content: "", gen_status: "done", ...over } as Chapter
}

function failed(reason: string | undefined, title: string, node_id = "n"): Chapter {
  return ch({ node_id, title, gen_status: "failed", genError: reason, content: "" })
}

describe("classifyGenFailure 归类判定", () => {
  it("典型原因各归其对（模型通道/超时/额度/空产出）", () => {
    expect(classifyGenFailure("fetch timeout after 120000ms")).toBe("timeout")
    expect(classifyGenFailure("请求超时")).toBe("timeout")
    expect(classifyGenFailure("模型通道 503 Service Unavailable")).toBe("channel")
    expect(classifyGenFailure("LLM 接口 401 unauthorized")).toBe("channel")
    expect(classifyGenFailure("insufficient quota, 请充值")).toBe("quota")
    expect(classifyGenFailure("调用次数超限 429")).toBe("quota")
    expect(classifyGenFailure(BLANK_OUTPUT_REASON)).toBe("blank")
    expect(classifyGenFailure("重试后仍空产出")).toBe("blank")
    expect(classifyGenFailure("模型返回空正文")).toBe("blank")
  })

  it("超时优先于通道：一句话里同时出现 timeout 与 504 时归超时", () => {
    expect(classifyGenFailure("上游 504 Gateway Timeout")).toBe("timeout")
  })

  it("空原因与旧记录未留痕一律归 blank（无原因可读，不硬猜通道）", () => {
    expect(classifyGenFailure("")).toBe("blank")
    expect(classifyGenFailure(undefined)).toBe("blank")
    expect(classifyGenFailure(null)).toBe("blank")
  })

  it("认不出的异常不硬塞类别，归 other 交人看原文", () => {
    expect(classifyGenFailure("用户取消了操作")).toBe("other")
    expect(classifyGenFailure("Error: something odd")).toBe("other")
  })

  it("网络与解析类各有明确去处，不与管理类混为一谈", () => {
    expect(classifyGenFailure("Failed to fetch")).toBe("network")
    expect(classifyGenFailure("ECONNREFUSED 127.0.0.1")).toBe("network")
    expect(classifyGenFailure("大纲格式解析失败，请重试")).toBe("parse")
  })
})

describe("normalizeGenError", () => {
  it("折叠换行与多余空白，避免同一原因被拆成多组", () => {
    expect(normalizeGenError("请求超时\r\n  请重试 ")).toBe("请求超时 请重试")
    expect(normalizeGenError(undefined)).toBe("")
  })
})

describe("summarizeGenFailures 聚合", () => {
  it("同一原因的多章聚到一组，并点名到章", () => {
    const s = summarizeGenFailures([
      failed("模型通道 503", "总体设计", "a"),
      failed("模型通道 503", "实施方案", "b"),
      ch({ node_id: "c", title: "已完成章", gen_status: "done", content: "正文", genError: "" }),
    ])
    expect(s.failedCount).toBe(2)
    expect(s.causes).toHaveLength(1)
    expect(s.causes[0].label).toBe(GEN_FAILURE_CATEGORY_LABEL.channel)
    expect(s.causes[0].count).toBe(2)
    expect(s.causes[0].chapters.map((c) => c.title)).toEqual(["总体设计", "实施方案"])
    expect(s.allSameCause).toBe("channel")
    expect(s.dominantRatio).toBe(100)
  })

  it("不同原因分属不同组，章数多的组排在前（最可能的根因优先）", () => {
    const s = summarizeGenFailures([
      failed("fetch timeout", "A", "a"),
      failed("fetch timeout", "B", "b"),
      failed("模型通道 401", "C", "c"),
    ])
    expect(s.failedCount).toBe(3)
    expect(s.causes[0].category).toBe("timeout")
    expect(s.causes[0].count).toBe(2)
    expect(s.causes[1].count).toBe(1)
    expect(s.dominantRatio).toBe(67)
    expect(s.allSameCause).toBe(null)
  })

  it("旧记录无原因走兜底口径，与大纲树 tooltip 同一句", () => {
    const s = summarizeGenFailures([failed(undefined, "培训方案", "a")])
    expect(s.causes[0].detail).toBe(LEGACY_GEN_ERROR_NOTE)
    expect(s.causes[0].category).toBe("blank")
    expect(s.dominantRatio).toBe(0)
  })

  it("非失败章不参与归因，pending/generating 不算失败", () => {
    const s = summarizeGenFailures([
      ch({ node_id: "p", gen_status: "pending" }),
      ch({ node_id: "g", gen_status: "generating" }),
      ch({ node_id: "d", gen_status: "done", content: "正文" }),
    ])
    expect(s.failedCount).toBe(0)
    expect(s.causes).toEqual([])
    expect(buildGenFailureText(s)).toContain("没有失败的章节")
  })

  it("整本大失败时点名截断并置 truncated，count 仍为真实章数", () => {
    const many = Array.from({ length: 10 }, (_, i) => failed("fetch timeout", `第${i + 1}章`, `n${i}`))
    const s = summarizeGenFailures(many)
    expect(s.failedCount).toBe(10)
    expect(s.causes[0].count).toBe(10)
    expect(s.causes[0].chapters).toHaveLength(8)
    expect(s.causes[0].truncated).toBe(true)
    expect(buildGenFailureText(s)).toContain("等共 10 章")
  })

  it("无标题章按序号兜底命名，与体检卡同口径", () => {
    const s = summarizeGenFailures([failed("fetch timeout", "")])
    expect(s.causes[0].chapters[0].title).toBe("第1章")
  })

  it("空入参容错，不抛异常", () => {
    expect(summarizeGenFailures([]).failedCount).toBe(0)
    expect(summarizeGenFailures(undefined).failedCount).toBe(0)
    expect(summarizeGenFailures(null).failedCount).toBe(0)
  })
})

describe("buildGenFailureText", () => {
  it("单因主导时给出排查结论，逐章点名可当整改笔记", () => {
    const s = summarizeGenFailures([failed("insufficient quota", "A", "a"), failed("insufficient quota", "B", "b")])
    const text = buildGenFailureText(s)
    expect(text).toContain("共 2 章失败")
    expect(text).toContain(GEN_FAILURE_CATEGORY_LABEL.quota)
    expect(text).toContain("insufficient quota")
    expect(text).toContain("- A")
    expect(text).toContain("建议先排查该通道再整本重试")
  })
})
