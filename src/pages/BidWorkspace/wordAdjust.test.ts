import { describe, expect, it } from "vitest"
import {
  adjustGranularity,
  applyWordAdjustmentOps,
  collectProtectedRanges,
  findUniqueMatch,
  maxChangeWordsFor,
  normalizeWordAdjustmentOps,
  pickWordRefineTargets,
  validateAdjustmentResult,
} from "./wordAdjust"

// T15 字数局部精调纯函数测试：保护区间 / 唯一锚点 / 局部操作应用 / 结果校验 / 候选挑选

describe("collectProtectedRanges + findUniqueMatch", () => {
  it("全角空格表格行与代码围栏块内禁止作为锚点", () => {
    const text = [
      "系统采用B/S架构设计。",
      "序号\t名称".replace("\t", "\u3000\u3000"), // 表格行（U+3000 分列）
      "系统采用微服务架构设计。",
      "```json\n{\"a\":1}\n```",
    ].join("\n")
    // 两句架构表述各不相同 → 「B/S」全篇唯一
    expect(findUniqueMatch(text, "B/S")).toBeGreaterThanOrEqual(0)
    // 表格行内容唯一命中但落在保护区间 → 拒绝
    expect(findUniqueMatch(text, "序号\u3000\u3000名称")).toBe(-1)
    // 围栏内唯一命中但受保护 → 拒绝
    expect(findUniqueMatch(text, '{"a":1}')).toBe(-1)
    // 多处命中 → 拒绝（「架构设计」出现两次）
    expect(findUniqueMatch(text, "架构设计")).toBe(-1)
  })

  it("collectProtectedRanges 覆盖围栏整块与表格整行", () => {
    const text = "A\n```json\nx\n```\nB\n列一\u3000\u3000列二\nC"
    const ranges = collectProtectedRanges(text)
    expect(ranges.length).toBe(2)
    const fenceAt = text.indexOf("```")
    const tableAt = text.indexOf("列一")
    expect(ranges.some(([s, e]) => s <= fenceAt && e >= text.indexOf("```", fenceAt + 3) + 3)).toBe(true)
    expect(ranges.some(([s, e]) => s <= tableAt && e >= tableAt + 5)).toBe(true)
  })
})

describe("normalizeWordAdjustmentOps", () => {
  it("只收合法三态操作：insert 补 position 兜底、replace 剔除空改、delete 必须有目标", () => {
    const ops = normalizeWordAdjustmentOps({
      operations: [
        { operation: "insert", anchor: "正文原句。", position: "before", content: "插入内容" },
        { operation: "insert", anchor: "", content: "无锚点插入" }, // position 缺省 → after
        { operation: "replace", target_text: "旧句。", content: "旧句。" }, // 空改剔除
        { operation: "replace", target_text: "", content: "x" }, // 空目标剔除
        { operation: "delete", target_text: "冗余句。" },
        { operation: "unknown", target_text: "x" }, // 未知操作丢弃
        { operation: "insert", anchor: "a", content: "" }, // 空 content 丢弃
      ],
    })
    expect(ops).toHaveLength(3)
    expect(ops[0]).toEqual({ operation: "insert", anchor: "正文原句。", position: "before", content: "插入内容" })
    expect(ops[1]).toEqual({ operation: "insert", anchor: "", position: "after", content: "无锚点插入" })
    expect(ops[2]).toEqual({ operation: "delete", target_text: "冗余句。" })
  })

  it("裸数组与超量输入的防御：非对象包装安全解析、上限 12 条", () => {
    expect(normalizeWordAdjustmentOps([{ operation: "delete", target_text: "a" }])).toHaveLength(1)
    expect(normalizeWordAdjustmentOps("垃圾输出")).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => ({ operation: "delete", target_text: `句子${i}。` }))
    expect(normalizeWordAdjustmentOps({ operations: many })).toHaveLength(12)
  })
})

