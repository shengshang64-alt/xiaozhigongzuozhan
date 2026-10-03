// Author: loop-R140
// Scheduling invariants of runBulkPool must hold independent of the caller. These
// pin dispatch-once, concurrency cap, cancel gate, error isolation and progress.
import { describe, expect, it } from "vitest"

import { runBulkPool } from "./bulkPool"

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

describe("runBulkPool", () => {
  it("dispatches every index exactly once across workers", async () => {
    const seen: number[] = []
    const processed = await runBulkPool({
      total: 10,
      concurrency: 3,
      runTask: async (i) => {
        seen.push(i)
        await tick()
      },
    })
    expect(processed).toBe(10)
    expect(seen.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i))
    expect(new Set(seen).size).toBe(10)
  })

  it("never exceeds the concurrency cap in flight", async () => {
    let open = 0
    let peak = 0
    await runBulkPool({
      total: 20,
      concurrency: 2,
      runTask: async () => {
        open += 1
        peak = Math.max(peak, open)
        await tick()
        open -= 1
      },
    })
    expect(peak).toBe(2)
  })

  it("stops dispatching once cancelled but lets in-flight tasks finish", async () => {
    let dispatched = 0
    const processed = await runBulkPool({
      total: 100,
      concurrency: 2,
      isCancelled: () => dispatched >= 5,
      runTask: async () => {
        dispatched += 1
        await tick()
      },
    })
    // cancel gate only blocks not-yet-dispatched tasks; dispatched count stays bounded
    expect(processed).toBeLessThan(100)
    expect(processed).toBeGreaterThanOrEqual(5)
  })

  it("isolates a throwing task without aborting the pool", async () => {
    const errored: number[] = []
    const done: number[] = []
    const processed = await runBulkPool({
      total: 6,
      concurrency: 2,
      runTask: async (i) => {
        if (i === 2) throw new Error("boom")
        done.push(i)
      },
      onTaskError: (i) => {
        errored.push(i)
      },
    })
    expect(errored).toEqual([2])
    expect(processed).toBe(6)
    expect(done.length).toBe(5)
    expect(done).not.toContain(2)
  })

  it("returns 0 and runs nothing when total is 0", async () => {
    let called = 0
    const processed = await runBulkPool({
      total: 0,
      concurrency: 3,
      runTask: async () => {
        called += 1
      },
    })
    expect(processed).toBe(0)
    expect(called).toBe(0)
  })

  it("clamps concurrency to total and reports monotonic progress", async () => {
    const progress: number[] = []
    const processed = await runBulkPool({
      total: 2,
      concurrency: 8,
      onTaskStart: (_i, p) => {
        progress.push(p)
      },
      runTask: async () => {
        await tick()
      },
    })
    expect(processed).toBe(2)
    expect(progress).toEqual([1, 2])
  })
})
