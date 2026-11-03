// 2026-10-23（P0-4 素材注入）：新项目默认开启，存量项目不受影响
// 背景：真实库 17 个有正文项目里 material_boost 开启数 0——知识库从未进过正文。
import { describe, expect, it } from "vitest"
import { defaultGenOptions, normalizeGenOptions } from "./bidTypes"

describe("生成开关默认值（P0-4）", () => {
  it("① 新建项目：素材注入与逐条应答强化默认开启", () => {
    const d = defaultGenOptions()
    expect(d.material_boost).toBe(true)
    expect(d.clause_response).toBe(true)
  })

  it("② 存量项目（存储中无该字段）保持关闭——不得因改默认而改变老项目下次生成的内容与费用", () => {
    const legacy = normalizeGenOptions({ scope: "both", include_biz: true })
    expect(legacy.material_boost).toBe(false)
  })

  it("③ 显式选择优先：用户手动关掉后，读回来仍是关", () => {
    expect(normalizeGenOptions({ material_boost: false }).material_boost).toBe(false)
    expect(normalizeGenOptions({ material_boost: true }).material_boost).toBe(true)
  })
})
