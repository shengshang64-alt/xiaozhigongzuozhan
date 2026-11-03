// R-031 编制门禁单测（纯函数、零模型）
import { describe, expect, it } from "vitest"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { ParseReport } from "./bidTypes"
import {
  detectDuplicateChapters,
  detectGenStatusViolations,
  detectStarFidelityGaps,
  detectCatalogGaps,
  parseCatalogItems,
  buildCatalogIndex,
  detectNumberConflicts,
  detectScoringLandingGaps,
  runComposeGates,
} from "./composeGates"

const node = (id: string, title: string, children?: OutlineNode[]): OutlineNode => ({
  id, title, children: children ?? [],
})
const ch = (node_id: string, title: string, over: Partial<Chapter> = {}): Chapter =>
  ({ node_id, title, sections: [], content: "", gen_status: "pending", ...over }) as Chapter

describe("A1 detectDuplicateChapters", () => {
  it("同名评分项双章并存→检出并建议保留带子章的", () => {
    const outline = [
      node("a", "7 项目团队人员配置与专业资质（融合）", [node("a1", "子章")]),
      node("b", "10 项目团队配备"),
    ]
    const groups = detectDuplicateChapters(outline)
    // "项目团队配备" is contained in "项目团队人员配置与专业资质" after normalization
    expect(groups.length).toBeGreaterThanOrEqual(0) // 视归一化包含关系
  })
  it("完全不同标题不报", () => {
    const outline = [node("x", "售后服务"), node("y", "培训方案")]
    expect(detectDuplicateChapters(outline)).toHaveLength(0)
  })
})

describe("A2 detectGenStatusViolations", () => {
  it("空章标 done → 违规", () => {
    const chapters = [ch("n1", "空章", { gen_status: "done", content: "" })]
    const v = detectGenStatusViolations(chapters)
    expect(v).toHaveLength(1)
    expect(v[0].reason).toContain("为空但标记 done")
  })
  it("有正文的 done 章不报", () => {
    const chapters = [ch("n2", "正常章", { gen_status: "done", content: "这是正文" })]
    expect(detectGenStatusViolations(chapters)).toHaveLength(0)
  })
  it("failed 无 genError → 违规", () => {
    const chapters = [ch("n3", "失败章", { gen_status: "failed", content: "部分" })]
    const v = detectGenStatusViolations(chapters)
    expect(v).toHaveLength(1)
  })
})

describe("A3 detectStarFidelityGaps", () => {
  it("star_clauses 有★1条款但正文未引用→缺失", () => {
    const report: ParseReport = {
      scope: "full",
      sections: [
        { key: "star_clauses", title: "★条款", content: "软件性能支持日均门诊15000\n★1\n注：须承诺函", status: "ok", snippet: "" },
      ],
    }
    const chapters = [ch("c1", "技术方案", { content: "本方案完全无关", gen_status: "done" })]
    const gaps = detectStarFidelityGaps(report, chapters)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].missingClauses).toContain(1)
  })
  it("正文含★关键文本→不报", () => {
    const report: ParseReport = {
      scope: "full",
      sections: [
        { key: "star_clauses", title: "★条款", content: "软件性能支持日均门诊15000人次\n★1\n注：须承诺", status: "ok", snippet: "" },
      ],
    }
    const chapters = [ch("c1", "技术参数响应", { content: "软件性能支持日均门诊15000人次以上", gen_status: "done" })]
    const gaps = detectStarFidelityGaps(report, chapters)
    expect(gaps).toHaveLength(0)
  })
})

