// 标书工作台「当前步骤不丢」的回归测试（2026-10-27，章程 P0「不丢状态」）
//
// 缺陷：`useBidWorkspace` 的 activeStep 原本是纯内存 `useState(1)`，
// 打开项目时按数据推断重设。于是：
//   · 在第 6 步（导出）刷新页面 → 被弹回第 3 步（正文生成）；
//   · 第 4/5 步（偏离表 / 交卷体检）刷新后一律回落，用户得重新点。
// 实测步骤共 7 个（BidWorkspacePage.tsx activeStep === 1..7）。
//
// 修法：按项目 id 存 localStorage（与 complianceMatrix 的 bid_matrix_* 同模式），
// 恢复时取「记录步骤」与「数据能支撑的步骤」的较小值。
import { describe, expect, it, beforeEach, vi } from "vitest"
import {
  clearBidStep,
  MAX_BID_STEP,
  MIN_BID_STEP,
  readActiveChapterId,
  readBidStep,
  resolveActiveChapterId,
  resolveOpenStep,
  writeActiveChapterId,
  writeBidStep,
} from "./bidStepPersistence"

// 最小 localStorage 桩（node 环境无 DOM）；项目内既有惯例是注入轻量桩而非引 jsdom
function installStorage(init: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(init))
  const stub = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
  vi.stubGlobal("window", { localStorage: stub })
  return map
}

describe("bidStepPersistence · 步骤按项目持久化", () => {
  beforeEach(() => {
    installStorage()
  })

  it("写入后能读回同一步骤", () => {
    writeBidStep("p1", 6)
    expect(readBidStep("p1")).toBe(6)
  })

  it("不同项目互不干扰（这是「按项目隔离」的核心）", () => {
    writeBidStep("p1", 2)
    writeBidStep("p2", 7)
    expect(readBidStep("p1")).toBe(2)
    expect(readBidStep("p2")).toBe(7)
  })

  it("越界 / 脏值 / 空 id 一律安全降级，不抛错", () => {
    expect(readBidStep("none")).toBeNull()
    expect(readBidStep("")).toBeNull()
    expect(readBidStep(null)).toBeNull()
    writeBidStep("p1", 0) // 越界
    expect(readBidStep("p1")).toBeNull()
    writeBidStep("p1", 99)
    expect(readBidStep("p1")).toBeNull()
    writeBidStep("", 3) // 空 id
    expect(readBidStep("")).toBeNull()
  })

  it("localStorage 里是脏字符串时返回 null 而不是 NaN", () => {
    installStorage({ "bid_step_p1": "abc" })
    expect(readBidStep("p1")).toBeNull()
  })

  it("clearBidStep 能清掉记录", () => {
    writeBidStep("p1", 4)
    clearBidStep("p1")
    expect(readBidStep("p1")).toBeNull()
  })

  it("存储不可用（隐私模式）时静默降级，不阻断主流程", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked")
      },
    })
    expect(() => writeBidStep("p1", 3)).not.toThrow()
    expect(readBidStep("p1")).toBeNull()
  })
})

describe("resolveOpenStep · 打开项目时停在哪一步", () => {
  it("无记录时沿用推断值（保持旧行为，不引入意外跳步）", () => {
    expect(resolveOpenStep(3, null, 3)).toBe(3)
    expect(resolveOpenStep(2, null, 2)).toBe(2)
    expect(resolveOpenStep(1, null, 1)).toBe(1)
  })

  it("有记录时恢复用户上次位置（修复「刷新回落到第 3 步」）", () => {
    // 用户在第 6 步导出，刷新后数据只支撑到 3 —— 但提交体检测过的话应回到记录值
    expect(resolveOpenStep(3, 6, 6)).toBe(6)
    expect(resolveOpenStep(3, 5, 5)).toBe(5)
  })

  it("数据被清空后不会停在没内容的步骤（取较小值）", () => {
    // 用户上次在第 6 步，但正文被清空 → dataMax=1，只能回第 1 步
    expect(resolveOpenStep(1, 6, 1)).toBe(1)
    // 上次第 5 步，正文还在但没体检 → 最多到 3
    expect(resolveOpenStep(3, 5, 3)).toBe(3)
  })

  it("记录值越界时退回推断值", () => {
    expect(resolveOpenStep(2, 0, 7)).toBe(2)
    expect(resolveOpenStep(2, 99, 7)).toBe(2)
  })

  it("结果恒在合法步骤区间内", () => {
    for (const [inf, rec, max] of [
      [1, null, 1],
      [3, 7, 7],
      [3, 1, 7],
      [99, 99, 99],
      [0, 0, 0],
    ] as const) {
      const r = resolveOpenStep(inf, rec, max)
      expect(r).toBeGreaterThanOrEqual(MIN_BID_STEP)
      expect(r).toBeLessThanOrEqual(MAX_BID_STEP)
    }
  })

  // 2026-10-27 实测暴露的边界缺陷：dataMax 只算到 5 时，
  // 「已评标」项目（stage=evaluated / 有 ai_review）刷新后会被从第 7 步限幅到第 5 步。
  // 实测证据：localStorage 记的是 7，刷新后变成 5。
  it("已评标项目必须能停在第 7 步（不能被限幅到 5）", () => {
    // dataMax=7（已模拟评标）时，记录值 7 应原样保留
    expect(resolveOpenStep(3, 7, 7)).toBe(7)
    // 反例：若 dataMax 仍按旧口径只给 5，就会被错误限幅
    expect(resolveOpenStep(3, 7, 5)).toBe(5)
  })

  it("第 6/7 步（模拟评标/归档导出）同样受 dataMax 保护", () => {
    expect(resolveOpenStep(3, 6, 7)).toBe(6)
    expect(resolveOpenStep(3, 6, 5)).toBe(5) // 没做评标时不该停在评标步
  })
})

