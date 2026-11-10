// 模型配置 屏内 Tab 的口径常量（纯数据，无组件）。
//
// 单独成文件的两个理由：
//   · 组件文件只导出组件，Fast Refresh 才不会被非组件导出打断（react-refresh/only-export-components）；
//   · Tab 顺序与屏名是「1:1 对齐原型的口径」，测试要能直接断言，不该从 tsx 里抠。

export type ModelConfigTab = "channels" | "health" | "test"

/** 顺序即 Tab 顺序，与原型 manifest 的三屏一致 */
export const MODEL_CONFIG_TABS: { key: ModelConfigTab; label: string; hint: string }[] = [
  { key: "channels", label: "通道与默认", hint: "通道分组 + 默认模型链" },
  { key: "health", label: "健康看板", hint: "可用性 / 失败原因，按模型拆开看" },
  { key: "test", label: "连通测试", hint: "发一条固定消息，看通不通" },
]

/** 解析 ?tab=；非法/缺省一律落「通道与默认」（保持旧书签与旧链接行为不变） */
export function parseModelConfigTab(raw: string | null): ModelConfigTab {
  return raw === "health" || raw === "test" || raw === "channels" ? raw : "channels"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function modelConfigTabHref(tab: ModelConfigTab): string {
  return tab === "channels" ? "/model-config" : `/model-config?tab=${tab}`
}
