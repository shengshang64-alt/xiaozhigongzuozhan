// 方案工作室 屏内 Tab 的口径常量（UX-v2：prototype/solution/ 四屏）。
//
// 拆法与模型配置 / 素材库同款：一个顶层路由 + ?tab= 在内容区切换，不拆顶层路由——
// 本应用是「扁平顶层路径 + 工作区标签保活」，拆成四条顶层路由会让标签栏多出四个
// 「方案工作室」标签，且 useSolutionStudio 的方案列表要各拉一遍。
//
// 单独成文件的两个理由（与 modelConfigTabs.ts 一致）：
//   · 组件文件只导出组件，Fast Refresh 才不会被非组件导出打断；
//   · Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言，不该从 tsx 里抠。

export type SolutionStudioTab = "list" | "editor" | "checklist" | "delivery"

/** 顺序即 Tab 顺序，与原型 manifest 的 solution 模块四屏一致（list → editor → checklist → delivery） */
export const SOLUTION_STUDIO_TABS: { key: SolutionStudioTab; label: string; hint: string }[] = [
  { key: "list", label: "方案列表", hint: "选方案、管方案；写正文去编辑器屏" },
  { key: "editor", label: "方案编辑器", hint: "左大纲与素材弹药 · 中正文 · 右需求覆盖" },
  { key: "checklist", label: "建设清单", hint: "立项阶段：系统选型与投资口径" },
  { key: "delivery", label: "交付检查", hint: "需求覆盖 / 事实接地 / 导出门禁" },
]

/** 解析 ?tab=；非法/缺省一律落「方案列表」（保持旧书签与旧链接行为不变） */
export function parseSolutionStudioTab(raw: string | null): SolutionStudioTab {
  return raw === "editor" || raw === "checklist" || raw === "delivery" || raw === "list" ? raw : "list"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function solutionStudioTabHref(tab: SolutionStudioTab): string {
  return tab === "list" ? "/solution-studio" : `/solution-studio?tab=${tab}`
}
