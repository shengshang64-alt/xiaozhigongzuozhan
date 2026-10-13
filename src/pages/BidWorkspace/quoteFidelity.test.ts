// r286（bid-l2-verbatim-compare 切片1）：引文级改写核对——本地零 AI、只报不拦的
// 「改写=0」硬指标第一刀。判据：有引述提示词/★▲起头的引号，归一后招标原文逐字未见 -> warn。
import { describe, expect, it } from "vitest"
import { buildQuoteFixDirective, quoteRewriteFixTargets, quoteRewriteHits } from "./quoteFidelity"
import type { Chapter } from "../SolutionStudio/solutionTypes"

const ch = (over: Partial<Chapter>): Chapter =>
  ({ node_id: "n", title: "章", sections: [], content: "", gen_status: "done", ...over }) as Chapter

const TENDER = [
  "一、技术规格要求",
  "★系统须支持日均门诊15000人次的数据处理能力，并保障高峰期响应时间不超过2秒。",
  "评标办法：技术部分满分40分，其中系统架构10分、性能指标10分、安全设计20分。",
  "售后服务要求：提供7×24小时驻场运维，重大故障2小时内到场处理。",
  "二、商务要求",
  "投标人须提供近三年内同类三甲医院项目成功案例不少于3个，并附合同扫描件。",
].join("\n")

describe("quoteRewriteHits 引文级改写核对", () => {
  it("照录引文（有提示词）→ 零命中", () => {
    const body = '按招标文件要求“★系统须支持日均门诊15000人次的数据处理能力，并保障高峰期响应时间不超过2秒”，我方完全满足。'
    expect(quoteRewriteHits(TENDER, [ch({ content: body })])).toEqual([])
  })

  it("改写引文（丢字换词）→ warn 命中并带原文定位", () => {
    const body = '按照评分要求“技术部分满分40分，系统架构10分、性能10分、安全20分”逐项自查。'
    const hits = quoteRewriteHits(TENDER, [ch({ title: "自查说明", content: body })])
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("quote_rewrite")
    expect(hits[0].level).toBe("warn")
    expect(hits[0].chapter).toBe("自查说明")
    expect(hits[0].quote).toContain("疑改写")
  })

  it("仅空白/半角标点差异 → 归一后视为逐字，不判", () => {
    const body = '响应技术规范“系统须支持日均门诊 15000 人次的数据处理能力, 并保障高峰期响应时间不超过2秒”。'
    expect(quoteRewriteHits(TENDER, [ch({ content: body })])).toEqual([])
  })

  it("★起头引号无需提示词：照录不判、改写判", () => {
    const ok = '本章逐条响应：“★系统须支持日均门诊15000人次的数据处理能力，并保障高峰期响应时间不超过2秒。”'
    const bad = '本章逐条响应：“★系统须支持日均门诊30000人次的数据处理能力，并保障高峰期响应时间不超过1秒。”'
    expect(quoteRewriteHits(TENDER, [ch({ content: ok })])).toEqual([])
    const hits = quoteRewriteHits(TENDER, [ch({ content: bad })])
    expect(hits).toHaveLength(1)
  })

  it("无提示词且无标记的长引号（自拟口号）→ 不核对", () => {
    const body = '我方秉承“以创新的技术与卓越的服务为医院打造智慧医疗全新生态”的愿景持续投入。'
    expect(quoteRewriteHits(TENDER, [ch({ content: body })])).toEqual([])
  })

  it("引号内含【待填写】占位 → 不核对（留给占位台账管）", () => {
    const body = '招标文件要求“系统须支持【待填写】人次的数据处理能力并保障高峰期响应时间不超过2秒”。'
    expect(quoteRewriteHits(TENDER, [ch({ content: body })])).toEqual([])
  })

  it("同一改写形态跨章重复 → 只记一条", () => {
    const body = '按照评标办法“技术部分满分40分，架构10分”复核。'
    const hits = quoteRewriteHits(TENDER, [ch({ title: "A", content: body }), ch({ title: "B", content: body })])
    expect(hits).toHaveLength(1)
  })

  it("无基准（tender 缺失/过短）→ 一律不判", () => {
    const body = '招标文件要求“某条被改写得不像原文的技术性长句表述内容若干字”响应。'
    expect(quoteRewriteHits("", [ch({ content: body })])).toEqual([])
    expect(quoteRewriteHits("太短了", [ch({ content: body })])).toEqual([])
  })

  it("命中封顶 16 条，多出的噪声不挤爆报告", () => {
    const parts = []
    for (let i = 0; i < 24; i++) {
      parts.push(`招标文件要求“第${i}项技术参数须完全响应甲乙丙丁戊己庚辛壬癸补充字样”，均已满足。`)
    }
    const hits = quoteRewriteHits(TENDER, [ch({ content: parts.join("\n") })])
    expect(hits).toHaveLength(16)
  })

  it("空正文/无内容章不参与", () => {
    expect(quoteRewriteHits(TENDER, [ch({ content: "" }), { node_id: "x" } as Chapter])).toEqual([])
  })
})

