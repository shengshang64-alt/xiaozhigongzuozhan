// ---------------------------------------------------------------------------
// dedup.ts 单测（R267 三期 L4 查重）：锁定只报不拦口径与诚实降级。
// 覆盖：开关关闭 skipped / 正文不足两章 skipped / 跨章重复段落 warn 带相似度 /
//       无重复 pass / 短段被 dupMinRun 过滤不误报。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest"
import { runDedupChecks } from "./dedup"
import { DEFAULT_CHECK_CONFIG } from "../config/checkConfig"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

const LONG_DUP =
  "本项目将建设统一数据中台，完成临床、运营、科研三大主题域的数据治理，并落地主数据管理与数据质量闭环管控机制。"

function ch(nodeId: string, title: string, content: string): Chapter {
  return { node_id: nodeId, title, sections: [], content, gen_status: "done" } as Chapter
}

function rec(chapters: Chapter[]): BidProjectRecord {
  return { bid_chapters: chapters } as unknown as BidProjectRecord
}

const cfg = DEFAULT_CHECK_CONFIG

describe("runDedupChecks L4 查重层", () => {
  it("开关关闭 -> skipped", () => {
    const items = runDedupChecks(rec([ch("a", "章A", LONG_DUP), ch("b", "章B", LONG_DUP)]), {
      ...cfg,
      dupCrossChapterEnabled: false,
    })
    expect(items[0].code).toBe("L4-D1")
    expect(items[0].status).toBe("skipped")
    expect(items[0].level).toBe("L4")
  })

  it("正文不足两章 -> skipped", () => {
    const items = runDedupChecks(rec([ch("a", "章A", LONG_DUP)]), cfg)
    expect(items[0].status).toBe("skipped")
  })

  it("跨章重复段落 -> warn，命中带相似度（只报不拦 medium/warn）", () => {
    const items = runDedupChecks(
      rec([ch("a", "章A", LONG_DUP), ch("b", "章B", LONG_DUP), ch("c", "章C", "完全不相干的另一段内容，讲述运维保障体系建设与人员培训安排。")]),
      cfg,
    )
    const it = items[0]
    expect(it.status).toBe("warn")
    expect(it.severity).toBe("medium")
    expect(it.hits.length).toBeGreaterThan(0)
    expect(it.hits[0].rule).toBe("intra_dup")
    expect(it.hits[0].basis).toContain("相似度")
  })

  it("无重复 -> pass", () => {
    const items = runDedupChecks(
      rec([
        ch("a", "章A", "本章描述系统集成接口对接的实施组织与进度计划安排。"),
        ch("b", "章B", "本章论述售后服务体系、响应时效与驻场工程师配置。"),
      ]),
      cfg,
    )
    expect(items[0].status).toBe("pass")
    expect(items[0].hits).toHaveLength(0)
  })

  it("短段套话被 dupMinRun 过滤 -> 不误报为 warn", () => {
    const items = runDedupChecks(
      rec([ch("a", "章A", "谢谢审阅。"), ch("b", "章B", "谢谢审阅。")]),
      { ...cfg, dupMinRun: 40 },
    )
    expect(items[0].status).not.toBe("warn")
  })
})
