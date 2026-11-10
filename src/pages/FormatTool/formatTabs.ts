// 格式刷新 屏内 Tab 的口径常量（UX-v2：prototype/format/ 两屏）。
//
// 拆法与全站同款：一个顶层路由 + ?tab= 切换。原四步向导条（选文档/选模板/对比/保存）
// 按原型收成两屏：①上传与模板（文档 + 模板 + 刷新范围 + 本机处理说明）
// ②预览套用（左右对照 + 差异清单 + 套用与导出 + 高级微调）。
// 「只改格式不改文字」的既有逻辑一字不动。
//
// 单独成文件的理由与 modelConfigTabs.ts 一致：组件文件只导出组件（react-refresh 规则），
// Tab 顺序与屏名是「1:1 对齐原型 manifest」的口径，测试要能直接断言。

export type FormatTab = "upload" | "preview"

/** 顺序即 Tab 顺序，与原型 manifest 的 format 模块两屏一致 */
export const FORMAT_TABS: { key: FormatTab; label: string; hint: string }[] = [
  { key: "upload", label: "① 上传与模板", hint: "要刷新的文档 + 公司标准模板 + 刷新范围" },
  { key: "preview", label: "② 预览套用", hint: "左右对照差异清单，套用与导出在本机完成" },
]

/**
 * 解析 ?tab=；非法/缺省返回 null，由调用方按会话派生当前屏
 * （已有文档/方案 → 预览套用，否则上传与模板；保持旧链接行为）。
 */
export function parseFormatTab(raw: string | null): FormatTab | null {
  return raw === "upload" || raw === "preview" ? raw : null
}

/** Tab → 地址参数（地址形状；默认屏不带参数由调用方决定） */
export function formatTabHref(tab: FormatTab): string {
  return tab === "upload" ? "/format-tool" : `/format-tool?tab=preview`
}
