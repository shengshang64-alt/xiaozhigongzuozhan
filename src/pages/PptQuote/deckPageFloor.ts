// ---------------------------------------------------------------------------
// 页数补齐（2026-11-04）
//
// 背景：单发路径（≤10 页）一次调用生成整册。实测模型经常「说要 10 页、只写 4 页」，
// 而原判据 `got.length === 0` 只有一页都没有才算失败，于是：
//   · 不重试、不补页、不提示；
//   · 用户拿到一本 4 页的册子，界面还显示「正在生成 10 页内容…」之后就直接进编辑器了。
// 这属于「静默交付半成品」，与本轮修的其它「假成功」同源。
//
// 本模块只做一件纯逻辑的事：给定已有 slides 和还差几页，生成**结构合理**的占位页，
// 让整册骨架完整（封面/目录/章节/正文/结尾的顺序不乱），用户可逐页「AI 补全」。
//
// 为什么占位页不写满假内容：
//   本轮之前修过「缺事实不许编造」的规矩（NO_FABRICATION_RULES）。这里同理——
//   占位页只给**可执行的填写提示**，不编业务数字，避免用户误以为已生成完整。
// ---------------------------------------------------------------------------

import type { Slide } from "./pptQuoteTypes"
import type { SlideKindZ } from "./deckSchema"

/** 占位页在正文里的固定提示语（用户一眼能看出"这页还没写"） */
export const PLACEHOLDER_HINT = "本页未生成内容：AI 本次返回的页数不足。可点本页「AI 补全」生成，或手动填写。"

/**
 * 生成 `count` 页占位页。
 *
 * @param count 需要补几页（≤0 时返回空数组）
 * @param kind  占位页的页型，默认 bullets（最中性的正文页）
 */
export function buildPlaceholderSlides(count: number, kind: SlideKindZ = "bullets"): Slide[] {
  const n = Math.floor(Number(count) || 0)
  if (n <= 0) return []
  const prefix = `ph${Date.now().toString(36)}`
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    title: `待补充章节 ${i + 1}`,
    bullets: [PLACEHOLDER_HINT],
    notes: PLACEHOLDER_HINT,
    kind,
    // 显式标 auto：不让自动配图把占位页也当成"需要配图的内容页"去烧钱
    layout: "auto",
  })) as Slide[]
}

/**
 * 把占位页插到"结尾页之前"（若末页是总结/致谢就插在它前面，否则追加到末尾）。
 *
 * 单发路径模型返回的册子通常已含封面与结尾，直接 append 会让占位页排在「谢谢」之后，
 * 这是明显的叙事错误，所以单列一个函数把插入位置做成可测的。
 */
export function insertBeforeClosing(all: readonly Slide[], placeholders: readonly Slide[]): Slide[] {
  if (!placeholders.length) return [...all]
  const list = [...all]
  if (!list.length) return [...placeholders]
  const last = list[list.length - 1]
  const isClosing = last.kind === "summary" || /谢谢|致谢|Q\s*&\s*A|提问/i.test(last.title ?? "")
  if (isClosing) {
    return [...list.slice(0, -1), ...placeholders, last]
  }
  return [...list, ...placeholders]
}
