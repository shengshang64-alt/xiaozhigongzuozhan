// P2-4（2026-10-24）：模型下拉的分组整备——实测 34 项平铺无搜索、不健康模型混排，
// 「额度耗尽」选项淹没在中间。原生 select 无法做搜索，本模块做两件零风险整备：
//   ① 个人模型按所属配置（供应商）细分为 optgroup，组间按名称排序；
//   ② 组内健康模型优先、挂账（额度耗尽/已下线/Key 失效）沉底并带后缀——配合
//      resolveAvailableModels 的默认模型健康感知（P0-3），首屏默认不再落在坏通道。
// 只动展示顺序，不增删选项、不禁用任何模型（用户仍可显式选中挂账模型，与 R296 口径一致）。
import type { ModelRef } from "@/lib/modelGateway"
import { modelRefLabel } from "@/lib/modelGateway"

export interface ModelOptionGroup {
  key: string
  label: string
  items: ModelRef[]
}

const labelOf = (m: ModelRef): string => modelRefLabel(m)

/**
 * 把平铺的模型列表整理为有序分组：
 *   - 平台内置一组（保持最前，本地自用域禁用逻辑由组件处理）；
 *   - 个人模型按 configId 分组（label 取 config_name），组间按名称排序；
 *   - 组内健康模型在前（label 排序），挂账模型沉底（label 排序）。
 */
export function groupModelOptions(
  models: ModelRef[],
  unhealthyKeys: ReadonlySet<string>,
): ModelOptionGroup[] {
  const platform: ModelRef[] = []
  const personalByConfig = new Map<string, { label: string; items: ModelRef[] }>()
  for (const m of models) {
    if (m.source === "platform") {
      platform.push(m)
      continue
    }
    // 组键取显示名（缺失回退「我的模型」）：同名配置合并为一组（选项本身仍按模型逐条渲染，
    // 与 configId 无关），避免出现两个同标签的 optgroup
    const label = m.configName?.trim() || "我的模型"
    let g = personalByConfig.get(label)
    if (!g) {
      g = { label, items: [] }
      personalByConfig.set(label, g)
    }
    g.items.push(m)
  }
  const sortItems = (a: ModelRef, b: ModelRef): number => {
    const ua = unhealthyKeys.has(`${a.source}:${a.configId}:${a.modelId}`) ? 1 : 0
    const ub = unhealthyKeys.has(`${b.source}:${b.configId}:${b.modelId}`) ? 1 : 0
    if (ua !== ub) return ua - ub
    return labelOf(a).localeCompare(labelOf(b), "zh-CN")
  }
  const groups: ModelOptionGroup[] = []
  if (platform.length) {
    groups.push({ key: "platform", label: "平台内置", items: [...platform].sort(sortItems) })
  }
  const personalGroups = [...personalByConfig.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label, "zh-CN"),
  )
  for (const [configId, g] of personalGroups) {
    groups.push({ key: `personal:${configId}`, label: g.label, items: [...g.items].sort(sortItems) })
  }
  return groups
}
