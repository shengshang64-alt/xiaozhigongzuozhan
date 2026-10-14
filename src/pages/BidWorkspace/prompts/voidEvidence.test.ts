// P0-1（R046）废标检查证据与未知态契约：证据不足 ≠ 合规/不合规
// 背景：改前「结构性线索→判 compliant」「无证据→改判 compliant」与「模型漏答→补 non_compliant(evidence "")」
// 三条口径都可能让「没看到」被当成确定结论。本文件把正反行为锈死：
//   反例（不许回归）：无证据自动转合规 / 模型漏答自动判不合规
//   正例（必须保持）：有可定位证据的合规 / 有冲突证据的不合规
import { describe, expect, it } from "vitest"
import { buildVoidCheckMessages } from "./voidCheck"
import {
  buildVoidInitialCheckMessages,
  buildVoidFinalizeMessages,
} from "./voidCheckRounds"
import { sanitizeVoidCheck } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

const clauses = ["未按招标文件要求盖章的投标无效", "投标报价超出最高限价的投标无效"]
const bid = "投标文件正文示例：本项目提供五星售后服务承诺，响应时间 2 小时。"
const systemText = (m: LlmMessage[]) => (typeof m[0].content === "string" ? m[0].content : "")

describe("P0-1 sanitizeVoidCheck：未知态不得自动判定", () => {
  it("模型漏答的条款：补 partial + pending + 人工核对提示，禁止无证据 non_compliant", () => {
    // 模型只输出了第一条，第二条漏答（或超出输入范围）
    const check = sanitizeVoidCheck(
      { items: [{ clause: clauses[0], status: "compliant", kind: "invalidBid", evidence: "第 3 章含盖章承诺" }] },
      clauses,
    )
    const missed = check.items.find((x) => x.clause === clauses[1])
    expect(missed).toBeDefined()
    if (!missed) return
    expect(missed.status).toBe("partial")
    expect(missed.review_status).toBe("pending")
    expect(missed.severity).toBe("critical") // 仍留在风险雷达（voidCriticalUnresolved 计数）
    expect(missed.evidence).toBe("") // 不得编造证据
    expect(missed.suggestion).toContain("人工核对")
    expect(missed.reason).toContain("不得据此判定不合规")
  })

  it("明确冲突且有可定位证据：保持 non_compliant 不降级", () => {
    const check = sanitizeVoidCheck(
      { items: [{ clause: clauses[1], status: "non_compliant", kind: "invalidBid", evidence: "报价 520 万 > 最高限价 500 万（第 5 章报价表）" }] },
      [clauses[1]],
    )
    const item = check.items[0]
    expect(item.status).toBe("non_compliant")
    expect(item.evidence).toContain("520 万")
  })

  it("有正文响应证据的 compliant 不被动降级", () => {
    const check = sanitizeVoidCheck(
      { items: [{ clause: clauses[0], status: "compliant", kind: "invalidBid", evidence: "第 2 章：已按招标文件要求逐页盖章" }] },
      [clauses[0]],
    )
    expect(check.items[0].status).toBe("compliant")
  })
})

describe("P0-1 提示词语义：结构性线索与无证据都不得自动判合规", () => {
  it("三轮·第二轮：仅有目录/附件线索判 partial 并注明需人工核对原件（不是 compliant）", () => {
    const s = buildVoidInitialCheckMessages(
      { scope: [{ clause: clauses[0], kind: "invalidBid", where: "附件", synonyms: ["盖章"] }] },
      bid,
    )
    const sys = systemText(s)
    expect(sys).toContain("此类情况判 partial")
    expect(sys).toContain("需人工核对原件")
    // 旧口径回归护栏：结构性线索不得再「判 compliant」
    expect(sys).not.toContain("判 compliant 并在定稿阶段补注")
    expect(sys).toContain("不得判 compliant 也不得判 non_compliant")
  })

  it("三轮·第三轮定稿：找不到可摘录依据时保留 partial，禁止改判 compliant 或删除风险", () => {
    const f = buildVoidFinalizeMessages(
      { items: [{ clause: clauses[0], status: "partial", kind: "invalidBid" }] },
      bid,
    )
    const sys = systemText(f)
    expect(sys).toContain("保留为 partial")
    expect(sys).toContain("改判 compliant")
    // 旧口径回归护栏
    expect(sys).not.toContain("不得输出该条风险判定")
  })

  it("单轮版（快捷工具/降级路径）：结构性线索判 partial；无依据时不得输出合规判定", () => {
    const m = buildVoidCheckMessages(clauses, bid)
    const sys = systemText(m)
    expect(sys).toContain("partial")
    expect(sys).not.toContain("此类情况判 compliant")
    expect(sys).not.toContain("不得输出该条的风险判定")
    expect(sys).toContain("需人工核对原件")
  })
})
