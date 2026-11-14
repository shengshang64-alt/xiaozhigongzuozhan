// 知识库 · 全文检索结果分组的口径守卫（纯函数）。
//
// 分组是这一屏的核心：**标题命中 / 正文命中** 回答的是两个不同的问题。
// 分错组，用户就得自己再去分辨一遍——那正是原型要消灭的成本。
import { describe, expect, it } from "vitest"
import { countSnippetHits, timeBucketCounts, timeBucketOf, titleHitsOf } from "./kbSearchGroup"

const DOCS = [
  { id: "1", title: "互联互通四甲测评准备清单", folder_path: "政策法规", updated: "2026-11-09T00:00:00Z", summary: "含数据元对照", doc_format: "docx" },
  { id: "2", title: "宣城市人民医院互联互通四甲建设方案", folder_path: "方案素材", updated: "2026-10-21T00:00:00Z", summary: "", doc_format: "docx" },
  { id: "3", title: "电子病历系统应用水平分级评价标准（2018 版）", folder_path: "政策法规", updated: "2026-09-08T00:00:00Z", summary: "条款原文", doc_format: "pdf" },
]

describe("① 标题命中：标题里包含检索词", () => {
  it("大小写不敏感、中文按子串", () => {
    expect(titleHitsOf(DOCS, "互联互通四甲").map((d) => d.id)).toEqual(["1", "2"])
    expect(titleHitsOf(DOCS, "互联互通四甲").length).toBe(2)
  })

  it("只命中标题，不看摘要/目录（正文命中是服务端 FTS 的活）", () => {
    // 文档 3 的摘要是「条款原文」，目录是「政策法规」——都不含检索词
    expect(titleHitsOf(DOCS, "条款原文").length).toBe(0)
    expect(titleHitsOf(DOCS, "政策法规").length).toBe(0)
  })

  it("空检索词返回空数组（不返回全部）", () => {
    expect(titleHitsOf(DOCS, "")).toEqual([])
    expect(titleHitsOf(DOCS, "   ")).toEqual([])
  })

  it("保留来源信息，界面要显示「来源目录 · 更新时间」", () => {
    const hit = titleHitsOf(DOCS, "互联互通四甲")[0]
    expect(hit.folderPath).toBe("政策法规")
    expect(hit.format).toBe("docx")
    expect(hit.summary).toBe("含数据元对照")
  })
})

describe("② 命中次数：按片段里 [[词]] 标记计数", () => {
  it("数出标记个数", () => {
    expect(countSnippetHits("…要求完成 [[43 个数据元]]的改造…")).toBe(1)
    expect(countSnippetHits("…[[互联互通四甲]]…[[数据元]]…")).toBe(2)
  })

  it("没有标记 → 0", () => {
    expect(countSnippetHits("普通片段")).toBe(0)
    expect(countSnippetHits("")).toBe(0)
  })
})

describe("③ 时间分档（近 7 天 / 近 90 天 / 更早）", () => {
  const now = Date.parse("2026-11-11T08:00:00Z")
  const days = (n: number) => new Date(now - n * 86400000).toISOString()

  it("边界：7 天算 d7、8 天算 d90、91 天算 older", () => {
    expect(timeBucketOf(days(3), now)).toBe("d7")
    expect(timeBucketOf(days(7), now)).toBe("d7")
    expect(timeBucketOf(days(8), now)).toBe("d90")
    expect(timeBucketOf(days(90), now)).toBe("d90")
    expect(timeBucketOf(days(91), now)).toBe("older")
  })

  it("非法时间算「更早」（不崩、不算 d7）", () => {
    expect(timeBucketOf("", now)).toBe("older")
    expect(timeBucketOf("nope", now)).toBe("older")
  })

  it("统计三档计数", () => {
    const counts = timeBucketCounts([{ updated: days(2) }, { updated: days(30) }, { updated: days(200) }], now)
    expect(counts).toEqual({ d7: 1, d90: 1, older: 1 })
  })
})
