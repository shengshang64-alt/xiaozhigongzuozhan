import { describe, expect, it } from "vitest"
import { searchKbDocs, type KbDocRow } from "./kbCore"
import { assembleKbContext } from "./kbAssemble"

// ---------------------------------------------------------------------------
// 组装层：赛道/桶软加权 + 缺料探测 + 「无 profile 时等价 searchKbDocs」回归
// 说明：assembleKbContext 是纯函数（接收 docs 数组），不触网；getCachedVisibleDocs 才触网，故此处不测。
// ---------------------------------------------------------------------------

const TS = "2026-01-01 00:00:00.000Z"

function doc(over: Partial<KbDocRow> & { id: string }): KbDocRow {
  return {
    rh_user_id: "u1",
    title: "数据治理方案",
    folder_path: "售前知识库",
    content: "数据治理平台建设内容与实施方案",
    doc_format: "md",
    visibility: "team",
    summary: "",
    keywords: [],
    source_file_name: `${over.id}.md`,
    uploader_name: "test",
    created: TS,
    updated: TS,
    ...over,
  }
}

describe("assembleKbContext · 等价回归", () => {
  const corpus: KbDocRow[] = [
    doc({ id: "c1", title: "数据治理平台建设方案", content: "本项目围绕数据治理平台建设，梳理数据标准与数据质量。" }),
    doc({ id: "c2", title: "电子病历评级路径", content: "电子病历五级评级需要闭环管理与数据治理支撑。" }),
    doc({ id: "c3", title: "医保基金监管", content: "医保基金智能审核与 DRG 分组管理。" }),
  ]

  it("无 track 且无 buckets 时，逐条等价 searchKbDocs（含顺序与分数）", () => {
    const raw = searchKbDocs(corpus, "数据治理", 5)
    const asm = assembleKbContext(corpus, { query: "数据治理", topN: 5 })
    expect(raw.length).toBeGreaterThan(0) // 前置：确有命中，回归才有意义
    expect(asm.hits).toEqual(raw)
    expect(asm.trackStatus).toEqual({ level: "na", count: 0 })
  })

  it("仅有 buckets（无 track）时 trackStatus 仍为 na", () => {
    const asm = assembleKbContext(corpus, { query: "数据治理", buckets: ["方案素材"], topN: 5 })
    expect(asm.trackStatus).toEqual({ level: "na", count: 0 })
  })

  it("空命中语料：等价返回空数组", () => {
    const raw = searchKbDocs(corpus, "与全部无关的qqqzzz", 5)
    const asm = assembleKbContext(corpus, { query: "与全部无关的qqqzzz", topN: 5 })
    expect(raw).toEqual([])
    expect(asm.hits).toEqual([])
  })
})

describe("assembleKbContext · 赛道软加权", () => {
  // 两条基础分完全相同的文档，仅 retrieval_weight 与 kb_track 不同：
  // X 原始分略高（跨赛道），Y 略低但命中场景赛道 → 加权后应翻转到前列。
  const X = doc({
    id: "x",
    title: "数据治理平台",
    content: "数据治理平台建设内容",
    ai_context_mode: "original",
    retrieval_weight: 1.0,
    kb_track: "互联互通评级",
  })
  const Y = doc({
    id: "y",
    title: "数据治理平台",
    content: "数据治理平台建设内容",
    ai_context_mode: "original",
    retrieval_weight: 0.95,
    kb_track: "电子病历评级",
  })
  const docs = [X, Y]

  it("原始 BM25：跨赛道文档 X 排在前", () => {
    const raw = searchKbDocs(docs, "数据治理", 5)
    expect(raw[0].doc.id).toBe("x")
  })

  it("命中场景赛道的 Y 被提到首位，并给出 thin 缺料状态", () => {
    const asm = assembleKbContext(docs, { query: "数据治理", track: "电子病历评级", topN: 5 })
    expect(asm.hits[0].doc.id).toBe("y")
    // 库内仅 1 篇该赛道候选（< 阈值 3）→ thin
    expect(asm.trackStatus).toEqual({ level: "thin", count: 1, track: "电子病历评级" })
  })

  it("「通用」赛道中性：不降权，排到被降权的跨赛道文档之前", () => {
    const Z = doc({
      id: "z",
      title: "数据治理平台",
      content: "数据治理平台建设内容",
      ai_context_mode: "original",
      retrieval_weight: 1.0,
      kb_track: "通用",
    })
    const asm = assembleKbContext([X, Z], { query: "数据治理", track: "电子病历评级", topN: 5 })
    // X 跨赛道 ×0.9 → 0.9；Z 通用 中性 ×1 → 1.0
    expect(asm.hits[0].doc.id).toBe("z")
  })
})

describe("assembleKbContext · 用途桶软加权", () => {
  const P = doc({
    id: "p",
    title: "数据治理平台",
    content: "数据治理平台建设内容",
    ai_context_mode: "original",
    retrieval_weight: 1.0,
    kb_bucket: "其他",
  })
  const Q = doc({
    id: "q",
    title: "数据治理平台",
    content: "数据治理平台建设内容",
    ai_context_mode: "original",
    retrieval_weight: 0.95,
    kb_bucket: "方案素材",
  })

  it("命中 buckets 的文档被加权提到首位", () => {
    const raw = searchKbDocs([P, Q], "数据治理", 5)
    expect(raw[0].doc.id).toBe("p") // 原始：P 略高
    const asm = assembleKbContext([P, Q], { query: "数据治理", buckets: ["方案素材"], topN: 5 })
    expect(asm.hits[0].doc.id).toBe("q") // 加权：Q ×1.15 反超
  })

  it("bucket 不在场景桶内：不升不降（保持原始顺序）", () => {
    const asm = assembleKbContext([P, Q], { query: "数据治理", buckets: ["竞品情报"], topN: 5 })
    expect(asm.hits[0].doc.id).toBe("p")
  })
})

describe("assembleKbContext · 缺料探测", () => {
  const mk = (n: number, track: string): KbDocRow[] =>
    Array.from({ length: n }, (_, i) =>
      doc({ id: `${track}-${i}`, title: `智慧医院材料${i}`, content: "智慧医院建设内容", kb_track: track }),
    )

  it("库内无该赛道候选 → empty", () => {
    const asm = assembleKbContext(mk(2, "智慧医院"), { query: "智慧医院", track: "DRG-DIP医保", topN: 5 })
    expect(asm.trackStatus).toEqual({ level: "empty", count: 0, track: "DRG-DIP医保" })
  })

  it("候选 < 阈值(默认3) → thin", () => {
    const asm = assembleKbContext(mk(2, "智慧医院"), { query: "智慧医院", track: "智慧医院", topN: 5 })
    expect(asm.trackStatus).toEqual({ level: "thin", count: 2, track: "智慧医院" })
  })

  it("候选 >= 阈值 → ok", () => {
    const asm = assembleKbContext(mk(3, "智慧医院"), { query: "智慧医院", track: "智慧医院", topN: 5 })
    expect(asm.trackStatus.level).toBe("ok")
    expect(asm.trackStatus.count).toBe(3)
  })

  it("自定义 thinThreshold 改变判定边界", () => {
    const docs = mk(2, "智慧医院")
    const tight = assembleKbContext(docs, { query: "智慧医院", track: "智慧医院", thinThreshold: 2 })
    expect(tight.trackStatus.level).toBe("ok") // 2 < 2 为假 → ok
    const loose = assembleKbContext(docs, { query: "智慧医院", track: "智慧医院", thinThreshold: 5 })
    expect(loose.trackStatus.level).toBe("thin") // 2 < 5 → thin
  })
})
