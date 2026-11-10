// 客户管理 屏内 Tab 的口径常量（UX-v2：prototype/customer/ 五屏）。
//
// 拆法与模型配置 / 素材库 / 方案工作室 / 工作台同款：一个顶层路由 + ?tab= 切换，
// 不拆顶层路由——拆成五条顶层路由会让工作区标签栏多出五个「客户管理」标签，
// 且 useCustomerManagement 的客户/商机列表要各拉一遍。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type CustomerTab = "list" | "detail" | "board" | "followup" | "import"

/** 顺序即 Tab 顺序，与原型 manifest 的 customer 模块五屏一致 */
export const CUSTOMER_TABS: { key: CustomerTab; label: string; hint: string }[] = [
  { key: "list", label: "客户列表", hint: "选客户、管档案；健康度与缺项一目了然" },
  { key: "detail", label: "客户详情", hint: "档案 / 联系人 / 商机 / 跟进时间线" },
  { key: "board", label: "商机看板", hint: "按阶段推进商机，丢单复盘同屏" },
  { key: "followup", label: "跟进队列", hint: "按未跟进时长分组，超期先唤醒" },
  { key: "import", label: "导入与体检", hint: "数据体检与批量补全入口" },
]

/** 解析 ?tab=；非法/缺省一律落「客户列表」（保持旧书签与旧链接行为不变） */
export function parseCustomerTab(raw: string | null): CustomerTab {
  return raw === "detail" || raw === "board" || raw === "followup" || raw === "import" || raw === "list"
    ? raw
    : "list"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function customerTabHref(tab: CustomerTab): string {
  return tab === "list" ? "/customer-management" : `/customer-management?tab=${tab}`
}
