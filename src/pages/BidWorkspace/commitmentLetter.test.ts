import { describe, it, expect } from "vitest"
import {
  splitStarClauses,
  buildCommitmentLetter,
  commitmentChapter,
  upsertCommitment,
  upsertCommitmentOutline,
  COMMITMENT_CHAPTER_ID,
  COMMITMENT_CHAPTER_TITLE,
} from "./commitmentLetter"

describe("splitStarClauses", () => {
  it("多行条款：标记行起新条、后续正文并入、前置普通行丢弃", () => {
    const out = splitStarClauses(
      [
        "前言与目录说明，不属于任何重点条款",
        "★1",
        "软件性能支持日均门诊患者人次达15000以上。",
        "注:投标文件中须提供承诺函并盖公章。",
        "★2 数据处理能力：须制定历史数据迁移方案。",
      ].join("\n"),
    )
    expect(out.length).toBe(2)
    expect(out[0]).toContain("★1")
    expect(out[0]).toContain("15000")
    expect(out[0]).toContain("承诺函")
    expect(out[1]).toContain("★2")
  })
  it("▲ 标记同样起条；尾注丢弃", () => {
    const out = splitStarClauses("▲ 质保期不少于3年\n…另有 5 条未列出")
    expect(out).toEqual(["▲ 质保期不少于3年"])
  })
  it("空/无标记返回空", () => {
    expect(splitStarClauses("")).toEqual([])
    expect(splitStarClauses("普通正文一\n普通正文二")).toEqual([])
  })
})

describe("buildCommitmentLetter", () => {
  const letter = buildCommitmentLetter(["★1 日均门诊15000以上", "★2 数据迁移方案"])
  it("逐字引用条款原文", () => {
    expect(letter).toContain("「★1 日均门诊15000以上」")
    expect(letter).toContain("「★2 数据迁移方案」")
  })
  it("含承诺语与落款", () => {
    expect(letter).toContain("完全响应并无条件满足")
    expect(letter).toContain("投标人（盖章）")
    expect(letter).toContain("日期：")
  })
  it("编号逐条", () => {
    expect(letter).toContain("1. 招标实质性条款")
    expect(letter).toContain("2. 招标实质性条款")
  })
})

describe("章节 upsert", () => {
  it("承诺函章节为 biz 归属、done 状态", () => {
    const c = commitmentChapter("x")
    expect(c.node_id).toBe(COMMITMENT_CHAPTER_ID)
    expect(c.title).toBe(COMMITMENT_CHAPTER_TITLE)
    expect(c.part).toBe("biz")
    expect(c.gen_status).toBe("done")
  })
  it("不存在则追加、存在则替换内容（幂等）", () => {
    const base = [{ node_id: "a", title: "A", sections: [], content: "", gen_status: "pending" as const }]
    const once = upsertCommitment(base, "v1")
    expect(once.length).toBe(2)
    expect(once.find((c) => c.node_id === COMMITMENT_CHAPTER_ID)?.content).toBe("v1")
    const twice = upsertCommitment(once, "v2")
    expect(twice.length).toBe(2)
    expect(twice.find((c) => c.node_id === COMMITMENT_CHAPTER_ID)?.content).toBe("v2")
  })
  it("大纲 upsert 幂等且报告新增态", () => {
    const r1 = upsertCommitmentOutline([])
    expect(r1.added).toBe(true)
    expect(r1.outline.length).toBe(1)
    const r2 = upsertCommitmentOutline(r1.outline)
    expect(r2.added).toBe(false)
    expect(r2.outline.length).toBe(1)
  })
})

// 2026-10-23（用户要求：所有承诺函按原文先响应）——★条款 + 技术参数里的承诺型条款都要进承诺函
import { collectCommitmentClauses } from "./commitmentLetter"
import type { ParseReport } from "./bidTypes"

describe("collectCommitmentClauses：★条款 + 承诺型方案条款", () => {
  it("两类来源合并去重，原文不动", () => {
    const rep = {
      scope: "full",
      sections: [{ key: "star_clauses", title: "★/▲", content: "★1. 未加盖公章的投标无效\n★2. 报价超预算无效" }],
    } as unknown as ParseReport
    const out = collectCommitmentClauses(rep, [
      "须提供《第三方接口费用承诺函》，承诺不向采购人转收接口费。",
      "本条规定了培训场地要求，与承诺无关。",
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toContain("未加盖公章")
    expect(out[2]).toContain("第三方接口费用承诺函")
    expect(out.some((c) => c.includes("培训场地"))).toBe(false)
  })
})
