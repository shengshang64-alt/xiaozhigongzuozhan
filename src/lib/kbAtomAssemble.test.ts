import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  assembleAtomContext,
  atomsToPromptBlock,
  citationsToFootnote,
  reportAtomUsageAfterGen,
} from "./kbAtomAssemble"
import type { AtomHit } from "@/pages/Knowledge/kbAtomSearch"

// ---------------------------------------------------------------------------
// P0-7 验收测试：知识原子消费装配
//
// 需求（§9.2）：
//   「assembleKbContext 改造为只接受原子，新增返回字段 citations」
//   「citations 必须透传到方案/PPT/标书的最终产物里，供用户点开核对」
//
// ⚠️ 本测试用 fetch mock，因为 kbAtomSearch 走 getPocketBaseUrl()（浏览器相对路径 /__pb）。
//    真实端到端已在 PB 上验证过（命中 3 条、usableFor 过滤正确、追溯完整）。
// ---------------------------------------------------------------------------

function hit(p: Partial<AtomHit> & { atomId: string }): AtomHit {
  return {
    atomType: "metric",
    title: "六安市中医院电子病历达 5 级",
    body: "该院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
    subjectKey: "metric:电子病历应用水平分级|国家卫健委",
    confidence: 0.92,
    kbTrack: "智慧医院",
    kbBucket: "评级",
    kbSection: "",
    usableFor: ["proposal", "ppt"],
    confidentiality: "internal",
    score: 12.5,
    sourceDocId: "doc123",
    docName: "六安市中医院可研报告.docx",
    sourceAnchor: "p5-c1200-1500",
    sourceQuote: "该院于 2021 年通过电子病历应用水平分级 5 级评审",
    validUntil: "",
    ...p,
  }
}

const GATE = {
  contentStatus: "approved",
  validUntilAfter: "2026-10-31T00:00:00Z",
  confidentialityMax: "internal",
  usableFor: "proposal",
  candidates: 4,
  afterValidUntil: 4,
  afterConfidentiality: 4,
}

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
}

describe("assembleAtomContext：原子版装配", () => {
  const origFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it("未登录时返回空并说明原因", async () => {
    const r = await assembleAtomContext(null, { query: "电子病历", usableFor: "proposal" })
    expect(r.hits).toHaveLength(0)
    expect(r.empty).toBe(true)
    expect(r.gateNote).toContain("未登录")
  })

  it("空检索语句不发起请求", async () => {
    globalThis.fetch = mockFetch({ ok: true, hits: [] })
    const r = await assembleAtomContext("u1", { query: "   ", usableFor: "proposal" })
    expect(r.empty).toBe(true)
    expect(r.gateNote).toContain("为空")
  })

  it("命中时返回 hits + citations", async () => {
    globalThis.fetch = mockFetch({ ok: true, hits: [hit({ atomId: "a1" })], total: 1, gate: GATE })
    const r = await assembleAtomContext("u1", { query: "电子病历", usableFor: "proposal" })
    expect(r.hits).toHaveLength(1)
    expect(r.citations).toHaveLength(1)
    expect(r.citations[0]).toMatchObject({
      atomId: "a1",
      docId: "doc123",
      docName: "六安市中医院可研报告.docx",
      anchor: "p5-c1200-1500",
    })
    expect(r.empty).toBe(false)
  })

  it("门禁说明透出（用户能看到为什么少了内容）", async () => {
    globalThis.fetch = mockFetch({ ok: true, hits: [], total: 0, gate: { ...GATE, candidates: 10, afterValidUntil: 7 } })
    const r = await assembleAtomContext("u1", { query: "x", usableFor: "proposal" })
    expect(r.gateNote).toContain("候选 10 条")
    expect(r.gateNote).toContain("过期滤除 3")
  })

  it("检索失败时降级为空白，不抛错（不阻断生成链路）", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    const r = await assembleAtomContext("u1", { query: "x", usableFor: "proposal" })
    expect(r.empty).toBe(true)
    expect(r.gateNote).toContain("检索失败")
  })

  it("HTTP 错误也降级不抛", async () => {
    globalThis.fetch = mockFetch({ message: "boom" }, false)
    const r = await assembleAtomContext("u1", { query: "x", usableFor: "proposal" })
    expect(r.empty).toBe(true)
  })
})

