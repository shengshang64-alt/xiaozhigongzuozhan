import { describe, expect, it } from "vitest"
import {
  buildParseNotices,
  countStarClauseLines,
  defaultParsePanelUi,
  parseHealthVerdict,
  pickParseGroup,
} from "./parseReportLayout"

describe("解析报告首屏分组", () => {
  it("必选项失败时先打开解析项明细，即使同时有风险和废标约束", () => {
    expect(
      pickParseGroup({
        requiredFailureCount: 2,
        riskRed: 3,
        implicitVoid: 4,
        paramNeedsAttention: true,
      }),
    ).toBe("items")
  })

  it("没有必选失败、但有红线风险时打开风险与合规", () => {
    expect(
      pickParseGroup({
        requiredFailureCount: 0,
        riskRed: 1,
        implicitVoid: 4,
        paramNeedsAttention: true,
      }),
    ).toBe("risk")
  })

  it("只有会废标的硬约束时打开重点条款", () => {
    expect(
      pickParseGroup({
        requiredFailureCount: 0,
        riskRed: 0,
        implicitVoid: 2,
        paramNeedsAttention: false,
      }),
    ).toBe("clauses")
  })

  it("参数已判定为放弃或谨慎时打开清单", () => {
    expect(
      pickParseGroup({
        requiredFailureCount: 0,
        riskRed: 0,
        implicitVoid: 0,
        paramNeedsAttention: true,
      }),
    ).toBe("lists")
  })

  it("都正常时回到解析项明细，方便核对摘要", () => {
    expect(
      pickParseGroup({
        requiredFailureCount: 0,
        riskRed: 0,
        implicitVoid: 0,
        paramNeedsAttention: false,
      }),
    ).toBe("items")
  })

  it("必选项失败时默认落到逐项，并选中第一项失败", () => {
    const ui = defaultParsePanelUi({
      stamp: "s",
      requiredFailureKey: "qualification",
      requiredFailureCount: 1,
      riskRed: 0,
      implicitVoid: 0,
      paramNeedsAttention: false,
    })
    expect(ui.view).toBe("detail")
    expect(ui.selectedKey).toBe("qualification")
    expect(ui.group).toBe("items")
  })
})

describe("解析提示合并", () => {
  it("扫描件单独标成危险，覆盖率偏低仍只是参考", () => {
    const notices = buildParseNotices({
      warningHeadline: "技术评分这一段没有完整读到",
      truncation: { keptChars: 1200, droppedChars: 300, fromLine: 40 },
      quality: "suspect_scanned",
      coveragePct: 12,
      coverageLow: true,
    })
    expect(notices.map((n) => n.id)).toEqual(["warnings", "truncation", "quality", "coverage"])
    expect(notices.find((n) => n.id === "quality")?.tone).toBe("danger")
    expect(notices.find((n) => n.id === "coverage")?.title).toContain("12%")
    expect(notices.find((n) => n.id === "coverage")?.detail).toContain("不阻断")
    expect(notices.find((n) => n.id === "warnings")?.title).toBe("技术评分这一段没有完整读到")
  })

  it("质量正常且没有其它提示时不产横幅", () => {
    expect(
      buildParseNotices({
        warningHeadline: null,
        truncation: null,
        quality: "ok",
        coveragePct: 80,
        coverageLow: false,
      }),
    ).toEqual([])
  })
})

describe("健康概览文案", () => {
  it("点名失败的必选项", () => {
    const v = parseHealthVerdict({ requiredTitles: ["资格性审查", "符合性检查"], pendingCount: 2 })
    expect(v.title).toContain("2")
    expect(v.detail).toContain("资格性审查")
  })

  it("必选项通过且没有待处理项时告诉用户可以进入编制", () => {
    const v = parseHealthVerdict({ requiredTitles: [], pendingCount: 0 })
    expect(v.title).toContain("已经解析通过")
  })
})

describe("重点条款计数", () => {
  it("空内容是 0，普通分行按行计，截断说明行不另算", () => {
    expect(countStarClauseLines("")).toBe(0)
    expect(countStarClauseLines("★1 培训服务\n▲2 接口")).toBe(2)
    expect(countStarClauseLines("★1 培训\n…另有 3 条未列出")).toBe(200)
  })
})
