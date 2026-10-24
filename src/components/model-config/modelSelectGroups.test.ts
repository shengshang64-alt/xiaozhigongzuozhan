// P2-4：模型下拉分组整备纯函数的单元测试。
import { describe, expect, it } from "vitest"
import { groupModelOptions } from "./modelSelectGroups"
import type { ModelRef } from "@/lib/modelGateway"

function ref(source: "platform" | "personal", configId: string, configName: string, modelId: string): ModelRef {
  return { source, configId, configName, modelId }
}

describe("groupModelOptions（P2-4）", () => {
  it("平台内置组在最前，个人模型按供应商（配置名）分组且组间按名称排序", () => {
    const groups = groupModelOptions(
      [
        ref("personal", "c2", "智业大模型", "m1"),
        ref("platform", "p0", "平台", "gpt-5.5"),
        ref("personal", "c1", "百灵", "Ling"),
        ref("personal", "c2", "智业大模型", "m2"),
      ],
      new Set(),
    )
    expect(groups.map((g) => g.label)).toEqual(["平台内置", "百灵", "智业大模型"])
    expect(groups[0].items.map((m) => m.modelId)).toEqual(["gpt-5.5"])
    expect(groups[2].items.map((m) => m.modelId)).toEqual(["m1", "m2"])
  })

  it("组内健康模型在前、挂账模型沉底（各自再按名称排）", () => {
    const unhealthy = new Set(["personal:c1:bailing-bad"])
    const groups = groupModelOptions(
      [
        ref("personal", "c1", "百灵", "bailing-ok2"),
        ref("personal", "c1", "百灵", "bailing-bad"),
        ref("personal", "c1", "百灵", "bailing-ok1"),
      ],
      unhealthy,
    )
    expect(groups[0].items.map((m) => m.modelId)).toEqual(["bailing-ok1", "bailing-ok2", "bailing-bad"])
  })

  it("configName 缺失回退「我的模型」；configId 缺失并入 default 组", () => {
    const groups = groupModelOptions(
      [
        { source: "personal", configId: "", configName: "", modelId: "x" },
        { source: "personal", configId: "c1", configName: "", modelId: "y" },
      ],
      new Set(),
    )
    expect(groups.map((g) => g.label)).toEqual(["我的模型"])
    expect(groups[0].items).toHaveLength(2)
  })

  it("空列表返回空分组", () => {
    expect(groupModelOptions([], new Set())).toEqual([])
  })
})
