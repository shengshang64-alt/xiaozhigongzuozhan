import { describe, expect, it } from "vitest"
import { roughFilterByMetadata, hydrateDocContents } from "./kbCorpusLazy"
import type { KbDocRow } from "./kbCore"

// ---------------------------------------------------------------------------
// 知识库渐进加载验收测试（2026-10-31 性能优化）
//
// 背景实测：
//   全量 7000 篇带正文 = 121MB / 2.4s
//   仅元数据（slim）   = 7.6MB / 1.4s  → 节省 94% 体积
//
// 本模块用「元数据粗筛 + 命中补正文」替代全量拉正文。
// 测试锁住两件事：
//   ① 粗筛能选中真正相关的文档（召回够用）
//   ② 不相关的不进候选（不浪费补正文的网络请求）
// ---------------------------------------------------------------------------

function doc(p: Partial<KbDocRow> & { id: string }): KbDocRow {
  return {
    rh_user_id: "u1",
    title: "",
    folder_path: "",
    content: "",
    doc_format: "docx",
    visibility: "team",
    summary: "",
    keywords: [],
    source_file_name: "",
    uploader_name: "",
    created: "",
    updated: "",
    ...p,
  } as KbDocRow
}

describe("roughFilterByMetadata：元数据粗筛", () => {
  const docs = [
    doc({ id: "1", title: "电子病历系统应用水平分级评价标准", keywords: ["电子病历", "分级"] }),
    doc({ id: "2", title: "互联互通四级甲等测评投标文件", keywords: ["互联互通", "四级甲等"] }),
    doc({ id: "3", title: "智慧医院建设方案", summary: "含预算与实施计划" }),
    doc({ id: "4", title: "公司差旅报销制度", keywords: ["报销"] }),
    doc({ id: "5", title: "中医医院特色业务方案", keywords: ["中医", "特色"] }),
  ]

  it("标题命中的文档被选中", () => {
    const ids = roughFilterByMetadata(docs, "电子病历 分级")
    expect(ids).toContain("1")
  })

  it("关键词命中的文档被选中", () => {
    const ids = roughFilterByMetadata(docs, "互联互通")
    expect(ids).toContain("2")
  })

  it("摘要命中的文档被选中", () => {
    const ids = roughFilterByMetadata(docs, "预算")
    expect(ids).toContain("3")
  })

  it("完全无关的文档不进候选", () => {
    const ids = roughFilterByMetadata(docs, "电子病历")
    expect(ids).not.toContain("4")
  })

  it("标题权重高于摘要（评分排序）", () => {
    const ids = roughFilterByMetadata(docs, "智慧医院")
    expect(ids[0]).toBe("3")
  })

  it("赛道命中加权", () => {
    const withTrack = [
      doc({ id: "a", title: "方案A", kb_track: "智慧医院" }),
      doc({ id: "b", title: "方案B", kb_track: "HIS系统" }),
    ]
    const ids = roughFilterByMetadata(withTrack, "方案", { track: "智慧医院" })
    expect(ids[0]).toBe("a")
  })

  it("空查询返回空（不做无谓计算）", () => {
    expect(roughFilterByMetadata(docs, "")).toHaveLength(0)
    expect(roughFilterByMetadata(docs, "  ")).toHaveLength(0)
  })

  it("候选数受 maxCandidates 限制", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      doc({ id: String(i), title: `电子病历方案${i}` }),
    )
    expect(roughFilterByMetadata(many, "电子病历", { maxCandidates: 10 })).toHaveLength(10)
  })

  it("按分数降序排列", () => {
    const scored = [
      doc({ id: "low", title: "其他文档", summary: "电子病历" }), // 摘要命中 1 分
      doc({ id: "high", title: "电子病历评价标准" }), // 标题命中 3 分
    ]
    const ids = roughFilterByMetadata(scored, "电子病历")
    expect(ids[0]).toBe("high")
  })
})

describe("hydrateDocContents：按需补正文", () => {
  it("空 ids 直接返回原数组（不做网络请求）", async () => {
    const docs = [doc({ id: "1", title: "a" })]
    expect(await hydrateDocContents(docs, [])).toBe(docs)
  })

  it("已有正文的文档不重复拉取", async () => {
    const docs = [doc({ id: "1", title: "a", content: "已有正文" })]
    const out = await hydrateDocContents(docs, ["1"])
    expect(out[0].content).toBe("已有正文")
  })

  it("未命中的文档保持原样", async () => {
    const docs = [doc({ id: "1", title: "a" }), doc({ id: "2", title: "b" })]
    // 只请求不存在的 id（网络会失败但不应抛错）
    const out = await hydrateDocContents(docs, ["not-exist"])
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe("")
  })
})
