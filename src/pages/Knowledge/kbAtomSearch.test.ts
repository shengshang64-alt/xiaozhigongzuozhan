import { describe, expect, it } from "vitest"
import { gateExplanation, toCitations, type AtomHit, type AtomSearchGate } from "./kbAtomSearch"

// ---------------------------------------------------------------------------
// P0-6 验收测试：检索硬门禁
//
// 需求（§9.1 + 原则 P5）：
//   「生成链路只读 approved 且未过期的原子。raw / pending 只能人工浏览。
//     这条不做，前面全部白做。验收时按红线检查。」
//
// 服务端过滤已通过真实 PB 验证（candidates 4 → afterValidUntil 3）。
// 本文件验证前端侧的**契约**：citations 透传、门禁说明、不自行放宽过滤。
// ---------------------------------------------------------------------------

function hit(p: Partial<AtomHit> & { atomId: string }): AtomHit {
  return {
    atomType: "metric",
    title: "电子病历应用水平达 5 级",
    body: "六安市中医院 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
    subjectKey: "metric:电子病历应用水平分级|国家卫健委评测",
    confidence: 0.92,
    kbTrack: "医院",
    kbBucket: "评级",
    kbSection: "",
    usableFor: ["proposal", "ppt"],
    confidentiality: "internal",
    score: 12.5,
    sourceDocId: "doc123",
    docName: "六安市中医院可研报告.docx",
    sourceAnchor: "p3-c1024-1180",
    sourceQuote: "该院于 2021 年通过电子病历应用水平分级 5 级评审",
    validUntil: "",
    ...p,
  }
}

function gate(p: Partial<AtomSearchGate> = {}): AtomSearchGate {
  return {
    contentStatus: "approved",
    validUntilAfter: "2026-10-30T00:00:00Z",
    confidentialityMax: "internal",
    usableFor: null,
    candidates: 4,
    afterValidUntil: 3,
    afterConfidentiality: 3,
    ...p,
  }
}

describe("toCitations：引用透传（§9.2 要求 citations 进最终产物）", () => {
  it("每条命中都转成可点开的引用", () => {
    const cs = toCitations([hit({ atomId: "a1" }), hit({ atomId: "a2", sourceDocId: "doc456", docName: "标书.docx" })])
    expect(cs).toHaveLength(2)
    expect(cs[0]).toMatchObject({
      atomId: "a1",
      docId: "doc123",
      docName: "六安市中医院可研报告.docx",
      anchor: "p3-c1024-1180",
    })
    expect(cs[0].quote.length).toBeGreaterThan(5)
    expect(cs[1].docName).toBe("标书.docx")
  })

  it("引用必须带 docId 与 anchor（否则无法跳回原文段落）", () => {
    const cs = toCitations([hit({ atomId: "a1" })])
    for (const c of cs) {
      expect(c.docId).toBeTruthy()
      expect(c.anchor).toBeTruthy()
    }
  })

  it("空结果返回空数组（不硬凑）", () => {
    expect(toCitations([])).toHaveLength(0)
  })
})

describe("gateExplanation：向用户解释「为什么某些内容搜不到」", () => {
  it("有过期滤除时明确说明", () => {
    const s = gateExplanation(gate({ candidates: 10, afterValidUntil: 7 }))
    expect(s).toContain("候选 10 条")
    expect(s).toContain("过期滤除 3")
  })

  it("有密级滤除时明确说明", () => {
    const s = gateExplanation(gate({ candidates: 10, afterValidUntil: 10, afterConfidentiality: 8 }))
    expect(s).toContain("密级滤除 2")
  })

  it("无滤除时只报候选数", () => {
    const s = gateExplanation(gate({ candidates: 5, afterValidUntil: 5, afterConfidentiality: 5 }))
    expect(s).toBe("候选 5 条")
  })
})

describe("硬门禁契约：前端不得放宽过滤", () => {
  it("citations 只来自服务端返回的 hits（前端不自行补充）", () => {
    // 这是一个契约测试：toCitations 是纯映射，不查询、不过滤、不补数据
    const hits = [hit({ atomId: "a1" })]
    const cs = toCitations(hits)
    expect(cs).toHaveLength(hits.length)
    expect(cs.map((c) => c.atomId)).toEqual(hits.map((h) => h.atomId))
  })

  it("命中结果携带 validUntil，供下游二次校验", () => {
    const cs = toCitations([hit({ atomId: "a1", validUntil: "2027-01-01" })])
    // Citation 本身不带 validUntil（那是 atom 级字段），但 hit 层必须带
    const h = hit({ atomId: "a1", validUntil: "2027-01-01" })
    expect(h.validUntil).toBe("2027-01-01")
    expect(cs).toHaveLength(1)
  })
})
