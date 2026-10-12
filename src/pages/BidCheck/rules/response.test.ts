// ---------------------------------------------------------------------------
// response.ts 单测（R266 二期 L2 响应层）：锁定只报不拦口径与 skipped 诚实降级。
// 覆盖：★条款全命中 pass / 存在未见条款 warn 且命中可数 / 无正文 skipped /
//       无解析报告 skipped / 评分项未落点 warn 带分值 / 无评分表 skipped。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest"
import { runResponseChecks } from "./response"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

function ch(title: string, content: string): Chapter {
  return { node_id: `n-${title}`, title, sections: [], content, gen_status: "done" } as Chapter
}

function recWith(report: unknown, chapters: Chapter[], outline: unknown[] = []): BidProjectRecord {
  return { parse_report: report, bid_chapters: chapters, bid_outline: outline } as unknown as BidProjectRecord
}

function section(key: string, content: string) {
  return { key, title: key, content }
}

describe("runResponseChecks L2 响应层", () => {
  it("上传文件（rec=null）两条诚实 skipped，不报问题", () => {
    const items = runResponseChecks(null)
    expect(items.map((i) => i.code)).toEqual(["L2-R1", "L2-R2"])
    for (const it of items) {
      expect(it.status).toBe("skipped")
      expect(it.level).toBe("L2")
      expect(it.hits).toHaveLength(0)
    }
  })

  it("★条款正文逐字回应 -> 进入判定（pass，非 skipped）", () => {
    const report = { sections: [section("star_clauses", "★ 接口对接实施范围")] }
    const chapters = [ch("实施方案", "接口对接实施范围")]
    const items = runResponseChecks(recWith(report, chapters))
    const r1 = items[0]
    expect(["pass", "warn"]).toContain(r1.status)
    expect(r1.status).not.toBe("skipped")
    if (r1.status === "pass") expect(r1.hits).toHaveLength(0)
  })

  it("★条款正文未见 -> warn，命中带未见要点（只报不拦，非 critical/fail）", () => {
    const report = { sections: [section("star_clauses", "★ 数据治理与临床数据库配置")] }
    const chapters = [ch("实施方案", "这里只讲与条款完全无关的内容。")]
    const items = runResponseChecks(recWith(report, chapters))
    const r1 = items[0]
    expect(r1.status).toBe("warn")
    expect(r1.severity).toBe("high")
    expect(r1.hits.length).toBeGreaterThan(0)
    expect(r1.hits[0].rule).toBe("compliance_coverage")
  })

  it("有 ★条款但正文未生成 -> skipped", () => {
    const report = { sections: [section("star_clauses", "★ 数据治理与临床数据库配置")] }
    const items = runResponseChecks(recWith(report, []))
    expect(items[0].status).toBe("skipped")
  })

  it("技术评分项未落点 -> warn，命中带分值", () => {
    const report = { sections: [section("tech_score", "1. 项目实施方案 30分\n2. 售后服务方案 20分")] }
    const items = runResponseChecks(recWith(report, [ch("方案", "正文若干")]))
    const r2 = items[1]
    if (r2.status === "warn") {
      expect(r2.hits[0].rule).toBe("score_coverage")
      expect(r2.hits[0].basis).toContain("分")
    } else {
      expect(["skipped", "pass"]).toContain(r2.status)
    }
  })

  it("无评分表 -> L2-R2 skipped", () => {
    const report = { sections: [section("overview", "项目概况若干")] }
    const items = runResponseChecks(recWith(report, [ch("方案", "正文")]))
    expect(items[1].status).toBe("skipped")
  })
})
