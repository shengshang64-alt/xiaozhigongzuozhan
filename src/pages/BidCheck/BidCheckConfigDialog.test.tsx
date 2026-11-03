// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// BidCheckConfigDialog · 配置弹窗（R45）：只验证「本轮新增的两个控件是否真的接上了配置」，
// 不做像素级断言、不碰检查引擎。项目此前 0 个组件测试，这是第一张 UI 回归网（见 docs/19 P1-4）。
//
// 断言三件事：①弹窗打开即渲染（Radix Dialog 能被 jsdom 承载）；
//   ②新增「编号形式」三态下拉存在且改动会写进保存的 formatStandard.allowBulletNumbering；
//   ③选「内蒙古」预置会把地区条款里的项填进草稿（行距 → 固定28磅），未写到的项不覆盖。
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BidCheckConfigDialog } from "./BidCheckConfigDialog"
import { DEFAULT_ANBID_CONFIG, type AnbidCheckConfig } from "./config/anbidCheckConfig"
import { DEFAULT_CHECK_CONFIG } from "./config/checkConfig"

// Radix 在 jsdom 下缺少的几个浏览器 API（仅测试环境补齐，不进产物）
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// vitest 未开 globals:true → RTL 不会自动 cleanup，多例之间会互相看到对方的 DOM（首跑即踩中）
afterEach(cleanup)

function setup(anbid: AnbidCheckConfig = DEFAULT_ANBID_CONFIG) {
  const onSaveAnbid = vi.fn()
  const onSaveCheck = vi.fn()
  const onClose = vi.fn()
  render(
    <BidCheckConfigDialog
      open
      onClose={onClose}
      anbid={anbid}
      checkCfg={DEFAULT_CHECK_CONFIG}
      onSaveAnbid={onSaveAnbid}
      onSaveCheck={onSaveCheck}
    />,
  )
  return { onSaveAnbid, onSaveCheck, onClose }
}

describe("BidCheckConfigDialog", () => {
  it("打开即渲染：标题 + 新增的两个下拉存在", () => {
    setup()
    expect(screen.getByText(/检查配置（暗标词库/)).toBeTruthy()
    expect(screen.getByText("地区预置标准（一键填入，可再改）")).toBeTruthy()
    expect(screen.getByText("编号形式（暗标常用：禁用项目符号）")).toBeTruthy()
  })

  it("编号形式选「禁用项目符号」后会写进保存的 allowBulletNumbering", () => {
    const { onSaveAnbid } = setup()
    const selects = screen.getAllByRole("combobox")
    // 顺序：地区预置 / 是否允许页码 / 颜色要求 / 编号形式 / 是否单独成册
    const bullet = selects[3]
    fireEvent.change(bullet, { target: { value: "false" } })
    fireEvent.click(screen.getByText("保存配置"))
    expect(onSaveAnbid).toHaveBeenCalledTimes(1)
    expect(onSaveAnbid.mock.calls[0][0].formatStandard.allowBulletNumbering).toBe(false)
  })

  it("选「内蒙古」预置：把条款写到的项填进草稿，未写到的项保持 null", () => {
    const { onSaveAnbid } = setup()
    const preset = screen.getAllByRole("combobox")[0]
    fireEvent.change(preset, { target: { value: "neimenggu" } })
    fireEvent.click(screen.getByText("保存配置"))
    const std = onSaveAnbid.mock.calls[0][0].formatStandard
    expect(std.bodyFont).toBe("宋体")
    expect(std.bodySize).toBe("14pt")
    expect(std.lineSpacing).toBe("固定28磅")
    expect(std.allowPageNumber).toBe(false)
    expect(std.allowColor).toBe(false)
    expect(std.maxPages).toBeNull() // 原文未写页数上限 → 不编造
    expect(std.allowBulletNumbering).toBeNull() // 原文未写编号形式 → 不判定
  })
})
