import { describe, expect, it } from "vitest"
import { createSubmissionTracker } from "./submissionTracker"
import { normalizeTextAudit } from "./bidTypes"

// T19 提交校验退回机制测试（易标 createSubmissionTracker 移植）：
// 进展按问题数判断、LIMIT 上限、停滞熔断（连续两次修复问题数不减少）。

function errWith(issues: number): Error & { issues?: unknown[] } {
  const e = new Error(`还剩 ${issues} 个问题`) as Error & { issues?: unknown[] }
  e.issues = Array.from({ length: issues }, (_, i) => i)
  return e
}

describe("createSubmissionTracker", () => {
  it("问题数持续减少时允许退回到 LIMIT 次", () => {
    const t = createSubmissionTracker()
    expect(t.allowReturn(errWith(5))).toBe(true) // #1
    expect(t.allowReturn(errWith(3))).toBe(true) // #2
    expect(t.allowReturn(errWith(2))).toBe(true) // #3
    expect(t.returns).toBe(3)
    const blocked = errWith(1)
    expect(t.allowReturn(blocked)).toBe(false)
    expect(blocked.message).toContain("提交校验已退回修复 3 次")
    expect(blocked.message).toContain("停止自动修复")
  })

  it("停滞熔断：连续三次问题数不减少即停止（不足 LIMIT 也停）", () => {
    const t = createSubmissionTracker()
    expect(t.allowReturn(errWith(4))).toBe(true) // #1
    expect(t.allowReturn(errWith(4))).toBe(true) // #2
    const blocked = errWith(4) // 4 → 4 → 4：连续两次无减少
    expect(t.allowReturn(blocked)).toBe(false)
    expect(blocked.message).toContain("连续两次问题数没有减少")
    expect(t.returns).toBe(2) // 实际只退回过 2 次
  })

  it("无 issues 清单的错误按 1 条计（同样参与停滞判断）", () => {
    const t = createSubmissionTracker()
    expect(t.allowReturn(new Error("格式坏"))).toBe(true)
    expect(t.allowReturn(new Error("格式坏2"))).toBe(true)
    expect(t.allowReturn(new Error("格式坏3"))).toBe(false)
  })

  it("问题数先减后增的抖动不触发熔断（最后一次比前一次少即视为有进展）", () => {
    const t = createSubmissionTracker()
    expect(t.allowReturn(errWith(5))).toBe(true)
    expect(t.allowReturn(errWith(5))).toBe(true)
    expect(t.allowReturn(errWith(2))).toBe(true) // 5→5→2：最后一次有减少，不算停滞
    expect(t.returns).toBe(3)
  })

  it("自定义 limit 生效", () => {
    const t = createSubmissionTracker(1)
    expect(t.allowReturn(errWith(5))).toBe(true)
    expect(t.allowReturn(errWith(1))).toBe(false)
  })
})

describe("normalizeTextAudit failed 章容错", () => {
  it("failed 清单读取 + 坏条目过滤 + 存量无字段容错", () => {
    const rep = normalizeTextAudit({
      typos: [],
      logic: [{ docId: "c1", docTitle: "章", title: "t", originalText: "o", locationHint: "l", fallacyReason: "f", suggestion: "s" }],
      failed: [
        { docId: "c2", docTitle: "失败章", reason: "错别字检查失败：请求超时" },
        { docId: "", reason: "坏条目" },
      ],
      checked_at: "2026-09-30T00:00:00Z",
      source: "internal",
    })
    expect(rep?.failed).toHaveLength(1)
    expect(rep?.failed?.[0]).toMatchObject({ docId: "c2", reason: "错别字检查失败：请求超时" })
    // 存量报告无 failed 字段 → 空数组（不炸）
    const legacy = normalizeTextAudit({ typos: [], logic: [{ docId: "c1", docTitle: "章", title: "t", fallacyReason: "f" }] })
    expect(legacy?.failed).toEqual([])
  })
})
