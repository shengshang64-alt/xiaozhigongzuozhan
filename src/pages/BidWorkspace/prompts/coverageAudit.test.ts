// ---------------------------------------------------------------------------
// R101 覆盖审计四态：sanitizeCoverageAudit 单测（over 直通、非法值回退、full 降级与清空）
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest"

import { aggregateAuditByChapter, buildReflowDirective, collectReflowFixItems, sanitizeCoverageAudit } from "./coverageAudit"
import type { CoverageAuditEntry, CoverageAuditLeafInput } from "../bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const leaves: CoverageAuditLeafInput[] = [
  { leaf_id: "n1", title: "3.1 集成平台", chapter: "第三章 集成平台", writing_focus: "ESB 总线选型", facts: [], table_plan: "", body_excerpt: "正文……" },
  { leaf_id: "n2", title: "3.2 安全设计", chapter: "第三章 集成平台", writing_focus: "", facts: [], table_plan: "", body_excerpt: "正文……" },
  { leaf_id: "n3", title: "3.3 实施进度", chapter: "第三章 集成平台", writing_focus: "", facts: [], table_plan: "", body_excerpt: "正文……" },
]

const audit = (rows: unknown) => sanitizeCoverageAudit(JSON.stringify(rows), leaves)

describe("sanitizeCoverageAudit（R101 四态）", () => {
  it("over 直通：加码承诺点保留在 missing_points", () => {
    const out = audit([{ leaf_id: "n1", covered: "over", missing_points: ["免费赠送两年运维"], suggestion: "收敛为标配一年运维" }])
    expect(out).toHaveLength(1)
    expect(out[0].covered).toBe("over")
    expect(out[0].missing_points).toEqual(["免费赠送两年运维"])
    expect(out[0].suggestion).toBe("收敛为标配一年运维")
  })

  it("非法 covered 值回退：有 points 判 partial，无 points 判 full", () => {
    const out = audit([
      { leaf_id: "n1", covered: "maybe", missing_points: ["漏写接口清单"], suggestion: "" },
      { leaf_id: "n2", covered: "全部落实", missing_points: [], suggestion: "" },
    ])
    expect(out.find((e) => e.leaf_id === "n1")?.covered).toBe("partial")
    expect(out.find((e) => e.leaf_id === "n2")?.covered).toBe("full")
  })

  it("full 带 points 降级 partial；full 清空点位；旧三档值兼容", () => {
    const out = audit([
      { leaf_id: "n1", covered: "full", missing_points: ["其实有遗漏"], suggestion: "" },
      { leaf_id: "n2", covered: "full", missing_points: [], suggestion: "" },
      { leaf_id: "n3", covered: "missing", missing_points: ["整节未响应"], suggestion: "重写该节" },
    ])
    expect(out.find((e) => e.leaf_id === "n1")?.covered).toBe("partial")
    expect(out.find((e) => e.leaf_id === "n2")?.missing_points).toEqual([])
    expect(out.find((e) => e.leaf_id === "n3")?.covered).toBe("missing")
  })
})

// ---------------------------------------------------------------------------
// R103 按章聚合回注：buildReflowDirective 口径同源 + aggregateAuditByChapter 分组/排序/worst
// + collectReflowFixItems 小节定位与同节合并
// ---------------------------------------------------------------------------

const outline: OutlineNode[] = [
  {
    id: "c1",
    title: "第一章 总体设计",
    children: [
      { id: "n1", title: "1.1 集成平台", children: [] },
      { id: "n2", title: "1.2 安全设计", children: [] },
    ],
  },
  { id: "c2", title: "第二章 实施方案", children: [{ id: "n3", title: "2.1 进度计划", children: [] }] },
  { id: "c3", title: "第三章 服务承诺", children: [] },
]

const auditEntry = (
  leafId: string,
  covered: CoverageAuditEntry["covered"],
  missingPoints: string[] = [],
  suggestion = "",
): CoverageAuditEntry => ({
  leaf_id: leafId,
  title: `${leafId} 节`,
  covered,
  missing_points: missingPoints,
  suggestion,
})

