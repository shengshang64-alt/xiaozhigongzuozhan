import { describe, expect, it } from "vitest"
import { runBatchesWithRetry, withGenerationRetry } from "./deckBatchRecovery"

describe("withGenerationRetry", () => {
  it("首试成功不触发第二次调用，attempt 从 0 起", async () => {
    let calls = 0
    const r = await withGenerationRetry(async (attempt) => {
      calls += 1
      return `ok-${attempt}`
    })
    expect(r).toBe("ok-0")
    expect(calls).toBe(1)
  })

  it("首试抛错自动重试一次并返回成功结果", async () => {
    let calls = 0
    const r = await withGenerationRetry(async () => {
      calls += 1
      if (calls === 1) throw new Error("网络抖动")
      return "b"
    })
    expect(r).toBe("b")
    expect(calls).toBe(2)
  })

  it("全部尝试抛错时重抛最后一个错误（保留末次文案）", async () => {
    let calls = 0
    await expect(
      withGenerationRetry(async () => {
        calls += 1
        throw new Error(`err${calls}`)
      }),
    ).rejects.toThrow("err2")
    expect(calls).toBe(2)
  })

  it("空结果判定命中则作废本试并重试", async () => {
    let calls = 0
    const r = await withGenerationRetry<string[]>(
      async () => {
        calls += 1
        return calls === 1 ? [] : ["a"]
      },
      { isEmptyResult: (arr) => arr.length === 0 },
    )
    expect(r).toEqual(["a"])
    expect(calls).toBe(2)
  })

  it("全部尝试均为空结果时抛 emptyMessage", async () => {
    await expect(
      withGenerationRetry<string[]>(async () => [], {
        isEmptyResult: (arr) => arr.length === 0,
        emptyMessage: "AI 未返回可用页面",
      }),
    ).rejects.toThrow("AI 未返回可用页面")
  })

  it("maxAttempts=3 时最多尝试 3 次", async () => {
    let calls = 0
    await expect(
      withGenerationRetry(async () => {
        calls += 1
        throw new Error("boom")
      }, { maxAttempts: 3 }),
    ).rejects.toThrow("boom")
    expect(calls).toBe(3)
  })
})

describe("runBatchesWithRetry", () => {
  it("全部批次成功：结果按批次序对齐返回，无 null", async () => {
    const batches = [[1], [2, 3]]
    const results = await runBatchesWithRetry<number, string>({
      batches,
      generate: async (batch) => batch.map((n) => `s${n}`),
    })
    expect(results).toEqual([["s1"], ["s2", "s3"]])
  })

  it("某批首试失败重试成功后整体无失败批，且批次入参正确", async () => {
    let calls = 0
    const seen: number[][] = []
    const results = await runBatchesWithRetry<number, string>({
      batches: [[1], [2]],
      generate: async (batch) => {
        calls += 1
        seen.push(batch)
        if (batch[0] === 1 && calls === 1) throw new Error("抖动")
        return batch.map((n) => `s${n}`)
      },
    })
    expect(results).toEqual([["s1"], ["s2"]])
    expect(calls).toBe(3)
    expect(seen).toEqual([[1], [1], [2]])
  })

  it("批次彻底失败置 null 但不中断后续批次", async () => {
    const results = await runBatchesWithRetry<number, string>({
      batches: [[1], [2], [3]],
      generate: async (batch) => {
        if (batch[0] === 2) throw new Error("坏批")
        return batch.map((n) => `s${n}`)
      },
    })
    expect(results).toEqual([["s1"], null, ["s3"]])
  })

  it("空数组返回视为失败并重试，仍空则置 null", async () => {
    let calls = 0
    const results = await runBatchesWithRetry<number, string>({
      batches: [[1]],
      generate: async () => {
        calls += 1
        return []
      },
    })
    expect(results).toEqual([null])
    expect(calls).toBe(2)
  })

  it("onBatchStart 按批次与试次回调（重试携带 attempt=1）", async () => {
    const tips: [number, number, number][] = []
    await runBatchesWithRetry<number, string>({
      batches: [[1], [2]],
      generate: async (batch) => {
        if (batch[0] === 2 && tips[tips.length - 1][2] === 0) throw new Error("抖动")
        return batch.map((n) => `s${n}`)
      },
      onBatchStart: (i, total, attempt) => tips.push([i, total, attempt]),
    })
    expect(tips).toEqual([
      [0, 2, 0],
      [1, 2, 0],
      [1, 2, 1],
    ])
  })

  it("空批次序列返回空结果，不抛错", async () => {
    const results = await runBatchesWithRetry<number, string>({
      batches: [],
      generate: async () => ["never"],
    })
    expect(results).toEqual([])
  })
})
