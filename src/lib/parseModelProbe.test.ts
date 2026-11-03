// P2 解析模型探活（2026-11-01）：「实质输出」判定的回归锁。
//
// 对应《三模型真实数据审计 2026-10-28》「0% 命中但全员全绿」——探针的判定信号必须是
// 「解析形态的多行实质输出」，不能是「接口返回了 200」。这里锁判定口径本身。
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/modelGateway", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/modelGateway")>()
  return { ...mod, chatViaGateway: vi.fn() }
})
vi.mock("@/lib/modelHealth", () => ({
  recordCallFailure: vi.fn(),
  recordModelSuccess: vi.fn(),
}))

import { probeParseModel } from "@/lib/parseModelProbe"
import { chatViaGateway } from "@/lib/modelGateway"
import { recordCallFailure, recordModelSuccess } from "@/lib/modelHealth"

const mockChat = vi.mocked(chatViaGateway)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("probeParseModel · 实质输出判定", () => {
  it("≥2 行「条款：」通过，记成功账", async () => {
    mockChat.mockResolvedValue({
      ok: true,
      status: "success",
      text: "条款：未密封投标无效。\n条款：报价超最高限价投标无效。",
    } as never)
    const v = await probeParseModel(null)
    expect(v.ok).toBe(true)
    expect(recordModelSuccess).toHaveBeenCalledOnce()
    expect(recordCallFailure).not.toHaveBeenCalled()
  })

  it("接口 200 但空回复 → 失败（审计发现的静默退化形态）", async () => {
    mockChat.mockResolvedValue({ ok: true, status: "success", text: "" } as never)
    const v = await probeParseModel(null)
    expect(v.ok).toBe(false)
    expect(recordCallFailure).toHaveBeenCalledOnce()
  })

  it("单行敷衍（散文/非条款形态）→ 失败", async () => {
    mockChat.mockResolvedValue({
      ok: true,
      status: "success",
      text: "好的，我来分析一下这段文本。它讲的是投标相关的要求。",
    } as never)
    const v = await probeParseModel(null)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain("实质输出不足")
  })

  it("接口失败 → 失败并挂账，不误报成功", async () => {
    mockChat.mockResolvedValue({ ok: false, error: "HTTP 429 频率超限" } as never)
    const v = await probeParseModel(null)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain("429")
    expect(recordCallFailure).toHaveBeenCalledOnce()
    expect(recordModelSuccess).not.toHaveBeenCalled()
  })

  it("网关抛异常 → 失败不冒泡（探活绝不能阻断解析）", async () => {
    mockChat.mockRejectedValue(new Error("network reset"))
    const v = await probeParseModel(null)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain("network reset")
  })
})
