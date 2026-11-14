// 知识库 屏内 Tab 的口径常量（UX-v2：prototype/kb/ 六屏）。
//
// 拆法与客户管理 / 模型配置 / 素材库 / 方案工作室 / 工作台同款：
// 一个顶层路由 + ?tab= 切换，不拆顶层路由——拆成六条顶层路由会让工作区标签栏
// 多出六个「知识库」标签，且 useKnowledge 的 7000 篇文档列表要各拉一遍。
//
// 单独成文件的理由与 customerTabs.ts / materialTabs.ts 一致：
// 组件文件只导出组件（react-refresh 规则），Tab 顺序与屏名是「1:1 对齐原型 manifest」
// 的口径，测试要能直接断言（kbTabs.test.ts）。
//
// 文案逐字取自 docs/ux-v2-2026-11/prototype/assets/manifest.js 的 kb 模块 tab 字段：
//   文档库 / 全文检索 / 知识原子 / 原子审核 / 问知识库 / 上传文档

export type KbTab = "browse" | "search" | "atoms" | "review" | "qa" | "upload"

/** 顺序即 Tab 顺序，与原型 manifest 的 kb 模块六屏一致 */
export const KB_TABS: { key: KbTab; label: string; hint: string }[] = [
  { key: "browse", label: "文档库", hint: "一个搜索入口找文档，目录树看结构" },
  { key: "search", label: "全文检索", hint: "一个框搜到底，结果按标题命中 / 正文命中分组" },
  { key: "atoms", label: "知识原子", hint: "可被方案 / 标书直接引用的最小事实单元" },
  { key: "review", label: "原子审核", hint: "逐条判「留 / 改 / 丢」，必须先勾适用场景" },
  { key: "qa", label: "问知识库", hint: "答案带来源编号，检索过程摊开给你看" },
  { key: "upload", label: "上传文档", hint: "上传即建索引，解析到哪一步都看得见" },
]

/** 解析 ?tab=；非法/缺省一律落「文档库」（保持旧书签与旧链接行为不变） */
export function parseKbTab(raw: string | null): KbTab {
  return raw === "search" || raw === "atoms" || raw === "review" || raw === "qa" || raw === "upload" || raw === "browse"
    ? raw
    : "browse"
}

/** Tab → 地址参数（默认 Tab 不带参数，地址栏干净） */
export function kbTabHref(tab: KbTab): string {
  return tab === "browse" ? "/knowledge" : `/knowledge?tab=${tab}`
}
