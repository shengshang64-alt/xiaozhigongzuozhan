import { describe, expect, it } from "vitest"
import {
  applyFilter,
  batchImpact,
  canApprove,
  canUndo,
  isJunkAtom,
  mapKeyToAction,
  planAllBatches,
  planDedupeGroups,
  planRejectBySource,
  planRejectJunk,
  planRejectLowConfidenceFacts,
  reviewStats,
  sortForReview,
  undoRemainingSec,
  UNDO_WINDOW_MS,
  type ReviewAtom,
  type UndoEntry,
} from "./kbReview"

// ---------------------------------------------------------------------------
// P0-5 验收测试：审核工作台逻辑
//
// 需求（§7）：
//   · 快捷键 A/R/E/1-8/J/K/U/Tab/空格/? 必须实现
//   · 「一个场景都勾不出来的，自动驳回」（原则 P3）
//   · 5 种批量操作把 1842 条压到几小时
//   · 排序：冲突组优先 → 高usage潜力 → 近期 → 低置信
// ---------------------------------------------------------------------------

function atom(p: Partial<ReviewAtom> & { id: string }): ReviewAtom {
  return {
    atomType: "metric",
    title: "电子病历应用水平达 5 级",
    body: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
    subjectKey: "metric:电子病历应用水平分级|国家卫健委评测",
    confidence: 0.92,
    kbTrack: "医院",
    kbBucket: "评级",
    kbSection: "",
    usableFor: ["proposal"],
    sourceDocId: "doc1",
    docName: "可研.docx",
    sourceAnchor: "p3-c100-200",
    sourceQuote: "电子病历应用水平分级 5 级评审",
    conflictGroup: "",
    validUntil: "",
    contentStatus: "pending",
    version: 1,
    usageCount: 0,
    createdAt: new Date().toISOString(),
    ...p,
  }
}

describe("canApprove：只勾用途才能通过的硬规则（原则 P3）", () => {
  it("没有勾任何用途 → 不允许通过，且给出明确提示", () => {
    const r = canApprove(atom({ id: "a", usableFor: [] }), [])
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("至少勾选一个用途")
    expect(r.reason).toContain("以后能在哪儿用")
  })

  it("原子本身有用途 → 允许通过", () => {
    expect(canApprove(atom({ id: "a", usableFor: ["proposal"] }), []).ok).toBe(true)
  })

  it("用户现场勾选用途 → 允许通过（即使原子原本为空）", () => {
    expect(canApprove(atom({ id: "a", usableFor: [] }), ["bid"]).ok).toBe(true)
  })
})

describe("排序：冲突组优先 → 高潜力 → 近期 → 低置信（§7.3 第 5 条）", () => {
  it("冲突组排最前", () => {
    const a = atom({ id: "conflict", conflictGroup: "g1", atomType: "fact", confidence: 0.5 })
    const b = atom({ id: "normal", atomType: "case", confidence: 0.99 })
    const sorted = sortForReview([b, a])
    expect(sorted[0].id).toBe("conflict")
  })

  it("case/metric 优先于 fact/script", () => {
    const c = atom({ id: "case", atomType: "case" })
    const f = atom({ id: "fact", atomType: "fact" })
    expect(sortForReview([f, c])[0].id).toBe("case")
  })

  it("低置信排最后", () => {
    const high = atom({ id: "high", confidence: 0.95 })
    const low = atom({ id: "low", confidence: 0.3 })
    expect(sortForReview([low, high])[0].id).toBe("high")
  })

  it("近期文档优先于久远文档", () => {
    const recent = atom({ id: "recent", atomType: "fact", createdAt: new Date().toISOString() })
    const old = atom({ id: "old", atomType: "fact", createdAt: "2022-01-01T00:00:00Z" })
    expect(sortForReview([old, recent])[0].id).toBe("recent")
  })
})

describe("筛选与统计", () => {
  const atoms = [
    atom({ id: "1", conflictGroup: "g1" }),
    atom({ id: "2", confidence: 0.95 }),
    atom({ id: "3", confidence: 0.3 }),
    atom({ id: "4", usableFor: [] }),
  ]

  it("冲突筛选", () => {
    expect(applyFilter(atoms, "conflict")).toHaveLength(1)
  })

  it("低置信筛选", () => {
    expect(applyFilter(atoms, "lowConfidence")).toHaveLength(1)
  })

  it("未勾用途筛选（找出会被驳回的）", () => {
    expect(applyFilter(atoms, "missingUsableFor")).toHaveLength(1)
  })

  it("统计四个数字", () => {
    const s = reviewStats(atoms)
    expect(s.total).toBe(4)
    expect(s.conflict).toBe(1)
    expect(s.lowConfidence).toBe(1)
    expect(s.highConfidence).toBe(3)
  })
})

