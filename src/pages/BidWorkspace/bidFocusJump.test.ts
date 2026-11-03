/** @vitest-environment jsdom */
// R-302：textarea 按字符偏移定位的单测（jsdom 环境，不影响全局 node 环境）

import { describe, expect, it } from "vitest"
import { jumpTextareaToOffset } from "./bidFocusJump"

function makeTextarea(value: string): HTMLTextAreaElement {
  const el = document.createElement("textarea")
  el.value = value
  document.body.appendChild(el)
  return el
}

describe("jumpTextareaToOffset（R-302 版式徽标跳转原语）", () => {
  it("正常偏移：选区落在 [offset, offset+hitLen) 且返回 true", () => {
    const el = makeTextarea("本项目实现医嘱闭环管理，系统支持每天 5000 人次预约。")
    const ok = jumpTextareaToOffset(el, 6, 4)
    expect(ok).toBe(true)
    expect(el.selectionStart).toBe(6)
    expect(el.selectionEnd).toBe(10)
  })

  it("空正文（含纯空白）→ false，且不动选区", () => {
    const empty = makeTextarea("")
    expect(jumpTextareaToOffset(empty, 3, 2)).toBe(false)
    const blank = makeTextarea("   \n  ")
    expect(jumpTextareaToOffset(blank, 1, 1)).toBe(false)
  })

  it("偏移越界自动 clamp 到正文末尾（不抛错、不越界选中）", () => {
    const el = makeTextarea("短正文内容")
    const ok = jumpTextareaToOffset(el, 9999, 3)
    expect(ok).toBe(true)
    expect(el.selectionStart).toBe(5)
    expect(el.selectionEnd).toBe(5)
  })

  it("负偏移 clamp 到 0", () => {
    const el = makeTextarea("本项目实现医嘱闭环管理，覆盖门诊与住院。")
    expect(jumpTextareaToOffset(el, -5, 2)).toBe(true)
    expect(el.selectionStart).toBe(0)
    expect(el.selectionEnd).toBe(2)
  })

  it("hitLen ≤ 0 时至少选中 1 个字符（否则用户看不到落点）", () => {
    const el = makeTextarea("本项目实现医嘱闭环管理，覆盖门诊与住院。")
    expect(jumpTextareaToOffset(el, 4, 0)).toBe(true)
    expect(el.selectionEnd - el.selectionStart).toBe(1)
    expect(jumpTextareaToOffset(el, 4, -3)).toBe(true)
    expect(el.selectionEnd - el.selectionStart).toBe(1)
  })

  it("hitLen 超出剩余长度时 end 收敛到正文末尾", () => {
    const el = makeTextarea("医嘱闭环")
    expect(jumpTextareaToOffset(el, 2, 999)).toBe(true)
    expect(el.selectionStart).toBe(2)
    expect(el.selectionEnd).toBe(4)
  })

  it("offset=0（缺表类命中无具体字符位置）也能安全定位", () => {
    const el = makeTextarea("参数响应表尚未生成，本节以文字描述响应情况。")
    expect(jumpTextareaToOffset(el, 0, 1)).toBe(true)
    expect(el.selectionStart).toBe(0)
    expect(el.selectionEnd).toBe(1)
  })

  it("滚动位置为有限非负数（textarea 无按行滚动 API，按比例估算）", () => {
    const el = makeTextarea("x".repeat(5000))
    jumpTextareaToOffset(el, 2500, 3)
    expect(Number.isFinite(el.scrollTop)).toBe(true)
    expect(el.scrollTop).toBeGreaterThanOrEqual(0)
  })
})
