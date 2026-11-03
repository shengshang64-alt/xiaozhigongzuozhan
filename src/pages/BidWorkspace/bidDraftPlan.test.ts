// R245 底稿增量合并落库口径（bidDraftPlan）单测：纯文本切章 / 类型判定 / 参考段渲染与剥离 /
// 应用计划的四种动作与「已有正文不被覆盖」底线 / 追加底稿多出的章幂等 / 解除标记（含商务骨架章切技术章） / 底稿小节按标题层级折叠（R245 实机自测发现 Word「标题 2」冒充独立章）。
// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Chapter } from "../SolutionStudio/solutionTypes"
import type { DraftChapter } from "./bidDraftMerge"
import { buildMergePlan } from "./bidDraftMerge"
import {
  DRAFT_REF_CLOSE,
  DRAFT_REF_OPEN,
  applyMergePlan,
  buildOutlineTargets,
  kindForChapter,
  parseDraftPlainText,
  planForChapters,
  previewExtras,
  releaseDraftChapter,
  renderDraftRefBlock,
  stripDraftRefBlock,
} from "./bidDraftPlan"

function ch(node_id: string, title: string, patch: Partial<Chapter> = {}): Chapter {
  return { node_id, title, sections: [], content: "", gen_status: "pending", ...patch }
}

const DRAFTS: DraftChapter[] = [
  { title: "第一章 商务资质", content: "营业执照与等级证书复印件。" + "资质说明".repeat(30) },
  { title: "三、总体架构设计", content: "五层架构逐层展开。".repeat(40) },
  { title: "附件清单", content: "底稿独有的附件说明段落，长度需要超过四十字才算一个段落用于检索。" },
]

describe("kindForChapter / buildOutlineTargets", () => {
  it("偏离表优先于 part，商务骨架章判 business，架构类判 architecture", () => {
    expect(kindForChapter({ title: "技术偏离表" })).toBe("deviation")
    expect(kindForChapter({ part: "biz", title: "商务资质" })).toBe("business")
    expect(kindForChapter({ title: "总体架构设计" })).toBe("architecture")
    expect(kindForChapter({ title: "数据中台功能设计" })).toBe("technical")
  })
  it("章节清单按顺序映射为匹配目标", () => {
    const t = buildOutlineTargets([
      { node_id: "a", title: "商务资质", part: "biz" },
      { node_id: "b", title: "总体架构设计" },
    ])
    expect(t).toEqual([
      { id: "a", title: "商务资质", kind: "business" },
      { id: "b", title: "总体架构设计", kind: "architecture" },
    ])
  })
})

describe("parseDraftPlainText", () => {
  it("按章编号与点号编号切章，标题与正文分离", () => {
    const out = parseDraftPlainText("前言段落\n第一章 商务资质\n证照齐全\n3.1 部署方案\n容器化部署\n第四章 服务\n驻场服务")
    expect(out.map((c) => c.title)).toEqual(["第一章 商务资质", "3.1 部署方案", "第四章 服务"])
    expect(out[0].content).toBe("证照齐全")
    expect(out[2].content).toBe("驻场服务")
  })
  it("句末标点与超长行不判为标题；无标题时整篇作单章", () => {
    expect(parseDraftPlainText("一、建设目标说明：")).toHaveLength(1)
    const one = parseDraftPlainText("这里没有任何编号标题，只有一段连续正文。".repeat(3))
    expect(one).toHaveLength(1)
    expect(one[0].title).toBe("")
    expect(one[0].content.length).toBeGreaterThan(0)
  })
  it("空输入返回空数组", () => {
    expect(parseDraftPlainText("   \n  \n")).toEqual([])
  })
})

