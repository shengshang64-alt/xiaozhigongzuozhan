import { describe, expect, it } from "vitest"
import { formatFailedChapterList, isBlankChapterOutput } from "./chapterGenGuard"

// R139 方案编制生成韧性判定纯函数：空产出口径 + 失败点名文案（批量补重试的行为编排在 hook 内，由此处锁死判定语义）

describe("isBlankChapterOutput", () => {
  it("空串/纯空白/换行/undefined/null 都算空产出", () => {
    expect(isBlankChapterOutput("")).toBe(true)
    expect(isBlankChapterOutput("   \n\t ")).toBe(true)
    expect(isBlankChapterOutput(undefined)).toBe(true)
    expect(isBlankChapterOutput(null)).toBe(true)
  })
  it("有任何非空白字符即非空（哪怕只有一个字）", () => {
    expect(isBlankChapterOutput("哈")).toBe(false)
    expect(isBlankChapterOutput("\n第一章 概述\n")).toBe(false)
  })
})

describe("formatFailedChapterList", () => {
  it("空清单回退 fallback 文案", () => {
    expect(formatFailedChapterList([])).toBe("原因未知")
    expect(formatFailedChapterList([], { fallback: "未知" })).toBe("未知")
  })
  it("逐章点名「章名（原因）」，章名超长截断", () => {
    const s = formatFailedChapterList([{ title: "第八章 医共体一体化平台技术方案与实施计划", reason: "网络超时" }])
    expect(s).toBe("第八章 医共体一体化（网络超时）")
  })
  it("reason 为空串时用「生成异常」兜底", () => {
    expect(formatFailedChapterList([{ title: "总览", reason: "" }])).toBe("总览（生成异常）")
  })
  it("超过 maxItems 截断并附「等 N 章」", () => {
    const failed = ["A", "B", "C", "D", "E"].map((t) => ({ title: t, reason: "空产出" }))
    const s = formatFailedChapterList(failed)
    expect(s).toContain("A（空产出）")
    expect(s).toContain("C（空产出）")
    expect(s).not.toContain("D（空产出）")
    expect(s).toContain("等 5 章")
  })
  it("自定义 maxItems/titleMax 生效", () => {
    const failed = ["章节一二三", "xx"].map((t) => ({ title: t, reason: "异常" }))
    expect(formatFailedChapterList(failed, { maxItems: 1, titleMax: 2 })).toBe("章节（异常）、等 2 章")
  })
})
