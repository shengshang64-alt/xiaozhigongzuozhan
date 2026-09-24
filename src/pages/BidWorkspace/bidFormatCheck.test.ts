import { describe, expect, it } from "vitest"
import { autoRepairChapter, FORMAT_CHECK_KEYS, formatCheckReport, numberConflictHits } from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// R32 批次2 #1：装饰符号 / Markdown 正文残留扫描器（零 AI、落进交卷体检管线）
const ch = (content: string): Chapter[] => [{ title: "第一章", content }] as unknown as Chapter[]
const scan = (content: string) =>
  formatCheckReport(ch(content), ["decoration_leftover"], null, "").hits.filter(
    (h) => h.rule === "decoration_leftover",
  )

describe("decoration_leftover（装饰符号 / Markdown 残留扫描）", () => {
  it("命中方括号装饰与图形符号（warn/glyph）", () => {
    expect(scan("本方案具备★领先优势").length).toBeGreaterThan(0)
    expect(scan("此处为【原文事实】式标注").length).toBeGreaterThan(0)
  })

  it("合法占位【待填写】【请补充素材】不触发（防误报）", () => {
    expect(scan("项目经理：【待填写】，驻场工程师：【请补充素材】")).toHaveLength(0)
  })

  it("命中 markdown 行首结构符：标题 # / 列表 - *（warn/md）", () => {
    expect(scan("# 一级标题残留").length).toBeGreaterThan(0)
    expect(scan("- 无序列表项残留").length).toBeGreaterThan(0)
  })

  it("正常正文与编号行不误报：句中连字符、区间、编号点、章标题均放过", () => {
    expect(scan("质保 3 年，响应时长 ≤ 8 小时，覆盖 HIS-EMR-LIS 等系统")).toHaveLength(0)
    expect(scan("1.1 建设目标")).toHaveLength(0)
    expect(scan("第1章 项目概述")).toHaveLength(0)
  })
})

// R32 批次2 #4：参数加码（承诺优于招标档位），复用 number_conflict 事实表比对
const chObj = (content: string): Chapter[] => [{ title: "第一章", content }] as unknown as Chapter[]

describe("param_escalation（参数加码：承诺优于招标档位）", () => {
  it("质保年限承诺高于招标档位 → param_escalation", () => {
    const hits = numberConflictHits(["免费质保期：3年"], chObj("我公司承诺提供 5 年免费质保期，完全满足要求"))
    expect(hits.some((h) => h.rule === "param_escalation")).toBe(true)
  })

  it("响应时限承诺快于招标档位 → param_escalation", () => {
    const hits = numberConflictHits(["响应时间：8小时"], chObj("本项目响应时间 4 小时，快速到场"))
    expect(hits.some((h) => h.rule === "param_escalation")).toBe(true)
  })

  it("与招标档位一致 → 不报警", () => {
    expect(numberConflictHits(["免费质保期：3年"], chObj("我公司提供 3 年免费质保期"))).toHaveLength(0)
  })

  it("方向未知的差异 → 普通 number_conflict（不误判为加码）", () => {
    const hits = numberConflictHits(["预算金额：3500万元"], chObj("本项目预算金额 4000万元 人民币"))
    expect(hits.some((h) => h.rule === "number_conflict")).toBe(true)
    expect(hits.some((h) => h.rule === "param_escalation")).toBe(false)
  })
})

// R32 批次2「生成后自动定向修复」：确定性代码清洗（装饰/元话语占位/空行/半角标点/加码降档），零 AI
const repair = (content: string, facts: string[] = [], items = FORMAT_CHECK_KEYS) =>
  autoRepairChapter(content, facts, items)
const hasRule = (applied: { rule: string }[], rule: string) => applied.some((a) => a.rule === rule)

describe("autoRepairChapter（确定性自动修复）", () => {
  it("清理装饰符号/Markdown 方括号，但保留合法占位【待填写】", () => {
    const r = repair("本方案具备★领先优势【原文事实】，项目经理：【待填写】")
    expect(hasRule(r.applied, "decoration_leftover")).toBe(true)
    expect(r.content).not.toContain("★")
    expect(r.content).not.toContain("【原文事实】")
    expect(r.content).toContain("【待填写】")
  })

  it("填值槽位元话语规范化为【待填写】，过程性元话语删除", () => {
    expect(repair("合同金额：待定，联系人：请填写").content).toBe("合同金额：【待填写】，联系人：【待填写】")
    expect(repair("本段此处省略，详见后续章节").content).not.toContain("此处省略")
  })

  it("参数加码降档：质保承诺高于招标单一基线 → 降回基线值", () => {
    const r = repair("我公司承诺提供 5 年免费质保期，完全满足要求", ["免费质保期：3年"])
    expect(hasRule(r.applied, "param_escalation")).toBe(true)
    expect(r.content).toContain("3 年")
    expect(r.content).not.toContain("5 年")
  })

  it("方向未知的数值差异不自动改（number_conflict 留人工）", () => {
    const src = "本项目预算金额 4000万元 人民币"
    const r = repair(src, ["预算金额：3500万元"])
    expect(hasRule(r.applied, "param_escalation")).toBe(false)
    expect(r.content).toContain("4000万元")
  })

  it("招标基线多档（不确定）时不自动降档", () => {
    const r = repair("承诺提供 6 年免费质保期", ["免费质保期：3年", "免费质保期：5年"])
    expect(hasRule(r.applied, "param_escalation")).toBe(false)
    expect(r.content).toContain("6 年")
  })

  it("半角标点紧跟汉字转全角，但不碰数字千分位", () => {
    expect(repair("系统运行稳定,故障率低").content).toContain("稳定，")
    expect(repair("预算 3,500 万元") .content).toContain("3,500")
  })

  it("连续空行 ≥3 折叠为 1 行", () => {
    const r = repair("第一段\n\n\n\n第二段")
    expect(r.content).toBe("第一段\n\n第二段")
    expect(hasRule(r.applied, "no_empty_line_consecutive")).toBe(true)
  })

  it("无问题时正文原样返回、applied 为空", () => {
    const src = "本项目采用双机热备架构，满足招标要求。"
    const r = repair(src, ["免费质保期：3年"])
    expect(r.applied).toHaveLength(0)
    expect(r.content).toBe(src)
  })
})
