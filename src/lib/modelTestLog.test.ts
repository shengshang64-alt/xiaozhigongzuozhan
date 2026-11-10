/** @vitest-environment jsdom */
/**
 * 「连通测试」台账口径测试。
 *
 * 钉四件事：
 *   ① 只记真实测试（失败也记，方便对比换 Key / 换通道前后的差异）；
 *   ② 没有耗时就存 null，绝不写 0——0ms 是一个会误导人的假结论；
 *   ③ 按用户分桶，换账号看不到别人的记录；
 *   ④ 汇总只出「次数」，不出「成功率」这类跨口径指标（测试不是调用）。
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  clearTestLog,
  describeWhen,
  formatElapsed,
  readTestLog,
  recordTestResult,
  summarizeTestLog,
} from "./modelTestLog"

const U = "user-a"
const entry = (over: Partial<Parameters<typeof recordTestResult>[1]> = {}) => ({
  key: "personal:c1:deepseek-v4.1-flash",
  configId: "c1",
  configName: "Open Design",
  modelId: "deepseek-v4.1-flash",
  ok: true,
  elapsedMs: 1200,
  message: "",
  ...over,
})

afterEach(() => {
  clearTestLog(U)
  clearTestLog("user-b")
  localStorage.clear()
})

describe("recordTestResult —— 只记真实测试", () => {
  it("成功与失败都入账，新的在前", () => {
    recordTestResult(U, entry({ at: 1000 }))
    recordTestResult(U, entry({ ok: false, message: "Key 失效", elapsedMs: null, at: 2000 }))
    const log = readTestLog(U)
    expect(log).toHaveLength(2)
    expect(log[0].ok).toBe(false)
    expect(log[0].message).toBe("Key 失效")
    expect(log[1].ok).toBe(true)
  })

  it("没有耗时存 null，不写 0（0ms 会被读成「秒回」）", () => {
    recordTestResult(U, entry({ elapsedMs: null }))
    expect(readTestLog(U)[0].elapsedMs).toBeNull()
    expect(formatElapsed(null)).toBe("—")
    expect(formatElapsed(1200)).toBe("1.2s")
    expect(formatElapsed(320)).toBe("320ms")
  })

  it("脏 key / 空模型名拒收（防止把脏数据写成一条假记录）", () => {
    recordTestResult(U, entry({ key: "" }))
    recordTestResult(U, entry({ modelId: "" }))
    expect(readTestLog(U)).toHaveLength(0)
  })
})

describe("按用户分桶", () => {
  it("A 的测试不会出现在 B 的台账里", () => {
    recordTestResult(U, entry())
    recordTestResult("user-b", entry({ modelId: "glm-5.3" }))
    expect(readTestLog(U).map((e) => e.modelId)).toEqual(["deepseek-v4.1-flash"])
    expect(readTestLog("user-b").map((e) => e.modelId)).toEqual(["glm-5.3"])
  })

  it("存储里被外部写脏 → 当作空台账，不抛错", () => {
    localStorage.setItem("xz_model_test_log:user-a", "{not json")
    expect(readTestLog(U)).toEqual([])
    localStorage.setItem("xz_model_test_log:user-a", JSON.stringify([{ key: "x" }]))
    expect(readTestLog(U)).toEqual([])
  })
})

describe("summarizeTestLog —— 只出次数，不出成功率", () => {
  const NOW = new Date(2026, 10, 9, 15, 0, 0).getTime()
  const YESTERDAY = new Date(2026, 10, 8, 18, 20, 0).getTime()

  it("总数 / 成功 / 失败 / 今日分开计", () => {
    recordTestResult(U, entry({ at: NOW - 60_000 }))
    recordTestResult(U, entry({ ok: false, at: NOW - 120_000 }))
    recordTestResult(U, entry({ at: YESTERDAY }))
    const s = summarizeTestLog(readTestLog(U), NOW)
    expect(s).toMatchObject({ total: 3, ok: 2, failed: 1, today: 2 })
    expect(s.latestAt).toBe(NOW - 60_000)
  })

  it("空台账：计数全 0、latestAt 为 null（不是 0）", () => {
    expect(summarizeTestLog([], NOW)).toEqual({ total: 0, ok: 0, failed: 0, today: 0, latestAt: null })
  })
})

describe("describeWhen —— 同一屏只用一种时间读法", () => {
  const NOW = new Date(2026, 10, 9, 15, 0, 0).getTime()
  it("今天 / 昨天 / 更早三档", () => {
    expect(describeWhen(new Date(2026, 10, 9, 8, 52).getTime(), NOW)).toBe("今天 08:52")
    expect(describeWhen(new Date(2026, 10, 8, 18, 20).getTime(), NOW)).toBe("昨天 18:20")
    expect(describeWhen(new Date(2026, 10, 5, 9, 4).getTime(), NOW)).toBe("11-05 09:04")
  })
})
