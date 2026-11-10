// 标书检查 屏内 Tab 的口径常量（UX-v2：prototype/check/ 四屏）。
//
// 拆法与模型配置 / 素材库 / 方案工作室同款：一个顶层路由 + ?tab= 切换，不拆顶层路由。
// 原「检查结果 / 规则清单」双 Tab → 四个屏：新建检查（对象+模式+规则开关）/ 检查中 /
// 检查报告（三栏阅读 + 导出）/ 历史报告（本机摘要；完整报告属当次会话，如实标注）。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type BidCheckTab = "upload" | "running" | "report" | "history"

/** 顺序即 Tab 顺序，与原型 manifest 的 check 模块四屏一致 */
export const BID_CHECK_TABS: { key: BidCheckTab; label: string; hint: string }[] = [
  { key: "upload", label: "新建检查", hint: "选对象与模式，调整规则开关后开跑" },
  { key: "running", label: "检查中", hint: "本机执行 · 文件不出门" },
  { key: "report", label: "检查报告", hint: "三栏阅读 + Excel/HTML/Word 四件套导出" },
  { key: "history", label: "历史报告", hint: "本机摘要留痕；完整报告属当次会话" },
]

/**
 * 解析 ?tab=；非法/缺省返回 null，由调用方按会话状态派生当前屏
 * （running→检查中、有结果→检查报告、否则新建检查；保持旧链接行为）。
 */
export function parseBidCheckTab(raw: string | null): BidCheckTab | null {
  return raw === "upload" || raw === "running" || raw === "report" || raw === "history" ? raw : null
}

/** Tab → 地址参数（地址形状；默认屏不带参数由调用方决定） */
export function bidCheckTabHref(tab: BidCheckTab): string {
  return tab === "upload" ? "/bid-check" : `/bid-check?tab=${tab}`
}
