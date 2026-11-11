// UX-v2 ② 解析确认接线守卫（prototype/bid/parse.html 1:1）。
//
// 这一屏的退化方式很隐蔽：卡片还在、数字没了（或反过来），页面照样能打开，用户看到的是
// 一屏「都通过」的假象。所以断在源码上——每一条都对应原型里的一个块：
//   .ph / .grid.g4 / .split--l-wide（评分分布 + 解析目录 / 解析质量 + 废标条款表）
// 另外锁两条纪律：① 示例数字禁入代码默认值（486/1284/98.7% 等）；
// ② 原型的 .note 拆前/拆后条不渲染。
import { sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

const SCREEN = sourceText("src/components/bid-workspace/ParseConfirmScreen.tsx")
const MODEL = sourceText("src/pages/BidWorkspace/parseConfirmModel.ts")
const PAGE = sourceText("src/pages/BidWorkspace/BidWorkspacePage.tsx")

describe("② 解析确认 · 版式块与原型一一对应", () => {
  it("四类结果卡：废标项 / 评分办法 / 技术参数 / 时间节点", () => {
    ;["废标项", "评分办法", "技术参数", "时间节点"].forEach((label) => {
      expect(MODEL).toContain(`label: "${label}"`)
    })
  })

  it("左栏评分分布 + 解析目录，右栏解析质量 + 废标条款表", () => {
    expect(SCREEN).toContain("评分办法分布")
    expect(SCREEN).toContain("解析目录")
    expect(SCREEN).toContain("解析质量")
    expect(SCREEN).toContain("废标条款")
  })

  it("未确认不可进 ③：主按钮在 pendingCount>0 时禁用，且按钮旁常驻待确认条数", () => {
    expect(SCREEN).toContain("确认解析结果，进入大纲编制")
    expect(SCREEN).toContain("disabled={!canContinue || archived}")
    expect(SCREEN).toContain("还有 {model.pendingCount} 条废标条款待确认")
  })

  it("逐条确认与「条款覆盖矩阵」共用同一份存储，不各存一套", () => {
    expect(SCREEN).toContain("complianceProgressSnapshot")
    expect(SCREEN).toContain("writeComplianceProgress")
    expect(SCREEN).toContain("subscribeComplianceProgress")
    // 不再自己拿一份 useState 存进度（否则两处互改会互相覆盖）
    expect(SCREEN.includes("useState<ComplianceProgressMap>")).toBe(false)
  })

  it("解析目录点条目 → 下方解析明细定位到该分区（能力不丢）", () => {
    expect(SCREEN).toContain("onFocusItem")
    expect(PAGE).toContain("onFocusItem={(key) => setParseFocus")
    expect(PAGE).toContain("focusItem={parseFocus}")
    expect(sourceText("src/components/bid-workspace/ParseReportPanel.tsx")).toContain("focusItem")
  })

  it("无真值时不写 0：主数字空则由 UI 渲染「—」", () => {
    expect(MODEL).toContain("value: rows.length || null")
    expect(SCREEN).toContain('{card.value ?? "—"}')
  })

  it("页码可回溯如实写「未接入」，不假装每条都带页码", () => {
    expect(MODEL).toContain('value: "未接入"')
    expect(MODEL).toContain("页码未落库")
  })
})

describe("② 解析确认 · 铁律扫描", () => {
  it("不含原型示例数字（486 / 1284 / 98.7% / ¥186.4 / 32,480 / 3 条废标风险）", () => {
    const banned = ["486", "1284", "98.7", "186.4", "32,480", "32480"]
    for (const b of banned) {
      expect(SCREEN.includes(b)).toBe(false)
      expect(MODEL.includes(b)).toBe(false)
    }
  })

  it("不渲染原型的 .note 拆前/拆后说明条", () => {
    expect(SCREEN.includes("拆前")).toBe(false)
    expect(SCREEN.includes("拆后")).toBe(false)
  })

  it("不把原型里那句耗时演示值当数据渲染（本仓无该落库字段）", () => {
    // 源码注释里会解释「为什么不显示」，所以只断「渲染成文本」与「演示数值」两件事
    expect(SCREEN.includes(">解析耗时")).toBe(false)
    expect(SCREEN.includes("86 秒")).toBe(false)
    expect(MODEL.includes("86 秒")).toBe(false)
  })
})
