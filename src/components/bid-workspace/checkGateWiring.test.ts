// UX-v2 ⑥ 交卷自查闸门总览接线守卫（prototype/bid/check.html 四闸门 + 问题清单）。
//
// 关键红线：**「没跑过」不能显示成「已通过」**。本仓为此专门加过 format_check_not_run 留痕，
// 这一屏如果再犯，用户会以为体检过了直接交卷。所以断三件事：
//   ① 闸门是三态（pass / fail / not_run），不是布尔；
//   ② 闸门 Tab 在 ⑥ 的第一个位置（打开就能看见能不能交卷）；
//   ③ 原七个 Tab 一个不少。
import { sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

const SCREEN = sourceText("src/components/bid-workspace/CheckGateOverview.tsx")
const MODEL = sourceText("src/pages/BidWorkspace/checkGateModel.ts")
const PAGE = sourceText("src/pages/BidWorkspace/BidWorkspacePage.tsx")

describe("⑥ 闸门总览 · 三态与红线", () => {
  it("闸门状态是三态，未运行有独立文案", () => {
    expect(MODEL).toContain('export type GateStatus = "pass" | "fail" | "not_run"')
    expect(MODEL).toContain('not_run: "未运行"')
  })

  it("allPass 只认 pass——未运行不算通过", () => {
    expect(MODEL).toContain("gates.every((g) => g.status === \"pass\")")
    expect(MODEL).toContain("hasNotRun")
  })

  it("format_check_not_run 留痕视为未运行，且不混进问题清单", () => {
    expect(MODEL).toContain('h.rule !== "format_check_not_run"')
    expect(MODEL).toContain("!rep.hits.some((h) => h.rule === \"format_check_not_run\")")
  })
})

describe("⑥ 闸门总览 · 四道闸门与原型对应", () => {
  it("废标项 / 一致性 / 暗标 / 格式 四道闸门都在", () => {
    // 闸门名与结论文案在模型层产出，屏只负责渲染——两处都要有
    ;["废标项闸门", "一致性闸门", "暗标闸门", "格式闸门"].forEach((label) => {
      expect(MODEL).toContain(label)
    })
    expect(SCREEN).toContain("gate.label")
  })

  it("问题清单含级别 / 类别 / 问题 / 位置 / 操作五列，按阻断→警告→提示排序", () => {
    expect(SCREEN).toContain("问题清单")
    expect(MODEL).toContain("const levelRank: Record<IssueLevel, number> = { block: 0, warn: 1, info: 2 }")
    expect(MODEL).toContain("block: \"阻断\"")
  })

  it("阻断横幅明说「当前不可导出」并指出去处理", () => {
    expect(SCREEN).toContain("当前不可导出")
  })
})

describe("⑥ 闸门总览 · 接线", () => {
  it("闸门总览是 ⑥ 的第一个 Tab（打开就能看见能不能交卷）", () => {
    expect(PAGE).toContain('{ key: "gates", label: "闸门总览"')
    const gatesAt = PAGE.indexOf('{ key: "gates", label: "闸门总览"')
    const dupAt = PAGE.indexOf('{ key: "dup", label: "标书查重"')
    expect(gatesAt).toBeGreaterThan(0)
    expect(dupAt).toBeGreaterThan(gatesAt)
  })

  it("⑥ 只保留交卷必过项四个 Tab", () => {
    ;["闸门总览", "标书查重", "废标检查", "合规检查"].forEach((label) => {
      expect(PAGE).toContain(`label: "${label}"`)
    })
    const step6 = PAGE.slice(PAGE.indexOf("{p.activeStep === 6 && ("), PAGE.indexOf("{p.activeStep === 7 && ("))
    ;["部门清单", "模拟评标", "报价测算", "答辩准备"].forEach((label) => {
      expect(step6).not.toContain(`label: "${label}"`)
    })
  })

  it("评标、报价、答辩、部门清单独立到模拟答辩工作面", () => {
    expect(PAGE).toContain("模拟答辩 / 开标准备")
    ;["部门清单", "模拟评标", "报价测算", "答辩准备"].forEach((label) => {
      expect(PAGE).toContain(`label: "${label}"`)
    })
  })

  it("「重新检查」走本地格式体检重算（零 AI 不扣费），不是 AI 体检", () => {
    expect(PAGE).toContain("onRunSubmissionCheck={() => p.refreshFormatReport()}")
  })
})

describe("⑥ 闸门总览 · 铁律扫描", () => {
  it("不含原型演示数字", () => {
    for (const b of ["286.0", "6.0 万", "5.0 万", "8,000", "8,500"]) {
      expect(SCREEN.includes(b)).toBe(false)
      expect(MODEL.includes(b)).toBe(false)
    }
  })

  it("不渲染原型的 .note 拆前/拆后说明条", () => {
    expect(SCREEN.includes("拆前")).toBe(false)
    expect(MODEL.includes("拆后")).toBe(false)
  })
})