describe("renderDraftRefBlock / stripDraftRefBlock", () => {
  it("每条压成单行并带标题头，空入参返回空串", () => {
    const text = renderDraftRefBlock([{ title: "  智慧医疗平台 ", content: "a\n\nb\tc" }])
    expect(text).toContain(DRAFT_REF_OPEN)
    expect(text).toContain("【底稿参考·智慧医疗平台】a b c")
    expect(text.trimEnd().endsWith(DRAFT_REF_CLOSE)).toBe(true)
    expect(renderDraftRefBlock([])).toBe("")
    expect(renderDraftRefBlock([{ title: "x", content: "   " }])).toBe("")
  })
  it("超长正文截断到上限并加省略号", () => {
    const text = renderDraftRefBlock([{ title: "长章", content: "字".repeat(2000) }])
    expect(text).toContain("字…")
    expect(text.includes("…】")).toBe(false)
    expect(text.length).toBeLessThan(1100)
  })
  it("参考段超上限时优先保留标题命中句与量化承诺句，而非机械截断（R246）", () => {
    const body =
      "系统概述段落，介绍平台建设背景与总体定位。".repeat(3) +
      "本项目质保期为 5 年，故障响应时间不超过 30 分钟。" +
      "此处为无关填充文字，用于把正文推过参考段上限阈值以触发要点选取。".repeat(30)
    const text = renderDraftRefBlock([{ title: "质保与响应", content: body }])
    expect(body.length).toBeGreaterThan(900)
    expect(text).toContain("质保期为 5 年")
    expect(text).toContain("响应时间不超过 30 分钟")
    expect(text).toContain("…")
    expect(text).not.toContain("无关填充文字")
    expect(text.length).toBeLessThan(1000)
  })
  it("剥离后重复应用不叠加，且不影响既有自由资料", () => {
    const block = renderDraftRefBlock([{ title: "章A", content: "内容内容内容内容内容内容" }])
    const full = "自由资料段落。\n\n" + block
    expect(stripDraftRefBlock(full)).toBe("自由资料段落。")
    expect(stripDraftRefBlock("没有任何标记的资料")).toBe("没有任何标记的资料")
  })
})

describe("applyMergePlan", () => {
  const chapters = [
    ch("c1", "商务资质", { part: "biz" }),
    ch("c2", "总体架构设计"),
    ch("c3", "数据中台功能设计"),
    ch("c4", "技术偏离表"),
  ]
  const plan = planForChapters(chapters, DRAFTS)

  it("商务章命中 → 底稿原文落正文 + done + 底稿保留标记", () => {
    const out = applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS })
    const c1 = out.chapters.find((c) => c.node_id === "c1")!
    expect(c1.gen_status).toBe("done")
    expect(c1.draftLocked).toBe(true)
    expect(c1.draftFrom).toBe("第一章 商务资质")
    expect(c1.content).toContain("营业执照")
    expect(out.summary.kept).toBe(2)
  })
  it("架构章命中仍判原文保留（保守：绝不误删商务同事成果）", () => {
    const out = applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS })
    expect(out.chapters.find((c) => c.node_id === "c2")!.draftLocked).toBe(true)
  })
  it("未命中的技术章正文保持为空，等待逐章生成", () => {
    const out = applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS })
    const c3 = out.chapters.find((c) => c.node_id === "c3")!
    expect(c3.content).toBe("")
    expect(c3.gen_status).toBe("pending")
    expect(c3.draftLocked).toBeUndefined()
  })
  it("底稿多出的章追加为商务章并同步大纲；appendExtras=false 时不追加", () => {
    const out = applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS })
    const extra = out.chapters.find((c) => c.node_id.startsWith("draft-extra"))!
    expect(extra.part).toBe("biz")
    expect(extra.gen_status).toBe("done")
    expect(out.outline.map((n) => n.id)).toContain(extra.node_id)
    expect(out.summary.appended).toBe(1)
    const skip = applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS, appendExtras: false })
    expect(skip.outline).toEqual([])
    expect(skip.summary.appended).toBe(0)
  })
  it("重复应用幂等：底稿多出章不重复追加，正文不叠加", () => {
    const first = applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS })
    const second = applyMergePlan({ chapters: first.chapters, outline: first.outline, plan, drafts: DRAFTS })
    expect(second.chapters.length).toBe(first.chapters.length)
    expect(second.chapters.filter((c) => c.node_id.startsWith("draft-extra"))).toHaveLength(1)
  })
  it("已有正文的章不被底稿覆盖，改记为参考材料", () => {
    const filled = chapters.map((c) => (c.node_id === "c1" ? { ...c, content: "AI 已生成的商务正文" } : c))
    const out = applyMergePlan({ chapters: filled, outline: [], plan: planForChapters(filled, DRAFTS), drafts: DRAFTS })
    expect(out.chapters.find((c) => c.node_id === "c1")!.content).toBe("AI 已生成的商务正文")
    expect(out.summary.protectedFilled).toBe(1)
    expect(out.refAppendix).toContain("【底稿参考·商务资质】")
  })
  it("入参章节清单不被就地修改", () => {
    const before = JSON.stringify(chapters)
    applyMergePlan({ chapters, outline: [], plan, drafts: DRAFTS })
    expect(JSON.stringify(chapters)).toBe(before)
  })
  it("偏离表未命中时判补表，正文不受影响", () => {
    const items = buildMergePlan(buildOutlineTargets([ch("c4", "技术偏离表")]), []).items
    expect(items[0].action).toBe("append-deviation")
  })
  it("换用更短底稿重新应用时清退上一轮的孤儿底稿多出章（R246）", () => {
    const base = [ch("c1", "商务资质", { part: "biz" }), ch("c2", "总体架构设计")]
    const first = applyMergePlan({ chapters: base, outline: [], plan: planForChapters(base, DRAFTS), drafts: DRAFTS })
    expect(first.chapters.some((c) => c.node_id === "draft-extra-3")).toBe(true)
    const shortDrafts: DraftChapter[] = [{ title: "商务资质", content: "只剩商务正文，大纲都能认领，不再有多出的章。" }]
    const planB = planForChapters(base, shortDrafts)
    const second = applyMergePlan({ chapters: first.chapters, outline: first.outline, plan: planB, drafts: shortDrafts })
    expect(second.summary.pruned).toBe(1)
    expect(second.chapters.some((c) => c.node_id.startsWith("draft-extra-"))).toBe(false)
    expect(second.outline.some((n) => n.id.startsWith("draft-extra-"))).toBe(false)
    const keep = applyMergePlan({
      chapters: first.chapters,
      outline: first.outline,
      plan: planB,
      drafts: shortDrafts,
      appendExtras: false,
    })
    expect(keep.summary.pruned).toBe(0)
    expect(keep.chapters.some((c) => c.node_id === "draft-extra-3")).toBe(true)
  })
})

