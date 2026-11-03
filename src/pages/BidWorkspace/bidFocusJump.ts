// R-302（2026-10-16）：textarea 按字符偏移定位（从 ComposeStep 内联闭包抽出）
// ---------------------------------------------------------------------------
// 为什么单独成文件：
//   原实现内联在 ComposeStep 的 contentFocus useEffect 里，无法单测——
//   而"选区端点是否被 clamp、空正文是否安全返回、hitLen=0 时是否至少选 1 字"
//   这类边界正是最容易写错、也最容易在重构中被改坏的地方。
//   抽成纯 DOM 函数（零 React 依赖）后可 jsdom 直测。
// 调用方：ComposeStep 的 contentFocus effect（"版式?"徽标点击 → 跳到 lint 命中字符）
// ---------------------------------------------------------------------------

/**
 * 把 textarea 的选区与滚动定位到指定字符偏移。
 *
 * @param el        目标 textarea
 * @param rawOffset 命中位置（字符偏移，非行号）；越界自动 clamp 到 [0, length]
 * @param hitLen    命中文本长度（用于选区高亮；≤0 时退化为选中 1 个字符）
 * @returns 是否完成定位（正文为空时返回 false，调用方据此保留 pending 以便重试）
 */
export function jumpTextareaToOffset(
  el: HTMLTextAreaElement,
  rawOffset: number,
  hitLen: number,
): boolean {
  const value = el.value ?? ""
  if (!value.trim()) return false
  const safeOffset = Math.max(0, Math.min(rawOffset, value.length))
  // 至少选中 1 个字符：否则 setSelectionRange(x, x) 只有一个光标，
  // 用户看不到"跳到了哪里"（徽标点击需要视觉反馈）
  const endOffset = Math.min(safeOffset + Math.max(1, hitLen), value.length)
  el.focus()
  el.setSelectionRange(safeOffset, endOffset)
  // 滚动：textarea 没有"滚动到第 N 行"的 API，按字符位置比例估算
  const ratio = value.length > 0 ? safeOffset / value.length : 0
  el.scrollTop = Math.max(0, el.scrollHeight * ratio - el.clientHeight / 3)
  return true
}
