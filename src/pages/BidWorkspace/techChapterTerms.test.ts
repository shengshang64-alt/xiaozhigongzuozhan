import { describe, expect, it } from "vitest"
import { extendQueryWithSynonyms, listTechTopics, techTermsForTitle } from "./techChapterTerms"

// ---------------------------------------------------------------------------
// 技术方案章节同义词表验收测试（2026-10-31 标书生成优化）
//
// 背景：真实招标文件里，章节标题的词往往**不是**招标文件里的常见表述。
//   实测（本地 3 份真实招标文件 60+ 万字统计）：
//     「培训」出现 53 次，而「培训方案」只有 5 次
//     「实施」164 次 / 「阶段」96 次 / 「里程碑」8 次
//     「接口」148 次 / 「集成」112 次
//   只拿章节标题去检索，会漏掉大量真正相关的原文。
//
// 本表把这些"招标文件实际措辞"补进检索词，纯本地零 AI。
// ---------------------------------------------------------------------------

describe("techTermsForTitle：章节标题 → 主题同义词", () => {
  it("培训类章节拿到培训相关词（含「考核」，这是培训方案必覆盖的评分点）", () => {
    const terms = techTermsForTitle("培训方案")
    expect(terms).toContain("培训")
    expect(terms).toContain("考核")
    expect(terms).toContain("培训计划")
  })

  it("实施类章节拿到进度相关词", () => {
    const terms = techTermsForTitle("项目实施、管理与协同保障方案")
    expect(terms).toContain("实施")
    expect(terms).toContain("里程碑")
    expect(terms).toContain("工期")
  })

  it("运维/售后类章节拿到运维相关词", () => {
    const terms = techTermsForTitle("售后服务、运维保障")
    expect(terms).toContain("运维")
    expect(terms).toContain("巡检")
  })

  it("应急类章节拿到故障/容灾词", () => {
    const terms = techTermsForTitle("应急方案")
    expect(terms).toContain("应急")
    expect(terms).toContain("容灾")
    expect(terms).toContain("故障")
  })

  it("迁移类章节拿到历史数据/归档词", () => {
    const terms = techTermsForTitle("历史数据治理、迁移与集成方案")
    expect(terms).toContain("迁移")
    expect(terms).toContain("历史数据")
    expect(terms).toContain("归档")
  })

  it("架构类章节拿到接口/集成词", () => {
    const terms = techTermsForTitle("总体技术解决方案")
    expect(terms).toContain("架构")
    expect(terms).toContain("接口")
  })

  it("一个标题命中多个主题时取并集（如「质保期外运维及新增接口」）", () => {
    const terms = techTermsForTitle("质保期外运维及新增接口服务方案")
    expect(terms).toContain("质保")
    expect(terms).toContain("运维")
    expect(terms).toContain("接口")
  })

  it("结果去重", () => {
    const terms = techTermsForTitle("实施与运维方案")
    const dup = terms.filter((t, i) => terms.indexOf(t) !== i)
    expect(dup).toHaveLength(0)
  })

  it("无匹配主题时返回空数组（保持原行为，不乱扩）", () => {
    expect(techTermsForTitle("量子计算机采购")).toEqual([])
    expect(techTermsForTitle("")).toEqual([])
  })
})

describe("extendQueryWithSynonyms：检索词扩展", () => {
  it("原有词全部保留且排在最前（优先级不变）", () => {
    const out = extendQueryWithSynonyms({ title: "培训方案", sections: ["培训内容"], clauses: ["培训师资要求"] })
    expect(out[0]).toBe("培训方案")
    expect(out[1]).toBe("培训内容")
    expect(out[2]).toBe("培训师资要求")
  })

  it("同义词追加在后面", () => {
    const out = extendQueryWithSynonyms({ title: "培训方案" })
    expect(out).toContain("考核")
    expect(out.indexOf("培训方案")).toBeLessThan(out.indexOf("考核"))
  })

  it("去重（标题与同义词重复时不重复出现）", () => {
    const out = extendQueryWithSynonyms({ title: "培训" })
    expect(out.filter((t) => t === "培训")).toHaveLength(1)
  })

  it("过短的元素被过滤（单字无检索价值）", () => {
    const out = extendQueryWithSynonyms({ title: "培训方案", clauses: ["a", "", "   "] })
    expect(out.every((t) => t.length >= 2)).toBe(true)
  })

  it("空标题只返回原有的 sections/clauses", () => {
    const out = extendQueryWithSynonyms({ title: "", sections: ["小节A"], clauses: [] })
    expect(out).toEqual(["小节A"])
  })

  it("扩展后词数显著多于原标题（提升召回的核心）", () => {
    const out = extendQueryWithSynonyms({ title: "培训方案" })
    expect(out.length).toBeGreaterThan(5)
  })
})

describe("词表本身的质量约束", () => {
  it("每个主题至少 5 个词（太少起不到扩展作用）", () => {
    for (const { topic, terms } of listTechTopics()) {
      expect(terms.length, `主题「${topic}」词表过少`).toBeGreaterThanOrEqual(5)
    }
  })

  it("词表内无重复", () => {
    for (const { topic, terms } of listTechTopics()) {
      expect(new Set(terms).size, `主题「${topic}」有重复词`).toBe(terms.length)
    }
  })

  it("覆盖标书常见的 8 类技术方案章节", () => {
    const topics = listTechTopics().map((t) => t.topic)
    for (const need of ["培训", "实施", "运维", "应急", "数据迁移", "架构集成"]) {
      expect(topics).toContain(need)
    }
  })

  it("不包含臆造词：所有词都是中文且长度 ≥2", () => {
    for (const { terms } of listTechTopics()) {
      for (const t of terms) {
        expect(t.length).toBeGreaterThanOrEqual(2)
        expect(/[\u4e00-\u9fa5]/.test(t)).toBe(true)
      }
    }
  })
})
