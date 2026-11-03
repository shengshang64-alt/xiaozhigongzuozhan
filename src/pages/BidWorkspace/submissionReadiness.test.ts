// 2026-10-23（P0-1 交卷清单）：零 AI 的跨步骤判定
import { describe, expect, it } from "vitest"
import { buildSubmissionReadiness } from "./submissionReadiness"
import type { BidProjectRecord } from "./bidTypes"

const ready = (over: Record<string, unknown> = {}) =>
  ({
    // 招标原文（无占位符）——交卷清单第一项「招标原文有效性」依赖它
    tender_text: "项目编号：[350401]SMGX[GK]2026004\n预算金额（最高限价）：2348 万元\n第一章 招标公告",
    parse_report: {
      scope: "full",
      sections: [
        { key: "tech_score", title: "技术评分", content: "总体技术解决方案（5 分）：现状与痛点理解、统分结合架构" },
        { key: "response_req", title: "响应", content: "签字盖章" },
        { key: "biz_score", title: "商务评分", content: "价格分（10 分）" },
        { key: "void_items", title: "废标", content: "未盖章的投标无效" },
        { key: "qualification", title: "资格", content: "[强制] 营业执照" },
        { key: "compliance", title: "符合性", content: "★负偏离无效" },
        { key: "bid_outline_req", title: "目录", content: "一 投标函" },
      ],
    },
    bid_outline: [{ id: "n1", title: "总体技术解决方案", children: [] }],
    bid_chapters: [{ node_id: "n1", title: "总体技术解决方案", sections: [], content: "总体技术解决方案：本项目现状与痛点分析、统分结合架构设计、数据治理与主索引唯一性等治理场景的落地措施与量化承诺，覆盖全部评审要点。", gen_status: "done", part: "tech" }],
    response_map: { rows: [{ clause_id: "c1" }] },
    void_check: { items: [{ clause: "未盖章无效", status: "compliant", severity: "minor", review_status: "pending" }], checked_at: "" },
    submission_check: { items: [{ index: 0 }], checked_at: "", format_report: { hits: [], checked_at: "" } },
    dup_report: { items: [] },
    ai_review: { summary: "ok" },
    gen_options: { scope: "tech" },
    ...over,
  }) as unknown as Partial<BidProjectRecord>

describe("buildSubmissionReadiness：跨步骤交卷判定", () => {
  it("① 齐备 → ready；建议项缺失不拦（查重/评标）", () => {
    const r = buildSubmissionReadiness(ready({ dup_report: null, ai_review: null }))
    expect(r.blocked).toBe(0)
    expect(r.ready).toBe(true)
    expect(r.items.find((i) => i.id === "dup")?.status).toBe("todo")
  })

  it("② 废标级未核销 → 阻断，且给出条数与步骤", () => {
    const rec = ready({
      void_check: {
        items: [{ clause: "未盖章无效", status: "non_compliant", severity: "critical", review_status: "pending" }],
        checked_at: "",
      },
    })
    const r = buildSubmissionReadiness(rec)
    const item = r.items.find((i) => i.id === "void")!
    expect(item.status).toBe("blocked")
    expect(item.detail).toContain("1 条废标级条款未核销")
    expect(item.step).toBe(4)
    expect(r.ready).toBe(false)
  })

  it("③ 空记录：解析/大纲/正文全阻断，ready=false", () => {
    const r = buildSubmissionReadiness({})
    expect(r.items.find((i) => i.id === "outline")?.status).toBe("blocked")
    expect(r.items.find((i) => i.id === "content")?.status).toBe("blocked")
    expect(r.ready).toBe(false)
  })

  it("④ 正文有空章 → 待办并点名；有正文但没偏离表 → 偏离表待办", () => {
    const rec = ready({
      bid_chapters: [
        { node_id: "n1", title: "总体技术解决方案", sections: [], content: "正文", gen_status: "done", part: "tech" },
        { node_id: "n2", title: "培训方案", sections: [], content: "", gen_status: "pending", part: "tech" },
      ],
      bid_outline: [
        { id: "n1", title: "总体技术解决方案", children: [] },
        { id: "n2", title: "培训方案", children: [] },
      ],
      response_map: null,
    })
    const r = buildSubmissionReadiness(rec)
    expect(r.items.find((i) => i.id === "content")?.detail).toContain("1/2")
    expect(r.items.find((i) => i.id === "deviation")?.status).toBe("todo")
  })

  it("⑤ 旧大纲遗留的同主题章 → 章表对账阻断（导出会多出一份重复章）", () => {
    const rec = ready({
      bid_outline: [
        { id: "n1", title: "培训方案", children: [] },
        { id: "n2", title: "应急方案与业务连续性保障", children: [] },
      ],
      bid_chapters: [
        { node_id: "n1", title: "培训方案", sections: [], content: "培训正文", gen_status: "done", part: "tech" },
        { node_id: "n2", title: "应急方案与业务连续性保障", sections: [], content: "应急正文", gen_status: "done", part: "tech" },
        // 旧大纲遗留：与 n2 同主题的第二份章
        { node_id: "old", title: "应急方案", sections: [], content: "旧稿正文", gen_status: "done", part: "tech" },
      ],
    })
    const r = buildSubmissionReadiness(rec)
    const item = r.items.find((i) => i.id === "chapter-reconcile")!
    expect(item.status).toBe("blocked")
    expect(item.level).toBe("blocking")
    expect(item.detail).toContain("重复")
    expect(item.step).toBe(3)
    expect(r.ready).toBe(false)
  })

  it("⑥ 假成功章（done + 正文 364 字 + 统计 33776）→ 落库一致性阻断", () => {
    const rec = ready({
      bid_outline: [{ id: "n1", title: "培训方案", children: [] }],
      bid_chapters: [
        {
          node_id: "n1",
          title: "培训方案",
          sections: ["一", "二", "三", "四", "五"],
          content: "x".repeat(364),
          gen_status: "done",
          part: "tech",
          section_stats: [{ chars: 6758 }, { chars: 6599 }, { chars: 7317 }, { chars: 7460 }, { chars: 5642 }],
        },
      ],
    })
    const r = buildSubmissionReadiness(rec)
    const item = r.items.find((i) => i.id === "chapter-integrity")!
    expect(item.status).toBe("blocked")
    expect(item.detail).toContain("分节产物没拼回正文")
    expect(r.ready).toBe(false)
  })

  it("⑦ 章表与大纲一致且统计自洽 → 两项均 done，不误伤", () => {
    const r = buildSubmissionReadiness(ready())
    expect(r.items.find((i) => i.id === "chapter-reconcile")?.status).toBe("done")
    expect(r.items.find((i) => i.id === "chapter-integrity")?.status).toBe("done")
    expect(r.ready).toBe(true)
  })
})