describe("applyWordAdjustmentOps", () => {
  const base = "第一段讲总体架构。\n\n第二段讲实施计划，工期九十天。\n\n第三段讲质保服务。"

  it("insert after 锚点 / replace / delete 依次生效，返回应用与跳过计数", () => {
    const r = applyWordAdjustmentOps(base, [
      { operation: "insert", anchor: "第一段讲总体架构。", position: "after", content: "补充：架构选型依据如下。" },
      { operation: "replace", target_text: "工期九十天", content: "工期一百二十天" },
      { operation: "delete", target_text: "第三段讲质保服务。" },
      { operation: "replace", target_text: "不存在的句子", content: "x" }, // 跳过
    ])
    expect(r.applied).toBe(3)
    expect(r.skipped).toBe(1)
    expect(r.text).toContain("补充：架构选型依据如下。")
    expect(r.text).toContain("工期一百二十天")
    expect(r.text).not.toContain("第三段讲质保服务。")
    expect(r.text).toContain("第二段讲实施计划")
  })

  it("空锚点 insert 插到文首；受保护区间内的替换被跳过", () => {
    const withTable = "开头句。\n\n项目\u3000\u3000数量"
    const r = applyWordAdjustmentOps(withTable, [
      { operation: "insert", anchor: "", position: "after", content: "【题注】" },
      { operation: "replace", target_text: "项目\u3000\u3000数量", content: "被篡改的表头" },
    ])
    expect(r.text.startsWith("【题注】开头句。")).toBe(true)
    expect(r.text).toContain("项目\u3000\u3000数量") // 表格行未被改动
    expect(r.skipped).toBe(1)
  })
})

describe("validateAdjustmentResult", () => {
  it("方向不成立 / 变化超限 / 距离未收敛 都要拦下", () => {
    expect(validateAdjustmentResult({ before: 100, after: 95, direction: "expand", targetWords: 200, maxChangeWords: 80 })).not.toBeNull()
    expect(validateAdjustmentResult({ before: 300, after: 305, direction: "shrink", targetWords: 200, maxChangeWords: 80 })).not.toBeNull()
    expect(validateAdjustmentResult({ before: 100, after: 190, direction: "expand", targetWords: 200, maxChangeWords: 80 })).not.toBeNull()
    expect(validateAdjustmentResult({ before: 100, after: 160, direction: "expand", targetWords: 200, maxChangeWords: 80 })).toBeNull()
    expect(validateAdjustmentResult({ before: 300, after: 230, direction: "shrink", targetWords: 200, maxChangeWords: 80 })).toBeNull()
    // 缩写越过目标也要拦（与目标距离反而拉大，且变化量受控时仍拦截）
    expect(validateAdjustmentResult({ before: 240, after: 150, direction: "shrink", targetWords: 200, maxChangeWords: 100 })).not.toBeNull()
  })
})

describe("adjustGranularity / maxChangeWordsFor", () => {
  it("偏离 >20% 走段落级，否则句子级", () => {
    expect(adjustGranularity(1000, 1500)).toBe("paragraph")
    expect(adjustGranularity(1400, 1500)).toBe("sentence")
  })
  it("扩写上限按目标 40%（下限 120），缩写上限按当前 25%（下限 80）", () => {
    expect(maxChangeWordsFor("expand", 800, 1500)).toBe(600)
    expect(maxChangeWordsFor("shrink", 800, 500)).toBe(200)
    expect(maxChangeWordsFor("expand", 800, 200)).toBe(120)
  })
})

describe("pickWordRefineTargets", () => {
  const sections = ["总体设计", "实施计划", "质保服务", "培训方案"]
  const stats = [
    { title: "总体设计", chars: 1000 },
    { title: "实施计划", chars: 400 },
    { title: "质保服务", chars: 2500 },
    { title: "培训方案", chars: 1000 },
  ]
  const sectionBudget = 1000
  const content = stats.map((s) => "字".repeat(s.chars)).join("\n\n")

  it("只挑带外（<0.8× 或 >1.2×目标）的小节，按偏离度降序，上限 maxTargets", () => {
    const targets = pickWordRefineTargets({ content, sections, sectionStats: stats, sectionBudget, chapterBudget: 4000 })
    expect(targets.map((t) => t.title)).toEqual(["质保服务", "实施计划"]) // 偏离 150% > 60%
    expect(targets[0].direction).toBe("shrink")
    expect(targets[1].direction).toBe("expand")
  })

  it("stats 与 sections 不对齐时回退整章候选；带内整章无候选", () => {
    const misaligned = pickWordRefineTargets({
      content: "字".repeat(300),
      sections,
      sectionStats: [{ title: "别的章", chars: 300 }],
      sectionBudget,
      chapterBudget: 1000,
    })
    expect(misaligned).toHaveLength(1)
    expect(misaligned[0].sectionIndex).toBe(-1)
    expect(pickWordRefineTargets({ content: "字".repeat(1000), sections: [], sectionStats: undefined, sectionBudget, chapterBudget: 1000 })).toHaveLength(0)
  })

  it("chars=0 的失败小节不参与精调", () => {
    const withEmpty = pickWordRefineTargets({
      content: "字".repeat(1000),
      sections: ["A", "B"],
      sectionStats: [
        { title: "A", chars: 1000 },
        { title: "B", chars: 0 },
      ],
      sectionBudget: 1000,
      chapterBudget: 2000,
    })
    expect(withEmpty).toHaveLength(0)
  })
})
