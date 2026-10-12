// ---------------------------------------------------------------------------
// runCheck 派生定位层单测（R262）：resolvePositions 的摘录匹配回归。
// 重点覆盖实机发现的缺陷：clip 窗口摘录带前导「…」/ 跨段拼接时定位失败。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest"
import { buildDocContextFromProject, resolvePositions } from "./runCheck"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { emptyMeta } from "./engine/docxInspect"
import type { CheckHit, CheckItem, DocContext, Paragraph } from "./bidCheckTypes"

function para(text: string, heading = false, index = 0): Paragraph {
  return { text, heading, index, inTable: false, hasImage: false }
}

function ctxWith(chapterDefs: { title: string; paras: string[] }[]): DocContext {
  const paragraphs: Paragraph[] = []
  const chapterOf: number[] = []
  const chapters = chapterDefs.map((c, ci) => {
    paragraphs.push(para(c.title, true, paragraphs.length))
    chapterOf.push(ci)
    c.paras.forEach((t) => {
      paragraphs.push(para(t, false, paragraphs.length))
      chapterOf.push(ci)
    })
    return { title: c.title, content: [c.title, ...c.paras].join("\n") }
  })
  return {
    sourceName: "t.docx",
    inputKind: "project",
    hasPackage: false,
    chapters,
    paragraphs,
    chapterOf,
    fullText: chapters.map((c) => `${c.title}\n${c.content}`).join("\n"),
    meta: emptyMeta(),
  }
}

function hit(location: string, text: string): CheckHit {
  return { location, text, rule: "wording_scan", basis: "" }
}

function item(hits: CheckHit[]): CheckItem {
  return {
    code: "L1-T1", level: "L1", category: "措辞", title: "措辞检查",
    severity: "medium", status: "warn", basis: "", suggestion: "", hits, confidence: null,
  }
}

const P1 = "本节承接第16章对接口对接实施范围与清单落点的界定，将总体集成范围转化为可执行的组织架构与职责分工。"
const P2 = "专业实施组下设平台部署组、接口对接组、数据治理与临床信息数据库配置组、测试与演示保障组。"

describe("resolvePositions（R262 派生定位层）", () => {
  it("摘录带前后省略号（clip 窗口截断）仍能定位到本章节落", () => {
    const ctx = ctxWith([
      { title: "实施方案", paras: [P1, P2] },
      { title: "报价", paras: ["报价说明若干。"] },
    ])
    // P1 中段开始的窗口摘录，两端带省略号
    const h = hit("实施方案", "…承接第16章对接口对接实施范围与清单落点的界定，将总体…")
    resolvePositions(ctx, [item([h])])
    expect(h.paragraphIndex).toBe(1) // paragraphs[0] 是章标题段
    expect(h.chapterIndex).toBe(0)
    expect(h.paragraphText).toBe(P1)
    expect(h.lineNo).toBe(2)
  })

  it("超长跨段摘录整段匹配失败时按前缀/后缀候选命中", () => {
    const ctx = ctxWith([{ title: "章A", paras: [P1 + P2, "尾部"] }])
    // 66 字窗口只落在 P1+P2 合并段内；再构造一个跨段拼接的 90 字窗口
    const cross = P1.slice(0, 34) + "|||" + P2.slice(0, 34)
    const h = hit("章A", cross)
    resolvePositions(ctx, [item([h])])
    // 整段不匹配 → 前缀候选（P1 前 32 字规范化后可命中合并段落）
    expect(h.paragraphIndex).toBe(1)
  })

  it("元数据/节点类 location 不参与正文定位", () => {
    const ctx = ctxWith([{ title: "章A", paras: [P1] }])
    const h = hit("core.xml → dc:creator", "某某公司")
    resolvePositions(ctx, [item([h])])
    expect(h.paragraphIndex).toBeUndefined()
  })

  it("无法匹配的正文片段安全跳过（不产生半成品锚点）", () => {
    const ctx = ctxWith([{ title: "章A", paras: [P1] }])
    const h = hit("章A", "完全不存在于正文的片段内容")
    resolvePositions(ctx, [item([h])])
    expect(h.paragraphIndex).toBeUndefined()
    expect(h.paragraphText).toBeUndefined()
  })
})

function projWith(chs: { title?: string; content?: string }[]): BidProjectRecord {
  return { project_name: "t", bid_chapters: chs } as unknown as BidProjectRecord
}

describe("buildDocContextFromProject 正文清洗（R284 检查=预览=导出）", () => {
  it("剥正文里的分析态批注（原文事实/响应cXX/出处），保留正文主体", () => {
    const ctx = buildDocContextFromProject(
      projWith([
        {
          title: "实施方案",
          content:
            "先行完成互联互通（原文事实，出自标包划分），报价（响应 c14、c15）如下，评审要点（出处：第四章 技术项（F2×A2））展开。",
        },
      ]),
    )
    const j = ctx.chapters.map((c) => c.content).join(" ")
    expect(j).not.toContain("原文事实")
    expect(j).not.toContain("响应 c14")
    expect(j).not.toContain("出处")
    expect(j).toContain("先行完成互联互通")
    expect(j).toContain("展开")
  })
  it("保留【待填写】与合法括号（投标（响应）报价明细表 / 含嵌套）不误伤", () => {
    const ctx = buildDocContextFromProject(
      projWith([
        {
          title: "投标（响应）报价明细表",
          content: "证书编号【待填写】。协议（如 http、webservice（含 websocket）等）。",
        },
      ]),
    )
    expect(ctx.chapters[0].title).toBe("投标（响应）报价明细表")
    const j = ctx.chapters.map((c) => c.content).join(" ")
    expect(j).toContain("【待填写】")
    expect(j).toContain("（含 websocket）")
  })
})
