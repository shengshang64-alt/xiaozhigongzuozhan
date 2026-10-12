// ---------------------------------------------------------------------------
// content.ts 单测（R268 四期 L3 内容层）：锁定只报不拦口径与诚实降级。
// 覆盖：无章节 skipped / 单薄 warn 带 thin_chapter / 空缺命中 / 全达标 pass /
//       商务骨架章不参与 / 阈值=0 skipped / underlength warn / 无偏短标记 pass。
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest"
import { runContentChecks } from "./content"
import { DEFAULT_CHECK_CONFIG } from "../config/checkConfig"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

const OK =
  "本项目构建院级数据中台，覆盖临床、运营、科研三大主题域的数据治理，并落地主数据管理与数据质量闭环管控机制，确保集成稳定可运维。"

function ch(nodeId: string, title: string, content: string, extra: Partial<Chapter> = {}): Chapter {
  return { node_id: nodeId, title, sections: [], content, gen_status: "done", ...extra } as Chapter
}

function rec(chapters: Chapter[]): BidProjectRecord {
  return { bid_chapters: chapters } as unknown as BidProjectRecord
}

const cfg = DEFAULT_CHECK_CONFIG

describe("runContentChecks L3 内容层", () => {
  it("无章节 -> 两项 skipped", () => {
    const items = runContentChecks(rec([]), cfg)
    expect(items[0].code).toBe("L3-C1")
    expect(items[0].level).toBe("L3")
    expect(items[0].status).toBe("skipped")
    expect(items[1].code).toBe("L3-C2")
    expect(items[1].status).toBe("skipped")
  })

  it("单薄章节 -> warn，命中 thin_chapter（只报不拦 medium/warn）", () => {
    const items = runContentChecks(rec([ch("a", "章A", "太少"), ch("b", "章B", OK)]), cfg)
    const c1 = items[0]
    expect(c1.status).toBe("warn")
    expect(c1.severity).toBe("medium")
    expect(c1.hits[0].rule).toBe("thin_chapter")
    expect(c1.hits[0].basis).toContain("低于阈值")
  })

  it("空缺正文 -> warn，命中给「正文空缺」", () => {
    const items = runContentChecks(rec([ch("a", "空章", "")]), cfg)
    expect(items[0].status).toBe("warn")
    expect(items[0].hits[0].text).toBe("（正文空缺）")
    expect(items[0].hits[0].basis).toContain("0 字")
  })

  it("全部达标 -> pass", () => {
    const items = runContentChecks(rec([ch("a", "章A", OK)]), cfg)
    expect(items[0].status).toBe("pass")
    expect(items[0].hits).toHaveLength(0)
  })

  it("商务骨架章不参与 -> skipped", () => {
    const items = runContentChecks(rec([ch("a", "商务报价", "", { part: "biz" })]), cfg)
    expect(items[0].status).toBe("skipped")
  })

  it("阈值 thinChapterMinChars=0 -> skipped（未启用）", () => {
    const items = runContentChecks(rec([ch("a", "章A", "太少")]), { ...cfg, thinChapterMinChars: 0 })
    expect(items[0].status).toBe("skipped")
  })

  it("underlength 标记 -> L3-C2 warn，命中 underlength", () => {
    const items = runContentChecks(rec([ch("a", "章A", OK, { underlength: true })]), cfg)
    expect(items[1].code).toBe("L3-C2")
    expect(items[1].status).toBe("warn")
    expect(items[1].hits[0].rule).toBe("underlength")
  })

  it("无偏短标记 -> L3-C2 pass", () => {
    const items = runContentChecks(rec([ch("a", "章A", OK)]), cfg)
    expect(items[1].status).toBe("pass")
    expect(items[1].hits).toHaveLength(0)
  })
})
