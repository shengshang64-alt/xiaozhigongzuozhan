import { describe, expect, it } from "vitest"
import { sanitizeMermaidCode, MERMAID_MAX_CODE_CHARS } from "./mermaidFigure"
import { buildOrchestrationMessages } from "./prompts/orchestration"
import { sanitizeOrchestrationBatch, normalizeOrchestration, mergeLeafOrchestrations, sanitizeFigures, type BidOrchestration } from "./bidTypes"
import type { TechLeafRef } from "./bidTypes"

// T16 第二批测试：mermaid 净化 + 编排三类型/knowledge schema + 图注/合并 + sanitizeFigures mermaid 分支

describe("sanitizeMermaidCode", () => {
  it("剥代码围栏、白名单图型起点、超长拒绝", () => {
    expect(sanitizeMermaidCode('```mermaid\nflowchart TD\n A["开始"] --> B["结束"]\n```')).toContain("flowchart TD")
    expect(sanitizeMermaidCode("flowchart LR\n A --> B")).toContain("flowchart LR")
    expect(sanitizeMermaidCode("sequenceDiagram\n A->>B: hi")).toContain("sequenceDiagram")
    expect(sanitizeMermaidCode("这不是mermaid")).toBe("")
    expect(sanitizeMermaidCode("randomtext TD\n A --> B")).toBe("")
    expect(sanitizeMermaidCode(`flowchart TD\n ${"x".repeat(MERMAID_MAX_CODE_CHARS + 1)}`)).toBe("")
    expect(sanitizeMermaidCode(null)).toBe("")
  })
  it("2026-10 配图需求轮：gantt（甘特图）进入白名单", () => {
    const code = "gantt\n dateFormat YYYY-MM-DD\n section 准备期\n 需求调研 :a1, 2026-01-01, 15d"
    expect(sanitizeMermaidCode(code)).toBe(code)
    expect(sanitizeMermaidCode('```mermaid\ngantt\n dateFormat YYYY-MM-DD\n section 实施\n 部署 :a1, 2026-02-01, 30d\n```')).toContain("gantt")
    // 非白名单起点的类 gantt 变体仍拒绝
    expect(sanitizeMermaidCode("ganttx\n dateFormat YYYY-MM-DD")).toBe("")
  })
})

describe("sanitizeFigures mermaid 分支", () => {
  it("收下合法 mermaid 图；非法 code 丢弃整图（每章上限 2 张为既有口径）", () => {
    const figs = sanitizeFigures([
      { type: "mermaid", title: "实施流程", code: "flowchart TD\n A[\"启动\"] --> B[\"验收\"]" },
      { type: "architecture", title: "总体架构", layers: [{ name: "数据层", modules: ["主数据管理"] }] },
    ])
    expect(figs).toHaveLength(2)
    expect(figs[0]).toMatchObject({ type: "mermaid", title: "实施流程" })
    expect((figs[0] as { code: string }).code).toContain("flowchart TD")
    expect(figs[1]).toMatchObject({ type: "architecture" })
    // 非法 code 整图丢弃（不占 2 张名额则让位给后续合法图）
    const bad = sanitizeFigures([
      { type: "mermaid", title: "坏图", code: "not-mermaid" },
      { type: "mermaid", title: "好图", code: "flowchart TD\n A[\"启动\"] --> B[\"验收\"]" },
    ])
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ type: "mermaid", title: "好图" })
  })
})

describe("编排 schema：mermaid 类型 + knowledge", () => {
  const batch: TechLeafRef[] = [{ nodeId: "n1", title: "实施流程", chapter: "实施方案" }]
  const idSet = new Set(["n1"])
  const knowledgeText = new Map([["K1", "（来源文档：《实施白皮书》· 第三章）\n实施分三阶段：调研、部署、验收。"]])

  it("sanitizeOrchestrationBatch 收 mermaid 类型与 knowledge ref 解析", () => {
    const raw = JSON.stringify({
      items: [
        {
          node_id: "n1",
          facts: [],
          writing_focus: "围绕三阶段实施流程响应评分点",
          knowledge: ["K1", "K99"],
          table: { needed: false, purpose: "" },
          figure: { needed: true, type: "mermaid", title: "实施流程图", caption: "三阶段实施流程", priority: 4, reason: "流程类内容" },
        },
      ],
    })
    const out = sanitizeOrchestrationBatch(raw, idSet, { knowledgeText })
    expect(out.n1).toBeDefined()
    expect(out.n1.figure?.type).toBe("mermaid")
    expect(out.n1.knowledge).toHaveLength(1) // K99 无对应素材被丢弃
    expect(out.n1.knowledge?.[0]).toContain("实施白皮书")
  })

  it("normalizeOrchestration 容错存量 mermaid 编排与 knowledge 字段", () => {
    const orch: BidOrchestration = {
      leaves: {
        n1: {
          figure: { needed: true, type: "mermaid", title: "关系图", priority: 3, reason: "", selected: true },
          knowledge: ["素材一"],
        },
      },
      generated_at: "2026-09-29T00:00:00Z",
    }
    const norm = normalizeOrchestration(JSON.parse(JSON.stringify(orch)))
    expect(norm?.leaves.n1?.figure?.type).toBe("mermaid")
    expect(norm?.leaves.n1?.knowledge).toEqual(["素材一"])
  })

  it("mergeLeafOrchestrations 合并 knowledge（去重 ≤4 条）", () => {
    const orch: BidOrchestration = {
      leaves: {
        a: { knowledge: ["素材一", "素材二"] },
        b: { knowledge: ["素材一", "素材三"] },
      },
      generated_at: "",
    }
    const merged = mergeLeafOrchestrations(orch, ["a", "b"])
    expect(merged.knowledge).toEqual(["素材一", "素材二", "素材三"])
  })

  it("编排提示词：mermaidEnabled/knowledgeCandidates 为条件块，不传时正文与既有口径一致", () => {
    const base = buildOrchestrationMessages(batch, "项目概述")
    const baseSys = String(base[0].content)
    expect(baseSys).not.toContain("mermaid")
    expect(baseSys).not.toContain("knowledge")
    expect(String(base[1].content)).not.toContain("知识库候选素材")

    const ext = buildOrchestrationMessages(batch, "项目概述", {
      mermaidEnabled: true,
      knowledgeCandidates: [{ ref: "K1", text: "（来源文档：《白皮书》）\n素材正文" }],
    })
    const extSys = String(ext[0].content)
    expect(extSys).toContain('"mermaid"')
    expect(extSys).toContain("knowledge")
    expect(String(ext[1].content)).toContain("K1｜（来源文档：《白皮书》）")
    // 基础规则仍完整保留
    expect(extSys).toContain("编排铁律（克制优先，宁缺毋滥）")
  })
})
