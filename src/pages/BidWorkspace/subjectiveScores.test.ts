// UX-R3 S12（2026-11-08）：主观分逐条确认 —— 纯逻辑单测
import { describe, expect, it } from "vitest"
import {
  buildSubjectiveScoreRows,
  countUnconfirmedSubjective,
  normalizeSubjectiveConfirmations,
  withConfirmation,
} from "./subjectiveScores"
import type { BidProjectRecord, ParseReport } from "./bidTypes"

/** 夹具：技术评分含 1 主观（得 N-M 分）+ 1 客观；商务评分含 1 主观（合理性评判词） */
function report(): ParseReport {
  return {
    sections: [
      {
        key: "tech_score",
        title: "技术评分办法",
        content: "",
        structured: {
          kind: "scoring",
          items: [
            { name: "技术方案完整性", score: 8, criteria: "方案完整、合理得 6-8 分，一般得 3-5 分" },
            { name: "并发用户数", score: 3, criteria: "满足 5000 并发得 3 分" },
          ],
        },
      },
      {
        key: "biz_score",
        title: "商务评分办法",
        content: "",
        structured: {
          kind: "scoring",
          items: [{ name: "售后服务方案合理性", score: 5, criteria: "服务方案合理、可操作性强得 5 分" }],
        },
      },
    ],
  } as unknown as ParseReport
}

function project(over: Partial<BidProjectRecord> = {}): BidProjectRecord {
  return {
    id: "p1",
    project_name: "测试项目",
    parse_report: report(),
    bid_chapters: [
      { node_id: "c1", title: "技术方案完整性说明", sections: [], content: "正文 [响应:R1]", gen_status: "done" },
    ],
    ...over,
  } as unknown as BidProjectRecord
}

describe("buildSubjectiveScoreRows", () => {
  it("只列 isSubjective=true 的项，客观分不出现", () => {
    const rows = buildSubjectiveScoreRows(project())
    expect(rows.map((r) => r.item)).toEqual(["技术方案完整性", "售后服务方案合理性"])
    expect(rows.every((r) => r.criteria.length > 0)).toBe(true)
  })

  it("落点章节按 [响应:Rx] 标注与标题包含两种口径匹配", () => {
    const rows = buildSubjectiveScoreRows(project())
    expect(rows[0].landedTitles).toEqual(["技术方案完整性说明"])
    // 商务项无承接章
    expect(rows[1].landedTitles).toEqual([])
  })

  it("无解析报告 / 空记录返回空数组（不抛错）", () => {
    expect(buildSubjectiveScoreRows(null)).toEqual([])
    expect(buildSubjectiveScoreRows({ parse_report: null })).toEqual([])
  })

  it("确认状态从 subjective_confirmations 读出", () => {
    const rows = buildSubjectiveScoreRows(
      project({
        subjective_confirmations: { R1: { confirmed: true, strategy: "写量化承诺", confirmed_at: "2026-11-08T00:00:00.000Z" } },
      }),
    )
    expect(rows[0].confirmation.confirmed).toBe(true)
    expect(rows[0].confirmation.strategy).toBe("写量化承诺")
    expect(rows[1].confirmation.confirmed).toBe(false)
  })
})

describe("countUnconfirmedSubjective", () => {
  it("统计总数与未确认数", () => {
    expect(countUnconfirmedSubjective(project())).toEqual({ total: 2, unconfirmed: 2 })
    const r = countUnconfirmedSubjective(
      project({ subjective_confirmations: { R1: { confirmed: true, strategy: "", confirmed_at: "" } } }),
    )
    expect(r).toEqual({ total: 2, unconfirmed: 1 })
  })

  it("无主观分项目返回 0/0（交卷清单不追加该条）", () => {
    expect(countUnconfirmedSubjective({ parse_report: { sections: [] } as unknown as ParseReport })).toEqual({
      total: 0,
      unconfirmed: 0,
    })
  })
})

describe("normalizeSubjectiveConfirmations", () => {
  it("缺列 / 脏值容错为空表", () => {
    expect(normalizeSubjectiveConfirmations(undefined)).toEqual({})
    expect(normalizeSubjectiveConfirmations("garbage")).toEqual({})
    expect(normalizeSubjectiveConfirmations({ R1: null, R2: "x" })).toEqual({})
  })

  it("正常表原样读出", () => {
    const raw = { R1: { confirmed: true, strategy: "abc", confirmed_at: "2026-11-08" } }
    expect(normalizeSubjectiveConfirmations(raw)).toEqual(raw)
  })
})

describe("withConfirmation", () => {
  it("勾选确认补时间戳；取消确认清时间戳", () => {
    const a = withConfirmation({}, "R1", { confirmed: true, strategy: "策略 A" })
    expect(a.R1.confirmed).toBe(true)
    expect(a.R1.strategy).toBe("策略 A")
    expect(a.R1.confirmed_at).not.toBe("")

    const b = withConfirmation(a, "R1", { confirmed: false })
    expect(b.R1.confirmed).toBe(false)
    expect(b.R1.confirmed_at).toBe("")
    // 取消确认不清策略（用户写的应对说明要保留）
    expect(b.R1.strategy).toBe("策略 A")
  })

  it("只改策略不动确认态", () => {
    const a = withConfirmation({}, "R2", { strategy: "只写策略" })
    expect(a.R2.confirmed).toBe(false)
    expect(a.R2.strategy).toBe("只写策略")
    expect(a.R2.confirmed_at).toBe("")
  })

  it("不修改入参（updateProject 需要新对象）", () => {
    const raw = { R1: { confirmed: true, strategy: "x", confirmed_at: "t" } }
    const next = withConfirmation(raw, "R1", { strategy: "y" })
    expect(raw.R1.strategy).toBe("x")
    expect(next.R1.strategy).toBe("y")
  })

  it("策略超长截断到 1000 字", () => {
    const long = "字".repeat(1500)
    expect(withConfirmation({}, "R1", { strategy: long }).R1.strategy.length).toBe(1000)
  })
})
