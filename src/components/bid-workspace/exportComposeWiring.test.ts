// UX-v2 ⑦ 组卷导出接线守卫（prototype/bid/export.html 三栏 1:1）。
//
// 这一屏的风险不是「不好看」，是「看起来在配置导出、实际导出不按它出件」：
//   ① 版式设置必须写进 format_settings（导出真读的字段），不能只是本地 useState；
//   ② 组卷顺序必须是导出真正写入的章序（pickExportChapters），否则两处各说一套；
//   ③ 导出清单不能预填体积（未生成时无真值）。
import { sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

const SCREEN = sourceText("src/components/bid-workspace/ExportComposeScreen.tsx")
const MODEL = sourceText("src/pages/BidWorkspace/exportComposeModel.ts")
const PAGE = sourceText("src/pages/BidWorkspace/BidWorkspacePage.tsx")

describe("⑦ 组卷导出 · 三栏与原型一一对应", () => {
  it("左组卷顺序 / 中版式设置 / 右导出清单 三块都在", () => {
    expect(SCREEN).toContain("组卷顺序")
    expect(SCREEN).toContain("版式设置")
    expect(SCREEN).toContain("导出清单")
  })

  it("版式设置写 format_settings（导出真读），不是只改本地 state", () => {
    expect(SCREEN).toContain("onSetFormatSettings")
    expect(PAGE).toContain("onSetFormatSettings={p.setFormatSettingsPatch}")
  })

  it("组卷顺序取导出真正写入的章序（pickExportChapters），不另算一套", () => {
    expect(SCREEN).toContain("pickExportChapters")
  })

  it("导出清单不预填体积，并明说体积生成时才有", () => {
    expect(SCREEN).toContain("体积在生成时才产生，此处不预填")
    // 清单行里不得出现体积单位（注释里解释「为什么没有」不算渲染）
    expect(/>\s*\d+(?:\.\d+)?\s*(?:KB|MB|GB)\s*</.test(MODEL)).toBe(false)
    expect(/>\s*\d+(?:\.\d+)?\s*(?:KB|MB|GB)\s*</.test(SCREEN)).toBe(false)
  })

  it("原型「页眉/页脚内容」输入框不渲染（现网不可配置），改为说明固定文案", () => {
    expect(SCREEN).toContain("页眉/页脚文案现网固定")
    // 没有以「页眉内容 / 页脚内容」为标签的输入控件
    expect(/>页眉内容</.test(SCREEN)).toBe(false)
    expect(/>页脚内容</.test(SCREEN)).toBe(false)
  })

  it("全导出按钮在闸门未确认时禁用，并指明去哪确认", () => {
    expect(SCREEN).toContain("disabled={!canExportAll}")
    expect(SCREEN).toContain("交卷闸门未确认")
  })

  it("改章序的出口指向 ③ 大纲（不假装可拖拽）", () => {
    expect(SCREEN).toContain("去大纲调整顺序")
    expect(SCREEN).toContain("onRequestStep(3)")
  })

  it("既有归档/结果登记/快照/重置能力仍挂在第 7 步（不丢）", () => {
    expect(PAGE).toContain("<ExportComposeScreen")
    expect(PAGE).toContain("<ArchivePanel")
    expect(PAGE).toContain("exportBidWord={p.exportBidWord}")
    expect(PAGE).toContain("restoreSnapshot={p.restoreSnapshot}")
  })
})

describe("⑦ 组卷导出 · 铁律扫描", () => {
  it("不含原型演示数字（286.0 / 12.4 MB / 46 页 / 4.2 MB）", () => {
    for (const b of ["286.0", "12.4 MB", "46 页", "4.2 MB", "2.8 MB"]) {
      expect(SCREEN.includes(b)).toBe(false)
    }
  })

  it("不渲染原型的 .note 拆前/拆后说明条", () => {
    expect(SCREEN.includes("拆前")).toBe(false)
    expect(SCREEN.includes("拆后")).toBe(false)
  })
})
