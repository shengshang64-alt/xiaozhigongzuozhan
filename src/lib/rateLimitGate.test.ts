// Q28 切片F：限流冷却闸门口径锁死（429 退避窗、并发错峰、连击封顶、成功清计数）
import { beforeEach, describe, expect, it } from "vitest"
import {
  MIN_CALL_GAP_MS,
  noteCallSucceeded,
  noteRateLimited,
  rateLimitStrikes,
  resetRateLimitGate,
  takeCallSlot,
  waitCallSlot,
} from "./rateLimitGate"

beforeEach(() => {
  resetRateLimitGate()
})

describe("Q28 切片F 限流冷却闸门", () => {
  it("健康态首调不等待，同刻并发按最小间隔错峰", () => {
    expect(takeCallSlot(1000)).toBe(0)
    // 第二个 worker 同一时刻取号：被推后一个最小间隔，杜绝同秒撞限流窗
    expect(takeCallSlot(1000)).toBe(MIN_CALL_GAP_MS)
    // 间隔足够后再取号：无需等待
    expect(takeCallSlot(9000)).toBe(0)
  })

  it("命中 429 开 20s 冷却窗，窗内取号需等满剩余窗", () => {
    expect(noteRateLimited(0)).toBe(20_000)
    expect(takeCallSlot(5_000)).toBe(15_000)
  })

  it("连击冷却窗逐次拉长但封顶，且不同 worker 同轮命中不叠加", () => {
    expect(noteRateLimited(0)).toBe(20_000)
    // 同刻第二个 worker 也命中：窗取 max 而非累加，不会变成 40s 干等
    expect(noteRateLimited(0)).toBe(40_000)
    expect(takeCallSlot(0)).toBe(40_000)
    expect(noteRateLimited(0)).toBe(60_000)
    expect(noteRateLimited(0)).toBe(80_000)
    expect(noteRateLimited(0)).toBe(90_000)
    expect(noteRateLimited(0)).toBe(90_000)
  })

  it("等待时长封顶 75s：闸门绝不制造无限挂起", () => {
    for (let i = 0; i < 6; i += 1) noteRateLimited(0)
    expect(takeCallSlot(0)).toBe(75_000)
  })

  it("成功返回清零连击计数，冷却回到单窗", () => {
    noteRateLimited(0)
    noteRateLimited(0)
    expect(rateLimitStrikes()).toBe(2)
    noteCallSucceeded()
    expect(rateLimitStrikes()).toBe(0)
    expect(noteRateLimited(100_000)).toBe(20_000)
  })

  it("waitCallSlot 真等窗：等待为 0 不调 sleep，有窗则等满后再放行", async () => {
    const slept: number[] = []
    const sleep = async (ms: number) => {
      slept.push(ms)
    }
    expect(await waitCallSlot(sleep, 10_000)).toBe(0)
    expect(slept).toEqual([])
    noteRateLimited(10_000)
    expect(await waitCallSlot(sleep, 10_000)).toBe(20_000)
    expect(slept).toEqual([20_000])
  })
})