describe("buildReflowDirective（R103 单叶/按章指令同源）", () => {
  it("漏点与建议皆空返回空串；over 走收敛口径、partial/missing 走补写口径", () => {
    expect(buildReflowDirective("partial", [], "")).toBe("")
    const over = buildReflowDirective("over", ["免费赠送两年运维"], "收敛为标配一年")
    expect(over).toContain("必须删除正文中以下过度承诺（加码）点")
    expect(over).toContain("免费赠送两年运维；收敛为标配一年")
    const partial = buildReflowDirective("partial", ["漏写接口清单"], "")
    expect(partial).toContain("必须补充覆盖审计发现的以下漏点")
    expect(partial).toContain("漏写接口清单")
  })
})

describe("aggregateAuditByChapter（R103 按章聚合）", () => {
  it("full 条目过滤；按顶层章分组并按大纲顺序排列；整章级叶单独成章", () => {
    const groups = aggregateAuditByChapter(
      [
        auditEntry("n3", "missing", ["整节未响应"]),
        auditEntry("n2", "partial", ["缺访问控制"]),
        auditEntry("n1", "full"),
        auditEntry("c3", "over", ["SLA 过度承诺"], "收敛"),
      ],
      outline,
    )
    expect(groups.map((g) => g.chapterId)).toEqual(["c1", "c2", "c3"])
    expect(groups[0].problemCount).toBe(1)
    expect(groups[0].items.map((i) => i.leaf_id)).toEqual(["n2"])
    expect(groups[2].chapterTitle).toBe("第三章 服务承诺")
  })

  it("worst 取章内最严重档（missing > over > partial）", () => {
    const groups = aggregateAuditByChapter(
      [auditEntry("n1", "partial"), auditEntry("n2", "missing", ["x"]), auditEntry("n3", "over", ["y"])],
      outline,
    )
    expect(groups.find((g) => g.chapterId === "c1")?.worst).toBe("missing")
    expect(groups.find((g) => g.chapterId === "c2")?.worst).toBe("over")
  })

  it("章级改进文本含章名/档位标签/漏点/建议；大纲中已删除的叶静默丢弃", () => {
    const groups = aggregateAuditByChapter([auditEntry("n2", "partial", ["缺日志审计"], "补 SIEM 说明")], outline)
    expect(groups).toHaveLength(1)
    const text = groups[0].directive
    expect(text).toContain("第一章 总体设计")
    expect(text).toContain("部分落实")
    expect(text).toContain("缺日志审计")
    expect(text).toContain("补 SIEM 说明")
    expect(aggregateAuditByChapter([auditEntry("zz", "missing", ["x"])], outline)).toHaveLength(0)
  })
})

describe("collectReflowFixItems（R103 回注项落位）", () => {
  it("按小节标题定位下标；整章级叶与定位失败叶不产生回注项", () => {
    const groups = aggregateAuditByChapter(
      [auditEntry("n1", "partial", ["a"]), auditEntry("n3", "missing", ["b"]), auditEntry("c3", "over", ["c"])],
      outline,
    )
    const g1 = groups.find((g) => g.chapterId === "c1")
    const g2 = groups.find((g) => g.chapterId === "c2")
    const g3 = groups.find((g) => g.chapterId === "c3")
    expect(g1 && g3 && collectReflowFixItems(g1, outline, { sections: ["1.1 集成平台", "1.2 安全设计"] }).map((t) => t.sectionIdx)).toEqual([0])
    expect(g2 && collectReflowFixItems(g2, outline, { sections: ["2.1 进度计划"] }).map((t) => t.sectionIdx)).toEqual([0])
    expect(g3 && collectReflowFixItems(g3, outline, { sections: [] })).toHaveLength(0)
  })

  it("同一小节的多个叶指令合并为一次重写（换行拼接、按小节序输出）", () => {
    const deep: OutlineNode[] = [
      {
        id: "c1",
        title: "第一章",
        children: [
          {
            id: "s1",
            title: "1.1 平台",
            children: [
              { id: "g1", title: "a", children: [] },
              { id: "g2", title: "b", children: [] },
            ],
          },
        ],
      },
    ]
    const groups = aggregateAuditByChapter([auditEntry("g1", "partial", ["x"]), auditEntry("g2", "over", ["y"])], deep)
    const first = groups[0]
    const items = first ? collectReflowFixItems(first, deep, { sections: ["1.1 平台"] }) : []
    expect(items).toHaveLength(1)
    expect(items[0].sectionIdx).toBe(0)
    expect(items[0].directive).toContain("必须补充")
    expect(items[0].directive).toContain("必须删除")
  })
})
