import { describe, expect, it } from "vitest"
import { hasPendingSections, isIncompleteSectionChapter, isTrulyDoneChapter, planSectionResume, reflowStatsAfterAppend, sectionGenStatus, trackedPrefixLength, withTransientRetry } from "./chapterCompletion"
import { rebuildSectionContent, sliceSectionPieces } from "./bidTypes"

describe("sectionGenStatus（R170 中断不再误标 done）", () => {
  it("未中断 → done", () => {
    expect(sectionGenStatus({ cancelledMid: false })).toBe("done")
  })
  it("小节循环被中断 → failed（可断点续跑）", () => {
    expect(sectionGenStatus({ cancelledMid: true })).toBe("failed")
  })
})

describe("isIncompleteSectionChapter（R170 历史误标 done 自愈判据）", () => {
  it("done 且 11 小节只产出 1 条统计 → 判为未完成（应被批量重跑续补）", () => {
    const ch = { gen_status: "done", sections: new Array(11).fill("s"), section_stats: [{ chars: 3131 }] }
    expect(isIncompleteSectionChapter(ch)).toBe(true)
  })
  it("done 且统计覆盖全部小节、每节均有产出（完整小节章）→ 不误伤", () => {
    const ch = { gen_status: "done", sections: ["a", "b", "c"], section_stats: [{ chars: 900 }, { chars: 800 }, { chars: 700 }] }
    expect(isIncompleteSectionChapter(ch)).toBe(false)
  })
  it("R179 收紧：stats 数==小节数但含 chars:0 空产出小节 → 判为待补（旧口径漏网的『done 但有小节洞』）", () => {
    const ch = { gen_status: "done", sections: ["a", "b", "c"], section_stats: [{ chars: 900 }, { chars: 800 }, { chars: 0 }] }
    expect(isIncompleteSectionChapter(ch)).toBe(true)
  })
  it("done 单次生成章（section_stats 空）→ 不误伤", () => {
    const ch = { gen_status: "done", sections: ["a", "b"], section_stats: [] }
    expect(isIncompleteSectionChapter(ch)).toBe(false)
  })
  it("非 done 状态一律 false（交给既有 failed/pending 流程）", () => {
    expect(isIncompleteSectionChapter({ gen_status: "failed", sections: ["a", "b"], section_stats: [{ chars: 1 }] })).toBe(false)
    expect(isIncompleteSectionChapter({ gen_status: "pending", sections: ["a", "b"] })).toBe(false)
  })
  it("空/缺字段安全", () => {
    expect(isIncompleteSectionChapter(null)).toBe(false)
    expect(isIncompleteSectionChapter(undefined)).toBe(false)
    expect(isIncompleteSectionChapter({})).toBe(false)
  })
})

describe("hasPendingSections（R171 继续生成路由判据：与 gen_status 无关）", () => {
  it("failed 且 11 小节只产出 1 条统计 → true（应走小节断点续跑）", () => {
    const ch = { gen_status: "failed", sections: new Array(11).fill("s"), section_stats: [{ chars: 3131 }] }
    expect(hasPendingSections(ch)).toBe(true)
  })
  it("done 且仍有未生成小节 → true（历史误标章同样命中）", () => {
    const ch = { gen_status: "done", sections: ["a", "b", "c"], section_stats: [{ chars: 900 }] }
    expect(hasPendingSections(ch)).toBe(true)
  })
  it("全部小节已生成、仅总长未达预算（stats==secs）→ false（仍走整章续写补足）", () => {
    const ch = { gen_status: "done", sections: ["a", "b"], section_stats: [{ chars: 900 }, { chars: 800 }] }
    expect(hasPendingSections(ch)).toBe(false)
  })
  it("单次生成章（section_stats 空）→ false", () => {
    expect(hasPendingSections({ gen_status: "done", sections: ["a", "b"], section_stats: [] })).toBe(false)
  })
  it("空/缺字段安全", () => {
    expect(hasPendingSections(null)).toBe(false)
    expect(hasPendingSections(undefined)).toBe(false)
    expect(hasPendingSections({})).toBe(false)
  })
  it("isIncompleteSectionChapter 复用 hasPendingSections：仅 done 才纳入批量自愈", () => {
    const failed = { gen_status: "failed", sections: ["a", "b"], section_stats: [{ chars: 1 }] }
    expect(hasPendingSections(failed)).toBe(true)
    expect(isIncompleteSectionChapter(failed)).toBe(false)
  })
})

