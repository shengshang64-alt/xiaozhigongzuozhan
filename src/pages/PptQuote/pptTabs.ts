// PPT 与报价 屏内 Tab 的口径常量（UX-v2：prototype/ppt/ 五屏）。
//
// 拆法与模型配置 / 素材库 / 方案工作室同款：一个顶层路由 + ?tab= 切换，不拆顶层路由。
// 原「汇报 PPT / 报价」两视图 ×（列表/详情）内层状态机 → 五个屏：汇报 PPT / PPT 编辑器 /
// 报价清单 / 报价编辑 / 报价单预览（预览为新增的只读屏：整单预览 + 导出，用印/发送记录
// 现网无此能力，不展示不伪造）。Tab 与 hook 的 activeView/deckMode/quoteMode 双向归位：
// URL 是地址栏口径，hook 状态仍是会话口径（列表↔编辑器切换由既有动作负责）。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type PptQuoteTab = "deck-list" | "deck-editor" | "quote-list" | "quote-editor" | "quote-preview"

/** 顺序即 Tab 顺序，与原型 manifest 的 ppt 模块五屏一致 */
export const PPT_QUOTE_TABS: { key: PptQuoteTab; label: string; hint: string }[] = [
  { key: "deck-list", label: "汇报 PPT", hint: "讲稿列表：新建、打开、删除" },
  { key: "deck-editor", label: "PPT 编辑器", hint: "逐页编辑 / AI 精修 / 模板与导出" },
  { key: "quote-list", label: "报价清单", hint: "报价单列表：新建、复制版本、打开" },
  { key: "quote-editor", label: "报价编辑", hint: "分组报价、产品带入与 AI 草稿" },
  { key: "quote-preview", label: "报价单预览", hint: "整单只读预览 + 导出 Excel / Word" },
]

/**
 * 解析 ?tab=；非法/缺省返回 null，由调用方回落到 hook 状态派生的当前屏
 * （保持旧链接行为：进页面落在 hook 的 activeView/deckMode/quoteMode 所在屏）。
 */
export function parsePptQuoteTab(raw: string | null): PptQuoteTab | null {
  return raw === "deck-list" || raw === "deck-editor" || raw === "quote-list" || raw === "quote-editor" || raw === "quote-preview"
    ? raw
    : null
}

/** Tab → 地址参数（默认屏不带参数由调用方决定；这里只给地址形状） */
export function pptQuoteTabHref(tab: PptQuoteTab): string {
  return tab === "deck-list" ? "/ppt-quote" : `/ppt-quote?tab=${tab}`
}
