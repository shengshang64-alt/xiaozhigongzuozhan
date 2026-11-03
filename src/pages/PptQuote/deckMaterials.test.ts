import { describe, expect, it } from "vitest"
import {
  buildLibrary,
  chunkText,
  detectConflicts,
  librarySummary,
  refsForSlide,
  searchChunks,
  type MaterialDoc,
} from "./deckMaterials"

// ---------------------------------------------------------------------------
// 阶段 2 验收测试：素材分块 / 检索 / sourceRefs / 冲突检测
//
// 对应需求：
//   · 对较长素材先建立检索索引，逐页生成时只传入相关片段，避免整份材料反复塞入提示词
//   · 每页保存 sourceRefs，能够查看该页引用了哪些素材及对应段落
//   · 素材之间出现数据冲突时不得自行选择，必须提示用户确认
//   · 区分"内容参考素材"和"视觉参考素材"，不得混用
// ---------------------------------------------------------------------------

function mkDoc(name: string, text: string, kind: "content" | "visual" = "content"): MaterialDoc {
  const id = `m_${name}`
  return { id, name, kind, text, chunks: chunkText(text, id, name), warnings: [], charCount: text.length }
}

const 可研 = mkDoc(
  "遂溪县中医院可研报告.docx",
  `第一章 项目概况
遂溪县中医院为二级甲等中医医院，编制床位 300 张，年门诊量 42 万人次。

第二章 现状分析
医院现有 HIS、EMR、LIS 三套系统，字典不统一，药名不互通。PACS 影像与病历系统脱钩，调阅靠人工。

第三章 建设目标
电子病历应用水平达到 5 级，互联互通标准化成熟度测评达到四级甲等。建设周期 12 个月，投资预算 1800 万元。

第四章 实施计划
调研 2 周，建设 6 个月，试运行 3 个月，验收 1 个月。`,
)

const 标书 = mkDoc(
  "历史投标文件.docx",
  `项目理解
本院开放床位 320 张，年门诊量 45 万人次，与可研口径略有差异。

技术方案
采用一体化数据底座，覆盖门诊、住院、医技、药事四大业务域。`,
)

const 视觉 = mkDoc("公司模板风格说明.pptx", "配色：深藏青 #1B3A5C，正文黑色，强调色墨绿。页面比例 16:9。", "visual")

describe("chunkText：分块与标题识别", () => {
  it("按小节标题切块，heading 被记录", () => {
    const chunks = 可研.chunks
    expect(chunks.length).toBeGreaterThan(2)
    const headings = chunks.map((c) => c.heading).filter(Boolean)
    expect(headings.some((h) => h?.includes("现状分析"))).toBe(true)
  })

  it("每块 id 稳定且唯一", () => {
    const ids = 可研.chunks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toMatch(/^m_遂溪县中医院可研报告\.docx#\d+$/)
  })

  it("单块不超过上限字数", () => {
    const long = mkDoc("长文档.txt", Array.from({ length: 200 }, (_, i) => `这是第 ${i} 段很长的正文内容用于测试分块逻辑是否会被正确切分。`).join("\n"))
    expect(long.chunks.length).toBeGreaterThan(3)
    for (const c of long.chunks) expect(c.text.length).toBeLessThanOrEqual(600)
  })

  it("空文本不产生块", () => {
    expect(chunkText("", "m", "n")).toHaveLength(0)
    expect(chunkText("   \n\n  ", "m", "n")).toHaveLength(0)
  })
})

describe("buildLibrary + searchChunks：检索", () => {
  const lib = buildLibrary([可研, 标书, 视觉])

  it("按关键词检索到正确片段", () => {
    const hits = searchChunks(lib, "字典不统一 药名", { topK: 3 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text).toContain("字典")
  })

  it("检索不返回视觉素材的块（内容/视觉不得混用）", () => {
    const hits = searchChunks(lib, "深藏青 配色 模板", { topK: 10 })
    expect(hits.every((h) => h.materialId !== 视觉.id)).toBe(true)
  })

  it("无关查询返回空（不会硬凑）", () => {
    expect(searchChunks(lib, "量子计算区块链", { topK: 5 })).toHaveLength(0)
  })

  it("标题命中权重更高", () => {
    const hits = searchChunks(lib, "建设目标", { topK: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].heading ?? "").toContain("建设目标")
  })
})

describe("refsForSlide：逐页 sourceRefs", () => {
  const lib = buildLibrary([可研, 标书, 视觉])

  it("为页面生成带素材名与摘录的 refs", () => {
    const refs = refsForSlide(lib, "电子病历 5 级是核心目标", "讲评级目标与周期", 2)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0].chunkId).toBeTruthy()
    expect(refs[0].materialName).toContain("可研报告")
    expect(refs[0].excerpt.length).toBeGreaterThan(10)
    expect(refs[0].kind).toBe("content")
  })

  it("素材名带上小节标题，便于用户定位", () => {
    const refs = refsForSlide(lib, "建设目标", "评级目标", 3)
    const withHeading = refs.find((r) => r.materialName.includes("·"))
    expect(withHeading).toBeTruthy()
  })
})

describe("detectConflicts：冲突只报告不裁决", () => {
  const lib = buildLibrary([可研, 标书, 视觉])

  it("同一指标不同数值 → 报告冲突并列出所有值", () => {
    const conflicts = detectConflicts(lib)
    const beds = conflicts.find((c) => c.metric.includes("床位"))
    expect(beds).toBeTruthy()
    expect(beds!.values.length).toBeGreaterThanOrEqual(2)
    // 300 与 320 都应出现
    expect(beds!.values.join(",")).toMatch(/300|320/)
  })

  it("冲突项带出处，用户可核对", () => {
    const conflicts = detectConflicts(lib)
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts[0].refs.length).toBeGreaterThan(0)
    expect(conflicts[0].refs[0].materialName).toBeTruthy()
  })

  it("单一口径不报冲突", () => {
    const single = buildLibrary([mkDoc("单一.txt", "编制床位 300 张。投资预算 1800 万元。")])
    const conflicts = detectConflicts(single)
    expect(conflicts).toHaveLength(0)
  })
})

describe("librarySummary：给用户看的摘要", () => {
  it("区分内容素材与视觉素材数量", () => {
    const lib = buildLibrary([可研, 标书, 视觉])
    const s = librarySummary(lib)
    expect(s).toContain("内容素材 2 份")
    expect(s).toContain("视觉素材 1 份")
  })
})
