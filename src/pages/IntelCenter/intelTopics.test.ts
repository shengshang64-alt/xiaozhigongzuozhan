import { describe, expect, it } from "vitest"
import {
  buildIntelItemsQueryString,
  classifyBidKind,
  hasFocusTopic,
  intelSinceDate,
  isPureAiGeneric,
  matchIntelTopics,
  primaryTopicBadge,
  selectHeadlineColumns,
  summarizeSourceHealth,
} from "./intelTopics"

describe("matchIntelTopics · t136 C 节词表", () => {
  it("能识别评级、核心系统、等保、医保与政策", () => {
    expect(matchIntelTopics("2026 年第五批电子病历评级通过名单")).toContain("评级测评")
    expect(matchIntelTopics("某医院 HIS 系统升级改造")).toContain("核心系统")
    expect(matchIntelTopics("医院信息平台机房等保测评")).toContain("等保与安全")
    expect(matchIntelTopics("DIP 支付方式改革配套信息化")).toContain("医保信息化")
    expect(matchIntelTopics("国家卫健委印发医院信息化建设指南")).toContain("政策规划")
  })

  it("竞品厂商与智慧医院可命中", () => {
    expect(matchIntelTopics("卫宁健康发布新一代智慧医院产品")).toEqual(
      expect.arrayContaining(["竞品厂商", "智慧医院/互联网医院"]),
    )
  })
})

describe("primaryTopicBadge", () => {
  it("优先展示评级/等保/HIS，不用采购或临床做徽标", () => {
    expect(primaryTopicBadge("电子病历评级结果公示采购公告")).toBe("评级")
    expect(primaryTopicBadge("医院等保测评项目招标采购")).toBe("等保")
    expect(primaryTopicBadge("某三甲医院 HIS 系统招标采购")).toBe("HIS")
    expect(primaryTopicBadge("临床路径管理采购项目")).not.toBe("采购")
    expect(primaryTopicBadge("临床路径管理采购项目")).not.toBe("临床")
  })
})

describe("isPureAiGeneric / classifyBidKind", () => {
  it("只谈大模型、没有其它重点话题的媒体文算纯 AI 泛资讯", () => {
    expect(isPureAiGeneric("大模型概念股集体走强", "media")).toBe(true)
    expect(isPureAiGeneric("医院接入医疗大模型提升电子病历书写", "media")).toBe(false)
  })

  it("招标按软件/混合/纯硬件分类", () => {
    expect(classifyBidKind("医院电子病历系统升级采购", "bid")).toBe("software")
    expect(classifyBidKind("医院信息系统及台式电脑采购", "bid")).toBe("mixed")
    expect(classifyBidKind("某医院国产化台式电脑采购", "bid")).toBe("hardware")
  })

  it("hasFocusTopic 对重点信息化成立，纯 AI 不成立", () => {
    expect(hasFocusTopic("智慧医院建设导则发布")).toBe(true)
    expect(hasFocusTopic("大模型概念股集体走强")).toBe(false)
  })
})

describe("selectHeadlineColumns", () => {
  const rows = [
    { id: "p1", title: "国家卫健委发布电子病历评级通知", item_type: "policy", published_at: "2026-11-10" },
    { id: "b1", title: "医院集成平台软件采购招标", item_type: "bid", published_at: "2026-11-09" },
    { id: "b2", title: "住院楼电梯采购招标公告", item_type: "bid", published_at: "2026-11-09" },
    { id: "c1", title: "东软发布新一代医院信息系统", item_type: "competitor", published_at: "2026-11-08" },
    { id: "m1", title: "智慧医院建设的几种实践路径", item_type: "media", published_at: "2026-11-07" },
    { id: "m2", title: "大模型概念再起，AI 应用展望", item_type: "media", published_at: "2026-11-07" },
  ]

  it("四栏按口径取条，纯硬件招标和纯 AI 泛资讯不进要闻", () => {
    const cols = selectHeadlineColumns(rows, 5)
    expect(cols.policy.map((x) => x.id)).toContain("p1")
    expect(cols.bid.map((x) => x.id)).toEqual(["b1"])
    expect(cols.competitor.map((x) => x.id)).toContain("c1")
    expect(cols.media.map((x) => x.id)).toEqual(["m1"])
  })

  it("每栏最多 5 条，同一条不跨栏重复", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      title: "国家卫健委信息化建设通知",
      item_type: "policy" as const,
      published_at: `2026-11-0${(i % 9) + 1}`,
    }))
    const cols = selectHeadlineColumns(many, 5)
    expect(cols.policy).toHaveLength(5)
    const ids = [...cols.policy, ...cols.bid, ...cols.competitor, ...cols.media].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("GET /api/intel/items 查询串", () => {
  it("since 必须是 YYYY-MM-DD，per_page 最大 50，tech 类型不会发给不认它的后端", () => {
    const since = intelSinceDate(30, new Date("2026-11-15T03:00:00+08:00"))
    expect(since).toBe("2026-10-16")
    const q = buildIntelItemsQueryString({
      item_status: "pending,confirmed",
      since,
      page: 1,
      per_page: 50,
    })
    expect(q).toContain("item_status=pending%2Cconfirmed")
    expect(q).toContain("since=2026-10-16")
    expect(q).toContain("per_page=50")
    expect(buildIntelItemsQueryString({ per_page: 200 })).toContain("per_page=50")
    expect(buildIntelItemsQueryString({ item_type: "tech" })).not.toContain("item_type=tech")
  })
})

describe("summarizeSourceHealth", () => {
  it("只统计启用中的异常，已停用失败源不报红，并清点静默空源", () => {
    const s = summarizeSourceHealth([
      { enabled: true, last_status: "error", fetched_count: 3 },
      { enabled: false, last_status: "error", fetched_count: 0 },
      { enabled: true, last_status: "ok", fetched_count: 0 },
      { enabled: true, last_status: "ok", fetched_count: 12 },
    ])
    expect(s).toEqual({
      enabledCount: 3,
      sourceCount: 4,
      enabledErrorCount: 1,
      silentEmptyCount: 1,
    })
  })
})