describe("previewExtras / 底稿小节折叠", () => {
  const LEVELED: DraftChapter[] = [
    { title: "第一章 公司资质", content: "资质正文。", level: 1 },
    { title: "1.1 业绩清单", content: "近三年业绩正文。", level: 2 },
    { title: "第二章 总体架构设计", content: "架构正文。", level: 1 },
    { title: "2.1 部署架构", content: "部署正文。", level: 2 },
  ]
  const planOf = (titles: string[]) =>
    buildMergePlan(buildOutlineTargets(titles.map((t, i) => ch(`n${i}`, t))), LEVELED)

  it("子节不计入独立追加：父章被大纲认领或父章自身被追加时折叠", () => {
    const pv = previewExtras(LEVELED, planOf(["总体架构设计"]))
    expect(pv.append).toEqual([0])
    expect(pv.folded).toEqual([1, 3])
  })
  it("折叠只认最近的更上层标题，跨级的更深子节仍归最近父章", () => {
    const deep: DraftChapter[] = [
      { title: "第一章 商务", content: "A", level: 1 },
      { title: "1.1 节", content: "b", level: 2 },
      { title: "1.1.1 小节", content: "c", level: 3 },
    ]
    const p = buildMergePlan(buildOutlineTargets([ch("x", "与底稿无关的章")]), deep)
    const pv = previewExtras(deep, p)
    expect(pv.append).toEqual([0])
    expect(pv.folded).toEqual([1, 2])
  })
  it("应用后子节正文接回所属章：追加章与保留章各得其所，summary.folded 记账", () => {
    const plan = planOf(["总体架构设计"])
    const out = applyMergePlan({ chapters: [ch("n0", "总体架构设计")], outline: [], plan, drafts: LEVELED })
    expect(out.summary).toEqual({ kept: 1, referenced: 0, protectedFilled: 0, appended: 1, folded: 2, pruned: 0 })
    const locked = out.chapters.find((c) => c.node_id === "n0")
    const extra = out.chapters.find((c) => c.node_id === "draft-extra-1")
    expect(locked?.content.startsWith("架构正文。")).toBe(true)
    expect(locked?.content).toContain("2.1 部署架构")
    expect(locked?.content).toContain("部署正文。")
    expect(extra?.content).toContain("1.1 业绩清单")
    expect(extra?.content).toContain("近三年业绩正文。")
    expect(out.outline.some((n) => n.id === "draft-extra-1")).toBe(true)
    expect(out.outline.some((n) => n.id === "draft-extra-4")).toBe(false)
  })
  it("不追加底稿多出章时：未认领父章的子节随之搁置，被认领父章的子节仍折叠", () => {
    const plan = planOf(["总体架构设计"])
    const out = applyMergePlan({
      chapters: [ch("n0", "总体架构设计")],
      outline: [],
      plan,
      drafts: LEVELED,
      appendExtras: false,
    })
    expect(out.summary.appended).toBe(0)
    expect(out.summary.folded).toBe(1)
    expect(out.chapters).toHaveLength(1)
    expect(out.chapters[0].content).toContain("部署正文。")
  })
  it("父章在章节清单里缺位时兜底独立成章，正文一个字都不丢", () => {
    const plan = planOf(["总体架构设计"])
    const out = applyMergePlan({ chapters: [], outline: [], plan, drafts: LEVELED })
    expect(out.summary.kept).toBe(0)
    expect(out.summary.appended).toBe(2)
    expect(out.summary.folded).toBe(1)
    expect(out.chapters.map((c) => c.node_id)).toEqual(["draft-extra-1", "draft-extra-4"])
    expect(out.chapters[1].content).toBe("部署正文。")
  })
  it("已有正文被保护转参考段时，子节折进参考段而不是新章", () => {
    const plan = planOf(["总体架构设计"])
    const out = applyMergePlan({
      chapters: [ch("n0", "总体架构设计", { content: "AI 已成稿正文", gen_status: "done" })],
      outline: [],
      plan,
      drafts: LEVELED,
    })
    expect(out.summary.protectedFilled).toBe(1)
    expect(out.chapters[0].content).toBe("AI 已成稿正文")
    expect(out.refAppendix).toContain("架构正文。")
    expect(out.refAppendix).toContain("部署正文。")
    expect(out.summary.folded).toBe(2) // 2.1 → 参考段；1.1 → 追加的第一章
    expect(out.chapters[1].content).toContain("业绩清单")
  })
})

