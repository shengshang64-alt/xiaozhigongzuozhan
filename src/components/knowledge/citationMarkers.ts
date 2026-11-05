// 知识问答「引用标记」的纯函数集（零 React / 零 JSX）。
//
// 拆出单独文件的原因：react-refresh/only-export-components 要求组件文件只导出组件，
// 而这些是纯判定/格式化函数，混在 CitedAnswer.tsx 里会让 lint 预算超额。
//
// 阶段 1 · 包 3（问答 Markdown 表可渲染）上下文：
//   表格单元格里带 `[资料N]` 时，若按标记把原文切段分别渲染 Markdown，表格结构会被切断
//   （实测 <tr> 从 3 掉到 2，整行数据漏到表格外）。故表格块内改为：
//   整块交给 Markdown 渲染，块内标记折成上标数字 `⁽N⁾`，表格下方另给一行来源说明，
//   保证「引用可见」不用靠切碎表格来换。

/** 回答里是否带 [资料N] 内联引用标记（无标记走旧版底部 chips 兼容渲染） */
export function hasCitationMarkers(content: string): boolean {
  return /\[资料\d+\]/.test(content ?? "")
}

/** 供表格来源说明使用的最小结构（只依赖序号与标题，避免耦合知识库页的完整类型） */
export interface CitationTitleLike {
  title: string
}

/**
 * 表格块内的引用标记折叠：`[资料2]` → 上标数字 `⁽2⁾`。
 * 序号越界时**原样保留**（不编造、不静默丢弃），调用方据此仍能看出这里有个未解析的引用。
 */
export function foldCitationMarkersInTable(text: string, citations: readonly CitationTitleLike[]): string {
  return (text ?? "").replace(/\[资料(\d+)\]/g, (all, d: string) => {
    const n = Number(d)
    if (!Number.isFinite(n) || n < 1 || n > citations.length) return all
    return `⁽${n}⁾`
  })
}

/**
 * 表格块内引用来源的一句话说明（挂在表格下方）：
 * 例：`表格来源：1·《建设清单说明》；2·《报价规则》`
 * 无有效引用时返回 null（不输出空说明）。
 */
export function tableSourceLineOf(text: string, citations: readonly CitationTitleLike[]): string | null {
  const nums = new Set<number>()
  for (const m of (text ?? "").matchAll(/\[资料(\d+)\]/g)) {
    const n = Number(m[1])
    if (n >= 1 && n <= citations.length) nums.add(n)
  }
  if (nums.size === 0) return null
  const items = [...nums].sort((a, b) => a - b).map((n) => `${n}·《${citations[n - 1].title}》`)
  return `表格来源：${items.join("；")}`
}
