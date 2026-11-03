import { describe, expect, it } from "vitest"
import {
  detectAllConflicts,
  detectConflict,
  summarizeConflicts,
  type ConflictAtom,
} from "./kbConflict"

// ---------------------------------------------------------------------------
// 冲突检测验收测试（2026-11-01，需求 §8.2）
//
// 需求表格：
//   | 数值冲突 | 同 subject_key，attributes.value 差异 > 5% | 保留 valid_from 晚的，旧的 superseded |
//   | 时效冲突 | 同 subject_key，valid_until 不同且都未过期 | 保留 valid_until 晚的 |
//   | 极性冲突 | 同 subject_key，polarity 相反 | 挂 conflict_group，两条都置 conflict，必须人工 |
//   | 密级冲突 | 同 subject_key，confidentiality 不同 | 取最高密级，低的 superseded |
//
// 关键设计（测试锁住）：
//   · 四类冲突的**优先级**：极性 > 数值 > 时效 > 密级（一次只给一个结论，避免状态打架）
//   · 极性冲突**绝不能自动裁决**（误判代价高，必须人看）
// ---------------------------------------------------------------------------

function atom(p: Partial<ConflictAtom> & { id: string }): ConflictAtom {
  return {
    subjectKey: "metric:电子病历分级|国家卫健委",
    contentStatus: "approved",
    confidence: 0.9,
    ...p,
  }
}