// ---- r287（bid-l2-verbatim-compare 切片2·整改回注）：命中定位与最小改动指令（纯本地零 AI） ----

/** 两小节串行生成形态章：改写引语落在第 2 片（section_stats 确定性切片可定位） */
const twoSectionChapter = () => {
  const p0 = "1.1 总体架构\n采用分层设计，高峰期响应不超过2秒。"
  const p1 = '1.2 安全设计\n按照评分要求“技术部分满分40分，系统架构10分、性能10分、安全20分”逐项自查。'
  return ch({
    node_id: "cA",
    title: "安全篇",
    sections: ["总体架构", "安全设计"],
    content: p0 + "\n\n" + p1,
    section_stats: [
      { title: "总体架构", chars: p0.length },
      { title: "安全设计", chars: p1.length },
    ],
  })
}

/** 造一章 n 个小节、每节一条互不相同的改写引语（封顶行为用） */
const manySectionChapter = (node: string, n: number): Chapter => {
  const pieces: string[] = []
  for (let i = 0; i < n; i++) {
    pieces.push(`${i + 1}.x 节${i}\n采购文件规定“第${i}项技术参数须完全响应甲乙丙丁戊己庚辛壬癸补充字样”，已满足。`)
  }
  return ch({
    node_id: node,
    title: `章${node}`,
    sections: pieces.map((_, i) => `节${i}`),
    content: pieces.join("\n\n"),
    section_stats: pieces.map((p, i) => ({ title: `节${i}`, chars: p.length })),
  })
}

describe("quoteRewriteFixTargets 整改定位（r287 切片2）", () => {
  it("命中落在正确小节下标：只定位含改写引语的那片", () => {
    const groups = quoteRewriteFixTargets(TENDER, [twoSectionChapter()])
    expect(groups).toHaveLength(1)
    expect(groups[0].chapterId).toBe("cA")
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].sectionIdx).toBe(1)
    expect(groups[0].items[0].quotes[0].text).toContain("技术部分满分40分")
  })

  it("整章 blob（无 section_stats）不定位：小节回注通道无法整章粒度整改", () => {
    const body = '按照评分要求“技术部分满分40分，系统架构10分、性能10分、安全20分”逐项自查。'
    expect(quoteRewriteFixTargets(TENDER, [ch({ content: body, sections: ["安全设计"] })])).toEqual([])
  })

  it("照录引文与无基准均不产整改项", () => {
    const verbatim = twoSectionChapter()
    const fixed = { ...verbatim, content: verbatim.content.replace("系统架构10分、性能10分、安全20分", "其中系统架构10分、性能指标10分、安全设计20分") }
    expect(quoteRewriteFixTargets(TENDER, [fixed])).toEqual([])
    expect(quoteRewriteFixTargets("", [twoSectionChapter()])).toEqual([])
  })

  it("同一改写形态散落在不同小节 → 每处都定位（回注重在清零，与报告的跨章去重刻意不同）", () => {
    const q = '按照评分要求“技术部分满分40分，系统架构10分、性能10分、安全20分”逐项自查。'
    const p0 = `1.1 甲节\n${q}`
    const p1 = `1.2 乙节\n${q}`
    const c = ch({
      node_id: "cB",
      title: "重复篇",
      sections: ["甲节", "乙节"],
      content: p0 + "\n\n" + p1,
      section_stats: [{ title: "甲节", chars: p0.length }, { title: "乙节", chars: p1.length }],
    })
    const groups = quoteRewriteFixTargets(TENDER, [c])
    expect(groups[0].items.map((it) => it.sectionIdx)).toEqual([0, 1])
  })

  it("一轮整改全局封顶 12 小节：7+7 两章只保留第一章（不让一次费用确认失控）", () => {
    const groups = quoteRewriteFixTargets(TENDER, [manySectionChapter("c1", 7), manySectionChapter("c2", 7)])
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(7)
  })
})

describe("buildQuoteFixDirective 整改指令（r287 切片2）", () => {
  it("空清单返回空串（等同不注入）", () => {
    expect(buildQuoteFixDirective([])).toBe("")
  })

  it("指令含引语、可对照时的原文定位与最小改动口径", () => {
    const d = buildQuoteFixDirective([{ text: "技术部分满分40分，性能10分", ctx: "技术部分满分40分其中系统架构10分…" }])
    expect(d).toContain("引文改写整改")
    expect(d).toContain("技术部分满分40分，性能10分")
    expect(d).toContain("招标原文该处为")
    expect(d).toContain("间接转述")
    expect(d).toContain("保持不变")
  })
})
