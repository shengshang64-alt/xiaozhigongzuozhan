// 素材库 屏内 Tab 的口径常量（UX-v2：prototype/material/ 四屏）。
//
// 单独成文件的理由与模型配置同：组件文件只导出组件（react-refresh 规则），
// 而 Tab 名称与顺序是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type MaterialTab = "overview" | "import" | "web" | "settings"

/** 顺序即 Tab 顺序，与原型 manifest 的 material 模块一致 */
export const MATERIAL_TABS: { key: MaterialTab; label: string; hint: string }[] = [
  { key: "overview", label: "素材总览", hint: "先看被引用多少次，再看分类与网格" },
  { key: "import", label: "导入", hint: "本地上传 · 去重 · 待分类" },
  { key: "web", label: "联网抓取", hint: "按场景词抓图，授权强制留档" },
  { key: "settings", label: "库设置", hint: "分类体系 / 存储 / 回收站 / Key" },
]

/** 解析 ?tab=；非法/缺省一律落「素材总览」（保持旧链接行为不变） */
export function parseMaterialTab(raw: string | null): MaterialTab {
  return raw === "import" || raw === "web" || raw === "settings" || raw === "overview" ? raw : "overview"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function materialTabHref(tab: MaterialTab): string {
  return tab === "overview" ? "/materials" : `/materials?tab=${tab}`
}
