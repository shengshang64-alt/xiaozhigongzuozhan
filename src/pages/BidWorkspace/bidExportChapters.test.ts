import { describe, expect, it } from "vitest"
import { pickExportChapters } from "./bidFiles"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// 2026-10-14 交付物治理（安中医实跑）：导出章清单的两条口径
//   ① 已有正文的章一律导出——内容范围只筛「空骨架章」，不得把写好的章整章丢掉；
//   ② 空章按 part 过滤（biz 仅商务 / tech 仅技术 / both 全部）。
// 修复前：scope=tech 时 part=biz 的「实质性条款响应承诺函」（零 AI 自动生成、★ 条款逐字响应
// 与盖章的法定载体，正文 3124 字 / 12 处 ★）被整章丢弃——写了却拿不到。
const ch = (title: string, part: string | undefined, content: string): Chapter =>
  ({ title, part, content }) as unknown as Chapter

const chapters: Chapter[] = [
  ch("第一章 技术方案", undefined, "技术正文"),
  ch("第二章 技术空骨架", undefined, ""),
  ch("实质性条款响应承诺函", "biz", "★1 注：投标文件中须提供承诺函并盖公章"),
  ch("第三章 商务空骨架", "biz", ""),
]

describe("pickExportChapters（导出章清单）", () => {
  it("scope=tech：已写正文的商务章（承诺函）不被丢掉", () => {
    const titles = pickExportChapters(chapters, "tech").map((c) => c.title)
    expect(titles).toContain("实质性条款响应承诺函")
    expect(titles).toContain("第一章 技术方案")
  })
  it("scope=tech：空骨架章仍按 part 过滤（技术空章留下、商务空章滤掉）", () => {
    const titles = pickExportChapters(chapters, "tech").map((c) => c.title)
    expect(titles).toContain("第二章 技术空骨架")
    expect(titles).not.toContain("第三章 商务空骨架")
  })
  it("scope=biz：已写正文的技术章同样保留", () => {
    const titles = pickExportChapters(chapters, "biz").map((c) => c.title)
    expect(titles).toContain("第一章 技术方案")
    expect(titles).not.toContain("第二章 技术空骨架")
    expect(titles).toContain("第三章 商务空骨架")
  })
  it("scope=both：空章全保留（商务骨架章留占位供线下填写）", () => {
    expect(pickExportChapters(chapters, "both")).toHaveLength(4)
  })
  it("空清单不抛错；空白正文按空章处理（走 part 过滤，不因空白算已写）", () => {
    expect(pickExportChapters([], "both")).toEqual([])
    expect(pickExportChapters([ch("空格技术章", undefined, "   ")], "tech")).toHaveLength(1)
    expect(pickExportChapters([ch("空格商务章", "biz", "   ")], "tech")).toHaveLength(0)
  })
})