describe("atomsToPromptBlock：注入 LLM 的文本", () => {
  it("把原子渲染成带原文摘录的要点", () => {
    const block = atomsToPromptBlock([hit({ atomId: "a1" })])
    expect(block).toContain("六安市中医院电子病历达 5 级")
    expect(block).toContain("2021 年")
    expect(block).toContain("原文：")
  })

  it("多条原子用空行分隔", () => {
    const block = atomsToPromptBlock([hit({ atomId: "a1", title: "A" }), hit({ atomId: "a2", title: "B" })])
    expect(block).toContain("\n\n")
  })

  it("空数组返回空串", () => {
    expect(atomsToPromptBlock([])).toBe("")
  })
})

describe("citationsToFootnote：产物末尾的来源清单", () => {
  it("渲染成编号来源清单", () => {
    const md = citationsToFootnote([
      { atomId: "a1", docId: "d1", docName: "可研报告.docx", anchor: "p5-c1200-1500", quote: "x", title: "t" },
      { atomId: "a2", docId: "d2", docName: "历史标书.docx", anchor: "p3-c100-200", quote: "y", title: "u" },
    ])
    expect(md).toContain("资料来源")
    expect(md).toContain("[1] 《可研报告.docx》")
    expect(md).toContain("p5-c1200-1500")
    expect(md).toContain("[2] 《历史标书.docx》")
  })

  it("空引用返回空串（不生成空标题）", () => {
    expect(citationsToFootnote([])).toBe("")
  })
})

describe("reportAtomUsageAfterGen：使用反哺", () => {
  const origFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it("未登录或空命中不上报", async () => {
    const f = vi.fn()
    globalThis.fetch = f as unknown as typeof fetch
    await reportAtomUsageAfterGen(null, [hit({ atomId: "a1" })])
    await reportAtomUsageAfterGen("u1", [])
    expect(f).not.toHaveBeenCalled()
  })

  it("有命中时上报 atomIds", async () => {
    const f = mockFetch({ ok: true })
    globalThis.fetch = f
    await reportAtomUsageAfterGen("u1", [hit({ atomId: "a1" }), hit({ atomId: "a2" })])
    expect(f).toHaveBeenCalled()
    const call = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, { body: string }]
    expect(call[1].body).toContain("a1")
    expect(call[1].body).toContain("a2")
  })
})

describe("核心契约：前端不做二次过滤（门禁在服务端）", () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch({ ok: true, hits: [hit({ atomId: "a1" })], total: 1, gate: GATE })
  })
  afterEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  it("服务端返回什么就返回什么，前端不自己判断 approved/有效期", async () => {
    const r = await assembleAtomContext("u1", { query: "x", usableFor: "proposal" })
    // 即使 mock 返回的原子看起来"可疑"，前端也原样透传——门禁是服务端职责
    expect(r.hits).toHaveLength(1)
    expect(r.citations).toHaveLength(1)
  })
})


describe("citations 去重（2026-10-31 修复）", () => {
  it("同一 anchor 的多个原子只产生一条引用", async () => {
    // 实测问题：生成产物末尾出现 [1] 与 [6] 指向同一段原文
    const { toCitations } = await import("@/pages/Knowledge/kbAtomSearch")
    const hits = [
      hit({ atomId: "a1", sourceAnchor: "p151-c30852-31092" }),
      hit({ atomId: "a2", sourceAnchor: "p151-c30852-31092" }),
      hit({ atomId: "a3", sourceAnchor: "p200-c40000-40100" }),
    ]
    const cites = toCitations(hits)
    expect(cites).toHaveLength(2)
    expect(cites[0].anchor).toBe("p151-c30852-31092")
    expect(cites[1].anchor).toBe("p200-c40000-40100")
  })

  it("无 anchor 时按 docId+title 去重", async () => {
    const { toCitations } = await import("@/pages/Knowledge/kbAtomSearch")
    const hits = [
      hit({ atomId: "a1", sourceAnchor: "", title: "同一标题" }),
      hit({ atomId: "a2", sourceAnchor: "", title: "同一标题" }),
      hit({ atomId: "a3", sourceAnchor: "", title: "不同标题" }),
    ]
    expect(toCitations(hits)).toHaveLength(2)
  })
})
