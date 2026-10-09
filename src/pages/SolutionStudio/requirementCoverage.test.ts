import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  REQUIREMENT_COVERAGE_LABEL,
  auditRequirementCoverage,
  buildRequirementPendingText,
  requirementMatchKeys,
} from "./requirementCoverage"
import type { Chapter } from "./solutionTypes"

// ---------------------------------------------------------------------------
// R162 需求条目落位核验：要点分段（与 R155 章级路由同源）、大纲/正文两级命中、
// 四态判定与排序、待补清单复制口径，以及 EditorWorkspace 接线与卡片无障碍哨兵。
// ---------------------------------------------------------------------------

function ch(over: Partial<Chapter> = {}): Chapter {
  return { node_id: "n1", title: "章节", sections: [], content: "", gen_status: "done", ...over } as Chapter
}

const ITEM = "一体化医院信息管理系统（门诊输液系统、远程会诊工作站）"

describe("requirementMatchKeys（R155 同源分段）", () => {
  it("按标点拆分并去泛词，主名称与各要点都参与核对", () => {
    expect(requirementMatchKeys(ITEM)).toEqual(["一体化医院信息管理", "门诊输液", "远程会诊工作站"])
  })

  it("整条只剩泛词时回退为整条原文，不产出空要点", () => {
    expect(requirementMatchKeys("系统方案")).toEqual(["系统方案"])
  })

  it("要点上限 8 个，超长功能描述不把全命中门槛抬到不可达", () => {
    const long = Array.from({ length: 12 }, (_, i) => `子系统${i}功能${i}`).join("、")
    expect(requirementMatchKeys(long)).toHaveLength(8)
  })
})

describe("auditRequirementCoverage 四态判定", () => {
  it("全部要点正文逐字出现 → full，无未见要点", () => {
    const chapters = [ch({ node_id: "a", title: "分系统设计", content: "建设一体化医院信息管理系统，含门诊输液系统与远程会诊工作站。" })]
    const r = auditRequirementCoverage([ITEM], chapters)
    expect(r.counts.full).toBe(1)
    expect(r.rows[0].level).toBe("full")
    expect(r.rows[0].missingKeys).toEqual([])
    expect(r.rows[0].bodyChapters.map((h) => h.title)).toEqual(["分系统设计"])
    expect(r.pending).toBe(0)
  })

  it("部分要点正文出现 → partial，并点名未见要点", () => {
    const chapters = [ch({ node_id: "a", title: "分系统设计", content: "一体化医院信息管理系统涵盖门诊输液流程。" })]
    const r = auditRequirementCoverage([ITEM], chapters)
    expect(r.rows[0].level).toBe("partial")
    expect(r.rows[0].missingKeys).toEqual(["远程会诊工作站"])
  })

  it("要点分散在不同章正文也算落实（审计对象是方案整体而非单章）", () => {
    const chapters = [
      ch({ node_id: "a", title: "第一章", content: "一体化医院信息管理系统的边界与门诊输液流程。" }),
      ch({ node_id: "b", title: "第二章", content: "远程会诊工作站按科室排班接入。" }),
    ]
    const r = auditRequirementCoverage([ITEM], chapters)
    expect(r.rows[0].level).toBe("full")
    expect(r.rows[0].bodyChapters).toHaveLength(2)
  })

  it("只在大纲标题/小节名命中、正文未见 → outline", () => {
    const chapters = [ch({ node_id: "a", title: "建设内容", sections: ["远程会诊工作站"], content: "本章描述总体架构与技术路线。" })]
    const r = auditRequirementCoverage(["远程会诊工作站"], chapters)
    expect(r.rows[0].level).toBe("outline")
    expect(r.rows[0].bodyChapters).toEqual([])
    expect(r.rows[0].outlineChapters.map((h) => h.nodeId)).toEqual(["a"])
  })

  it("大纲与正文均未见 → missing", () => {
    const r = auditRequirementCoverage(["智慧服务三级评级陪跑服务"], [ch({ title: "总体架构", content: "分层解耦。" })])
    expect(r.rows[0].level).toBe("missing")
    expect(r.counts.missing).toBe(1)
  })

  it("正文尚未生成 → 只按大纲判档，generatedChapters 归零", () => {
    const chapters = [ch({ node_id: "a", title: "互联互通平台测评", content: "" })]
    const r = auditRequirementCoverage(["互联互通平台"], chapters)
    expect(r.generatedChapters).toBe(0)
    expect(r.counts.outline).toBe(1)
    expect(r.counts.missing).toBe(0)
  })

  it("章标题为空时命中章兜底显示「第 N 章」", () => {
    const chapters = [ch({ node_id: "a", title: "", sections: ["门诊输液系统"], content: "" })]
    const r = auditRequirementCoverage(["门诊输液系统"], chapters)
    expect(r.rows[0].outlineChapters[0].title).toBe("第 1 章")
  })

  it("排序按严重度优先、同级保持清单原序", () => {
    const items = ["数据安全审计服务", "互联互通平台", "门诊输液系统（含远程会诊工作站）", "挂号系统", "绩效耗材管理咨询"]
    const chapters = [
      ch({ node_id: "a", title: "互联互通专项", content: "按国家测评标准推进改造，门诊输液流程实现自动叫号与挂号队列管理。" }),
    ]
    const r = auditRequirementCoverage(items, chapters)
    expect(r.rows.map((x) => x.level)).toEqual(["missing", "missing", "outline", "partial", "full"])
    expect(r.rows.map((x) => x.index)).toEqual([0, 4, 1, 2, 3])
    expect(r.pending).toBe(4)
  })

  it("空清单 / 空章节 → 全零且不抛错", () => {
    const r = auditRequirementCoverage(undefined, undefined)
    expect(r.total).toBe(0)
    expect(r.rows).toEqual([])
    expect(r.counts).toEqual({ full: 0, partial: 0, outline: 0, missing: 0 })
    const r2 = auditRequirementCoverage(["门诊输液系统"], [])
    expect(r2.counts.missing).toBe(1)
    expect(r2.chapterCount).toBe(0)
  })
})

