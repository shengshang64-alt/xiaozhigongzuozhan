import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const success = vi.fn()
const error = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => success(m),
    error: (m: string) => error(m),
  },
}))

import { copyTextToClipboard } from "./clipboard"

function makeTextareaStub() {
  return {
    value: "",
    style: {} as Record<string, string>,
    setAttribute() {},
    select() {},
    remove() {},
  }
}

function stubDocument(execCommand: () => boolean) {
  const ta = makeTextareaStub()
  vi.stubGlobal("document", {
    createElement: () => ta,
    body: { appendChild: vi.fn() },
    execCommand,
  })
  return ta
}

beforeEach(() => {
  success.mockClear()
  error.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("copyTextToClipboard", () => {
  it("走 Clipboard API 成功：返回 true、成功 Toast、触发 onSuccess", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const onSuccess = vi.fn()
    const ok = await copyTextToClipboard("hi", { successMessage: "已复制", onSuccess })
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hi")
    expect(success).toHaveBeenCalledWith("已复制")
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it("无 successMessage 时不弹成功 Toast（QaDrawer 仅状态反馈口径）", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const ok = await copyTextToClipboard("hi", {})
    expect(ok).toBe(true)
    expect(success).not.toHaveBeenCalled()
  })

  it("Clipboard API 缺失时回退 execCommand 成功", async () => {
    vi.stubGlobal("navigator", {})
    const execCommand = vi.fn(() => true)
    stubDocument(execCommand)
    const ok = await copyTextToClipboard("hi", { successMessage: "已复制" })
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(success).toHaveBeenCalledWith("已复制")
  })

  it("Clipboard API 抛错时回退 execCommand", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    const execCommand = vi.fn(() => true)
    stubDocument(execCommand)
    const ok = await copyTextToClipboard("hi", { successMessage: "已复制" })
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("两路都失败：返回 false、弹默认错误文案、不触发 onSuccess", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    stubDocument(() => false)
    const onSuccess = vi.fn()
    const ok = await copyTextToClipboard("hi", { successMessage: "已复制", onSuccess })
    expect(ok).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain("复制失败")
    expect(success).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("自定义 errorMessage 覆盖默认文案", async () => {
    vi.stubGlobal("navigator", {})
    stubDocument(() => false)
    const ok = await copyTextToClipboard("hi", { errorMessage: "复制失败，请检查浏览器剪贴板权限" })
    expect(ok).toBe(false)
    expect(error).toHaveBeenCalledWith("复制失败，请检查浏览器剪贴板权限")
  })
})
