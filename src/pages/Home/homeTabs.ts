// 工作台总览 屏内 Tab 的口径常量（UX-v2：prototype/home/ 四屏）。
//
// 拆法与模型配置 / 素材库 / 方案工作室同款：一个顶层路由（/）+ ?tab= 切换，不拆顶层路由——
// 原首页 14 个区块竖排约 2958px（滚 4 屏），拆后总览只回答「今天该干什么」，
// 待办/节点/复盘各自成屏（UX-v2 §home）。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type HomeTab = "overview" | "todos" | "calendar" | "review"

/** 顺序即 Tab 顺序，与原型 manifest 的 home 模块四屏一致 */
export const HOME_TABS: { key: HomeTab; label: string; hint: string }[] = [
  { key: "overview", label: "总览", hint: "今天必须处理什么 · 卡在哪 · 下一步点哪里" },
  { key: "todos", label: "待办中心", hint: "全部待办分桶管理，完成 / 新增都在这" },
  { key: "calendar", label: "投标节点", hint: "未来 60 天开标 / 截标节点与补录提示" },
  { key: "review", label: "投标复盘", hint: "有真结果才出漏斗与归因，不造中标率" },
]

/** 解析 ?tab=；非法/缺省一律落「总览」（保持旧书签与旧链接行为不变） */
export function parseHomeTab(raw: string | null): HomeTab {
  return raw === "todos" || raw === "calendar" || raw === "review" || raw === "overview" ? raw : "overview"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function homeTabHref(tab: HomeTab): string {
  return tab === "overview" ? "/" : `/?tab=${tab}`
}
