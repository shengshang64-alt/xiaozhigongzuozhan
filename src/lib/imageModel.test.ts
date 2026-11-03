import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * R56：生图默认设置的解析口径（账号覆盖 → 无全局默认 ＝ 未配置），以及脏值防护。
 * 2026-10-15：RunningHub 生图链下线后，未配置必须显式返回 null，不得回落到任何 RH 模型。
 */

const store = new Map<string, string>()
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

import { IMAGE_MODEL_CANDIDATES, clearImageModel, readImageModel, resolveImageModel, saveImageModel } from "./imageModel"

beforeEach(() => store.clear())

describe("resolveImageModel：默认设置", () => {
  it("未设置时没有可用默认——显式返回 null（未配置）", () => {
    expect(resolveImageModel("u1")).toBeNull()
    expect(resolveImageModel(null)).toBeNull()
  })

  it("账号级覆盖生效并可清除；账号之间互不影响", () => {
    saveImageModel("u1", "agnes-image-2.1-flash")
    expect(resolveImageModel("u1")).toEqual({ model: "agnes-image-2.1-flash", channel: "agnes" })
    expect(resolveImageModel("u2")).toBeNull()
    clearImageModel("u1")
    expect(readImageModel("u1")).toBeNull()
  })

  it("只接受候选清单内的模型名：脏值既不写入、读侧也不生效", () => {
    saveImageModel("u1", "some-random-model")
    expect(readImageModel("u1")).toBeNull()
    store.set("xz_image_model:u1", "evil-model")
    expect(resolveImageModel("u1")).toBeNull()
  })

  it("候选清单只剩自带配置的 agnes 三个模型；RunningHub 候选已随生图链下线移除", () => {
    expect(IMAGE_MODEL_CANDIDATES.length).toBe(3)
    expect(IMAGE_MODEL_CANDIDATES.every((c) => c.channel === "agnes")).toBe(true)
    expect(IMAGE_MODEL_CANDIDATES.every((c) => (c.note ?? "").includes("待确认"))).toBe(true)
    expect(IMAGE_MODEL_CANDIDATES.some((c) => c.model === "nano-banana-pro")).toBe(false)
  })
})
