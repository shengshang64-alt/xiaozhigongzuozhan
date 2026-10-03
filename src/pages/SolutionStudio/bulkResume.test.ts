import { describe, expect, it } from "vitest"
import { bulkResumeNotice, deriveSolutionDocStatus, shouldRecoverStaleGenerating } from "./bulkResume"

// ---------------------------------------------------------------------------
// 方案侧批量中断恢复纯函数：阶段推导 / 陈旧「生成中」复位判定 / 断点续跑提示
// 口径须与 runBulkGenerate 收口的 nextStatus 推导一致（done 计数 vs total）。
// ---------------------------------------------------------------------------

function ch(gen_status: string) {
  return { gen_status }
}

describe("deriveSolutionDocStatus", () => {
  it("全部 done → done", () => {
    expect(deriveSolutionDocStatus([ch("done"), ch("done"), ch("done")])).toBe("done")
  })
  it("部分 done 部分 pending/failed → partial", () => {
    expect(deriveSolutionDocStatus([ch("done"), ch("pending"), ch("failed")])).toBe("partial")
  })
  it("无任何 done → outline", () => {
    expect(deriveSolutionDocStatus([ch("pending"), ch("generating"), ch("failed")])).toBe("outline")
  })
  it("空章节列表 → outline", () => {
    expect(deriveSolutionDocStatus([])).toBe("outline")
  })
})

describe("shouldRecoverStaleGenerating", () => {
  it("generating 且无进行中批量 → 需复位", () => {
    expect(shouldRecoverStaleGenerating("generating", false)).toBe(true)
  })
  it("generating 但批量仍在进行 → 不复位", () => {
    expect(shouldRecoverStaleGenerating("generating", true)).toBe(false)
  })
  it("非 generating 态 → 不复位", () => {
    expect(shouldRecoverStaleGenerating("done", false)).toBe(false)
    expect(shouldRecoverStaleGenerating("partial", false)).toBe(false)
  })
})

describe("bulkResumeNotice", () => {
  it("有 done 但未全 → 给出断点续跑提示", () => {
    expect(bulkResumeNotice(3, 8)).toMatch("继续生成正文")
  })
  it("全部完成 → 不提示", () => {
    expect(bulkResumeNotice(8, 8)).toBeNull()
  })
  it("一章未成 → 不提示（等同全新起跑）", () => {
    expect(bulkResumeNotice(0, 5)).toBeNull()
  })
  it("空列表 → 不提示", () => {
    expect(bulkResumeNotice(0, 0)).toBeNull()
  })
})
