/**
 * 方案侧超时降级重试的**行为网**（2026-11-04，审计 P1）。
 *
 * 缺陷形态：方案侧 llmGenerate 只发一次请求，撞上网关 300s 红线就整章 failed；
 * 而标书侧早就有「关思考 + 逐次折半预算」的恢复链，同一份预算标书能跑完、方案必失败。
 *
 * 本文件钉住四件事（用 mock 的网关，零网络、零费用）：
 *  ① 首调超时 → 必须再发降级请求，且降级请求带 disableThinking、预算小于首调；
 *  ② 降级成功 → 返回正文（用户拿到内容，而不是 failed）；
 *  ③ 非超时失败（内容审核）→ 不重试（避免重复扣费）；
 *  ④ 全部降档都失败 → 抛出的错误带真实原因，不是笼统的「生成失败」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<Record<string, unknown>> = []

type Result = { ok: boolean; status?: string; text?: string; error?: string; needsLogin?: boolean }

/** 每个用例用这个队列控制「第 N 次调用返回什么」 */
let responses: Result[] = []

vi.mock("@/lib/modelGateway", async (orig) => {
  const actual = await orig<typeof import("@/lib/modelGateway")>()
  return {
    ...actual,
    chatViaGateway: async (opts: Record<string, unknown>) => {
      calls.push(opts)
      const next = responses.shift()
      return next ?? { ok: false, status: "failed", text: "", error: "no_more_response" }
    },
  }
})

import { llmGenerate } from "./studioLlm"
import { PERSONAL_TIMEOUT_MSG } from "@/lib/modelGateway"

beforeEach(() => {
  calls.length = 0
  responses = []
})

describe("llmGenerate：首调成功不发多余请求", () => {
  it("成功即返回，只发 1 次", async () => {
    responses = [{ ok: true, status: "success", text: "正文内容" }]
    await expect(llmGenerate([{ role: "user", content: "写" }], 8192)).resolves.toBe("正文内容")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.disableThinking).toBeUndefined()
  })
})

describe("llmGenerate：超时降级（本轮的修复）", () => {
  it("首调超时 → 再发降级请求：关思考 + 预算折半，成功后返回正文", async () => {
    responses = [
      { ok: false, status: "failed", text: "", error: PERSONAL_TIMEOUT_MSG },
      { ok: true, status: "success", text: "降档后的正文" },
    ]
    await expect(llmGenerate([{ role: "user", content: "写" }], 8192)).resolves.toBe("降档后的正文")

    expect(calls.length).toBe(2)
    const degraded = calls[1]!
    expect(degraded.disableThinking).toBe(true)
    expect(degraded.max_tokens).toBe(4096)
    expect(degraded.max_tokens as number).toBeLessThan(calls[0]!.max_tokens as number)
    // 同一次生成必须用同一份 payload（含技能块），不能悄悄换内容
    expect(degraded.messages).toEqual(calls[0]!.messages)
  })

  it("第一档仍超时、第二档成功 → 继续降档，最终拿到正文", async () => {
    responses = [
      { ok: false, status: "failed", text: "", error: PERSONAL_TIMEOUT_MSG },
      { ok: false, status: "failed", text: "", error: PERSONAL_TIMEOUT_MSG },
      { ok: true, status: "success", text: "更低档的正文" },
    ]
    await expect(llmGenerate([{ role: "user", content: "写" }], 8192)).resolves.toBe("更低档的正文")
    expect(calls.length).toBe(3)
    expect(calls[1]!.max_tokens).toBe(4096)
    expect(calls[2]!.max_tokens).toBe(2048)
  })

  it("非超时失败（内容审核）→ 不重试，只发 1 次", async () => {
    responses = [{ ok: false, status: "failed", text: "", error: "内容审核未通过，请调整措辞后重试" }]
    await expect(llmGenerate([{ role: "user", content: "写" }], 8192)).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it("全部降档都超时 → 抛出的错误是人话（含可执行建议），并说明最后真实原因", async () => {
    responses = Array.from({ length: 10 }, () => ({
      ok: false,
      status: "failed",
      text: "",
      error: PERSONAL_TIMEOUT_MSG,
    }))
    const err = await llmGenerate([{ role: "user", content: "写" }], 8192).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/[一-鿿]/)
    // 不能只留一个笼统的「生成失败」——超时的处置建议必须透出来
    expect((err as Error).message).toMatch(/超时|模型|分次|逐章/)
    // 降级次数有上限，不会无限重试烧钱
    expect(calls.length).toBeLessThanOrEqual(9)
  })

  it("降级途中遇到余额不足 → 立即停，不再继续降档（防连续扣费）", async () => {
    responses = [
      { ok: false, status: "failed", text: "", error: PERSONAL_TIMEOUT_MSG },
      { ok: false, status: "failed", text: "", error: "insufficient balance 余额不足" },
      { ok: true, status: "success", text: "不该走到这里" },
    ]
    await expect(llmGenerate([{ role: "user", content: "写" }], 8192)).rejects.toThrow()
    expect(calls.length).toBe(2)
  })
})
