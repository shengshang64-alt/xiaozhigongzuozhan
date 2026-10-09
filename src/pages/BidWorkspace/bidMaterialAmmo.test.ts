import { describe, expect, it } from "vitest"
import type { KbDocRow } from "@/lib/kbCore"
import type { KbQaPairRow } from "@/lib/kbQa"
import { buildBidRecos, pickAmmoPairs, pickKbHits, pickSiblingChapters } from "./bidMaterialAmmo"

function doc(over: Partial<KbDocRow> & { id: string; title: string; content: string }): KbDocRow {
  return {
    rh_user_id: "u1",
    folder_path: "团队",
    doc_format: "md",
    visibility: "team",
    summary: "",
    keywords: [],
    source_file_name: "",
    uploader_name: "",
    created: "",
    updated: "",
    // 显式 original，避免分类默认对断言造成脱敏扰动
    ai_context_mode: "original",
    ...over,
  } as KbDocRow
}

function qa(over: Partial<KbQaPairRow> & { id: string; question: string; answer: string }): KbQaPairRow {
  return {
    rh_user_id: "u1",
    category: "标准问答",
    status: "approved",
    source: "manual",
    visibility: "team",
    created: "",
    updated: "",
    ...over,
  } as KbQaPairRow
}

describe("bidMaterialAmmo · 知识库检索", () => {
  const docs = [
    doc({ id: "d1", title: "智慧院区数据中台集成方案", content: "本项目采用数据中台完成多院区数据治理与集成，支撑互联互通。" }),
    doc({ id: "d2", title: "医院后勤保障手册", content: "食堂与保洁排班制度说明。" }),
  ]
  it("空查询返回空数组", () => {
    expect(pickKbHits(docs, "u1", "")).toEqual([])
  })
  it("命中相关文档，标题/标签/摘要齐备", () => {
    const hits = pickKbHits(docs, "u1", "数据中台 集成")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].title).toBe("智慧院区数据中台集成方案")
    expect(hits[0].key.startsWith("kb:d1")).toBe(true)
    expect(hits[0].snippet.length).toBeGreaterThan(0)
  })
  it("个人可见性文档对他人不可见", () => {
    const priv = [doc({ id: "d3", title: "数据中台私有笔记", content: "数据中台集成", visibility: "personal", rh_user_id: "other" })]
    expect(pickKbHits(priv, "u1", "数据中台")).toEqual([])
    expect(pickKbHits(priv, "other", "数据中台").length).toBeGreaterThan(0)
  })
})

describe("bidMaterialAmmo · 弹药库问答", () => {
  const pairs = [
    qa({ id: "q1", question: "如何保证系统高可用", answer: "双活部署 + 自动故障切换。" }),
    qa({ id: "q2", question: "报价有效期多久", answer: "自开标起 90 天。", status: "pending" }),
    qa({ id: "q3", question: "实施周期多长", answer: "标准三到六个月。" }),
  ]
  it("无查询只返回已审批问答，过滤 pending", () => {
    const items = pickAmmoPairs(pairs, "u1", "")
    expect(items.map((i) => i.key)).not.toContain("ammo:q2")
    expect(items.length).toBe(2)
  })
  it("有查询按相似度优先命中问答", () => {
    const items = pickAmmoPairs(pairs, "u1", "如何保证系统高可用")
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].key).toBe("ammo:q1")
  })
})

describe("bidMaterialAmmo · 本标书跨章素材", () => {
  const chapters = [
    { id: "c1", title: "项目实施方案", content: "分阶段实施与里程碑计划。" },
    { id: "c2", title: "售后服务方案", content: "驻场运维与响应时效承诺。" },
    { id: "c3", title: "空章节", content: "   " },
  ]
  it("排除当前章且过滤空正文", () => {
    const items = pickSiblingChapters(chapters, "c1", "")
    expect(items.map((i) => i.key)).not.toContain("sibling:c1")
    expect(items.map((i) => i.key)).not.toContain("sibling:c3")
  })
  it("有查询按命中词排序", () => {
    const items = pickSiblingChapters(chapters, "c1", "运维")
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].key).toBe("sibling:c2")
  })
})

describe("bidMaterialAmmo · 智能推荐组合", () => {
  const docs = [doc({ id: "d1", title: "数据中台总体架构", content: "数据中台与集成平台分层设计。" })]
  const pairs = [qa({ id: "q1", question: "数据中台如何治理", answer: "统一数据标准与血缘。" })]
  const siblings = [{ id: "c1", title: "数据中台建设", content: "构建院级数据中台。" }, { id: "c2", title: "当前章", content: "当前章正文。" }]
  it("按章主题跨三源产出推荐", () => {
    const recos = buildBidRecos({ docs, pairs, siblings, userId: "u1", chapterQuery: "数据中台 治理 集成", activeChapterId: "c2" })
    expect(recos.length).toBeGreaterThan(0)
    expect(recos.length).toBeLessThanOrEqual(6)
    const sources = new Set(recos.map((r) => r.source))
    expect(sources.has("kb")).toBe(true)
    // 推荐文本非空且带来源标签
    for (const r of recos) {
      expect(r.text.trim().length).toBeGreaterThan(0)
      expect(r.label.length).toBeGreaterThan(0)
    }
  })
  it("章主题为空时不推荐", () => {
    expect(buildBidRecos({ docs, pairs, siblings, userId: "u1", chapterQuery: "  ", activeChapterId: "c2" })).toEqual([])
  })
})
