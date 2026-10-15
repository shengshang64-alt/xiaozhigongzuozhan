/** @vitest-environment jsdom */
/**
 * 模型选择器的「不自动」口径网（用户裁定 2026-10-15）。
 *
 * 背景：模型档此前默认勾在「自动 · 按环节智能选择」上，由系统按环节挑模型；用户实测后要求
 * 「一本标书一个模型，别让系统替我换」。该档已从下拉移除，默认值改为用户显式选择（见
 * modelPrefs 的 xz_model_choice）与「上次成功用过的模型」。
 *
 * 本文件守两件事：
 *  ① 下拉里不再存在自动档哨兵项（防止有人顺手把它加回默认）；
 *  ② 只渲染传入的具体模型，选中项变化时如实回调（父层据此持久化"显式选择"）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { ModelSelect } from "./ModelSelect"
import type { ModelRef } from "@/lib/modelGateway"

function model(configId: string, modelId: string): ModelRef {
  return { source: "personal", configId, configName: `${configId} 配置`, modelId } as ModelRef
}

const MODELS = [model("opencode", "deepseek-v4-flash"), model("opencode", "glm-5.3")]

afterEach(() => cleanup())

describe("ModelSelect（自动档下线后）", () => {
  it("下拉里没有自动档哨兵项，只有传入的具体模型", () => {
    const { container } = render(<ModelSelect models={MODELS} valueKey="personal:opencode:deepseek-v4-flash" onChange={() => {}} />)

    const options = Array.from(container.querySelectorAll("option"))
    expect(options.length).toBe(MODELS.length)
    expect(options.some((o) => o.value === "__auto__")).toBe(false)
    expect(options.every((o) => o.value.startsWith("personal:"))).toBe(true)
    expect(container.textContent).not.toContain("按环节智能选择")
  })

  it("选中项如实回调（父层据此记住显式选择）", () => {
    const onChange = vi.fn()
    render(<ModelSelect models={MODELS} valueKey="personal:opencode:deepseek-v4-flash" onChange={onChange} />)

    const select = screen.getByLabelText("选择本次生成使用的模型") as HTMLSelectElement
    expect(select.value).toBe("personal:opencode:deepseek-v4-flash")

    const target = Array.from(select.options).find((o) => o.value === "personal:opencode:glm-5.3")
    expect(target).toBeTruthy()
    target!.selected = true
    select.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith("personal:opencode:glm-5.3")
  })
})
