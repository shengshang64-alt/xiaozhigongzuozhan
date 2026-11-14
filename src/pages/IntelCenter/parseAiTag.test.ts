import { describe, expect, it } from "vitest"
import { buildTagMessages, parseAiTagResult } from "./useIntelCenter"
import type { IntelItemRow } from "./useIntelCenter"

function item(): IntelItemRow {
  return {
    id: "i1",
    title: "某医院信息化采购公告",
    content_snippet: "医院电子病历系统升级",
    summary: "",
    item_type: "media",
    item_status: "pending",
    my_status: "pending",
    region: "",
    source_id: "s1",
    source_name: "行业媒体",
    url: "https://example.com/1",
    published_at: "2026-11-10",
    created: "2026-11-10",
    updated: "2026-11-10",
    tags: [],
    visibility: "public",
    added_by: "crawl",
    owner_id: "",
  }
}

describe("AI 打标提示词与解析（t137）", () => {
  it("系统提示词允许 media 或 tech，并要求 topic 字段", () => {
    const sys = buildTagMessages(item()).find((m) => m.role === "system")?.content || ""
    expect(sys).toMatch(/media/)
    expect(sys).toMatch(/tech/)
    expect(sys).toMatch(/topic/)
    expect(sys).not.toMatch(/item_type":"policy 或 competitor 或 bid"/)
  })

  it("解析保留 media，不再兜底成 policy，并读取 topic", () => {
    const parsed = parseAiTagResult('{"summary":"医院信息化建设动态摘要字数足够","item_type":"media","topic":"HIS","region":"北京","tags":["电子病历"]}')
    expect(parsed?.item_type).toBe("media")
    expect(parsed?.topic).toBe("HIS")
  })

  it("无法识别的类型兜底为 media 而不是 policy", () => {
    const parsed = parseAiTagResult('{"summary":"一条无法归类的资讯摘要字数足够","item_type":"unknown","region":"","tags":[]}')
    expect(parsed?.item_type).toBe("media")
  })

  it("允许 tech 类型", () => {
    const parsed = parseAiTagResult('{"summary":"行业前沿技术观察摘要字数足够","item_type":"tech","topic":"大模型","region":"全国","tags":["AI"]}')
    expect(parsed?.item_type).toBe("tech")
  })
})