describe("releaseDraftChapter", () => {
  const kept = (): Chapter[] => [
    ch("c1", "商务资质", { part: "biz", content: "底稿原文", gen_status: "done", draftLocked: true, draftFrom: "第一章" }),
    ch("c2", "总体架构设计", { part: "tech", content: "架构原文", gen_status: "done", draftLocked: true, draftFrom: "第二章" }),
  ]
  const OUTLINE = [
    { id: "c1", title: "商务资质", children: [], part: "biz" as const },
    { id: "c2", title: "总体架构设计", children: [], part: "tech" as const },
  ]

  it("解除标记保留正文，gen_status 复位 pending", () => {
    const out = releaseDraftChapter(kept(), "c1")
    expect(out.partFlipped).toBe(false)
    expect(out.chapters[0].draftLocked).toBe(false)
    expect(out.chapters[0].draftFrom).toBeUndefined()
    expect(out.chapters[0].gen_status).toBe("pending")
    expect(out.chapters[0].content).toBe("底稿原文")
    expect(out.chapters[0].part).toBe("biz") // 未传大纲（无法同步）时不擅自改归属，只解标记
  })
  it("商务骨架章交回 AI 重写时切成技术章（R245 断链修复：商务章不参与生成）", () => {
    const out = releaseDraftChapter(kept(), "c1", { outline: OUTLINE, scope: "both" })
    expect(out.partFlipped).toBe(true)
    expect(out.chapters[0].part).toBe("tech")
    expect(out.chapters[0].gen_status).toBe("pending")
    expect(out.outline[0].part).toBe("tech")
    expect(out.outline[1].part).toBe("tech")
    expect(out.chapters[1].draftLocked).toBe(true) // 只动被点的那章
  })
  it("内容范围为「仅商务」时商务章本就是生成目标，保持 part 不变", () => {
    const out = releaseDraftChapter(kept(), "c1", { outline: OUTLINE, scope: "biz" })
    expect(out.partFlipped).toBe(false)
    expect(out.chapters[0].part).toBe("biz")
    expect(out.outline[0].part).toBe("biz")
  })
  it("技术章交回重写不动 part，大纲原样返回", () => {
    const out = releaseDraftChapter(kept(), "c2", { outline: OUTLINE, scope: "both" })
    expect(out.partFlipped).toBe(false)
    expect(out.chapters[1].part).toBe("tech")
    expect(out.chapters[1].draftLocked).toBe(false)
    expect(out.outline).toEqual(OUTLINE)
  })
})
