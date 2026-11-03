import { describe, expect, it } from "vitest"
import {
  autoRepairChapter,
  FORMAT_CHECK_KEYS,
  GATE_FATAL_RULES,
  formatCheckReport,
  numberConflictHits,
  structuredNumberConflictHits,
  deviationCommitHits,
  amountCaseMismatchHits,
  overPriceCeilingHits,
  quoteRecordCeilingHits,
  pickLatestQuoteTotals,
  priceCeilingFromFacts,
  type QuoteTotalRef,
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
    expect(scan("本方案具备■领先优势").length).toBeGreaterThan(0)
    expect(scan("此处为【原文事实】式标注").length).toBeGreaterThan(0)
  })

  // 2026-10-14 交付物治理：★/▲ 是招标实质性条款标记（废标判据），
  // 与「逐条照录原文响应」硬约束配套，不得再被当装饰符扫掉，否则两条硬要求互相打架。
  it("★/▲ 实质性条款标记不算装饰残留（自相矛盾修复）", () => {
    expect(scan("响应未涉及的加“★”的指标")).toHaveLength(0)
    expect(scan("9.1 ★项技术参数实质性响应")).toHaveLength(0)
    expect(scan("▲ 供应商须提供原厂授权")).toHaveLength(0)
    expect(scan("★1 注：投标文件中须提供承诺函并盖公章")).toHaveLength(0)
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

  // R43 真实标书校准回归锈：extractNumRefs 时钟式收窄（规则②）与模糊量剔除（规则⑤）
  it("正文「关键词：值」冒号承诺形态不再被误剔（R43 收窄规则②：质保期：5年 → 报加码）", () => {
    const hits = numberConflictHits(["质保期：3年"], chObj("系统质保期：5年，全部免费"))
    expect(hits.some((h) => h.rule === "param_escalation")).toBe(true)
    expect(numberConflictHits(["投入人数：12人"], chObj("驻场安排表\n投入人数：15人")).some((h) => h.rule === "number_conflict")).toBe(true)
  })

  it("真时钟形态「8:30人」仍被剔除（收窄不回归）；模糊量「近20年/约为3年」不参与比较（R43 规则⑤）", () => {
    expect(numberConflictHits(["投入人数：12人"], chObj("投入人数：早8:30人到岗打卡"))).toHaveLength(0)
    expect(numberConflictHits(["服务期：3年"], chObj("服务期内完成医院近20年历史数据的迁移治理"))).toHaveLength(0)
    expect(numberConflictHits(["质保期：5年"], chObj("整机质保期约为3年"))).toHaveLength(0)
  })
})

// R32 批次2「生成后自动定向修复」：确定性代码清洗（装饰/元话语占位/空行/半角标点/加码降档），零 AI
const repair = (content: string, facts: string[] = [], items = FORMAT_CHECK_KEYS) =>
  autoRepairChapter(content, facts, items)
const hasRule = (applied: { rule: string }[], rule: string) => applied.some((a) => a.rule === rule)