describe("buildRequirementPendingText（待补清单复制口径）", () => {
  it("只收未全落实三档，分组点名正文未见要点", () => {
    const r = auditRequirementCoverage(
      ["门诊输液系统（含远程会诊工作站）", "互联互通平台", "挂号系统"],
      [
        ch({ node_id: "a", title: "分系统设计", content: "门诊输液系统已按评级要求建设。" }),
        ch({ node_id: "b", title: "挂号系统", content: "本章展开挂号系统的建设内容。" }),
      ],
    )
    const text = buildRequirementPendingText(r)
    expect(text).toContain("待补清单")
    expect(text).toContain(REQUIREMENT_COVERAGE_LABEL.missing)
    expect(text).toContain(REQUIREMENT_COVERAGE_LABEL.partial)
    expect(text).toContain("远程会诊工作站")
    expect(text).not.toContain(REQUIREMENT_COVERAGE_LABEL.full)
  })

  it("全部落实 → 空串（调用方不渲染复制按钮）", () => {
    const r = auditRequirementCoverage(["门诊输液系统"], [ch({ title: "分系统设计", content: "门诊输液系统建设方案。" })])
    expect(buildRequirementPendingText(r)).toBe("")
  })
})

describe("EditorWorkspace 接线与无障碍（防回流）", () => {
  it("工作台挂载落位核验卡并传入清单快照、章节与跳转回调", () => {
    const code = readFileSync(new URL("../../components/solution-studio/EditorWorkspace.tsx", import.meta.url), "utf-8")
    expect(code).toContain("RequirementCoverageCard")
    expect(code).toContain("snapshot={sol.hospital_info?.ref_checklist_snapshot}")
    expect(code).toContain("onSelectChapter={p.selectChapter}")
  })

  it("卡片展开明细按钮带 aria-expanded（R136 无障碍主线）", () => {
    const code = readFileSync(new URL("../../components/solution-studio/RequirementCoverageCard.tsx", import.meta.url), "utf-8")
    expect(code).toContain("aria-expanded={expanded}")
    expect(code).toContain("setExpanded")
  })

  it("四态标签与标书侧覆盖审计口径一致（全部落实/部分落实/未落实）", () => {
    expect(REQUIREMENT_COVERAGE_LABEL.full).toBe("全部落实")
    expect(REQUIREMENT_COVERAGE_LABEL.partial).toBe("部分落实")
    expect(REQUIREMENT_COVERAGE_LABEL.missing).toBe("未落实")
  })
})

describe("泛化要点（模板词）降权", () => {
  // 6 条以上才启用降权；前 5 条共用「服务类 / 详见第七章技术参数要求」两个模板词
  const BOILER_ITEMS = [
    "国密改造（服务类，详见第七章技术参数要求）",
    "信创升级（服务类，详见第七章技术参数要求）",
    "运维服务（服务类，详见第七章技术参数要求）",
    "集成实施（服务类，详见第七章技术参数要求）",
    "培训服务（服务类，详见第七章技术参数要求）",
    "检验设备采购（全自动生化分析仪）",
  ]

  it("正文只写中模板词，不把大批条目升为部分落实", () => {
    const chapters = [ch({ node_id: "a", title: "实施范围", content: "本项目按服务类范围实施，详见第七章技术参数要求。" })]
    const r = auditRequirementCoverage(BOILER_ITEMS, chapters)
    expect(r.boilerplateKeys).toContain("服务类")
    expect(r.counts.partial).toBe(0)
    expect(r.rows.find((x) => x.index === 0)?.level).toBe("missing")
  })

  it("条目特征词命中即全部落实，模板词不再充当门槛", () => {
    const chapters = [ch({ node_id: "a", title: "安全设计", content: "完成国密改造，相关配套按服务类范围实施。" })]
    const row = auditRequirementCoverage(BOILER_ITEMS, chapters).rows.find((x) => x.index === 0)
    expect(row?.keys).toEqual(["国密改造"])
    expect(row?.level).toBe("full")
    expect(row?.missingKeys).toEqual([])
  })

  it("条目不足 6 条时样本太小，不做模板词降权", () => {
    const chapters = [ch({ node_id: "a", title: "实施范围", content: "本项目按服务类实施。" })]
    const r = auditRequirementCoverage(["国密改造（服务类）", "信创升级（服务类）"], chapters)
    expect(r.boilerplateKeys).toEqual([])
    expect(r.counts.partial).toBe(2)
  })

  it("某条目的要点全是模板词时整条回退原要点，不至于无据可查", () => {
    const chapters = [ch({ node_id: "a", title: "实施范围", content: "本项目按服务类范围实施。" })]
    const r = auditRequirementCoverage([...BOILER_ITEMS, "服务类（详见第七章技术参数要求）"], chapters)
    const row = r.rows.find((x) => x.index === 6)
    expect(row?.keys).toEqual(["服务类", "详见第七章技术参数要求"])
    expect(row?.level).toBe("partial")
  })

  it("卡片同步说明降权口径（防实现与文案脱节）", () => {
    const code = readFileSync(new URL("../../components/solution-studio/RequirementCoverageCard.tsx", import.meta.url), "utf-8")
    expect(code).toContain("result.boilerplateKeys")
    expect(code).toContain("不计入逐字核对")
  })
})
