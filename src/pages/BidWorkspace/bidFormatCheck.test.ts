import { describe, expect, it } from "vitest"
import {
  autoRepairChapter,
  FORMAT_CHECK_KEYS,
  formatCheckReport,
  numberConflictHits,
  structuredNumberConflictHits,
  deviationCommitHits,
  overPriceCeilingHits,
  normalizeFormatCheckReport,
} from "./bidTypes"
import type { DeviationRow, DeviationTable } from "./bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

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

// numeric-consistency-01（R32）：数字口径核对从「事实表 × 正文」扩展到偏离表/大纲两个结构化面
const dev = (clause_text: string, response_summary: string, clause_id = "c1"): DeviationTable =>
  ({
    rows: [
      {
        clause_id,
        clause_text,
        source: "招标技术要求",
        response_node: "第三章",
        response_level: "full",
        response_summary,
        bid_ref: "",
      } as DeviationRow,
    ],
  }) as DeviationTable
const ol = (title: string): OutlineNode[] => [{ id: "n1", title, children: [] } as OutlineNode]

describe("structuredNumberConflictHits（偏离表 / 大纲 × 事实表 结构化面对账）", () => {
  it("偏离表响应值与事实口径不符（方向未知）→ number_conflict，chapter 标注来源面", () => {
    const hits = structuredNumberConflictHits(
      ["预算金额：3500万元"],
      [],
      dev("本项目预算金额3500万元，投标报价不得超预算", "我方总报价4000万元"),
    )
    expect(hits.some((h) => h.rule === "number_conflict" && h.chapter.startsWith("偏离表"))).toBe(true)
  })

  it("偏离表质保响应高于招标档位 → param_escalation（复用正文方向判定）", () => {
    const hits = structuredNumberConflictHits(["免费质保期：3年"], [], dev("免费质保期3年", "我司提供5年免费质保服务"))
    expect(hits.some((h) => h.rule === "param_escalation" && h.chapter.startsWith("偏离表"))).toBe(true)
  })

  it("偏离表响应值与事实一致 → 不报警", () => {
    expect(structuredNumberConflictHits(["免费质保期：3年"], [], dev("免费质保期3年", "我司提供3年免费质保"))).toHaveLength(0)
  })

  it("防误报：响应值带比较语境（不低于）不提取；跨单位（天 vs 月）不比较", () => {
    expect(structuredNumberConflictHits(["免费质保期：5年"], [], dev("免费质保期5年", "我司承诺质保不低于3年"))).toHaveLength(0)
    expect(structuredNumberConflictHits(["工期：180天"], [], dev("项目工期180天", "分6个月完成部署"))).toHaveLength(0)
  })

  it("大纲标题含数值与事实不符 → 命中（chapter 标注大纲）", () => {
    const hits = structuredNumberConflictHits(["预算金额：3500万元"], ol("本项目预算金额4000万元建设方案"), null)
    expect(hits.some((h) => h.rule === "number_conflict" && h.chapter.startsWith("大纲"))).toBe(true)
  })

  it("无事实基准时静默返回空", () => {
    expect(structuredNumberConflictHits([], ol("任意标题"), dev("任意条款", "任意响应"))).toHaveLength(0)
  })
})

// prompt-fabscan-03（子集 · R33）：交卷体检补「承诺不够」（偏离表负偏离），与 param_escalation（加码）成镜像
const devRow = (clause_text: string, response_level: string, clause_id = "c1"): DeviationTable =>
  ({
    rows: [
      {
        clause_id,
        clause_text,
        source: "招标技术要求",
        response_node: "第三章",
        response_level,
        response_summary: "",
        bid_ref: "",
      } as DeviationRow,
    ],
  }) as DeviationTable

describe("deviationCommitHits（承诺不够 / 偏离表负偏离 surfaced 到交卷体检）", () => {
  it("普通条款判为偏离 → deviation_undercommit（提醒影响评分）", () => {
    const hits = deviationCommitHits(devRow("提供7×24小时运维支持", "deviation"))
    expect(hits.some((h) => h.rule === "deviation_undercommit" && h.chapter.startsWith("偏离表"))).toBe(true)
    expect(hits[0].quote).toContain("影响评分")
  })

  it("★/强制条款判为偏离 → 升级为废标风险措辞", () => {
    const hits = deviationCommitHits(devRow("★系统可用性需达到99.99%", "deviation"))
    expect(hits.some((h) => h.rule === "deviation_undercommit")).toBe(true)
    expect(hits[0].quote).toContain("废标")
  })

  it("完全响应 / 部分响应 → 不报（只报明确负偏离）", () => {
    expect(deviationCommitHits(devRow("免费质保期3年", "full"))).toHaveLength(0)
    expect(deviationCommitHits(devRow("免费质保期3年", "partial"))).toHaveLength(0)
  })

  it("无偏离表 / 空行 → 静默返回空", () => {
    expect(deviationCommitHits(null)).toHaveLength(0)
    expect(deviationCommitHits({ rows: [] } as unknown as DeviationTable)).toHaveLength(0)
  })

  it("新规则 deviation_undercommit 在白名单存活（normalize 不丢弃）", () => {
    const report = normalizeFormatCheckReport({
      hits: [{ chapter: "偏离表 · c1", rule: "deviation_undercommit", quote: "x", level: "warn" }],
      checked_at: "",
    })
    expect(report?.hits[0]?.rule).toBe("deviation_undercommit")
  })
})

