import { describe, expect, it } from "vitest"
// ---------------------------------------------------------------------------
// R155（闭环 r150-outline-consulting-gap 残余）：客户建设需求条目章级路由
// 与「评级咨询服务」类服务条目承载口径的钉死测试。
// ---------------------------------------------------------------------------
import {
  SOL_PROMPT_VERSION,
  buildChapterMessages,
  buildOutlineMessages,
  chapterRequirementLines,
  checklistScopeBlock,
  requirementTitleSegments,
  type Chapter,
  type HospitalInfo,
} from "./solutionTypes"

function ch(over: Partial<Chapter> = {}): Chapter {
  return { node_id: "n1", title: "总述", sections: [], content: "", gen_status: "pending", ...over } as Chapter
}

function info(over: Partial<HospitalInfo> = {}): HospitalInfo {
  return {
    hospital_level: "三级甲等",
    bed_scale: "1200",
    outpatient_scale: "8000",
    demand_departments: "",
    systems: [],
    budget_range: "",
    special_requirements: "",
    ...over,
  }
}

function snapOf(reqs: string[]): HospitalInfo["ref_checklist_snapshot"] {
  return {
    checklist_id: "ck-1",
    checklist_name: "【演练】建设清单",
    rating_targets: ["emr:5"],
    company_systems: [],
    external_systems: [],
    customer_requirements: reqs,
  }
}

const REQS = [
  "一体化医院信息管理系统（门急诊挂号系统、门诊医生工作站）",
  "中医智能体质辨识",
  "智慧医疗五级评级咨询服务",
]

describe("requirementTitleSegments（R155）", () => {
  it("去泛词保留名称段，连词拆开各自成段", () => {
    const segs = requirementTitleSegments("门急诊挂号与分诊叫号系统")
    expect(segs).toContain("门急诊挂号")
    expect(segs).toContain("分诊叫号")
  })

  it("纯泛词标题不产生命名片段", () => {
    expect(requirementTitleSegments("分系统设计")).toEqual([])
  })
})

describe("chapterRequirementLines（R155 章级路由）", () => {
  it("章标题命中：门急诊挂号章 → 一体化医院信息管理系统条目", () => {
    expect(chapterRequirementLines("门急诊挂号系统", [], REQS)).toEqual([REQS[0]])
  })

  it("节名参与匹配：中医药专章经小节命中体质辨识条目", () => {
    expect(chapterRequirementLines("中医药特色专病", ["中医智能体质辨识"], REQS)).toEqual([REQS[1]])
  })

  it("服务类条目路由到咨询服务章（r150 主诉点）", () => {
    expect(chapterRequirementLines("评级咨询服务", [], REQS)).toEqual([REQS[2]])
  })

  it("泛词误伤大清单（命中>=4 且占比>=80%）宁缺毋滥返回空", () => {
    const big = ["医院信息平台", "数据交换信息网关", "信息治理体系", "科研信息标准"]
    expect(chapterRequirementLines("信息系统", [], big)).toEqual([])
  })

  it("小清单命中全部条目时仍注入（不误伤单条清单）", () => {
    expect(chapterRequirementLines("信息系统", [], ["医院信息平台"])).toEqual(["医院信息平台"])
  })

  it("Latin 段按词边界：HIS 不命中 PHIST 类内部子串", () => {
    expect(chapterRequirementLines("HIS", [], ["PHIST系统"])).toEqual([])
  })

  it("空需求清单 / 缺字段 → []", () => {
    expect(chapterRequirementLines("互联网医院", [], undefined)).toEqual([])
    expect(chapterRequirementLines("互联网医院", [], [])).toEqual([])
  })
})

describe("buildChapterMessages 章级需求条目注入（R155）", () => {
  const chapters = [
    ch({ title: "门急诊挂号系统", sections: ["挂号管理", "分诊叫号"] }),
    ch({ title: "总体架构", sections: ["设计原则"] }),
  ]
  const sol = {
    solution_name: "三明市第一医院信息化建设项目方案",
    solution_type: "preliminary" as const,
    hospital: "三明市第一医院",
    hospital_info: info({ ref_checklist_snapshot: snapOf(REQS) }),
    outline: [],
  }

  it("命中章 taskUser 注入逐条回应清单，且只含命中条目", () => {
    const task = buildChapterMessages(sol, chapters, 0).at(-1)!.content
    expect(task).toContain("【本章须逐条回应的客户建设需求条目（共 1 条）】")
    expect(task).toContain(REQS[0])
    expect(task).not.toContain("中医智能体质辨识")
    expect(task).toContain("服务类条目")
  })

  it("未命中章不注入清单块", () => {
    const task = buildChapterMessages(sol, chapters, 1).at(-1)!.content
    expect(task).not.toContain("须逐条回应的客户建设需求条目")
  })

  it("无清单快照时 prompt 不含注入块（与既有口径一致）", () => {
    const plain = { ...sol, hospital_info: info() }
    const msgs = buildChapterMessages(plain, chapters, 0)
    expect(msgs).toHaveLength(3)
    expect(msgs.at(-1)!.content).not.toContain("须逐条回应的客户建设需求条目")
  })

  it("system 与 stableUser 跨章恒定——注入只落章级差异块，不破坏前缀缓存", () => {
    const m0 = buildChapterMessages(sol, chapters, 0)
    const m1 = buildChapterMessages(sol, chapters, 1)
    expect(m0[0].content).toBe(m1[0].content)
    expect(m0[1].content).toBe(m1[1].content)
    expect(m0[2].content).not.toBe(m1[2].content)
  })
})

describe("大纲与服务类条目承载口径（R155/B类快照）", () => {
  it("SOL_PROMPT_VERSION 钉死：改 prompt 文本必须 +1 并同步本测试", () => {
    expect(SOL_PROMPT_VERSION).toBe("sol-v2/R155-2026-10-05")
  })

  it("checklistScopeBlock 含服务类条目承载规则（大纲与逐章共用）", () => {
    const block = checklistScopeBlock(snapOf(REQS))
    expect(block).toContain("服务类条目")
    expect(block).toContain("不得只作为评级目标或预期成效表述")
  })

  it("buildOutlineMessages 含集群合章但名称逐字进节/小节的硬性要求", () => {
    const sys = buildOutlineMessages("preliminary", "测试方案", "测试医院", info({ ref_checklist_snapshot: snapOf(REQS) }))[0]
      .content
    expect(sys).toContain("条目多时可按业务集群合并章节承载")
    expect(sys).toContain("至少逐字出现在一个节或小节标题中")
  })
})
