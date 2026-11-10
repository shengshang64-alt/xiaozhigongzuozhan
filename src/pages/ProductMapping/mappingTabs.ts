// 产品映射 屏内 Tab 的口径常量（UX-v2：prototype/mapping/ 四屏）。
//
// 拆法与模型配置 / 素材库 / 方案工作室同款：一个顶层路由 + ?tab= 切换，不拆顶层路由。
// 原「左输入 / 右结果」同页向导 → 四个步骤屏：①选择清单 → ②对照 → ③结果 → 产品库
// （manifest 口径：公司库 / 记忆库 / 导入 ONE-LINK 合并为「产品库」一个资产页）。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type MappingTab = "upload" | "compare" | "result" | "library"

/** 顺序即 Tab 顺序，与原型 manifest 的 mapping 模块四屏一致（屏名逐字照抄 tab 字段） */
export const MAPPING_TABS: { key: MappingTab; label: string; hint: string }[] = [
  { key: "upload", label: "① 选择清单", hint: "上传业主清单 / 粘贴条目 / 关联招标采购清单" },
  { key: "compare", label: "② 对照", hint: "记忆库 → 离线规则自动对照，AI 语义兜底" },
  { key: "result", label: "③ 结果", hint: "覆盖视角 + 评级筛选 + 导出与保存" },
  { key: "library", label: "产品库", hint: "公司库 / 记忆库 / 导入 ONE-LINK 资产页" },
]

/** 解析 ?tab=；非法/缺省一律落「① 选择清单」（保持旧书签与旧链接行为不变） */
export function parseMappingTab(raw: string | null): MappingTab {
  return raw === "compare" || raw === "result" || raw === "library" || raw === "upload" ? raw : "upload"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function mappingTabHref(tab: MappingTab): string {
  return tab === "upload" ? "/product-mapping" : `/product-mapping?tab=${tab}`
}
