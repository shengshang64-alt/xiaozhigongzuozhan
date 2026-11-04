/**
 * 标书大纲草稿的「该恢复还是该清」判定（纯函数，零 React / 零 DOM）。
 *
 * 背景（2026-11-04 审计 P1）：
 *   AI 生成的大纲在用户点「确认大纲」之前只存在于 React 内存，刷新即丢，等于要重新付费生成。
 *   2026-11-03 加了 localStorage 草稿，但**恢复判定写错了**：
 *
 *     if (!(rec.bid_outline ?? []).length && savedDraft) { 恢复 }
 *     else { setOutlineDraft([]); if (savedDraft) clearOutlineDraft(rec.id) }   // ← 无条件清
 *
 *   结果：「项目已有确认大纲，用户又点了一次『生成大纲』（新的一份还没确认）」——
 *   这是最常见的使用场景——草稿会被这个 else 当成过期垃圾删掉，新大纲刷新后凭空消失，
 *   而且没有任何提示（用户会以为系统没存住 / 自己点错了）。
 *
 * 正确语义（写库侧本来就是对的，只是恢复侧没跟上）：
 *   · 没有草稿                          → 用数据库大纲（或空）
 *   · 草稿与 bid_outline 完全一致        → 已入库，草稿过期，清掉
 *   · 草稿与 bid_outline 不一致          → 草稿是「更新的一份还没确认」，**必须恢复**
 *                                        （即使 bid_outline 非空也一样）
 *   · 草稿为空数组                        → 视为无草稿
 *
 * 为什么单独成文件：丢的是**已付费生成**的成果，这种判定必须能被单测钉住，
 * 不能只躺在 10,894 行的 God Hook 里靠人眼复核。
 */

export type OutlineDraftAction = "none" | "restore" | "clear"

/**
 * 比较两份大纲是否「内容相同」。
 * 用 JSON 序列化比对：字段顺序由同一套 normalizeOutline 产出，稳定；
 * 不逐个字段比是为了避免将来 OutlineNode 加字段时这里漏改。
 */
export function sameOutline(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  } catch {
    return false
  }
}

/**
 * 决定打开项目时该怎么处理大纲草稿。
 *
 * @param savedDraft    localStorage 里读到的草稿（null / 空数组 = 没有草稿）
 * @param persisted     项目上已确认的 bid_outline（可能为空数组）
 */
export function decideOutlineDraft(
  savedDraft: unknown[] | null | undefined,
  persisted: unknown[] | null | undefined,
): OutlineDraftAction {
  const draft = Array.isArray(savedDraft) ? savedDraft : null
  if (!draft || draft.length === 0) return "none"
  const saved = Array.isArray(persisted) ? persisted : []
  // 已与库里大纲逐字一致 → 说明用户当初点过确认，草稿只是残渣
  if (sameOutline(draft, saved)) return "clear"
  // 其余情况都是「有未确认的新稿」，哪怕库里已有旧大纲也要恢复
  return "restore"
}
