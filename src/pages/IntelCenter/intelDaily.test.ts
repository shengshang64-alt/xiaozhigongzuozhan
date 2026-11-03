import { describe, expect, it } from "vitest"
import { intelDeadlineKind, parseIntelDeadline, selectDailyIntel, selectWeeklyIntelItems } from "./intelDaily"
import type { IntelItemRow } from "./useIntelCenter"

const NOW = new Date("2026-11-02T12:00:00+08:00")

function row(partial: Partial<IntelItemRow>): IntelItemRow {
  return {
    id: Math.random().toString(36).slice(2),
    source_id: "s",
    source_name: "来源",
    title: "测试情报",
    url: "",
    content_snippet: "",
    item_type: "media",
    summary: "",
    tags: [],
    region: "",
    item_status: "pending",
    added_by: "crawl",
    owner_id: "",
    visibility: "public",
    my_status: "pending",
    published_at: "2026-11-02",
    created: "2026-11-02",
    updated: "2026-11-02",
    ...partial,
  }
}

describe("截止日解析与分级", () => {
  it("支持 ISO、斜杠、中文日期和时间", () => {
    expect(parseIntelDeadline("2026-11-20 09:30", NOW)?.getDate()).toBe(20)
    expect(parseIntelDeadline("2026/11/20", NOW)?.getHours()).toBe(23)
    expect(parseIntelDeadline("2026年11月20日09:30", NOW)?.getMinutes()).toBe(30)
    expect(parseIntelDeadline("2026年11月20日 09时30分", NOW)?.getMinutes()).toBe(30)
  })

  it("非法日期返回 null，不猜", () => {
    expect(parseIntelDeadline("2026-13-40", NOW)).toBeNull()
    expect(parseIntelDeadline("待定", NOW)).toBeNull()
  })

  it("逾期/今天/7天内/更后分档正确", () => {
    expect(intelDeadlineKind("2026-11-01", NOW)).toBe("overdue")
    expect(intelDeadlineKind("2026-11-02 18:00", NOW)).toBe("today")
    expect(intelDeadlineKind("2026-11-08", NOW)).toBe("week")
    expect(intelDeadlineKind("2026-11-20", NOW)).toBe("later")
  })
})

describe("今日工作队列", () => {
  it("今天截止的招标优先于普通媒体，忽略和已确认不进入队列", () => {
    const out = selectDailyIntel([
      row({ id: "media", title: "普通行业新闻", item_type: "media" }),
      row({ id: "bid", title: "紧急招标", item_type: "bid", structured: { deadline: "2026-11-02 18:00", buyer: "某医院" } }),
      row({ id: "ignored", title: "已忽略", item_type: "bid", my_status: "ignored" }),
      row({ id: "confirmed", title: "已确认", item_type: "bid", my_status: "confirmed" }),
    ], NOW)
    expect(out.top[0].id).toBe("bid")
    expect(out.top[0].priority_reason).toContain("今天截止")
    expect(out.pendingCount).toBe(2)
  })

  it("临期按时间升序，过老截止不产生警报", () => {
    const out = selectDailyIntel([
      row({ id: "later", item_type: "bid", structured: { deadline: "2026-11-08" } }),
      row({ id: "today", item_type: "bid", structured: { deadline: "2026-11-02 18:00" } }),
      row({ id: "old", item_type: "bid", structured: { deadline: "2020-01-01" } }),
    ], NOW)
    expect(out.deadlines.map((d) => d.id)).toEqual(["today", "later"])
  })

  it("未来发布日不进必看；关注方向有额外权重", () => {
    const out = selectDailyIntel([
      row({ id: "future", title: "日期异常", published_at: "2027-01-01", item_type: "bid" }),
      row({ id: "focus", title: "关注竞品", item_type: "competitor" }),
    ], NOW, (it) => it.id === "focus")
    expect(out.top.map((it) => it.id)).toEqual(["focus"])
    expect(out.top[0].priority_reason).toContain("关注方向")
  })
})

describe("周报选材", () => {
  it("高分待办与临期优先，已确认保留，忽略/异常日期/超 7 天排除", () => {
    const out = selectWeeklyIntelItems([
      row({ id: "deadline", item_type: "bid", structured: { deadline: "2026-11-03 09:00" } }),
      row({ id: "confirmed", my_status: "confirmed", item_type: "policy" }),
      row({ id: "ignored", my_status: "ignored", item_type: "bid" }),
      row({ id: "future", published_at: "2027-01-01", item_type: "bid" }),
      row({ id: "old", published_at: "2026-10-01", created: "2026-10-01", item_type: "policy" }),
    ], NOW)
    expect(out.map((it) => it.id)).toEqual(["deadline", "confirmed"])
  })
})
