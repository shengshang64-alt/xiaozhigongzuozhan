// 2026-10-23（P0-2 证据台账）：评分点 → 承接章 → 材料类型 → 编号
import { describe, expect, it } from "vitest"
import { buildEvidenceLedger, evidenceLedgerTableRows, inferEvidenceKind } from "./evidenceLedger"
import type { ParseReport } from "./bidTypes"
import type { Chapter, OutlineNode } from "../SolutionStudio/solutionTypes"

const scoring = (items: { name: string; score: number; criteria: string }[]) =>
  ({ kind: "scoring", score_composition: "", declared_total: null, weights: null, items: items.map((i) => ({ ...i, source: "" })) }) as const

const report = {
  scope: "full",
  sections: [
    {
      key: "tech_score",
      title: "技术评分",
      content: "",
      structured: scoring([
        { name: "总体技术解决方案", score: 5, criteria: "方案完整、现状与痛点分析精准" },
        { name: "技术参数实质性响应", score: 20, criteria: "★项须提供系统截图与承诺函" },
        { name: "项目团队配备", score: 10, criteria: "须提供人员证书及近 3 个月社保" },
      ]),
    },
  ],
} as unknown as ParseReport

const outline = [
  { id: "n1", title: "总体技术解决方案", children: [] },
  { id: "n2", title: "技术参数实质性响应", children: [] },
] as unknown as OutlineNode[]

const chapters = [
  { node_id: "n1", title: "总体技术解决方案", sections: [], content: "正文内容", gen_status: "done" },
  { node_id: "n2", title: "技术参数实质性响应", sections: [], content: "响应见截图【待填写】", gen_status: "done" },
] as unknown as Chapter[]

describe("证据台账（P0-2）", () => {
  it("① 材料类型按评分标准措辞推断", () => {
    expect(inferEvidenceKind("须提供系统截图")).toBe("截图")
    expect(inferEvidenceKind("须提供软件著作权证书")).toBe("证书")
    expect(inferEvidenceKind("类似项目合同业绩")).toBe("合同")
    expect(inferEvidenceKind("人员证书与社保")).toBe("社保与证书")
    expect(inferEvidenceKind("须出具承诺函")).toBe("承诺函")
    expect(inferEvidenceKind("方案完整、思路清晰")).toBe("方案正文")
  })

  it("② 台账逐项：承接章、材料编号、待挂载判定", () => {
    const l = buildEvidenceLedger(report, outline, chapters)
    const byId = Object.fromEntries(l.rows.map((r) => [r.id, r]))
    expect(byId.R1.chapters).toEqual(["总体技术解决方案"])
    expect(byId.R1.material).toBe("方案正文")
    expect(byId.R1.pending).toBe(false)
    expect(byId.R2.material).toBe("承诺函")
    expect(byId.R2.pending).toBe(true)
    expect(byId.R3.chapters).toEqual([])
    expect(byId.R3.material).toBe("社保与证书")
    expect(byId.R3.pending).toBe(true)
    expect(l.pendingCount).toBe(2)
  })

  it("③ 导出表：表头 + 状态列", () => {
    const rows = evidenceLedgerTableRows(buildEvidenceLedger(report, outline, chapters))
    expect(rows[0]).toEqual(["序号", "评分项", "分值", "承接章节", "需提供材料", "材料编号", "状态"])
    expect(rows[1][6]).toBe("见正文")
    expect(rows[2][6]).toBe("待挂载")
    expect(rows[1][5]).toBe("M1")
  })

  it("④ 无评分项 → 空台账", () => {
    expect(buildEvidenceLedger(null, [], [])).toEqual({ rows: [], pendingCount: 0, orphanCount: 0 })
  })
})