describe("批量操作：同组去重（§7.3 第 1 条）", () => {
  it("同 subject_key 多条 → 保留版本最高的", () => {
    const atoms = [
      atom({ id: "v1", subjectKey: "metric:X|Y", version: 1, confidence: 0.9 }),
      atom({ id: "v3", subjectKey: "metric:X|Y", version: 3, confidence: 0.8 }),
      atom({ id: "v2", subjectKey: "metric:X|Y", version: 2, confidence: 0.95 }),
    ]
    const plans = planDedupeGroups(atoms)
    expect(plans).toHaveLength(1)
    expect(plans[0].kind).toBe("dedupeGroup")
    if (plans[0].kind === "dedupeGroup") {
      expect(plans[0].keepId).toBe("v3") // 版本最高
      expect(plans[0].supersedeIds.sort()).toEqual(["v1", "v2"])
      expect(plans[0].reason).toContain("保留最新版本")
    }
  })

  it("同版本取置信度最高", () => {
    const atoms = [
      atom({ id: "low", subjectKey: "metric:X|Y", version: 1, confidence: 0.6 }),
      atom({ id: "high", subjectKey: "metric:X|Y", version: 1, confidence: 0.95 }),
    ]
    const p = planDedupeGroups(atoms)[0]
    if (p.kind === "dedupeGroup") expect(p.keepId).toBe("high")
  })

  it("不同 subject_key 不合并", () => {
    const atoms = [atom({ id: "a", subjectKey: "metric:X|Y" }), atom({ id: "b", subjectKey: "metric:A|B" })]
    expect(planDedupeGroups(atoms)).toHaveLength(0)
  })
})

describe("批量操作：低置信 fact 驳回（§7.3 第 2 条）", () => {
  it("只驳回 fact 类型且低置信的", () => {
    const atoms = [
      atom({ id: "f1", atomType: "fact", confidence: 0.3 }),
      atom({ id: "f2", atomType: "fact", confidence: 0.9 }), // 高置信，不驳
      atom({ id: "m1", atomType: "metric", confidence: 0.3 }), // 非 fact，不驳
    ]
    const p = planRejectLowConfidenceFacts(atoms)
    expect(p).toBeTruthy()
    if (p?.kind === "rejectLowConfidenceFacts") expect(p.atomIds).toEqual(["f1"])
  })

  it("没有目标时返回 null", () => {
    expect(planRejectLowConfidenceFacts([atom({ id: "a", atomType: "fact", confidence: 0.9 })])).toBeNull()
  })
})

