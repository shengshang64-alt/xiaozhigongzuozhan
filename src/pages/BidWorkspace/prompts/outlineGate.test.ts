import { describe, expect, it } from "vitest"
import { buildOutlineGateReviewMessages, sanitizeOutlineGateReview } from "./outlineGate"
import { buildOutlineFixMessages } from "./outlineFix"
import { buildBidOutlineMessages } from "./bidOutline"
import { hasBidComposition, type ParseReport } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// T15 大纲门禁评审测试：评审输出净化 + 提示词契约 + 锁定顶层约束（快照锁字不受影响的回归验证）

const nodes: OutlineNode[] = [
  { id: "a", title: "商务章", part: "biz", children: [{ id: "a1", title: "商务小节", children: [] }] },
  {
    id: "b",
    title: "系统建设方案",
    part: "tech",
    children: [
      { id: "b1", title: "总体设计", children: [], description: "[响应:R1]" },
      { id: "b2", title: "实施保障", children: [], description: "[响应:R2]" },
    ],
  },
]

describe("sanitizeOutlineGateReview", () => {
  it("passed 与问题清单一致性：有问题清单却报 passed 视为未通过", () => {
    expect(sanitizeOutlineGateReview({ passed: true, issues: [] })).toEqual({ passed: true, issues: [] })
    const withIssues = sanitizeOutlineGateReview({ passed: true, issues: ["第二章下只有 1 个孤儿子节点"] })
    expect(withIssues.passed).toBe(false)
    expect(withIssues.issues).toHaveLength(1)
  })

  it("去重（前 40 字为键）、超长裁剪、上限 8 条、非对象输入安全", () => {
    const dup = sanitizeOutlineGateReview({
      passed: false,
      issues: ["评分项 R3 未被任何叶子承接", "评分项 R3 未被任何叶子承接"],
    })
    expect(dup.issues).toHaveLength(1)
    expect(sanitizeOutlineGateReview("垃圾输出")).toEqual({ passed: false, issues: [] })
    const long = sanitizeOutlineGateReview({ passed: false, issues: ["x".repeat(300)] })
    expect(long.issues[0].length).toBeLessThanOrEqual(161) // 截断 160 字 + 省略号
  })
})

describe("buildOutlineGateReviewMessages", () => {
  it("system 含单叶子分支硬规则、叶子体量带与承接对账清单；大纲 JSON 带 part 与承接标注", () => {
    const msgs = buildOutlineGateReviewMessages(nodes, 2, 20, [{ id: "R1", item: "总体架构设计" }], 800)
    expect(msgs[0].role).toBe("system")
    const sys = String(msgs[0].content)
    expect(sys).toContain("单叶子分支")
    expect(sys).toContain("16-24 区间") // 20 × 0.8 ~ 1.2
    expect(sys).toContain("16-24 区间") // 20 × 0.8 ~ 1.2
    expect(sys).toContain('"passed":true,"issues":[]')
    // 评分承接对账清单在 user 消息里
    const user = String(msgs[1].content)
    expect(user).toContain("R1 总体架构设计")
    expect(user).toContain('"part":"tech"')
    expect(user).toContain("[响应:R1]")
  })
})

describe("buildOutlineFixMessages 锁定顶层（T15 回归）", () => {
  it("不传 opts 时提示词与既往一致（无锁定行）；传 lockTopLevel 时追加顶层章身份锁定", () => {
    const base = buildOutlineFixMessages(nodes, 2, 20, 800, ["测试问题"])
    expect(String(base[0].content)).not.toContain("顶层章身份锁定")
    const locked = buildOutlineFixMessages(nodes, 2, 20, 800, ["测试问题"], { lockTopLevel: true })
    expect(String(locked[0].content)).toContain("顶层章身份锁定")
    expect(String(locked[0].content)).toContain("禁止新增/删除/合并/改名任何顶层章")
  })
})

// R207 切片 2（R-003）：无底稿兜底——响应文件组成硬约束注入 + 缺失判据（走运行时告警、不注入）
const NL = String.fromCharCode(10)
const joinAll = (m: LlmMessage[]) => m.map((x) => x.content ?? "").join(NL)
const repWith = { scope: "key", sections: [{ key: "response_req", title: "响应文件要求", content: "响应文件组成：报价文件、商务文件、技术文件" }] } as unknown as ParseReport
const repWithout = { scope: "key", sections: [{ key: "tech_score", title: "技术评分要求", content: "系统技术方案（20 分）：方案完整" }] } as unknown as ParseReport

describe("R-003 无底稿兜底：响应文件组成", () => {
  it("hasBidComposition 判据：response_req 非空为真、缺失/null 为假", () => {
    expect(hasBidComposition(repWith)).toBe(true)
    expect(hasBidComposition(repWithout)).toBe(false)
    expect(hasBidComposition(null)).toBe(false)
  })
  it("有组成时 bidOutline prompt 注入硬约束句（逐项映射、不允许合并或改名）", () => {
    const text = joinAll(buildBidOutlineMessages("P", "H", repWith, false, 0))
    expect(text).toContain("响应文件组成硬约束")
    expect(text).toContain("不允许合并或改名")
  })
  it("缺组成时不注入硬约束句（走兜底告警路径，不误导模型对齐不存在的组成）", () => {
    const text = joinAll(buildBidOutlineMessages("P", "H", repWithout, false, 0))
    expect(text).not.toContain("响应文件组成硬约束")
  })
})