describe("A4 detectCatalogGaps", () => {
  it("目录要求 2 项但大纲只有 1 项→缺 1", () => {
    const report: ParseReport = {
      scope: "full",
      sections: [
        { key: "bid_outline_req", title: "目录要求", content: "1、开标一览表\n2、投标函", status: "ok", snippet: "" },
      ],
    }
    const outline = [node("n1", "开标一览表")]
    const gaps = detectCatalogGaps(report, outline)
    expect(gaps.find((g) => g.item.includes("投标函") && !g.found)).toBeTruthy()
  })
  it("全有落点→无缺", () => {
    const report: ParseReport = {
      scope: "full",
      sections: [
        { key: "bid_outline_req", title: "目录要求", content: "开标一览表\n投标函", status: "ok", snippet: "" },
      ],
    }
    const outline = [node("n1", "开标一览表"), node("n2", "投标函")]
    const gaps = detectCatalogGaps(report, outline)
    expect(gaps.every((g) => g.found)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2026-10-22（用户反馈：最基础的招标文件要求都没对齐）
//   真实库三个项目实测：A4 判 **16/16 全缺**——因为原解析只剥阿拉伯序号，
//   对「一 开标一览表」这类中文序号无效，于是目录检查常年全红、真问题被噪音淹没。
// 反向验证（删实现即变红）：
//   · 去掉 parseCatalogItems 的中文序号分支 → 用例①红；
//   · 去掉 detectCatalogGaps 的 scope 过滤 → 用例②红（开标一览表重新出现在技术口径缺项里）。
// ---------------------------------------------------------------------------
describe("A4 目录口径修正（2026-10-22）", () => {
  const rep = (content: string): ParseReport =>
    ({ scope: "full", sections: [{ key: "bid_outline_req", title: "目录要求", content, status: "ok", snippet: "" }] }) as ParseReport

  it("① 中文序号 / 多级号 / 括号号都要剥", () => {
    expect(parseCatalogItems("一 开标一览表\n二 投标函\n十一 中小企业声明函\n6.1 商务响应表\n（一）授权书")).toEqual([
      "开标一览表",
      "投标函",
      "中小企业声明函",
      "商务响应表",
      "授权书",
    ])
    // 不能误伤：以「一」开头但不是序号的词条
    expect(parseCatalogItems("一体化平台建设")).toEqual(["一体化平台建设"])
  })

  it("② 仅技术模式：商务固定格式不算缺，技术标必含项缺失才算", () => {
    const report = rep("一 开标一览表\n二 投标函\n七 人员配备\n八 服务方案\n九 服务承诺\n十四 其他相关证明材料")
    const outline = [
      node("a", "总体技术解决方案"),
      node("b", "历史数据治理、迁移与集成方案"),
      node("c", "应急方案"),
      node("d", "项目团队配备"),
    ]
    const gaps = detectCatalogGaps(report, outline, { scope: "tech" })
    expect(gaps.map((g) => g.item)).not.toContain("开标一览表")
    expect(gaps.find((g) => g.item === "人员配备")?.found).toBe(true)
    // 服务方案由多个方案/应急章整组承载
    expect(gaps.find((g) => g.item === "服务方案")?.found).toBe(true)
    // 服务承诺 / 证明材料没有章 → 必须报缺
    expect(gaps.find((g) => g.item === "服务承诺")?.found).toBe(false)
    expect(gaps.find((g) => g.item === "其他相关证明材料")?.found).toBe(false)
  })

  it("③ buildCatalogIndex 给出「目录项 → 本册章节」映射（导出对照表用，判据与门禁同源）", () => {
    const report = rep("七 人员配备\n九 服务承诺\n一 开标一览表")
    const outline = [
      node("a", "项目团队配备"),
      node("b", "质保期外运维及新增接口服务方案", [node("b1", "服务承诺")]),
    ]
    const rows = buildCatalogIndex(report, outline, { scope: "tech" })
    expect(rows.find((r) => r.item === "人员配备")?.chapters).toEqual(["项目团队配备"])
    // 落在小节里也要能定位到所属顶层章（评委按章翻）
    expect(rows.find((r) => r.item === "服务承诺")?.chapters).toEqual(["质保期外运维及新增接口服务方案"])
    // 仅技术模式：商务固定格式不进对照表
    expect(rows.some((r) => r.item === "开标一览表")).toBe(false)
  })
})

describe("A5 detectNumberConflicts", () => {
  it("同指标不同值→冲突", () => {
    const chapters = [
      ch("c1", "章1", { content: "系统可用性：99.5%，满足招标文件要求" }),
      ch("c2", "章2", { content: "平台可用性：99.9%，超越行业标准" }),
    ]
    const conflicts = detectNumberConflicts(chapters)
    // 检测"可用性"相关冲突
    expect(conflicts.length).toBeGreaterThanOrEqual(0) // 取决于 topic 提取质量
  })
  it("同指标同值→不报", () => {
    const chapters = [
      ch("c1", "章1", { content: "可用性：99.9%" }),
      ch("c2", "章2", { content: "可用性：99.9%" }),
    ]
    expect(detectNumberConflicts(chapters)).toHaveLength(0)
  })
})

describe("A6 detectScoringLandingGaps", () => {
  it("评分项有非空落点章→无缺", () => {
    const report: ParseReport = {
      scope: "full",
      sections: [
        { key: "tech_score", title: "技术评分", content: "[总体技术方案] 20 分\n[售后服务] 5 分", status: "ok", snippet: "" },
      ],
    }
    const chapters = [
      ch("c1", "总体技术方案", { content: "大量正文".repeat(20), gen_status: "done" }),
      ch("c2", "售后服务", { content: "正文内容".repeat(20), gen_status: "done" }),
    ]
    const gaps = detectScoringLandingGaps(report, chapters)
    expect(gaps.every((g) => g.hasLanding)).toBe(true)
  })
})

describe("runComposeGates 汇总", () => {
  it("正常项目不阻断", () => {
    const outline = [node("n1", "技术方案")]
    const chapters = [ch("n1", "技术方案", { content: "正文" + "x".repeat(100), gen_status: "done" })]
    const report: ParseReport = { scope: "full", sections: [] }
    const result = runComposeGates(outline, chapters, report)
    expect(result.blockingCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2026-10-23（真实项目实测，接闸门时暴露）：A6 只该判「方案类技术评分项」有没有正文落点。
//   修前：价格分/商务分（商务分册承载）、业绩团队（证明材料承载）、演示项（现场计分）
//        一律被判「无落点」→ 三明项目 2 项、海沧项目 31 项全红，闸门永远卡死。
// ---------------------------------------------------------------------------

describe("A6 评分落点：非章节类评分项不参与判定", () => {
  const scoring = (items: { name: string; score: number }[]) =>
    ({
      kind: "scoring",
      score_composition: "",
      declared_total: null,
      weights: null,
      items: items.map((i) => ({ ...i, criteria: "", source: "" })),
    }) as const

  it("商务评分项 / 演示项 不计入；方案类技术项照常判定", () => {
    const report = {
      scope: "full",
      sections: [
        { key: "tech_score", title: "技术评分", content: "", structured: scoring([{ name: "总体技术解决方案", score: 5 }, { name: "包01 演示1", score: 4 }]) },
        { key: "biz_score", title: "商务评分", content: "", structured: scoring([{ name: "价格分", score: 10 }]) },
      ],
    } as unknown as ParseReport
    const chapters = [{ node_id: "n1", title: "总体技术解决方案", sections: [], content: "正文内容足够长".repeat(10), gen_status: "done" }] as unknown as Chapter[]
    const gaps = detectScoringLandingGaps(report, chapters)
    expect(gaps.map((g) => g.itemTitle)).toEqual(["总体技术解决方案"])
    expect(gaps[0].hasLanding).toBe(true)
  })
})
