// Author: loop-R185
// 回归锁：全局错误 toast 的「复制」动作必须走 R111 剪贴板唯一入口（copyTextToClipboard），
// 不再直连 navigator.clipboard.writeText——后者在内网 http 非安全上下文为 undefined 会抛错，
// 且其 promise rejection 逃逸会再触发 unhandledrejection 造成错误 toast 递归。
import { beforeEach, describe, expect, it, vi } from "vitest"

// 延迟解引用（沿用 clipboard.test.ts 既有可行模式：factory 内箭头体在调用时才读外层 const）
const copyImpl = vi.fn().mockResolvedValue(true)
vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: (...a: unknown[]) => copyImpl(...a),
}))

const errImpl = vi.fn()
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => errImpl(...a), success: vi.fn() },
}))

import { registerGlobalErrorCatch } from "./globalErrorCatch"

type Handlers = Record<string, (e: { reason?: unknown; error?: Error }) => void>

let handlers: Handlers

beforeEach(() => {
  errImpl.mockClear()
  copyImpl.mockClear()
  handlers = {}
  vi.stubGlobal("window", {
    addEventListener: (type: string, cb: (e: { reason?: unknown; error?: Error }) => void) => {
      handlers[type] = cb
    },
  })
})

function lastToastAction() {
  const call = errImpl.mock.calls[errImpl.mock.calls.length - 1]
  return call?.[1]?.action as { label: string; onClick: () => void } | undefined
}

describe("globalErrorCatch 复制动作走剪贴板唯一入口", () => {
  it("unhandledrejection 的复制 action 调用 copyTextToClipboard，绝不直连 navigator.clipboard", () => {
    const directWrite = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText: directWrite } })
    registerGlobalErrorCatch()
    handlers["unhandledrejection"]({ reason: new Error("上传标书附件失败") })

    expect(errImpl).toHaveBeenCalledTimes(1)
    expect(String(errImpl.mock.calls[0][0])).toContain("上传标书附件失败")
    const action = lastToastAction()
    expect(action?.label).toBe("复制")
    action!.onClick()
    expect(copyImpl).toHaveBeenCalledTimes(1)
    expect(copyImpl).toHaveBeenCalledWith("上传标书附件失败", { successMessage: "已复制" })
    expect(directWrite).not.toHaveBeenCalled()
  })

  it("非安全上下文（navigator.clipboard 缺失）点击复制不再抛错", () => {
    vi.stubGlobal("navigator", {})
    registerGlobalErrorCatch()
    handlers["unhandledrejection"]({ reason: new Error("拉取情报源超时") })

    const action = lastToastAction()
    expect(() => action!.onClick()).not.toThrow()
    expect(copyImpl).toHaveBeenCalledWith("拉取情报源超时", { successMessage: "已复制" })
  })

  it("window.error 分支同样接入统一复制入口", () => {
    vi.stubGlobal("navigator", {})
    registerGlobalErrorCatch()
    handlers["error"]({ error: new Error("渲染方案预览崩溃") })

    const action = lastToastAction()
    action!.onClick()
    expect(copyImpl).toHaveBeenCalledWith("渲染方案预览崩溃", { successMessage: "已复制" })
  })

  it("可忽略错误（AbortError）不弹 toast、不接线复制", () => {
    registerGlobalErrorCatch()
    handlers["unhandledrejection"]({ reason: new Error("AbortError: 用户取消请求") })
    expect(errImpl).not.toHaveBeenCalled()
    expect(copyImpl).not.toHaveBeenCalled()
  })

  it("同消息 5s 内防抖：第二条被抑制", () => {
    vi.stubGlobal("navigator", {})
    registerGlobalErrorCatch()
    handlers["unhandledrejection"]({ reason: new Error("重复的抖动错误") })
    handlers["unhandledrejection"]({ reason: new Error("重复的抖动错误") })
    expect(errImpl).toHaveBeenCalledTimes(1)
  })
})