// ---------------------------------------------------------------------------
// 2026-10-26 标书官 P2 建议落地：图表题注**全书粒度**检查
//
// 背景：章级检查（useBidWorkspace 对单章跑 checkCaptionNumbering）看不到跨章重号。
// 每章各自从「表1-1」起编，单章检查各章都"连续"，装订成册后全书就是一堆重复编号。
// 本组用例锁「交卷体检里那道全书检查」确实能看见跨章重号。
// ---------------------------------------------------------------------------
describe("图表题注编号（全书粒度）", () => {
  const capItem = (rec: ReturnType<typeof ready>) =>
    buildSubmissionReadiness(rec as unknown as Partial<BidProjectRecord>).items.find((i) => i.id === "caption-numbering")

  it("两章各自从「表1-1」起编 → 全书检出重号", () => {
    const rec = ready({
      bid_chapters: [
        { node_id: "n1", title: "第一章", sections: [], content: "表1-1 系统清单\n序号　　名称\n1　　A", gen_status: "done", part: "tech" },
        { node_id: "n2", title: "第二章", sections: [], content: "表1-1 设备清单\n序号　　名称\n1　　B", gen_status: "done", part: "tech" },
      ],
    })
    const item = capItem(rec)
    expect(item, "全书题注检查没进交卷体检").toBeTruthy()
    expect(item!.status).toBe("todo")
    expect(item!.detail).toContain("重复")
  })

  it("全书编号连续 → 通过", () => {
    const rec = ready({
      bid_chapters: [
        { node_id: "n1", title: "第一章", sections: [], content: "表1-1 系统清单\n序号　　名称\n1　　A", gen_status: "done", part: "tech" },
        { node_id: "n2", title: "第二章", sections: [], content: "表1-2 设备清单\n序号　　名称\n1　　B", gen_status: "done", part: "tech" },
      ],
    })
    const item = capItem(rec)
    expect(item!.status).toBe("done")
  })

  it("金标准风格「表N」全书顺序号断号 → 检出", () => {
    const rec = ready({
      bid_chapters: [
        { node_id: "n1", title: "第一章", sections: [], content: "表1 挂号记录", gen_status: "done", part: "tech" },
        { node_id: "n2", title: "第二章", sections: [], content: "表5 收费主表", gen_status: "done", part: "tech" },
      ],
    })
    const item = capItem(rec)
    expect(item!.status).toBe("todo")
    expect(item!.detail).toContain("断号")
  })

  it("商务章不参与（只查技术章）", () => {
    const rec = ready({
      bid_chapters: [
        { node_id: "n1", title: "技术章", sections: [], content: "表1-1 技术清单", gen_status: "done", part: "tech" },
        { node_id: "n2", title: "商务章", sections: [], content: "表1-1 商务清单", gen_status: "done", part: "biz" },
      ],
    })
    const item = capItem(rec)
    expect(item!.status, "商务章不该造成假重号").toBe("done")
  })

  it("没有正文时不产生该条目（避免前置噪音）", () => {
    const rec = ready({ bid_chapters: [] })
    expect(capItem(rec)).toBeUndefined()
  })
})
