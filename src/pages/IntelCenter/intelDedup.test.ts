import { describe, expect, it } from "vitest"
import { groupIntelItems, normalizeIntelTitle } from "./intelDedup"
import type { IntelItemRow } from "./useIntelCenter"

function row(partial: Partial<IntelItemRow>): IntelItemRow {
  return {
    id: Math.random().toString(36).slice(2),
    title: "同一项目招标公告",
    url: "",
    source_id: "s1",
    source_name: "来源甲",
    content_snippet: "",
    item_type: "bid",
    summary: "",
    tags: [],
    region: "",
    item_status: "pending",
    added_by: "crawl",
    owner_id: "",
    published_at: "2026-11-01",
    created: "2026-11-01",
    updated: "2026-11-01",
    visibility: "public",
    my_status: "pending",
    ...partial,
  }
}

describe("情报同题聚合", () => {
  it("同 URL 合并并保留全部来源，摘要取更完整版本", () => {
    const out = groupIntelItems([
      row({ id: "a", url: "https://a.cn/p/1", summary: "短", source_name: "甲" }),
      row({ id: "b", url: "https://a.cn/p/1", summary: "更完整的摘要内容", source_name: "乙" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].duplicate_count).toBe(2)
    expect(out[0].duplicate_sources).toEqual(["甲", "乙"])
    expect(out[0].summary).toBe("更完整的摘要内容")
  })

  it("不同 URL 但同类型同题也聚合；标点与空白差异不影响归一", () => {
    expect(normalizeIntelTitle("某医院：智慧 医疗项目")).toBe(normalizeIntelTitle("某医院智慧医疗项目"))
    const out = groupIntelItems([
      row({ id: "a", title: "某医院：智慧 医疗项目", url: "https://a.cn/1", source_name: "甲" }),
      row({ id: "b", title: "某医院智慧医疗项目", url: "https://b.cn/2", source_name: "乙" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].duplicate_sources).toEqual(["甲", "乙"])
  })

  it("不同类型或不同标题不误合并；结构化字段只补空缺", () => {
    const out = groupIntelItems([
      row({ id: "a", structured: { budget: "100万元" }, title: "项目A", url: "https://a.cn/1" }),
      row({ id: "b", structured: { budget: "200万元", deadline: "2026-11-20" }, title: "项目A", url: "https://b.cn/2" }),
      row({ id: "c", title: "项目B", url: "https://c.cn/3" }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].structured).toMatchObject({ budget: "100万元", deadline: "2026-11-20" })
  })
})
