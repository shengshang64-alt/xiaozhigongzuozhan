import { describe, expect, it } from "vitest"
import { INTEL_THREE_COLUMN_MIN_WIDTH, shouldScrollDetailIntoView } from "./detailScroll"

describe("情报详情滚动判定", () => {
  it("窄布局（两栏，详情在列表下方）→ 打开详情要滚过去", () => {
    expect(shouldScrollDetailIntoView(1024, true)).toBe(true)
    expect(shouldScrollDetailIntoView(1100, true)).toBe(true)
    expect(shouldScrollDetailIntoView(1279, true)).toBe(true)
  })

  it("三栏布局（详情已在右侧可见）→ 不滚，避免页面莫名跑动", () => {
    expect(shouldScrollDetailIntoView(INTEL_THREE_COLUMN_MIN_WIDTH, true)).toBe(false)
    expect(shouldScrollDetailIntoView(1440, true)).toBe(false)
    expect(shouldScrollDetailIntoView(1920, true)).toBe(false)
  })

  it("断点边界与 CSS xl 同源：1280 属于三栏", () => {
    expect(INTEL_THREE_COLUMN_MIN_WIDTH).toBe(1280)
    expect(shouldScrollDetailIntoView(1279, true)).toBe(true)
    expect(shouldScrollDetailIntoView(1280, true)).toBe(false)
  })

  it("没有详情时不滚（关闭详情 / 未选中）", () => {
    expect(shouldScrollDetailIntoView(1024, false)).toBe(false)
  })

  it("拿不到宽度（非浏览器环境）时不滚，宁可不动也不要乱跳", () => {
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldScrollDetailIntoView(w, true)).toBe(false)
    }
  })
})
