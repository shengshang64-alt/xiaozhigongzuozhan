// r277 切片1：★引文保真 / 占位台账 / 形式质量三查——正例反例与幂等
import { describe, it, expect } from "vitest"
import {
  extractStarParagraphs,
  upgradeClausesWithTender,
  starQuoteFidelityHits,
  normalizeFidelity,
  clauseResponsePromptBlock,
} from "./starClauseFidelity"
import { placeholderLedgerHits } from "./placeholderLedger"
import {
  markdownResidueHits,
  numberingSequenceHits,
  extractDeadlineIso,
  deadlineDateHits,
  cnNum,
} from "./formQualityHits"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

const ch = (title: string, content: string): Chapter =>
  ({ node_id: title, title, sections: [], content, gen_status: "done" })

const P13 =
  "★13、知识产权\n" +
  "本项目软件开发成果整体知识产权归供应商所有，采购人享有永久、免费、不可撤销、非独占、可全域使用的使用权，" +
  "包含本单位及下属单位永久部署、使用、运维、小幅优化、接口适配及日常迭代使用权限。\n" +
  "供应商承诺无条件开放本项目全部定制化源代码及全套技术文档，保障采购人后续可自主升级、改造、迁移。"
const P14 = "★14、保密要求\n中标人有义务对采购方现有系统具体情况以及服务过程文档保密，不得泄露给外界。"
const TENDER = `第五章 招标内容\n${P13}\n${P14}\n★15、售后服务\n中标人须在本市设有固定服务机构并提供7×24小时响应。`

describe("extractStarParagraphs", () => {
  it("标记行到下一标记行全程吸收，不受条款库 600 字/4 行上限影响", () => {
    const long = "★16、超长条款\n" + "很长的正文内容。".repeat(120)
    const paras = extractStarParagraphs(`前文\n${long}\n★17、下一条\n简短正文。`)
    expect(paras).toHaveLength(2)
    expect(paras[0].length).toBeGreaterThan(600)
  })
  it("★13/★14 建条成功，非标记普通行不建条", () => {
    const paras = extractStarParagraphs(TENDER)
    expect(paras.some((p) => p.includes("★13、知识产权"))).toBe(true)
    expect(paras.some((p) => p.includes("保密"))).toBe(true)
    expect(paras.every((p) => /^[★☆▲△]/.test(p.split("\n")[0]))).toBe(true)
  })
})

describe("upgradeClausesWithTender", () => {
  it("条款库被截断的引文找回原文逐字全文", () => {
    const truncated =
      "★13、知识产权\n本项目软件开发成果整体知识产权归供应商所有，采购人享有永久、免费、不可撤销、非独占、可全域使用的使用权"
    const [up] = upgradeClausesWithTender([truncated], TENDER)
    expect(up).toContain("无条件开放本项目全部定制化源代码")
    expect(normalizeFidelity(up).length).toBeGreaterThan(normalizeFidelity(truncated).length)
  })
  it("原文缺失/未命中时原样返回（幂等，绝不无中生有）", () => {
    const c = "★99、查无此条\n完全不存在的条款内容。"
    expect(upgradeClausesWithTender([c], TENDER)).toEqual([c])
    expect(upgradeClausesWithTender([c], "")).toEqual([c])
  })
})

describe("starQuoteFidelityHits", () => {
  it("逐字完整引用 → 零命中", () => {
    const letter =
      `1. 招标实质性条款（逐字引用）：「${P13.replace(/\s+/g, " ")}」\n我方承诺：完全响应。\n` +
      `2. 「${P14.replace(/\s+/g, " ")}」我方承诺。\n` +
      "3. 「★15、售后服务 中标人须在本市设有固定服务机构并提供7×24小时响应。」我方承诺。"
    expect(starQuoteFidelityHits(TENDER, [ch("承诺函", letter)], null)).toHaveLength(0)
  })
  it("引文删节 → warn 并给缺失尾段", () => {
    const bad =
      "「★13、知识产权 本项目软件开发成果整体知识产权归供应商所有，采购人享有永久、免费、不可撤销、非独占、可全域使用的使用权」" +
      `「${P14.replace(/\s+/g, " ")}」「★15、售后服务 中标人须在本市设有固定服务机构并提供7×24小时响应。》`
    const hits = starQuoteFidelityHits(TENDER, [ch("承诺函", bad)], null)
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("star_quote_fidelity")
    expect(hits[0].quote).toContain("删节")
    expect(hits[0].quote).toContain("包含本单位")
  })
  it("整条漏引 → 报未见逐字引用；偏离表条款列计入引用面", () => {
    expect(starQuoteFidelityHits(TENDER, [ch("方案", "与条款无关的正文。")], null)).toHaveLength(3)
    const dm = {
      split_dim: "l3" as const,
      generated_at: "",
      rows: [
        {
          clause_id: "c1",
          clause_text: P13.replace(/\n/g, " "),
          source: "招标",
          response_node: "",
          response_level: "full" as const,
          response_summary: "",
          bid_ref: "",
        },
      ],
    }
    expect(starQuoteFidelityHits(TENDER, [], dm)).toHaveLength(2)
  })
})

