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

  it("⑤ 写作规范：自称口径与真模糊词归 writing_voice，且不重复报暗标身份泄漏（那是 identity_leak 的活）", () => {
    // R56：「不低于」已放行（下限承诺是明确边界），示例用真模糊词「相当于」
    const hits = deptRulesHits(base({ bidText: "我们承诺系统性能相当于同类产品。" }))
    expect(rulesOf(hits)).toEqual(["writing_voice", "writing_voice"])
    expect(hits.map((h) => h.quote).join("|")).toContain("我们")
    expect(hits.map((h) => h.quote).join("|")).toContain("相当于")
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
    // 2026-10-26：本轮新增 table_caption_missing / latex_residue 两类，本用例只锁「单类上限」
    // 不再断言总量等于上限——改锁每类各自不超过上限（与模块头「六类各自独立上限」的原意一致）。
    const byRule = new Map<string, number>()
    for (const h of hits) byRule.set(h.rule, (byRule.get(h.rule) ?? 0) + 1)
    for (const [, n] of byRule) expect(n).toBeLessThanOrEqual(DEPT_RULE_CAP)
    expect(byRule.get("outdated_term")).toBe(DEPT_RULE_CAP)
  })

  it("全空输入不抛错、不产生命中", () => {
    expect(deptRulesHits({ tenderText: "", bidText: "", scoringItems: [], outline: [] })).toEqual([])
  })
})

describe("2026-10-26 用户硬要求：表格必须有表题 / 正文禁 LaTeX", () => {
  /** 造一个符合导出约定的表格块（列间两个全角空格 U+3000） */
  const TABLE = ["序号　　名称　　备注", "1　　系统A　　无", "2　　系统B　　无"].join("\n")

  it("表格上方有表题 → 不报 table_caption_missing", () => {
    const hits = deptRulesHits(base({ bidText: `表1-1 系统清单\n${TABLE}` }))
    expect(hits.filter((h) => h.rule === "table_caption_missing")).toEqual([])
  })

  it("表格上方没有表题 → 报 table_caption_missing，并指出是第几行", () => {
    const hits = deptRulesHits(base({ bidText: `以下为系统清单：\n${TABLE}` }))
    const cap = hits.filter((h) => h.rule === "table_caption_missing")
    expect(cap.length).toBe(1)
    expect(cap[0].quote).toContain("没有表题")
    expect(cap[0].quote).toContain("第 2 行")
  })

  it("表题多种真实写法都认：带冒号 / 带加粗 / 只写编号 / 隔一空行", () => {
    for (const cap of ["表 2-3：参数响应表", "**表1-1** 系统清单", "表1-1", "表格：系统清单"]) {
      const hits = deptRulesHits(base({ bidText: `${cap}\n${TABLE}` }))
      expect(hits.filter((h) => h.rule === "table_caption_missing"), `表题写法「${cap}」应被认出`).toEqual([])
    }
    // 表题与表格之间隔一个空行也要认
    const hits = deptRulesHits(base({ bidText: `表1-1 系统清单\n\n${TABLE}` }))
    expect(hits.filter((h) => h.rule === "table_caption_missing")).toEqual([])
  })

  it("单行孤立「表格行」不当表格要求表题（导出侧 block.length≥2 才转表，避免误报）", () => {
    const hits = deptRulesHits(base({ bidText: "序号　　只有一行" }))
    expect(hits.filter((h) => h.rule === "table_caption_missing")).toEqual([])
  })

  it("LaTeX 命令 / $公式$ / \\begin{} 都报 latex_residue", () => {
    for (const bad of ["公式为 \\frac{1}{2}", "约等于 $x+y$", "\\begin{aligned} a=1", "精度 \\le 3 秒"]) {
      const hits = deptRulesHits(base({ bidText: bad }))
      const latex = hits.filter((h) => h.rule === "latex_residue")
      expect(latex.length, `「${bad}」应报 LaTeX 残留`).toBe(1)
      expect(latex[0].quote).toContain("<sup>")
    }
  })

  it("反斜杠路径与普通乘号不算 LaTeX（误报会让徽标失去可信度）", () => {
    for (const ok of ["附件存放于 C:\\temp\\bid 目录", "3 × 4 = 12", "价格 10/20 元"]) {
      const hits = deptRulesHits(base({ bidText: ok }))
      expect(hits.filter((h) => h.rule === "latex_residue"), `「${ok}」不该判 LaTeX`).toEqual([])
    }
  })

  it("正文还没生成时不报表题/LaTeX（避免前置噪音）", () => {
    const hits = deptRulesHits(base({ bidText: "" }))
    expect(hits.filter((h) => h.rule === "table_caption_missing" || h.rule === "latex_residue")).toEqual([])
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
