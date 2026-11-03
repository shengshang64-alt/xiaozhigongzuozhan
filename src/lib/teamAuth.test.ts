// R119：登出/切换账号必须失效该用户的本机缓存（知识库文档快照 + LLM 应答缓存）。
// 这两个缓存按登录用户 id 分库存于 IndexedDB，属 PHI 落盘；clearTeamSession 是
// logoutRhAccount / 401 失效 / 账号切换的唯一漏斗，本轮把清理接进这里。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const clearKbCache = vi.fn()
const clearLlmCache = vi.fn()
const dispatchEvent = vi.fn()

vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "http://127.0.0.1:8090" }))
vi.mock("@/lib/kbDocCache", () => ({
  clearKbCache: (uid: string | null) => clearKbCache(uid),
}))
vi.mock("@/lib/llmCache", () => ({
  clearLlmCache: (uid: string | null) => clearLlmCache(uid),
}))

import { clearTeamSession } from "./teamAuth"

const TOKEN_KEY = "xiaozhi-team-token"
const PROFILE_KEY = "xiaozhi-team-profile"

function seedProfile(id: string | null) {
  const store = new Map<string, string>()
  store.set(TOKEN_KEY, "t-1")
  if (id) {
    store.set(
      PROFILE_KEY,
      JSON.stringify({ id, email: "a@b.c", name: "甲", role: "admin", active: true }),
    )
  }
  return store
}

function stubStorage(store: Map<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
}

beforeEach(() => {
  clearKbCache.mockReset().mockResolvedValue(undefined)
  clearLlmCache.mockReset().mockResolvedValue(undefined)
  dispatchEvent.mockReset()
  vi.stubGlobal("window", { dispatchEvent })
  vi.stubGlobal("Event", class { type: string; constructor(t: string) { this.type = t } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("clearTeamSession 登出缓存失效接线（R119）", () => {
  it("已登录：清 token/profile、派发退回事件、按用户 id 失效双缓存", () => {
    const store = seedProfile("u42")
    stubStorage(store)

    clearTeamSession()

    expect(store.has(TOKEN_KEY)).toBe(false)
    expect(store.has(PROFILE_KEY)).toBe(false)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(clearKbCache).toHaveBeenCalledWith("u42")
    expect(clearLlmCache).toHaveBeenCalledWith("u42")
  })

  it("未登录（无档案）：不触发缓存清理，登出流程仍正常收尾", () => {
    const store = seedProfile(null)
    stubStorage(store)

    clearTeamSession()

    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(clearKbCache).not.toHaveBeenCalled()
    expect(clearLlmCache).not.toHaveBeenCalled()
  })

  it("缓存清理失败（fire-and-forget）：不抛错、不阻断登出", async () => {
    const store = seedProfile("u42")
    stubStorage(store)
    clearKbCache.mockRejectedValue(new Error("idb down"))

    expect(() => clearTeamSession()).not.toThrow()
    await Promise.resolve()

    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(store.has(PROFILE_KEY)).toBe(false)
  })

  it("档案损坏（JSON 解析失败）：按未登录处理，不误清缓存", () => {
    const store = new Map<string, string>()
    store.set(TOKEN_KEY, "t-1")
    store.set(PROFILE_KEY, "{broken")
    stubStorage(store)

    expect(() => clearTeamSession()).not.toThrow()
    expect(clearKbCache).not.toHaveBeenCalled()
    expect(clearLlmCache).not.toHaveBeenCalled()
  })
})