describe("placeholderLedgerHits", () => {
  it("【此处插入截图】/【待填写】/（填写‘全称’）入台账；正常正文与签章下划线零误伤", () => {
    const hits = placeholderLedgerHits([
      ch("技术响应表", "患者信息脱敏功能如下【此处插入截图】备注【待填写】投标人（填写‘全称’）"),
      ch("投标函", "正常正文，无任何占位指令。落款：________（盖章）"),
    ])
    expect(hits).toHaveLength(2)
    expect(hits.every((h) => h.rule === "placeholder_leftover" && h.level === "warn")).toBe(true)
    expect(hits.every((h) => h.chapter === "技术响应表")).toBe(true)
    expect(hits[0].quote).toContain("占位未填 2 处")
  })
})

describe("markdownResidueHits", () => {
  it("**加粗**、# 标题、[链接]()、|---| 残留命中；正常中文正文零误伤", () => {
    const hits = markdownResidueHits([
      ch("质保", "质保 **3年** 免费\n# 标题残留\n详见 [官网](https://x.cn)\n| --- | --- |"),
      ch("正常", "本项目质保期为 3 年，7×24 小时响应，★13 条款逐字响应，覆盖率 3*5=15。"),
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("markdown_residue")
    expect(hits[0].chapter).toBe("质保")
  })
})

describe("numberingSequenceHits", () => {
  it("行首「第N期」重复/倒序命中；句中回指与正常序列零误报", () => {
    expect(cnNum("三")).toBe(3)
    expect(cnNum("十二")).toBe(12)
    expect(cnNum("二十三")).toBe(23)
    expect(cnNum("X")).toBe(-1)
    const bad = numberingSequenceHits([ch("培训", "第一期 基础\n第二期 进阶\n第三期 管理\n第三期 补训")])
    expect(bad).toHaveLength(1)
    expect(bad[0].rule).toBe("numbering_sequence")
    expect(bad[0].quote).toContain("第三期")
    const ok = numberingSequenceHits([ch("培训", "第一期 基础\n第二期 进阶（复盘第一期内容）\n第三期 管理")])
    expect(ok).toHaveLength(0)
  })
})

describe("deadlineDateHits", () => {
  it("从解析文本提取截止日；正文落款晚于截止日命中，当日与之前放行；无截止日静默", () => {
    expect(extractDeadlineIso("投标文件递交截止：2026年10月20日 09:30")).toBe("2026-10-20")
    expect(extractDeadlineIso("具体详见招标公告，无日期")).toBe("")
    const iso = extractDeadlineIso("投标截止时间：2026年10月20日")
    const hits = deadlineDateHits(
      [ch("承诺函", "日期：2026 年 10 月 25 日"), ch("投标函", "日期：2026年10月20日")],
      iso,
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("deadline_date")
    expect(deadlineDateHits([ch("a", "2026年10月25日")], "")).toHaveLength(0)
  })
})

import { scheduleConsistencyHits } from "./formQualityHits"
import { gateCondition, type BidProjectRecord, type FormatCheckHit } from "./bidTypes"

describe("scheduleConsistencyHits（评审 A2 根修）", () => {
  it("总工期承诺与计划里程碑天数矛盾 → warn 并给超出天数", () => {
    const hits = scheduleConsistencyHits([
      ch("商务响应表", "我方承诺：总工期合同签订后 180 个自然日内完成全部建设并申请终验。"),
      ch("实施方案", "里程碑计划：合同签订后第 120 日完成初验，T+240 日组织终验。"),
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].rule).toBe("schedule_consistency")
    expect(hits[0].quote).toContain("超承诺 60 天")
  })
  it("口径一致 / 缺任一面 → 零命中", () => {
    expect(scheduleConsistencyHits([
      ch("响应表", "总工期 240 日历天"), ch("实施", "T+120 日初验，T+240 日终验"),
    ])).toHaveLength(0)
    expect(scheduleConsistencyHits([ch("实施", "T+240 日终验")])).toHaveLength(0)
    expect(scheduleConsistencyHits([ch("响应表", "总工期 180 天")])).toHaveLength(0)
  })
  it("月形态里程碑「第N个月终验」×30 折天并入对账（评审 A2 的 M8 句式）", () => {
    const hits = scheduleConsistencyHits([
      ch("响应表", "总工期：180 日历天"),
      ch("进度计划", "项目进场后第 8 个月内组织完成终验"),
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].quote).toContain("超承诺 60 天")
  })
  it("个月承诺按 30 天平折", () => {
    const hits = scheduleConsistencyHits([
      ch("a", "总工期：6 个月"), ch("b", "上线：合同签订后第 200 日"),
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].quote).toContain("=180 天")
  })
})

describe("gateCondition check 质量闸（r277 切片2）", () => {
  const baseRec = (hits: FormatCheckHit[]) =>
    ({
      dup_report: {},
      void_check: {},
      submission_check: { items: [{ index: 0 }], checked_at: "", format_report: { hits, checked_at: "" } },
    }) as unknown as Partial<BidProjectRecord>

  it("报告齐全且无废标级命中 → 满足", () => {
    expect(gateCondition(baseRec([]), "check").met).toBe(true)
  })
  it("★引文删节/占位未填 → 不满足并计数", () => {
    const bad = baseRec([
      { chapter: "x", rule: "star_quote_fidelity", quote: "q", level: "warn" },
      { chapter: "y", rule: "placeholder_leftover", quote: "q", level: "warn" },
      { chapter: "z", rule: "markdown_residue", quote: "q", level: "warn" },
    ])
    const g = gateCondition(bad, "check")
    expect(g.met).toBe(false)
    expect(g.missing).toContain("2 条废标级体检项")
  })
  it("形式类命中（markdown）不进质量闸黑名单", () => {
    expect(gateCondition(baseRec([{ chapter: "z", rule: "markdown_residue", quote: "q", level: "warn" }]), "check").met).toBe(true)
  })
})

// ---- r277 切片3：逐项深度响应引擎注入段 ----
const TRUNC13 = "★13、知识产权\n本项目软件开发成果整体知识产权归供应商所有，采购人享有永久、免费、不可撤销、非独占、可全域使用的使用权"
const reportWith = (content: string) =>
  ({ sections: [{ key: "star_clauses", title: "t", content, status: "ok", snippet: "" }] }) as never

describe("clauseResponsePromptBlock", () => {
  it("条款节缺失/为空 → 空串（调用方不注入）", () => {
    expect(clauseResponsePromptBlock(null, TENDER)).toBe("")
    expect(clauseResponsePromptBlock(reportWith(""), TENDER)).toBe("")
  })
  it("截断条款按招标原文找回逐字全文后再注入", () => {
    const block = clauseResponsePromptBlock(reportWith(TRUNC13), TENDER)
    expect(block).toContain("无条件开放本项目全部定制化源代码")
    expect(block).toContain("★13、知识产权")
  })
  it("锁三要素与证据挂载关键短语 + 尾注行丢弃", () => {
    const sec = TRUNC13 + "\n…另有 99 条未列出"
    const block = clauseResponsePromptBlock(reportWith(sec), TENDER)
    expect(block).toContain("逐项深度响应")
    expect(block).toContain("三要素")
    expect(block).toContain("逐字复述")
    expect(block).toContain("偏离值")
    expect(block).toContain("佐证材料：【待填写")
    expect(block).not.toContain("另有 99 条未列出")
  })
  it("无招标原文时以条款节自身为基准仍正常产出（降级不崩）", () => {
    const block = clauseResponsePromptBlock(reportWith(P13), "")
    expect(block).toContain("★13、知识产权")
    expect(block.startsWith("【★/▲ 实质性条款逐项深度响应")).toBe(true)
  })
})
