// R-036 AI 热点模块逻辑单测（时效性 + 去重）
import { describe, expect, it } from "vitest"

/** 从 useAiHot.ts 中提取的可测试纯函数 */

// 去重判据：URL 相同 或 标题归一化后相同
function normalizeTitle(t: string): string {
  return (t ?? "").replace(/\s+/g, "").toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "")
}
function isDuplicate(existing: { url: string; title: string }[], item: { url: string; title: string }): boolean {
  return existing.some((e) => e.url === item.url || normalizeTitle(e.title) === normalizeTitle(item.title))
}

// 时效性：超过 maxDays 天的条目视为过期
function isExpired(item: { created: string }, maxDays = 7): boolean {
  const created = new Date((item.created ?? "").replace(" ", "T"))
  if (isNaN(created.getTime())) return false
  return Date.now() - created.getTime() > maxDays * 86_400_000
}

describe("R-036 AI热点去重", () => {
  it("URL 相同→判重复", () => {
    const existing = [{ url: "https://a.com/x", title: "标题A" }]
    expect(isDuplicate(existing, { url: "https://a.com/x", title: "标题B" })).toBe(true)
  })
  it("标题归一化相同→判重复", () => {
    const existing = [{ url: "https://a.com/1", title: "AI 大模型发布！" }]
    expect(isDuplicate(existing, { url: "https://b.com/2", title: "ai大模型发布" })).toBe(true)
  })
  it("不同URL+不同标题→不判重复", () => {
    const existing = [{ url: "https://a.com/1", title: "标题A" }]
    expect(isDuplicate(existing, { url: "https://b.com/2", title: "标题B" })).toBe(false)
  })
})

describe("R-036 AI热点时效性", () => {
  it("7天内→未过期", () => {
    const recent = new Date().toISOString().replace("T", " ").slice(0, 19)
    expect(isExpired({ created: recent })).toBe(false)
  })
  it("超过7天→过期", () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString().replace("T", " ").slice(0, 19)
    expect(isExpired({ created: old })).toBe(true)
  })
  it("无效日期→不误判为过期", () => {
    expect(isExpired({ created: "not-a-date" })).toBe(false)
  })
})