describe("autoRepairChapter（确定性自动修复）", () => {
  it("清理装饰符号/Markdown 方括号，但保留合法占位【待填写】", () => {
    const r = repair("本方案具备■领先优势【原文事实】，项目经理：【待填写】")
    expect(hasRule(r.applied, "decoration_leftover")).toBe(true)
    expect(r.content).not.toContain("■")
    expect(r.content).not.toContain("【原文事实】")
    expect(r.content).toContain("【待填写】")
  })

  // 2026-10-14 交付物治理：自动清洗不得再剥掉 ★/▲（照录招标原文的实质性条款标记）
  it("★/▲ 实质性条款标记不被自动清洗剥除", () => {
    const r = repair("未涉及的加“★”的指标，▲ 项须逐条响应", [], ["decoration_leftover"])
    expect(r.content).toContain("★")
    expect(r.content).toContain("▲")
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

/** R50（P0-3）：本次注入范围内无可定位证据的行——程序侧标记 needs_review（非负偏离） */
const invisibleRow = (over: Partial<DeviationRow> = {}): DeviationTable =>
  ({
    rows: [
      {
        clause_id: "c1",
        clause_text: "提供7×24小时运维支持",
        source: "招标技术要求",
        response_node: "未找到响应",
        response_level: "partial",
        response_summary: "本次注入范围内无可见证据，需人工核对未注入部分",
        bid_ref: "",
        needs_review: true,
        ...over,
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

  // R50（P0-3 长文可见性）：partial 在旧口径下不进体检——「没看到」会静默通过最后一道关。
  it("本次不可见（needs_review）行 → deviation_invisible_review（warn，不得静默）", () => {
    const hits = deviationCommitHits(invisibleRow())
    expect(hits.some((h) => h.rule === "deviation_invisible_review" && h.level === "warn")).toBe(true)
    expect(hits[0].quote).toContain("人工核对")
    // 不可见 ≠ 负偏离：只 surface「没看到」，不冒充 deviation_undercommit
    expect(hits.some((h) => h.rule === "deviation_undercommit")).toBe(false)
  })

  it("已确判偏离的待核对行 → 只报 deviation_undercommit（不重复报可见性）", () => {
    const hits = deviationCommitHits(invisibleRow({ response_level: "deviation" }))
    expect(hits.some((h) => h.rule === "deviation_undercommit")).toBe(true)
    expect(hits.some((h) => h.rule === "deviation_invisible_review")).toBe(false)
  })

  it("新规则 deviation_invisible_review 在白名单存活（normalize 不丢弃）", () => {
    const report = normalizeFormatCheckReport({
      hits: [{ chapter: "偏离表 · c1", rule: "deviation_invisible_review", quote: "x", level: "warn" }],
      checked_at: "",
    })
    expect(report?.hits[0]?.rule).toBe("deviation_invisible_review")
  })

  it("可见性告警不进制裁名单（只提示，不阻断闸门确认）", () => {
    expect(GATE_FATAL_RULES.has("deviation_invisible_review")).toBe(false)
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

  // R42 真实标书校准回归锈：开标一览表「关键词：金额元」式写法的冒号豁免（此前被时间式规则误剔→漏报）
  it("开标一览表千分位「投标报价：25,010,000.00 元」超限价 → 报（回归锈 extractNumRefs 冒号+钱单位豁免）", () => {
    const facts = ["预算金额：2500万元", "最高限价：2500万元"]
    expect(overPriceCeilingHits(facts, chObj("投标报价：25,000,000.00 元"), null)).toHaveLength(0)
    const hits = overPriceCeilingHits(facts, chObj("投标报价：25,010,000.00 元"), null)
    expect(hits.some((h) => h.rule === "over_price_ceiling")).toBe(true)
  })

  it("真实招标文件复述行（废标条款/评分公式/含'限价'功能描述）不当报价、不误报", () => {
    const facts = ["预算金额：2500万元", "最高限价：2500万元"]
    const realLines = [
      "11.2投标人报价超过招标文件规定的预算金额或者分项、分包最高限价，其投标将被认定为投标无效。",
      "投标报价得分＝（评标基准价/投标报价）×10％×100",
      "医保控费规则配置:支持按不同规则模版配置限量、限价、互斥等多种控费规则。",
    ].join("\n")
    expect(overPriceCeilingHits(facts, chObj(realLines), null)).toHaveLength(0)
  })

  it("新规则 over_price_ceiling 在白名单存活（normalize 不丢弃）", () => {
    const report = normalizeFormatCheckReport({
      hits: [{ chapter: "第一章", rule: "over_price_ceiling", quote: "x", level: "warn" }],
      checked_at: "",
    })
    expect(report?.hits[0]?.rule).toBe("over_price_ceiling")
  })
})

// numeric-consistency-02（做法 B）：关联商机的报价单真实总额并入同一废标核对
describe("quoteRecordCeilingHits（做法 B：报价单真总额 vs 天花板）", () => {
  it("报价单总额（元）超预算（万元）→ 归一后报废标，文案带报价单名与超幅%", () => {
    const hits = quoteRecordCeilingHits(["预算金额：3500万元"], [{ name: "XX医院智慧医疗报价", totalYuan: 36000000 }])
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("over_price_ceiling")
    expect(hits[0].chapter.startsWith("报价单")).toBe(true)
    expect(hits[0].quote).toContain("废标")
    expect(hits[0].quote).toContain("XX医院智慧医疗报价")
    expect(hits[0].quote).toContain("3%")
    expect(hits[0].quote).toContain("预算金额")
  })

  it("报价单总额≤天花板 / 硬限价口径下超预算不超限价 → 不报", () => {
    expect(quoteRecordCeilingHits(["预算金额：3500万元"], [{ name: "q", totalYuan: 35000000 }])).toHaveLength(0)
    expect(
      quoteRecordCeilingHits(["预算金额：3500万元", "最高限价：3600万元"], [{ name: "q", totalYuan: 35500000 }]),
    ).toHaveLength(0)
  })

  it("取不到限价/预算或报价单列表为空 → 静默不报", () => {
    expect(quoteRecordCeilingHits(["项目周期：180天"], [{ name: "q", totalYuan: 99999999 }])).toHaveLength(0)
    expect(quoteRecordCeilingHits(["预算金额：3500万元"], [])).toHaveLength(0)
  })

  it("非正数/非法总额不参与比对（价格后录的空白报价单不误报）", () => {
    expect(
      quoteRecordCeilingHits(["预算金额：3500万元"], [
        { name: "空单", totalYuan: 0 },
        { name: "NaN单", totalYuan: Number.NaN },
      ]),
    ).toHaveLength(0)
  })
})

describe("pickLatestQuoteTotals（同名多版本取最新、按商机过滤、≤3 份）", () => {
  const ref = (over: Partial<QuoteTotalRef>): QuoteTotalRef => ({
    name: "报价单A",
    totalYuan: 100,
    updated: "2026-01-01",
    opportunityId: "opp1",
    ...over,
  })

  it("同名 v1/v2 只取最新 updated 那条；不同名都保留", () => {
    const picked = pickLatestQuoteTotals(
      [
        ref({ name: "报价单A", totalYuan: 111, updated: "2026-01-01" }),
        ref({ name: "报价单A", totalYuan: 222, updated: "2026-03-01" }),
        ref({ name: "报价单B", totalYuan: 333, updated: "2026-02-01" }),
      ],
      "opp1",
    )
    expect(picked).toHaveLength(2)
    expect(picked.find((q) => q.name === "报价单A")?.totalYuan).toBe(222)
  })

  it("只取关联目标商机的记录；空/非法商机 id 静默空", () => {
    expect(pickLatestQuoteTotals([ref({ opportunityId: "opp2" })], "opp1")).toHaveLength(0)
    expect(pickLatestQuoteTotals([ref({})], "")).toHaveLength(0)
  })

  it("total≤0/NaN 不参与；超 3 份只取最新 3 份且按 updated 降序", () => {
    const refs = [
      ref({ name: "q0", totalYuan: 0 }),
      ref({ name: "qn", totalYuan: Number.NaN }),
      ref({ name: "a", updated: "2026-01-01" }),
      ref({ name: "b", updated: "2026-02-01" }),
      ref({ name: "c", updated: "2026-03-01" }),
      ref({ name: "d", updated: "2026-04-01" }),
    ]
    const picked = pickLatestQuoteTotals(refs, "opp1")
    expect(picked.map((q) => q.name)).toEqual(["d", "c", "b"])
  })

  it("priceCeilingFromFacts：硬限价优先于预算；两者都无→null；需人工确认行不参与", () => {
    expect(priceCeilingFromFacts(["预算金额：3500万元", "最高限价：3600万元"])).toEqual({ ceiling: 3.6e7, src: "最高限价/控制价" })
    expect(priceCeilingFromFacts(["预算金额：3500万元"])?.src).toBe("预算金额")
    expect(priceCeilingFromFacts(["项目周期：180天"])).toBeNull()
    expect(priceCeilingFromFacts(["预算金额：3500万元【需人工确认】"])).toBeNull()
  })
})

// R187（r184-bid-amount-consistency-wiring）：金额大小写一致性——R184 确定性内核接入交卷体检本地格式路
describe("amountCaseMismatchHits（金额大小写一致性接入交卷体检）", () => {
  it("相邻重述大小写不一致 → amount_case_mismatch（warn + 【废标风险】）", () => {
    const hits = amountCaseMismatchHits(chObj("投标总报价：人民币肆仟万元整（¥4,000,00）"), null)
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("amount_case_mismatch")
    expect(hits[0].level).toBe("warn")
    expect(hits[0].quote).toContain("废标风险")
    expect(hits[0].chapter).toBe("第一章")
  })

  it("大小写一致 → 不报（正常开标一览表零误报）", () => {
    expect(amountCaseMismatchHits(chObj("投标总报价：人民币肆仟万元整（¥40,000,000.00）"), null)).toHaveLength(0)
    expect(amountCaseMismatchHits(chObj("报价 4000万元（人民币肆仟万元整）"), null)).toHaveLength(0)
  })

  it("回归锁：表头「（单位：万元）」这类高频碎片不误报畸形大写（畸形须紧邻小写才提示）", () => {
    const text = "本项目预算金额 3500 万元（单位：万元），其中设备购置 1200 万元（单位：万元）\n质保期 3 年"
    expect(amountCaseMismatchHits(chObj(text), null)).toHaveLength(0)
  })

  it("大写位置未填/书写不规范且紧邻小写 → 提示级 info（模板占位残留）", () => {
    const hits = amountCaseMismatchHits(chObj("投标总价（大写）：人民币万元整（¥40,000,000）"), null)
    expect(hits).toHaveLength(1)
    expect(hits[0].level).toBe("info")
    expect(hits[0].quote).toContain("无法解析")
  })

  it("偏离表响应面同样核对（chapter 标注「偏离表」）", () => {
    const hits = amountCaseMismatchHits([], devSum("我方投标总报价人民币贰佰万元整（¥3,000,000）"))
    expect(hits.some((h) => h.rule === "amount_case_mismatch" && h.chapter.startsWith("偏离表"))).toBe(true)
  })

  it("同章同串去重 + 全文 ≤15 条上限（防刷屏挤占体检列表）", () => {
    const dup = amountCaseMismatchHits(chObj("甲：壹佰万元（¥200,000）；乙：壹佰万元（¥200,000）"), null)
    expect(dup).toHaveLength(1)
    const many = amountCaseMismatchHits(
      Array.from({ length: 20 }, (_, i) => ({
        title: `第${i + 1}章`,
        content: `本项目合同金额人民币壹佰万元整（¥${i + 2},000,000）`,
      })) as unknown as Chapter[],
      null,
    )
    expect(many).toHaveLength(15)
  })

  it("空正文 / 无 title / null 入参容错", () => {
    expect(amountCaseMismatchHits(null as unknown as Chapter[], null)).toHaveLength(0)
    expect(amountCaseMismatchHits([{ title: "", content: "   " }] as unknown as Chapter[], null)).toHaveLength(0)
    expect(amountCaseMismatchHits([{ title: "", content: "壹佰万元（¥2,000,000）" }] as unknown as Chapter[], null)[0].chapter).toBe("第1章")
  })

  it("新规则 amount_case_mismatch 在白名单存活（normalize 不丢弃）", () => {
    const report = normalizeFormatCheckReport({
      hits: [{ chapter: "第一章", rule: "amount_case_mismatch", quote: "x", level: "warn" }],
      checked_at: "",
    })
    expect(report?.hits[0]?.rule).toBe("amount_case_mismatch")
  })
})

// R187 真实标书语料（20 份含大写金额的 docx）复验出的噪声形态，在接线层锁死
describe("amountCaseMismatchHits 真实语料噪声锁", () => {
  it("表格列头「（单位：万元）」与邻格数字不构成大小写重述（跨行相邻不提示）", () => {
    expect(amountCaseMismatchHits(chObj("金额（单位：万元）\n¥670.00\n质保期 3 年"), null)).toHaveLength(0)
  })

  it("「人民币1万元」式小写前缀不被拆出幻影大写", () => {
    expect(amountCaseMismatchHits(chObj("本项目软件许可费为人民币1万元，含税；实施费另计"), null)).toHaveLength(0)
  })

  it("真实废标形态仍能报出：大写与小写重述数值不符", () => {
    const hits = amountCaseMismatchHits(chObj("投标总报价（大写）人民币贰仟贰佰肆拾伍万元整 ¥22,100,000.00"), null)
    expect(hits.filter((h) => h.rule === "amount_case_mismatch")).toHaveLength(1)
    expect(hits[0].level).toBe("warn")
  })
})
