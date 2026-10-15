import { describe, expect, it } from "vitest"
import { DEPT_RULE_CAP, deptRulesHits, flattenOutlineTitles, type DeptRulesInput } from "./bidDeptRulesHits"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/**
 * R54：部门基础要求（三份检查清单 + 售前工作规范）接进交卷体检的**接线口径**。
 * 规则真源在 bidComplianceRules / bidWritingRules（各自已有单测），这里锁的是：
 * 用什么文本扫、命中归到哪个规则码、上限、以及"没到大纲阶段时不许刷缺章"。
 */

const base = (over: Partial<DeptRulesInput> = {}): DeptRulesInput => ({
  tenderText: "",
  bidText: "",
  scoringItems: [],
  outline: [],
  ...over,
})

const rulesOf = (hits: { rule: string }[]) => hits.map((h) => h.rule)

describe("deptRulesHits：六类命中各自归码", () => {
  it("① 公司红线条款：扫招标侧（含合同条款），命中标 company_redline", () => {
    const hits = deptRulesHits(base({ tenderText: "合同价款：无首款，验收合格后一次性支付。\n售后服务：提供三年免费质保。" }))
    expect(rulesOf(hits)).toEqual(["company_redline", "company_redline"])
    expect(hits[0].quote).toContain("红线")
    expect(hits[0].level).toBe("warn")
  })

  it("① 售后年限：中文数字（三年/五年）与阿拉伯数字（3 年）都要认出超限；「一年」不算超限", () => {
    expect(deptRulesHits(base({ tenderText: "质保期五年" })).length).toBe(1)
    expect(deptRulesHits(base({ tenderText: "维保 3 年" })).length).toBe(1)
    expect(deptRulesHits(base({ tenderText: "质保期一年" }))).toEqual([])
    expect(deptRulesHits(base({ tenderText: "质保期 1 年" }))).toEqual([])
  })

  it("② 评分合规：单项超 3 分 / 证书类超 1 分 都报 scoring_compliance", () => {
    const hits = deptRulesHits(
      base({
        scoringItems: [
          { item: "技术方案完整性", score: 5, criteria: "" },
          { item: "软件著作权证书", score: 2, criteria: "" },
        ],
      }),
    )
    expect(hits.every((h) => h.rule === "scoring_compliance")).toBe(true)
    expect(hits.length).toBe(2)
  })

  it("③ 术语旧称：扫投标侧，命中标 outdated_term 并给出替换建议", () => {
    const hits = deptRulesHits(base({ bidText: "系统与卫生计生委现有平台对接。" }))
    expect(rulesOf(hits)).toEqual(["outdated_term"])
    expect(hits[0].quote).toContain("卫健委")
  })

  it("④ 其他项目残留：报别家医院名；本项目自有名称被排除", () => {
    const text = "本项目为安庆市立人民医院建设，参考了XX市人民医院的做法。"
    const withOwn = deptRulesHits(base({ bidText: text, own: { hospitals: ["安庆市立人民医院"] } }))
    expect(rulesOf(withOwn)).toEqual(["project_residue"])
    expect(withOwn[0].quote).toContain("XX市人民医院")
  })

  it("⑤ 写作规范：自称口径与模糊参数归 writing_voice，且不重复报暗标身份泄漏（那是 identity_leak 的活）", () => {
    const hits = deptRulesHits(base({ bidText: "我们承诺系统可用性不低于 99.9%。" }))
    expect(rulesOf(hits)).toEqual(["writing_voice", "writing_voice"])
    expect(hits.map((h) => h.quote).join("|")).toContain("我们")
    expect(hits.map((h) => h.quote).join("|")).toContain("不低于")
  })

  it("⑥ 专用章：大纲缺承诺函/偏离表时报 dedicated_section", () => {
    const hits = deptRulesHits(base({ outline: [{ title: "第一章 技术方案", level: 1 }] }))
    expect(rulesOf(hits)).toEqual(["dedicated_section", "dedicated_section"])
  })

  it("大纲还没生成时不刷「缺承诺函/缺偏离表」——那只是还没到这一步，不是缺陷", () => {
    expect(deptRulesHits(base())).toEqual([])
  })

  it("每类独立 ≤20 条上限（防单类刷屏挤掉别的类）", () => {
    const many = Array.from({ length: 40 }, (_, i) => `系统与卫生计生委平台对接 ${i}`).join("\n")
    const hits = deptRulesHits(base({ bidText: many }))
    expect(hits.length).toBe(DEPT_RULE_CAP)
  })

  it("全空输入不抛错、不产生命中", () => {
    expect(deptRulesHits({ tenderText: "", bidText: "", scoringItems: [], outline: [] })).toEqual([])
  })
})

describe("flattenOutlineTitles：大纲树 → 带层级标题表", () => {
  const tree: OutlineNode[] = [
    {
      id: "a",
      title: "第一章 技术部分",
      children: [
        { id: "b", title: "1.1 系统架构", children: [{ id: "c", title: "1.1.1 微服务", children: [] }] },
      ],
    },
  ]

  it("按深度带 level（专用章检查靠它判 maxLevel）", () => {
    expect(flattenOutlineTitles(tree)).toEqual([
      { title: "第一章 技术部分", level: 1 },
      { title: "1.1 系统架构", level: 2 },
      { title: "1.1.1 微服务", level: 3 },
    ])
  })

  it("空标题跳过、空树返回空数组", () => {
    expect(flattenOutlineTitles([{ id: "x", title: "  ", children: [] }])).toEqual([])
    expect(flattenOutlineTitles(null)).toEqual([])
  })
})
