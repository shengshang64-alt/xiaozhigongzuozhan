// R-039②（R259）mustWrite 读时自愈 场景自测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import { healMustWriteOnRead, mustWriteBackfillNeeded } from "./mustWriteSelfHeal"
import type { ParseReport } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const node = (title: string, extra: Partial<OutlineNode> = {}): OutlineNode => ({
  id: title,
  title,
  children: [],
  ...extra,
})
// 空评分项报告：必写判定退化为依赖技术关键词/★▲（不依赖评分项名），仍能触发自愈
const emptyReport: ParseReport = { scope: "full", sections: [] }

describe("R-039② mustWrite 读时自愈（R259，零 AI）", () => {
  it("技术关键词命中但缺标记的存量章→补 mustWrite=true", () => {
    const nodes = [node("系统部署方案")] // 「系统」「部署」命中 TECH_KEYWORD
    expect(mustWriteBackfillNeeded(nodes, emptyReport)).toBe(true)
    const healed = healMustWriteOnRead(nodes, emptyReport)
    expect(healed[0].mustWrite).toBe(true)
  })

  it("★实质性条款→补标记", () => {
    const healed = healMustWriteOnRead([node("★实质性响应要求")], emptyReport)
    expect(healed[0].mustWrite).toBe(true)
  })

  it("商务骨架（投标函）→不需自愈、原样返回", () => {
    const nodes = [node("投标函", { part: "biz" })]
    expect(mustWriteBackfillNeeded(nodes, emptyReport)).toBe(false)
    expect(healMustWriteOnRead(nodes, emptyReport)).toBe(nodes)
  })

  it("已正确标记→原样返回同一引用（免多余重渲染/落库）", () => {
    const nodes = [node("售后服务方案", { mustWrite: true })]
    expect(mustWriteBackfillNeeded(nodes, emptyReport)).toBe(false)
    expect(healMustWriteOnRead(nodes, emptyReport)).toBe(nodes)
  })

  it("无报告 / 空大纲→不自愈（不臆断）", () => {
    const nodes = [node("系统部署方案")]
    expect(mustWriteBackfillNeeded(nodes, null)).toBe(false)
    expect(healMustWriteOnRead(nodes, null)).toBe(nodes)
    expect(healMustWriteOnRead([], emptyReport)).toEqual([])
  })
})
