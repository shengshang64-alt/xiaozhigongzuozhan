import { describe, expect, it } from "vitest"
import {
  buildTechParamCoverage,
  classifyKind,
  uncoveredParamIds,
} from "./techParamCoverage"
import type { DeviationTable, ParseReport } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// 第五章技术和服务要求参数样例：混合【评审项】/▲/一般项，含分号与句号多参数行
const DELIVERY_REQ = [
  "服务器：CPU 【评审项】 16核以上；内存 64G；存储 2T",
  "▲ 数据库须支持国产化替代，兼容主流操作系统",
  "系统可用性 99.9%，提供 7×24 小时运维响应",
  "培训：交付前完成不少于 3 场用户培训",
].join("\n")

function report(): ParseReport {
  return {
    scope: "full",
    sections: [{ key: "delivery_req", title: "交货和服务要求", content: DELIVERY_REQ }],
  } as ParseReport
}

function node(title: string, part: "biz" | "tech"): OutlineNode {
  return { id: title, title, children: [], part }
}

// 依 clauses 顺序构造偏离表行（clause_id c1..cN，与 l3 抽取同源）
function devTable(levels: ("full" | "partial" | "deviation" | "")[]): DeviationTable {
  const texts = DELIVERY_REQ.replace(/；/g, "。").split(/[。；]/).map((s) => s.trim()).filter(Boolean)
  return {
    split_dim: "l3",
    generated_at: "",
    rows: texts.map((t, i) => ({
      clause_id: `c${i + 1}`,
      clause_text: t,
      source: "招标技术要求",
      response_node: "",
      response_level: levels[i] ?? "",
      response_summary: "",
      bid_ref: "",
    })),
  }
}

describe("R-022 技术参数落点", () => {
  it("无报告时不呈现", () => {
    const cov = buildTechParamCoverage([], null, null)
    expect(cov.hasParams).toBe(false)
    expect(cov.total).toBe(0)
  })

  it("全量抽取三类参数并计数，空大纲全部未覆盖", () => {
    const cov = buildTechParamCoverage([], report(), null)
    expect(cov.hasParams).toBe(true)
    expect(cov.total).toBeGreaterThan(0)
    expect(cov.reviewCount).toBeGreaterThanOrEqual(1)
    expect(cov.starCount).toBeGreaterThanOrEqual(1)
    expect(cov.generalCount).toBeGreaterThanOrEqual(1)
    expect(cov.reviewCount + cov.starCount + cov.generalCount).toBe(cov.total)
    expect(cov.covered).toBe(0)
    expect(cov.uncovered).toBe(cov.total)
  })

  it("命中技术大纲叶子即记为已覆盖（商务章不计）", () => {
    const outline = [node("系统可用性", "tech"), node("运维响应", "tech"), node("投标函", "biz")]
    const cov = buildTechParamCoverage(outline, report(), null)
    expect(cov.covered).toBeGreaterThan(0)
    const avail = cov.rows.find((r) => r.text.includes("99.9"))
    expect(avail?.covered).toBe(true)
  })

  it("进偏离表记为已覆盖，负偏离每项扣 0.5 联动合计", () => {
    const cov = buildTechParamCoverage([], report(), devTable(["full", "partial", "deviation", "deviation", "", "", "", ""]))
    expect(cov.inDeviationCount).toBeGreaterThanOrEqual(4)
    expect(cov.negativeCount).toBe(2)
    expect(cov.deviationPenalty).toBe(1) // 2 × 0.5
    expect(cov.rows.filter((r) => r.inDeviation).every((r) => r.covered)).toBe(true)
  })

  it("扣分单价可经 opts 覆盖", () => {
    const base = buildTechParamCoverage([], report(), devTable(["", "", "deviation", "deviation", "", "", "", ""]))
    const custom = buildTechParamCoverage([], report(), devTable(["", "", "deviation", "deviation", "", "", "", ""]), { perItemPenalty: 1 })
    expect(base.perItemPenalty).toBe(0.5)
    expect(custom.perItemPenalty).toBe(1)
    expect(custom.deviationPenalty).toBe(custom.negativeCount * 1)
  })

  it("uncoveredParamIds 返回未覆盖参数 id 且去重", () => {
    const cov = buildTechParamCoverage([], report(), null)
    const ids = uncoveredParamIds(cov)
    expect(ids.length).toBe(cov.uncovered)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("R-022 classifyKind", () => {
  it("【评审项】/▲/一般项分类正确", () => {
    expect(classifyKind("CPU 【评审项】 16核")).toBe("review")
    expect(classifyKind("▲ 国产化数据库")).toBe("star")
    expect(classifyKind("提供培训服务")).toBe("general")
  })
})
