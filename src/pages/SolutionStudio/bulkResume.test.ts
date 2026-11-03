import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { bulkResumeNotice, deriveSolutionDocStatus, resumeBannerVisible, shouldRecoverStaleGenerating } from "./bulkResume"

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

describe("resumeBannerVisible", () => {
  it("部分 done 且不在批量中 → 可见", () => {
    expect(resumeBannerVisible(3, 10, false)).toBe(true)
  })
  it("批量进行中的同进度 → 不可见（由进度条播报）", () => {
    expect(resumeBannerVisible(3, 10, true)).toBe(false)
  })
  it("零 done / 全 done / 空章节 → 不可见", () => {
    expect(resumeBannerVisible(0, 10, false)).toBe(false)
    expect(resumeBannerVisible(10, 10, false)).toBe(false)
    expect(resumeBannerVisible(0, 0, false)).toBe(false)
  })
})

describe("断点续跑提示文案（横幅与 toast 共用口径）", () => {
  it("可见时文案非空且含「继续生成正文」指引，与横幅按钮标签一致", () => {
    const notice = bulkResumeNotice(3, 10)
    expect(notice).not.toBeNull()
    expect(notice).toContain("继续生成正文")
  })
})

describe("EditorWorkspace 恢复横幅接线（防回流）", () => {
  it("横幅使用 resumeBannerVisible + bulkResumeNotice 并挂 startBulkGenerate", () => {
    const code = readFileSync(new URL("../../components/solution-studio/EditorWorkspace.tsx", import.meta.url), "utf-8")
    expect(code).toContain("resumeBannerVisible(p.doneChapterCount, total, p.bulkGenerating)")
    expect(code).toContain("{bulkResumeNotice(p.doneChapterCount, total)}")
    expect(code).toContain("onClick={p.startBulkGenerate}")
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
