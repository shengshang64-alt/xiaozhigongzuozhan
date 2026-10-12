import { describe, expect, it } from "vitest"
import { classifyOrigins } from "./bidOutlineOrigin"
import type { ParseReport } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const CATALOG = [
  "一、报价文件",
  "二、商务文件",
  "  1. 投标函",
  "  2. 资质证明",
  "三、技术文件",
  "  1. 总体设计方案",
  "  2. 系统功能设计",
  "  3. 实施方案",
  "四、资格证明",
].join("\n")

const TECH_SCORE = [
  "总体设计方案（5 分）：整体设计",
  "系统功能设计（5 分）：功能设计",
  "售后服务方案（5 分）：故障处理",
].join("\n")

function report(): ParseReport {
  return {
    scope: "full",
    sections: [
      { key: "bid_outline_req", title: "目录要求", content: CATALOG },
      { key: "tech_score", title: "技术评分", content: TECH_SCORE },
      { key: "biz_score", title: "商务评分", content: "" },
    ],
  } as ParseReport
}

function node(title: string, part?: "biz" | "tech"): OutlineNode {
  return { id: title, title, children: [], part }
}

describe("R-023 双层目录 origin 分类 + 三态差异", () => {
  it("无招标目录时 origin 不标、hasCatalog=false", () => {
    const { nodes, diff } = classifyOrigins([node("A")], null)
    expect(diff.hasCatalog).toBe(false)
    expect(nodes[0].origin).toBeUndefined()
  })

  it("顶层章匹配目录行 → origin=tender", () => {
    const { nodes, diff } = classifyOrigins(
      [node("投标函", "biz"), node("总体设计方案", "tech")],
      report(),
    )
    expect(nodes[0].origin).toBe("tender")
    expect(nodes[1].origin).toBe("tender")
    expect(diff.matchedCount).toBe(2) // 投标函 + 总体设计方案 匹配的两行
  })

  it("评分项派生章（不在目录中但匹配 tech 评分项名）→ origin=scoring", () => {
    const { nodes, diff } = classifyOrigins(
      [node("售后服务方案", "tech")],
      report(),
    )
    expect(nodes[0].origin).toBe("scoring")
    expect(diff.extraCount).toBe(0) // scoring 不算 extra
  })

  it("三态差异：missing 列出目录有但大纲没有的条目", () => {
    const { diff } = classifyOrigins(
      [node("总体设计方案", "tech"), node("投标函", "biz")],
      report(),
    )
    // 报价文件/商务文件/资质证明/系统功能设计/实施方案/资格证明 等未匹配 → missing
    const missing = diff.entries.filter((e) => e.status === "missing")
    expect(missing.length).toBeGreaterThan(0)
    expect(missing.some((m) => m.name.includes("报价文件"))).toBe(true)
  })

  it("extra 列出大纲有但目录未要求的（非 tender 非 scoring）", () => {
    const { diff } = classifyOrigins(
      [node("总体设计方案", "tech"), node("应急预案", "tech")],
      report(),
    )
    expect(diff.extraCount).toBe(1)
    expect(diff.entries.find((e) => e.status === "extra")?.name).toBe("应急预案")
  })
})