describe("极性冲突：必须人工裁决", () => {
  it("positive vs negative 被判为极性冲突", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", polarity: "positive" }),
        atom({ id: "a2", polarity: "negative" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("polarity")
    expect(f?.resolution.action).toBe("markConflict")
  })

  it("极性冲突挂 conflict_group 且两条都进冲突组（不自动裁决）", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", polarity: "positive" }),
        atom({ id: "a2", polarity: "negative" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    if (f?.resolution.action !== "markConflict") throw new Error("应为 markConflict")
    expect(f.resolution.atomIds.sort()).toEqual(["a1", "a2"])
    expect(f.resolution.conflictGroup).toContain("cg:")
  })

  it("只有 positive 没有 negative 不算极性冲突", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", polarity: "positive" }),
        atom({ id: "a2", polarity: "positive" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).not.toBe("polarity")
  })

  it("极性冲突优先级最高（同时存在数值差异也先报极性）", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", polarity: "positive", value: 5 }),
        atom({ id: "a2", polarity: "negative", value: 6 }), // 数值差异 16% > 5%
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("polarity")
  })
})

describe("数值冲突：差异 > 5% 自动裁决", () => {
  it("差异 > 5% 判为数值冲突", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", value: 2500, unit: "万元", validFrom: "2023-01-01" }),
        atom({ id: "a2", value: 3000, unit: "万元", validFrom: "2024-01-01" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("numeric")
    expect(f?.resolution.action).toBe("supersede")
  })

  it("保留 valid_from 更晚的（需求明确）", () => {
    const f = detectConflict(
      [
        atom({ id: "old", value: 2500, validFrom: "2023-01-01" }),
        atom({ id: "new", value: 3000, validFrom: "2024-06-01" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    if (f?.resolution.action !== "supersede") throw new Error("应为 supersede")
    expect(f.resolution.keepId).toBe("new")
    expect(f.resolution.supersedeIds).toEqual(["old"])
  })

  it("差异 ≤ 5% 不算冲突（避免把口径微差当冲突）", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", value: 2500 }),
        atom({ id: "a2", value: 2560 }), // 2.4%
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f).toBeNull()
  })

  it("数值相同不冲突", () => {
    expect(detectConflict([atom({ id: "a1", value: 5 }), atom({ id: "a2", value: 5 })], "metric:电子病历分级|国家卫健委")).toBeNull()
  })

  it("字符串数值也能比较（2500 vs 3000）", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", value: "2500", validFrom: "2023-01-01" }),
        atom({ id: "a2", value: "3000", validFrom: "2024-01-01" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("numeric")
  })

  it("带单位字符串能提取数值（2500万元）", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", value: "2500万元", validFrom: "2023-01-01" }),
        atom({ id: "a2", value: "3000万元", validFrom: "2024-01-01" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("numeric")
  })
})

describe("时效冲突：保留有效期更晚的", () => {
  it("valid_until 不同且都未过期 → 时效冲突", () => {
    const future1 = new Date(Date.now() + 86400000 * 100).toISOString()
    const future2 = new Date(Date.now() + 86400000 * 200).toISOString()
    const f = detectConflict(
      [
        atom({ id: "a1", validUntil: future1 }),
        atom({ id: "a2", validUntil: future2 }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("temporal")
    if (f?.resolution.action !== "supersede") throw new Error("应为 supersede")
    expect(f.resolution.keepId).toBe("a2")
  })

  it("其中一条已过期不算时效冲突", () => {
    const past = new Date(Date.now() - 86400000 * 100).toISOString()
    const future = new Date(Date.now() + 86400000 * 100).toISOString()
    const f = detectConflict(
      [
        atom({ id: "a1", validUntil: past }),
        atom({ id: "a2", validUntil: future }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).not.toBe("temporal")
  })
})

describe("密级冲突：取最高密级", () => {
  it("密级不同 → 密级冲突，保留最高的", () => {
    const f = detectConflict(
      [
        atom({ id: "a1", confidentiality: "public" }),
        atom({ id: "a2", confidentiality: "secret" }),
      ],
      "metric:电子病历分级|国家卫健委",
    )
    expect(f?.kind).toBe("confidentiality")
    if (f?.resolution.action !== "supersede") throw new Error("应为 supersede")
    expect(f.resolution.keepId).toBe("a2")
  })

  it("密级相同时不冲突", () => {
    expect(
      detectConflict(
        [atom({ id: "a1", confidentiality: "internal" }), atom({ id: "a2", confidentiality: "internal" })],
        "metric:电子病历分级|国家卫健委",
      ),
    ).toBeNull()
  })
})

describe("边界与批量", () => {
  it("单条原子不算冲突", () => {
    expect(detectConflict([atom({ id: "a1" })], "metric:电子病历分级|国家卫健委")).toBeNull()
  })

  it("不同 subject_key 之间不比较", () => {
    const findings = detectAllConflicts([
      atom({ id: "a1", subjectKey: "k1", value: 1 }),
      atom({ id: "a2", subjectKey: "k2", value: 100 }),
    ])
    expect(findings).toHaveLength(0)
  })

  it("批量检测按 subject_key 分组", () => {
    const findings = detectAllConflicts([
      atom({ id: "a1", subjectKey: "k1", polarity: "positive" }),
      atom({ id: "a2", subjectKey: "k1", polarity: "negative" }),
      atom({ id: "a3", subjectKey: "k2", value: 1 }),
      atom({ id: "a4", subjectKey: "k2", value: 100 }),
    ])
    expect(findings).toHaveLength(2)
    expect(findings.map((f) => f.kind).sort()).toEqual(["numeric", "polarity"])
  })

  it("统计：区分自动可解与需人工", () => {
    const findings = detectAllConflicts([
      atom({ id: "a1", subjectKey: "k1", polarity: "positive" }),
      atom({ id: "a2", subjectKey: "k1", polarity: "negative" }),
      atom({ id: "a3", subjectKey: "k2", value: 1 }),
      atom({ id: "a4", subjectKey: "k2", value: 100 }),
    ])
    const s = summarizeConflicts(findings)
    expect(s.total).toBe(2)
    expect(s.needHuman).toBe(1)
    expect(s.autoResolvable).toBe(1)
    expect(s.byKind.polarity).toBe(1)
    expect(s.byKind.numeric).toBe(1)
  })

  it("空数组安全", () => {
    expect(detectAllConflicts([])).toHaveLength(0)
    expect(summarizeConflicts([])).toMatchObject({ total: 0, autoResolvable: 0, needHuman: 0 })
  })
})