// ---------------------------------------------------------------------------
// 2026-10-27 第 2 轮 P0：当前选中章的持久化
// 实测缺陷：投标文件编制里点开「第16章 培训方案」→ 刷新 → 回到「第11章 总体技术方案」
// ---------------------------------------------------------------------------
describe("选中章持久化 · 刷新不丢编辑位置", () => {
  beforeEach(() => {
    installStorage()
  })

  it("写入后能读回同一章", () => {
    writeActiveChapterId("p1", "node-16")
    expect(readActiveChapterId("p1")).toBe("node-16")
  })

  it("不同项目互不干扰", () => {
    writeActiveChapterId("pA", "node-A")
    writeActiveChapterId("pB", "node-B")
    expect(readActiveChapterId("pA")).toBe("node-A")
    expect(readActiveChapterId("pB")).toBe("node-B")
  })

  it("空项目 id / 空章 id 不写入，读取返回 null", () => {
    writeActiveChapterId("", "node-1")
    writeActiveChapterId("p1", "")
    expect(readActiveChapterId("")).toBeNull()
    expect(readActiveChapterId("p1")).toBeNull()
  })

  it("存储不可用时静默降级", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked")
      },
    })
    expect(() => writeActiveChapterId("p1", "node-1")).not.toThrow()
    expect(readActiveChapterId("p1")).toBeNull()
  })
})

describe("resolveActiveChapterId · 进项目时选中哪一章", () => {
  const ids = ["node-11", "node-12", "node-13", "node-16"]

  it("记录章仍在清单里 → 恢复它（修复「回到第一章」）", () => {
    expect(resolveActiveChapterId("node-16", ids)).toBe("node-16")
  })

  it("无记录 → 退回第一项（保持旧行为）", () => {
    expect(resolveActiveChapterId(null, ids)).toBe("node-11")
    expect(resolveActiveChapterId("", ids)).toBe("node-11")
  })

  it("记录章已失效（重新生成大纲换了 node_id）→ 退回第一项，不返回不存在的章", () => {
    expect(resolveActiveChapterId("node-999", ids)).toBe("node-11")
  })

  it("没有任何章 → null", () => {
    expect(resolveActiveChapterId("node-16", [])).toBeNull()
    expect(resolveActiveChapterId(null, [])).toBeNull()
  })

  it("清单里的空值被忽略", () => {
    expect(resolveActiveChapterId(null, ["", "node-2"])).toBe("node-2")
  })
})

// 2026-10-27 实测教训（本轮踩的坑，用测试钉住语义）：
// 恢复选中章时**只改 activeChapterId 不够**，必须同时把该章正文装进编辑器状态，
// 否则出现「章 id 变了、正文还是旧值」——首版就漏了这步，chapterRefine 行为网 4 例红
// （测试 selectChapter("c1") 后读 editingContent 得到空串）。
describe("resolveActiveChapterId · 返回值必须能定位到一份正文", () => {
  const chapters = [
    { node_id: "c1", content: "原始正文" },
    { node_id: "c2", content: "第二章原文" },
  ]
  const idsOf = (list: Array<{ node_id: string }>) => list.map((c) => c.node_id)
  const contentOf = (id: string | null) => chapters.find((c) => c.node_id === id)?.content ?? ""

  it("恢复记录的章时，能取到该章的真实正文（不是空串）", () => {
    const id = resolveActiveChapterId("c2", idsOf(chapters))
    expect(id).toBe("c2")
    expect(contentOf(id)).toBe("第二章原文")
  })

  it("回退第一项时，也能取到真实正文", () => {
    const id = resolveActiveChapterId(null, idsOf(chapters))
    expect(id).toBe("c1")
    expect(contentOf(id)).toBe("原始正文")
  })
})
