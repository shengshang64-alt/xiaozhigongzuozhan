import { describe, expect, it } from "vitest"
import type { CheckItem } from "./bidCheckTypes"
import {
  applyConfidence,
  buildReviewInputs,
  buildReviewPrompt,
  parseReviewResponse,
  pickReviewCandidates,
  REVIEW_BATCH_MAX,
} from "./semanticReview"

function mkItem(over: Partial<CheckItem> & { code: string }): CheckItem {
  return {
    code: over.code,
    level: "L1",
    category: "测试",
    title: over.title ?? over.code,
    severity: over.severity ?? "medium",
    status: over.status ?? "fail",
    basis: over.basis ?? "",
    suggestion: "",
    hits: over.hits ?? [],
    confidence: null,
  }
}

describe("pickReviewCandidates", () => {
  it("只挑 fail/warn，按严重度 critical→info 排序", () => {
    const items = [
      mkItem({ code: "L1-a", severity: "info", status: "warn" }),
      mkItem({ code: "L1-b", severity: "critical", status: "fail" }),
      mkItem({ code: "L1-c", severity: "medium", status: "pass" }),
      mkItem({ code: "L1-d", severity: "high", status: "fail" }),
      mkItem({ code: "L1-e", severity: "medium", status: "unconfigured" }),
    ]
    const picked = pickReviewCandidates(items)
    expect(picked.map((i) => i.code)).toEqual(["L1-b", "L1-d", "L1-a"])
  })

  it("超出 REVIEW_BATCH_MAX 时截断", () => {
    const items = Array.from({ length: REVIEW_BATCH_MAX + 5 }, (_, i) =>
      mkItem({ code: `L1-${i}`, status: "fail" }),
    )
    expect(pickReviewCandidates(items).length).toBe(REVIEW_BATCH_MAX)
  })

  it("全部 pass 时返回空数组", () => {
    const items = [mkItem({ code: "L1-x", status: "pass" }), mkItem({ code: "L1-y", status: "skipped" })]
    expect(pickReviewCandidates(items)).toEqual([])
  })
})

describe("buildReviewInputs", () => {
  it("取首条 hit 的原文与段落上下文", () => {
    const items = [
      mkItem({
        code: "L5-A4",
        title: "联系方式泄露",
        basis: "命中手机号正则",
        hits: [{ location: "第3章", text: "联系电话 13800138000", rule: "phone_regex", basis: "命中", paragraphText: "本项目联系人电话 13800138000，随时沟通。" }],
      }),
    ]
    const inputs = buildReviewInputs(items)
    expect(inputs.length).toBe(1)
    expect(inputs[0].code).toBe("L5-A4")
    expect(inputs[0].hitText).toContain("13800138000")
    expect(inputs[0].paragraphText).toContain("随时沟通")
  })

  it("超长片段被裁剪且不抛错", () => {
    const long = "很长的中文".repeat(100)
    const items = [
      mkItem({
        code: "L1-z",
        hits: [{ location: "正文", text: long, rule: "r", basis: "b" }],
      }),
    ]
    const inputs = buildReviewInputs(items)
    expect(inputs[0].hitText.length).toBeLessThanOrEqual(161) // 160 + 省略号
    expect(inputs[0].hitText.endsWith("…")).toBe(true)
  })
})

describe("buildReviewPrompt", () => {
  it("system 含判定准则与 JSON 输出契约，user 含逐条上下文", () => {
    const inputs = [
      { code: "L1-1", title: "身份词泄露", severity: "critical", status: "fail", basis: "命中公司名", hitText: "XX 科技有限公司", paragraphText: "由 XX 科技有限公司承建" },
      { code: "L3-C1", title: "章节单薄", severity: "medium", status: "warn", basis: "正文不足", hitText: "", paragraphText: "" },
    ]
    const { system, user } = buildReviewPrompt(inputs)
    expect(system).toContain("0.0~1.0")
    expect(system).toContain("JSON 数组")
    expect(user).toContain("L1-1")
    expect(user).toContain("XX 科技有限公司")
    expect(user).toContain("2 条")
  })
})

describe("parseReviewResponse", () => {
  it("解析裸 JSON 数组", () => {
    const r = parseReviewResponse('[{"code":"L1-1","confidence":0.9,"reasoning":"确实泄露"}]')
    expect(r).toEqual([{ code: "L1-1", confidence: 0.9, reasoning: "确实泄露" }])
  })

  it("解析 markdown 代码块包裹 + reason 别名", () => {
    const r = parseReviewResponse('```json\n[{"code":"L1-2","confidence":0.4,"reason":"疑似误报"}]\n```')
    expect(r.length).toBe(1)
    expect(r[0].confidence).toBe(0.4)
    expect(r[0].reasoning).toBe("疑似误报")
  })

  it("前后多余文字仍可容错提取", () => {
    const r = parseReviewResponse('好的：[{"code":"L1-3","confidence":1}] 以上。')
    expect(r.length).toBe(1)
    expect(r[0].confidence).toBe(1)
  })

  it("非法 JSON / 缺 code / 越界置信度安全降级", () => {
    expect(parseReviewResponse("not json")).toEqual([])
    expect(parseReviewResponse('{"code":"L1-1"}')).toEqual([]) // 非数组
    expect(parseReviewResponse('[{"confidence":0.5}]')).toEqual([]) // 缺 code
    const r = parseReviewResponse('[{"code":"X","confidence":17},{"code":"Y","confidence":-3},{"code":"Z","confidence":"abc"}]')
    expect(r.map((x) => x.confidence)).toEqual([1, 0, 0])
  })
})

describe("applyConfidence", () => {
  it("只更新命中 code 的条目，其余保持 confidence=null；不 mutate 原数组", () => {
    const items = [mkItem({ code: "A" }), mkItem({ code: "B" })]
    const next = applyConfidence(items, [{ code: "A", confidence: 0.82, reasoning: "判定成立" }])
    expect(next[0].confidence).toBe(0.82)
    expect(next[1].confidence).toBeNull()
    expect(items[0].confidence).toBeNull() // 原数组未被 mutate
  })

  it("reasoning 挂到会话态字段 confidenceReasoning", () => {
    const items = [mkItem({ code: "A" })]
    const next = applyConfidence(items, [{ code: "A", confidence: 0.3, reasoning: "表格误判" }])
    expect((next[0] as { confidenceReasoning?: string }).confidenceReasoning).toBe("表格误判")
  })

  it("status/severity 恒不变（只标不改裁定）", () => {
    const items = [mkItem({ code: "A", status: "fail", severity: "critical" })]
    const next = applyConfidence(items, [{ code: "A", confidence: 0.05, reasoning: "基本是误报" }])
    expect(next[0].status).toBe("fail")
    expect(next[0].severity).toBe("critical")
    expect(next[0].confidence).toBe(0.05)
  })
})
