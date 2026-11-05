/** @vitest-environment jsdom */
/**
 * 阶段 1 · 包 1（AI 可靠性）第 ④ 条：**未配置任何模型时，UI 不得把不存在的模型当推荐**。
 *
 * 缺陷形态（实测）：模型下拉在 `models.length === 0` 时仍渲染
 * `<option>平台内置 gpt-5.5</option>`，且 `selectedLabel` 同样回落成「平台内置 gpt-5.5」。
 * 于是「一条通道都没配」的用户看到的界面是「你已经有一个平台内置模型可用」——
 * 点下去必然失败（本地部署下平台内置缺 RunningHub 登录态，恒 412），
 * 而失败文案与真实原因（根本没配置）对不上，用户无从自查。
 *
 * 口径：没有可用模型就如实说没有，并给一条**可执行**的下一步（去模型配置），
 * 下拉禁用（没有可选项可选），绝不渲染任何「看起来可用」的假模型。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { MemoryRouter } from "react-router-dom"
import { ModelSelect, NO_MODEL_CONFIGURED_TEXT } from "./ModelSelect"
import type { ModelRef } from "@/lib/modelGateway"

vi.mock("@/lib/rhLogin", () => ({
  decodeRhToken: () => null,
  isLocalDeployHost: () => true,
}))
vi.mock("@/lib/modelHealth", () => ({
  healthNotice: () => "",
  healthShortLabel: () => "",
  onHealthChange: () => () => {},
  readModelHealth: () => ({}),
}))

const MODELS: ModelRef[] = [
  { source: "personal", configId: "c1", configName: "我的通道", modelId: "deepseek-v4-flash" } as ModelRef,
]

afterEach(() => cleanup())

describe("未配置模型：不推荐未配置的模型", () => {
  it("models 为空 → 如实说「未配置」，下拉禁用，不出现「平台内置 gpt-5.5」", () => {
    const { container } = render(
      <MemoryRouter>
        <ModelSelect models={[]} valueKey="" onChange={() => {}} />
      </MemoryRouter>,
    )
    const select = screen.getByLabelText("选择本次生成使用的模型") as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(container.textContent).not.toContain("平台内置")
    expect(container.textContent).not.toContain("gpt-5.5")
    expect(container.textContent).toContain(NO_MODEL_CONFIGURED_TEXT)
  })

  it("空态给一条可执行的下一步（去模型配置）", () => {
    const { getByText } = render(
      <MemoryRouter>
        <ModelSelect models={[]} valueKey="" onChange={() => {}} />
      </MemoryRouter>,
    )
    const link = getByText("去配置").closest("a")
    expect(link).toBeTruthy()
    expect(link?.getAttribute("href")).toBe("/model-config")
  })

  it("有已配置模型时行为不变：可选、不出现空态文案", () => {
    const { container } = render(
      <MemoryRouter>
        <ModelSelect models={MODELS} valueKey="personal:c1:deepseek-v4-flash" onChange={() => {}} />
      </MemoryRouter>,
    )
    const select = screen.getByLabelText("选择本次生成使用的模型") as HTMLSelectElement
    expect(select.disabled).toBe(false)
    expect(container.textContent).not.toContain(NO_MODEL_CONFIGURED_TEXT)
    expect(container.textContent).toContain("deepseek-v4-flash")
  })
})