describe("批量操作：套话驳回（§7.3 第 3 条）", () => {
  it("正文过短判为套话", () => {
    expect(isJunkAtom(atom({ id: "a", body: "很短" }))).toBe(true)
  })

  it("含「随着…的发展」判为套话", () => {
    expect(isJunkAtom(atom({ id: "a", body: "随着医疗信息化的发展，我院不断提升服务能力与水平。" }))).toBe(true)
  })

  it("含占位符判为套话", () => {
    expect(isJunkAtom(atom({ id: "a", body: "具体数值待补充，后续完善相关内容说明部分。" }))).toBe(true)
  })

  it("正常内容不判套话", () => {
    expect(isJunkAtom(atom({ id: "a", body: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。" }))).toBe(false)
  })

  it("批量计划汇总所有套话", () => {
    const atoms = [
      atom({ id: "j1", body: "很短" }),
      atom({ id: "j2", body: "随着技术的发展，我们不断进步与提升。" }),
      atom({ id: "ok", body: "医院编制床位 300 张，年门诊量 42 万人次，建筑面积 2 万平方米。" }),
    ]
    const p = planRejectJunk(atoms)
    if (p?.kind === "rejectJunk") expect(p.atomIds.sort()).toEqual(["j1", "j2"])
  })
})

describe("批量操作：按来源整篇驳回（§7.3 第 4 条）", () => {
  it("同一文档不合格占比 > 60% → 整篇驳回建议", () => {
    const atoms = [
      atom({ id: "b1", sourceDocId: "baddoc", body: "很短" }),
      atom({ id: "b2", sourceDocId: "baddoc", confidence: 0.2 }),
      atom({ id: "b3", sourceDocId: "baddoc", body: "很短" }),
      atom({ id: "b4", sourceDocId: "baddoc", confidence: 0.9, body: "这是一条足够长的正常内容描述文本用于测试。" }),
    ]
    const plans = planRejectBySource(atoms)
    expect(plans).toHaveLength(1)
    expect(plans[0].kind).toBe("rejectBySource")
    if (plans[0].kind === "rejectBySource") {
      expect(plans[0].atomIds).toHaveLength(4)
      expect(plans[0].reason).toContain("整篇驳回")
    }
  })

  it("质量好时不建议整篇驳回", () => {
    const atoms = [
      atom({ id: "g1", sourceDocId: "gooddoc" }),
      atom({ id: "g2", sourceDocId: "gooddoc" }),
      atom({ id: "g3", sourceDocId: "gooddoc" }),
    ]
    expect(planRejectBySource(atoms)).toHaveLength(0)
  })
})

describe("批量计划汇总", () => {
  it("planAllBatches 汇总四类计划并按影响排序", () => {
    const atoms = [
      atom({ id: "a1", subjectKey: "k1", version: 1 }),
      atom({ id: "a2", subjectKey: "k1", version: 2 }),
      atom({ id: "a3", subjectKey: "k1", version: 3 }),
      atom({ id: "f1", atomType: "fact", confidence: 0.2 }),
      atom({ id: "j1", body: "很短" }),
    ]
    const plans = planAllBatches(atoms)
    expect(plans.length).toBeGreaterThan(0)
    const impact = batchImpact(plans)
    expect(impact.handled).toBeGreaterThan(0)
    expect(impact.note).toContain("批量可处理")
  })
})

describe("键盘快捷键（§7.2 必须实现）", () => {
  it("A/R/E 映射正确", () => {
    expect(mapKeyToAction("a").kind).toBe("approve")
    expect(mapKeyToAction("r").kind).toBe("reject")
    expect(mapKeyToAction("e").kind).toBe("edit")
  })

  it("J/K 上下条", () => {
    expect(mapKeyToAction("j").kind).toBe("next")
    expect(mapKeyToAction("k").kind).toBe("prev")
  })

  it("U 撤销、空格切换原文、? 帮助", () => {
    expect(mapKeyToAction("u").kind).toBe("undo")
    expect(mapKeyToAction(" ").kind).toBe("toggleSource")
    expect(mapKeyToAction("?").kind).toBe("help")
    expect(mapKeyToAction("Tab").kind).toBe("focusUsableFor")
  })

  it("数字 1-8 对应八种原子类型", () => {
    const a1 = mapKeyToAction("1")
    expect(a1.kind).toBe("setType")
    if (a1.kind === "setType") expect(a1.type).toBe("fact")
    const a8 = mapKeyToAction("8")
    if (a8.kind === "setType") expect(a8.type).toBe("script")
    expect(mapKeyToAction("9").kind).toBe("none")
  })

  it("大写字母同样生效", () => {
    expect(mapKeyToAction("A").kind).toBe("approve")
  })

  it("在输入框里不触发（避免打字误操作）", () => {
    expect(mapKeyToAction("a", { inEditable: true }).kind).toBe("none")
  })
})

describe("撤销窗口（U 键，10 秒内）", () => {
  const entry: UndoEntry = { atomId: "a", prevStatus: "pending", prevUsableFor: [], action: "approve", at: Date.now() }

  it("10 秒内可撤销", () => {
    expect(canUndo(entry, entry.at + 5000)).toBe(true)
  })

  it("超过 10 秒不可撤销", () => {
    expect(canUndo(entry, entry.at + UNDO_WINDOW_MS + 1)).toBe(false)
  })

  it("剩余秒数倒计时正确", () => {
    expect(undoRemainingSec(entry, entry.at)).toBe(10)
    expect(undoRemainingSec(entry, entry.at + 9000)).toBe(1)
  })

  it("无撤销记录时不可撤", () => {
    expect(canUndo(null)).toBe(false)
  })
})
