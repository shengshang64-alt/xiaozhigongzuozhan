import { beforeEach, describe, expect, it, vi } from "vitest"

/** R56：生图默认设置的解析口径（账号覆盖 → 全局默认），以及脏值防护。 */

const store = new Map<string, string>()
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

import { IMAGE_MODEL_CANDIDATES, clearImageModel, readImageModel, resolveImageModel, saveImageModel } from "./imageModel"

beforeEach(() => store.clear())

describe("resolveImageModel：默认设置", () => {
  it("未设置时用全局默认 nano-banana-pro（保持既有行为不变）", () => {
    expect(resolveImageModel("u1")).toEqual({ model: "nano-banana-pro", channel: "runninghub" })
    expect(resolveImageModel(null).model).toBe("nano-banana-pro")
  })

  it("账号级覆盖生效并可清除；账号之间互不影响", () => {
    saveImageModel("u1", "agnes-image-2.1-flash")
    expect(resolveImageModel("u1")).toEqual({ model: "agnes-image-2.1-flash", channel: "agnes" })
    expect(resolveImageModel("u2").model).toBe("nano-banana-pro")
    clearImageModel("u1")
    expect(readImageModel("u1")).toBeNull()
  })

  it("只接受候选清单内的模型名：脏值既不写入、读侧也回退默认", () => {
    saveImageModel("u1", "some-random-model")
    expect(readImageModel("u1")).toBeNull()
    store.set("xz_image_model:u1", "evil-model")
    expect(resolveImageModel("u1").model).toBe("nano-banana-pro")
  })

  it("候选清单显式标注通道与待开通状态（agnes 图像权限未确认前不设默认）", () => {
    const agnes = IMAGE_MODEL_CANDIDATES.filter((c) => c.channel === "agnes")
    expect(agnes.length).toBe(3)
    expect(agnes.every((c) => (c.note ?? "").includes("待确认"))).toBe(true)
    expect(IMAGE_MODEL_CANDIDATES.find((c) => c.model === "nano-banana-pro")?.channel).toBe("runninghub")
  })
})
