/**
 * 情报中心「点卡片后要不要把详情滚进视口」的判定（纯函数，便于单测）。
 *
 * 背景（2026-11-04 审计 P1）：情报中心是三栏布局，但只有 ≥1280px（tailwind xl）才是
 * 「左筛选 / 中列表 / 右详情」；1024–1279px（常见笔记本 + 侧边栏展开）是两栏，
 * 详情面板被挤到整个列表的下方。此时点卡片 → 详情确实渲染了，但**视口毫无变化**
 * （列表可能还有几十条卡片，详情在几屏之外），用户会认为「点了没反应」，再点一次也一样。
 *
 * 修法：在窄布局下打开详情时把详情区滚进视口。判定阈值必须与 CSS 的 `xl` 断点同源，
 * 否则会出现「CSS 已经三栏了、JS 还以为要滚」的错位——所以阈值只在这里定义一次。
 */

/** 三栏布局的 CSS 断点（与 IntelCenterPage 的 `xl:grid-cols-[...340px]` 一一对应） */
export const INTEL_THREE_COLUMN_MIN_WIDTH = 1280

/**
 * 打开详情时是否需要把它滚进视口。
 *
 * @param innerWidth 当前视口宽度（window.innerWidth）
 * @param hasDetail  是否真的要显示详情（没有详情就不该滚）
 */
export function shouldScrollDetailIntoView(innerWidth: number, hasDetail: boolean): boolean {
  if (!hasDetail) return false
  const w = Number(innerWidth)
  // 取不到宽度（非浏览器环境/异常值）时偏保守：不滚，避免在真实三栏布局里把页面莫名拉走
  if (!Number.isFinite(w) || w <= 0) return false
  return w < INTEL_THREE_COLUMN_MIN_WIDTH
}
