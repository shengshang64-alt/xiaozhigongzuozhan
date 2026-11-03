import { describe, expect, it } from "vitest"

import {
  assignLinesToLots,
  assignLinesToLotsBulk,
  buildLotsScopeHint,
  filterEntriesByLotsScope,
  mergeLotsScopeOnReparse,
  parseLotsLineInfo,
  type LotInfo,
} from "./bidTypes"
import { buildBidOutlineMessages } from "./prompts/bidOutline"
import type { ParseReport } from "./bidTypes"

// Q27 切片B：多包范围归属 + 所投包件约束（纯函数 + prompt 注入）

const lots: LotInfo[] = [
  { no: 1, title: "第1包：核心系统", budget: "", lines: 10 },
  { no: 2, title: "第2包：硬件", budget: "", lines: 40 },
  { no: 3, title: "第3包：运维", budget: "", lines: 70 },
]

describe("assignLinesToLots 单行就近归属", () => {
  it("公共区（所有包标题之前）归 0", () => {
    expect(assignLinesToLots(lots, 0)).toBe(0)
    expect(assignLinesToLots(lots, 9)).toBe(0)
  })
  it("落在包 K 与 K+1 标题之间 → 归包 K", () => {
    expect(assignLinesToLots(lots, 10)).toBe(1)
    expect(assignLinesToLots(lots, 25)).toBe(1)
    expect(assignLinesToLots(lots, 40)).toBe(2)
    expect(assignLinesToLots(lots, 55)).toBe(2)
    expect(assignLinesToLots(lots, 70)).toBe(3)
    expect(assignLinesToLots(lots, 999)).toBe(3)
  })
  it("乱序入参按行号排序后归属；无包全部归 0", () => {
    const shuffled = [lots[2], lots[0], lots[1]]
    expect(assignLinesToLots(shuffled, 55)).toBe(2)
    expect(assignLinesToLots([], 5)).toBe(0)
  })
  it("批量归属与逐行一致", () => {
    expect(assignLinesToLotsBulk(lots, [5, 15, 45, 75])).toEqual([0, 1, 2, 3])
  })
})

describe("parseLotsLineInfo 原文行包标题扫描", () => {
  it("识别第N包标题行并给出行号；否定语境与保证金行跳过", () => {
    const lines = [
      "第一章 公告",
      "本项目不划分标包，投标人应对全部内容投标。",
      "第1包 核心业务系统",
      "某保证金：人民币50000元",
      "第2包 硬件设备",
      "第3包 运维服务",
    ]
    const infos = parseLotsLineInfo(lines)
    expect(infos.map((l) => l.no)).toEqual([1, 2, 3])
    expect(infos[0].lines).toBe(2)
    expect(infos[1].lines).toBe(4)
    expect(infos[2].lines).toBe(5)
  })
  it("无标包返回空数组", () => {
    expect(parseLotsLineInfo(["普通正文", "无包件划分"])).toEqual([])
  })
})

describe("buildLotsScopeHint 范围约束文案", () => {
  it("未选 / 全选 / total<=1 → 空串（零行为变化）", () => {
    expect(buildLotsScopeHint(undefined, 3)).toBe("")
    expect(buildLotsScopeHint([], 3)).toBe("")
    expect(buildLotsScopeHint([1, 2, 3], 3)).toBe("")
    expect(buildLotsScopeHint([1], 1)).toBe("")
  })
  it("限定单包 → 含包号与不响应口径", () => {
    const h = buildLotsScopeHint([2], 3)
    expect(h).toContain("本次仅投标第 2 包")
    expect(h).toContain("共划分 3 个包件")
    expect(h).toContain("不得响应")
    expect(h).toContain("包件归属未明")
  })
  it("多选去重排序", () => {
    const h = buildLotsScopeHint([3, 1, 3], 3)
    expect(h).toContain("本次仅投标第 1、3 包")
  })
})

describe("filterEntriesByLotsScope 行号归属过滤", () => {
  const scope = {
    selected: [1],
    all: [
      { no: 1, title: "第1包", lines: 10 },
      { no: 2, title: "第2包", lines: 40 },
    ],
  }
  it("仅保留所选包 + 公共区行", () => {
    const rows = [
      { lineIdx: 5, name: "公共" },
      { lineIdx: 15, name: "包1" },
      { lineIdx: 45, name: "包2" },
    ]
    const out = filterEntriesByLotsScope(rows, scope)
    expect(out.map((r) => r.name)).toEqual(["公共", "包1"])
  })
  it("未选 / 全选 / 缺行号 → 原样返回（零行为变化）", () => {
    const rows = [{ lineIdx: 15 }, { lineIdx: 45 }]
    expect(filterEntriesByLotsScope(rows, { selected: [], all: scope.all })).toBe(rows)
    expect(filterEntriesByLotsScope(rows, { selected: [1, 2], all: scope.all })).toBe(rows)
    const noIdx = [{ lineIdx: undefined, name: "a" }, { lineIdx: undefined, name: "b" }]
    expect(filterEntriesByLotsScope(noIdx, scope)).toBe(noIdx)
  })
})

describe("mergeLotsScopeOnReparse 重解析去留", () => {
  it("签名一致保留选择，签名变化清空，无选择恒空", () => {
    const prev = { selected: [1], all: [] }
    expect(mergeLotsScopeOnReparse(prev, "sigA", "sigA")).toBe(prev)
    expect(mergeLotsScopeOnReparse(prev, "sigA", "sigB")).toBeUndefined()
    expect(mergeLotsScopeOnReparse({ selected: [] }, "sigA", "sigA")).toBeUndefined()
    expect(mergeLotsScopeOnReparse(undefined, "sigA", "sigA")).toBeUndefined()
  })
})

describe("buildBidOutlineMessages 注入包件范围约束", () => {
  const report: ParseReport = {
    scope: "key",
    sections: [{ key: "lots", title: "标包划分", content: "【第1包】核心系统\n【第2包】硬件" }],
    lots_scope: {
      selected: [1],
      all: [
        { no: 1, title: "第1包", lines: 10 },
        { no: 2, title: "第2包", lines: 40 },
      ],
    },
  }
  it("限定单包时大纲 prompt 含范围约束文案", () => {
    const msgs = buildBidOutlineMessages("项目", "医院", report, false, 2, undefined, {})
    const joined = msgs.map((m) => m.content).join("\n")
    expect(joined).toContain("本次仅投标第 1 包")
    expect(joined).toContain("【标包划分（多包件招标）】")
  })
  it("全选时不注入约束（与现状一致）", () => {
    const allReport: ParseReport = { ...report, lots_scope: { selected: [1, 2], all: report.lots_scope!.all } }
    const msgs = buildBidOutlineMessages("项目", "医院", allReport, false, 2, undefined, {})
    const joined = msgs.map((m) => m.content).join("\n")
    expect(joined).not.toContain("本次仅投标第")
    expect(joined).toContain("【标包划分（多包件招标）】")
  })
})