class FakeFatal extends Error {}

describe("withTransientRetry（R173 小节瞬时失败重试韧性）", () => {
  it("首试成功 → 只调用一次并返回结果", async () => {
    let n = 0
    const v = await withTransientRetry(async () => { n += 1; return "ok" })
    expect(v).toBe("ok")
    expect(n).toBe(1)
  })
  it("首试抛非致命错、重试成功 → 调用两次并返回重试结果", async () => {
    let n = 0
    const v = await withTransientRetry(async () => {
      n += 1
      if (n === 1) throw new Error("网关 5xx")
      return "recovered"
    })
    expect(v).toBe("recovered")
    expect(n).toBe(2)
  })
  it("两试都抛错 → 重抛最后一次错误、共调用两次", async () => {
    let n = 0
    await expect(
      withTransientRetry(async () => {
        n += 1
        throw new Error("err-" + n)
      }),
    ).rejects.toThrow("err-2")
    expect(n).toBe(2)
  })
  it("isFatal 命中 → 立即上抛、不重试（只调用一次）", async () => {
    let n = 0
    await expect(
      withTransientRetry(
        async () => { n += 1; throw new FakeFatal("登录失效") },
        { isFatal: (e) => e instanceof FakeFatal },
      ),
    ).rejects.toThrow("登录失效")
    expect(n).toBe(1)
  })
  it("shouldStop 命中（用户取消）→ 本试失败后不再重试、直接上抛", async () => {
    let n = 0
    await expect(
      withTransientRetry(
        async () => { n += 1; throw new Error("net") },
        { shouldStop: () => true },
      ),
    ).rejects.toThrow("net")
    expect(n).toBe(1)
  })
  it("maxAttempts 生效 → 按上限次数尝试后重抛", async () => {
    let n = 0
    await expect(
      withTransientRetry(
        async () => { n += 1; throw new Error("boom") },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow("boom")
    expect(n).toBe(3)
  })
})

describe("trackedPrefixLength（R174 续跑种子裁剪，防重复膨胀）", () => {
  it("小节已全部跟踪 → Infinity（沿用整章正文，行为不变）", () => {
    const stats = [{ chars: 1000 }, { chars: 1200 }]
    expect(trackedPrefixLength(stats, 2, 2)).toBe(Number.POSITIVE_INFINITY)
  })
  it("全部小节已跟踪且 resumeFrom==sectionCount==stats 覆盖 → Infinity", () => {
    const stats = [{ chars: 800 }, { chars: 900 }, { chars: 700 }]
    expect(trackedPrefixLength(stats, 3, 3)).toBe(Number.POSITIVE_INFINITY)
  })
  it("残缺章（content 远超已跟踪小节之和）→ 只返回已跟踪前缀长度，裁掉 blob 尾巴", () => {
    // 实测态：stats 仅 [3131]（1 小节）、content 17548（历史整章追加）、共 11 小节、resumeFrom=1
    const stats = [{ chars: 3131 }]
    const cap = trackedPrefixLength(stats, 1, 11)
    expect(cap).toBe(3131) // 1 段无分隔符
    expect(cap).toBeLessThan(17548) // 裁掉未跟踪尾巴
  })
  it("健康中断章（content 恰等于已生成小节）→ 上限≈全长，裁剪无副作用", () => {
    const stats = [{ chars: 1000 }, { chars: 1200 }]
    // 2 段 + 1 个 \n\n 分隔 = 1000+1200+2，content 实际也≈此值
    expect(trackedPrefixLength(stats, 2, 4)).toBe(1000 + 1200 + 2)
  })
  it("含 chars:0 失败小节时只累计正数小节正文", () => {
    const stats = [{ chars: 900 }, { chars: 0 }, { chars: 800 }]
    // resumeFrom 停在首个失败小节（index1），只保留第 1 段
    expect(trackedPrefixLength(stats, 1, 3)).toBe(900)
  })
  it("空 stats → 0；自定义分隔符生效", () => {
    expect(trackedPrefixLength([], 3, 11)).toBe(0)
    expect(trackedPrefixLength([{ chars: 500 }, { chars: 500 }], 2, 5, 1)).toBe(1001)
  })
})

describe("isTrulyDoneChapter（R175 生成总览完成数不再虚高）", () => {
  it("done 且小节全部生成 → 真正完成", () => {
    expect(isTrulyDoneChapter({ gen_status: "done", sections: ["a", "b"], section_stats: [{ chars: 900 }, { chars: 800 }] })).toBe(true)
  })
  it("done 但 11 小节只统计 1 条 → 不算完成（历史虚标元凶）", () => {
    expect(isTrulyDoneChapter({ gen_status: "done", sections: new Array(11).fill("s"), section_stats: [{ chars: 3131 }] })).toBe(false)
  })
  it("单次生成章（stats 空）done → 算完成（不误伤）", () => {
    expect(isTrulyDoneChapter({ gen_status: "done", sections: ["a", "b"], section_stats: [] })).toBe(true)
  })
  it("failed / pending → 不算完成", () => {
    expect(isTrulyDoneChapter({ gen_status: "failed", sections: ["a", "b"], section_stats: [{ chars: 900 }] })).toBe(false)
    expect(isTrulyDoneChapter({ gen_status: "pending", sections: ["a"] })).toBe(false)
  })
})

describe("hasPendingSections R179 收紧（空产出洞也算待补）", () => {
  it("中间小节洞 + 后续小节已产出 → true（旧口径按 stats==secs 误判完整）", () => {
    expect(hasPendingSections({ sections: ["a", "b", "c"], section_stats: [{ chars: 900 }, { chars: 0 }, { chars: 800 }] })).toBe(true)
  })
  it("全部小节 chars>0 且覆盖小节数 → false（不误伤健康章）", () => {
    expect(hasPendingSections({ sections: ["a", "b"], section_stats: [{ chars: 900 }, { chars: 800 }] })).toBe(false)
  })
  it("isTrulyDoneChapter：done 且含小节洞 → 不算完成（总览不再虚高）", () => {
    expect(isTrulyDoneChapter({ gen_status: "done", sections: ["a", "b", "c"], section_stats: [{ chars: 900 }, { chars: 800 }, { chars: 0 }] })).toBe(false)
  })
  it("单次生成章（stats 空）→ 不受收紧影响", () => {
    expect(hasPendingSections({ sections: ["a", "b"], section_stats: [] })).toBe(false)
  })
})

describe("reflowStatsAfterAppend（R179 生产端 section_stats 回写）", () => {
  it("整章补足追加尾巴 → 增量按切片口径并入最后一个非空小节，切片/重组对正文无损往返", () => {
    const p1 = "x".repeat(900)
    const p2 = "y".repeat(800)
    const tail = "z".repeat(300)
    const merged = [p1, p2, tail].join("\n\n")
    const next = reflowStatsAfterAppend([{ title: "a", chars: 900 }, { title: "b", chars: 800 }], merged)
    expect(next).not.toBeNull()
    expect(next![0]).toEqual({ title: "a", chars: 900 })
    expect(next![1].chars).toBe(800 + 2 + 300)
    expect(rebuildSectionContent(sliceSectionPieces(merged, next!))).toBe(merged)
  })
  it("中间 chars:0 占位不消费分隔符，洞保持为洞（待断点续跑补齐）", () => {
    const p1 = "x".repeat(500)
    const p3 = "y".repeat(400)
    const merged = [p1, "", p3, "t".repeat(100)].filter((t) => t.length > 0).join("\n\n")
    const next = reflowStatsAfterAppend([{ title: "a", chars: 500 }, { title: "b", chars: 0 }, { title: "c", chars: 400 }], merged)
    expect(next).not.toBeNull()
    expect(next![1].chars).toBe(0)
    expect(next![2].chars).toBe(400 + 2 + 100)
    expect(rebuildSectionContent(sliceSectionPieces(merged, next!))).toBe(merged)
  })
  it("空 stats / 无已产出小节 / 空正文 → null（不回写，避免写入错误结构）", () => {
    expect(reflowStatsAfterAppend([], "anything")).toBeNull()
    expect(reflowStatsAfterAppend([{ title: "a", chars: 0 }], "some")).toBeNull()
    expect(reflowStatsAfterAppend([{ title: "a", chars: 100 }], "")).toBeNull()
  })
  it("正文短到无法容纳既有结构（治理裁剪后）→ null，不误改", () => {
    expect(reflowStatsAfterAppend([{ title: "a", chars: 900 }, { title: "b", chars: 800 }], "short")).toBeNull()
  })
})


describe("planSectionResume（R276 细粒度断点续跑：保留空洞之后的已产出小节）", () => {
  const secs = ["A", "B", "C", "D"]

  it("全新/空正文 → 全部小节待补，pieces 全空", () => {
    const p = planSectionResume("", [], secs)
    expect(p.pendingIndices).toEqual([0, 1, 2, 3])
    expect(p.pieces).toEqual(["", "", "", ""])
    expect(p.stats.map((x) => x.chars)).toEqual([0, 0, 0, 0])
  })

  it("opts.fresh → 忽略既有正文，全部待补", () => {
    const stats = [{ title: "A", chars: 5 }, { title: "B", chars: 5 }]
    const p = planSectionResume("xxxxx\n\nyyyyy", stats, secs, { fresh: true })
    expect(p.pendingIndices).toEqual([0, 1, 2, 3])
  })

  it("title 与 stats 错位 → 弃用种子，全部待补", () => {
    const stats = [{ title: "X", chars: 5 }, { title: "B", chars: 5 }]
    const p = planSectionResume("xxxxx\n\nyyyyy", stats, secs)
    expect(p.pendingIndices).toEqual([0, 1, 2, 3])
  })

  it("连续前缀中断（尾部未覆盖）→ 保留前缀、尾部待补（与旧行为一致）", () => {
    const stats = [{ title: "A", chars: 5 }, { title: "B", chars: 5 }]
    const content = "12345\n\nabcde"
    const p = planSectionResume(content, stats, secs)
    expect(p.pieces[0]).toBe("12345")
    expect(p.pieces[1]).toBe("abcde")
    expect(p.pieces[2]).toBe("")
    expect(p.pieces[3]).toBe("")
    expect(p.pendingIndices).toEqual([2, 3])
    expect(p.stats[0]).toEqual({ title: "A", chars: 5 })
  })

  it("中间空洞、之后小节已成功 → 保留空洞之后的成品，只补空洞与尾部（本轮修复点）", () => {
    // A 成功、B 失败(chars:0)、C 成功；D 从未尝试
    const stats = [
      { title: "A", chars: 5 },
      { title: "B", chars: 0 },
      { title: "C", chars: 5 },
      { title: "D", chars: 0 },
    ]
    // 注：生成时洞（空产出）不追加正文也不占连接符，故 A 与 C 直接相邻（与 sliceSectionPieces 口径一致）
    const content = "12345\n\nabcde"
    const p = planSectionResume(content, stats, secs)
    expect(p.pieces[0]).toBe("12345") // A 保留
    expect(p.pieces[1]).toBe("") // B 空洞 → 待补
    expect(p.pieces[2]).toBe("abcde") // C 保留（旧逻辑会被推倒重生成）
    expect(p.pieces[3]).toBe("") // D 待补
    expect(p.pendingIndices).toEqual([1, 3])
    // 已保留小节计入 stats，空洞记 0
    expect(p.stats.map((x) => x.chars)).toEqual([5, 0, 5, 0])
  })

  it("全部小节已成功 → 无待补（pendingIndices 为空）", () => {
    const stats = [
      { title: "A", chars: 3 },
      { title: "B", chars: 3 },
      { title: "C", chars: 3 },
      { title: "D", chars: 3 },
    ]
    const content = "aaa\n\nbbb\n\nccc\n\nddd"
    const p = planSectionResume(content, stats, secs)
    expect(p.pendingIndices).toEqual([])
    expect(p.pieces).toEqual(["aaa", "bbb", "ccc", "ddd"])
  })

  it("历史整章 blob 追加尾巴（content 远超 Σchars）→ 只裁到已跟踪区间，多余尾巴不进种子（R174 口径）", () => {
    const stats = [{ title: "A", chars: 5 }]
    const content = "12345\n\n" + "Z".repeat(100)
    const p = planSectionResume(content, stats, secs)
    expect(p.pieces[0]).toBe("12345")
    expect(p.pieces[0].length).toBeLessThanOrEqual(5)
    expect(p.pendingIndices).toEqual([1, 2, 3])
  })

  it("chars>0 但正文短到切不出该节 → 保守判待补，不误留空成品", () => {
    const stats = [
      { title: "A", chars: 5 },
      { title: "B", chars: 5 },
    ]
    const content = "123" // 远短于 A 声明的 5 字
    const p = planSectionResume(content, stats, secs)
    expect(p.pendingIndices).toContain(1)
  })
})
