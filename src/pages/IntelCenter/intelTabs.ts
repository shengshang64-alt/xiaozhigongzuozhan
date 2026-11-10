// 情报中心 屏内 Tab 的口径常量（UX-v2：prototype/intel/ 五屏）。
//
// 拆法与模型配置 / 素材库 / 方案工作室 / 工作台 / 客户管理同款：一个顶层路由 + ?tab=
// 切换，不拆顶层路由。原「待办/浏览」双模式 pill 升级为五 Tab：审阅 / 浏览 / 详情 /
// 行业前沿 / 数据源——行业前沿收编 /ai-hot（两处共用同一组件与数据，不再两个入口两套 UI），
// 数据源把散在右栏的信息源状态块收拢成独立屏。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type IntelTab = "review" | "browse" | "detail" | "industry" | "sources"

/** 顺序即 Tab 顺序，与原型 manifest 的 intel 模块五屏一致 */
export const INTEL_TABS: { key: IntelTab; label: string; hint: string }[] = [
  { key: "review", label: "审阅", hint: "待确认队列 + 审阅面板，处理完再走" },
  { key: "browse", label: "浏览", hint: "检索、筛选与表格比对历史情报" },
  { key: "detail", label: "详情", hint: "整屏阅读当前打开的这条情报" },
  { key: "industry", label: "行业前沿", hint: "AI 行业精选流，可转存回情报库" },
  { key: "sources", label: "数据源", hint: "源状态、抓取说明与管理入口" },
]

/** 解析 ?tab=；非法/缺省一律落「审阅」（保持旧书签与旧链接行为不变） */
export function parseIntelTab(raw: string | null): IntelTab {
  return raw === "browse" || raw === "detail" || raw === "industry" || raw === "sources" || raw === "review"
    ? raw
    : "review"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function intelTabHref(tab: IntelTab): string {
  return tab === "review" ? "/intel-center" : `/intel-center?tab=${tab}`
}