// numeric-consistency-02（做法 A）：投标报价 vs 最高限价/预算 方向性废标核对
const devSum = (response_summary: string): DeviationTable =>
  ({
    rows: [
      {
        clause_id: "c1",
        clause_text: "投标总报价",
        source: "招标",
        response_node: "第三章",
        response_level: "full",
        response_summary,
        bid_ref: "",
      } as DeviationRow,
    ],
  }) as DeviationTable

describe("overPriceCeilingHits（投标报价超最高限价/预算 → 废标风险）", () => {
  it("报价 > 预算 → over_price_ceiling，文案带【废标风险】与超幅%", () => {
    const hits = overPriceCeilingHits(["预算金额：3500万元"], chObj("我方投标总报价为人民币 3600 万元"), null)
    expect(hits.some((h) => h.rule === "over_price_ceiling")).toBe(true)
    expect(hits[0].quote).toContain("废标")
    expect(hits[0].quote).toContain("预算金额")
    expect(hits[0].quote).toContain("3%")
  })

  it("报价 ≤ 预算 → 不报", () => {
    expect(overPriceCeilingHits(["预算金额：3500万元"], chObj("我方投标总报价 3500 万元"), null)).toHaveLength(0)
    expect(overPriceCeilingHits(["预算金额：3500万元"], chObj("我方投标总报价 3200 万元"), null)).toHaveLength(0)
  })

  it("存在最高限价时以限价为准（高于预算仍可能不废标）", () => {
    const facts = ["预算金额：3500万元", "最高限价：3600万元"]
    expect(overPriceCeilingHits(facts, chObj("我方投标总报价 3550 万元"), null)).toHaveLength(0)
    const hits = overPriceCeilingHits(facts, chObj("我方投标总报价 3650 万元"), null)
    expect(hits.some((h) => h.rule === "over_price_ceiling" && h.quote.includes("最高限价"))).toBe(true)
  })

  it("元 / 万元 混用正确归一到元比较", () => {
    expect(overPriceCeilingHits(["预算金额：3500万元"], chObj("我方投标总报价 38000000 元"), null).length).toBeGreaterThan(0)
    expect(overPriceCeilingHits(["预算金额：3500万元"], chObj("我方投标报价 35000000 元"), null)).toHaveLength(0)
  })

  it("千分位金额可解析：36,000,000 元 = 3600 万 > 3500 万", () => {
    expect(overPriceCeilingHits(["预算金额：3500万元"], chObj("我方投标总报价 36,000,000 元"), null).length).toBeGreaterThan(0)
  })

  it("取不到限价/预算事实 → 静默不报", () => {
    expect(overPriceCeilingHits(["项目周期：180天"], chObj("我方投标总报价 9999 万元"), null)).toHaveLength(0)
  })

  it("『报价不得超过预算X』约束句（未给具体报价）不当报价、不误报", () => {
    // 若无方向/约束过滤，“不得超过预算的120% 即 1200万”会把 1200万 当成报价误报（实际 > 1000万 限价）
    expect(
      overPriceCeilingHits(["预算金额：1000万元"], chObj("根据规定投标报价不得超过预算的120%，即不得超过1200万元"), null),
    ).toHaveLength(0)
  })

  it("偏离表响应里写了超限价报价 → 从偏离表面报出", () => {
    const hits = overPriceCeilingHits(["预算金额：3500万元"], [], devSum("我方投标总报价 3700 万元"))
    expect(hits.some((h) => h.rule === "over_price_ceiling" && h.chapter.startsWith("偏离表"))).toBe(true)
  })

  it("新规则 over_price_ceiling 在白名单存活（normalize 不丢弃）", () => {
    const report = normalizeFormatCheckReport({
      hits: [{ chapter: "第一章", rule: "over_price_ceiling", quote: "x", level: "warn" }],
      checked_at: "",
    })
    expect(report?.hits[0]?.rule).toBe("over_price_ceiling")
  })
})
