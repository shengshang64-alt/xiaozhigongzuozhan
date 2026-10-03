// R139 方案编制生成韧性的纯判定/收敛展示函数（单章与批量共用，独立可单测）。
// 口径来源：标书侧「循环 8 A2 保底」（空产出不标 done）与「R126 自动补重试」（失败章收口前补跑一次并逐章点名）。

/** 视为空正文的章节产出：纯空白即空。空产出不得标 done——空章会被后续批量按「已生成」永久跳过 */
export function isBlankChapterOutput(content: string | undefined | null): boolean {
  return !(content ?? "").trim()
}

/** 失败章节逐章点名「章名（原因）」，数量/名称截断防 toast 溢出；清单为空时回退 fallback 文案 */
export function formatFailedChapterList(
  failed: { title: string; reason: string }[],
  opts?: { maxItems?: number; titleMax?: number; fallback?: string },
): string {
  const maxItems = opts?.maxItems ?? 3
  const titleMax = opts?.titleMax ?? 10
  const fallback = opts?.fallback ?? "原因未知"
  if (!failed.length) return fallback
  const parts = failed
    .slice(0, maxItems)
    .map((f) => `${f.title.slice(0, titleMax)}（${f.reason || "生成异常"}）`)
  if (failed.length > maxItems) parts.push(`等 ${failed.length} 章`)
  return parts.join("、")
}
