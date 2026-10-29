// ---------------------------------------------------------------------------
// R66（2026-10-29）资质「导出硬拦截」开关的**唯一真源**。
//
// 为什么要有这个文件：同一个 localStorage 键 `qual_hard_block` 此前被两处各写一套判定，
// 而且**默认值相反**——
//   · 资质台账页（useQualCerts.ts）：`=== "1"` 才算开 → 键不存在时显示「导出硬拦截：关」；
//   · 导出闸门（useBidWorkspace.ts warnExpiredQuals）：`!== "0"` 才算关 → 键不存在时**实际在拦**。
// 于是**从没碰过这个开关的人（默认态）**看到的是「关」，导出时却被红字拦住；而提示语让用户
// 「去关闭硬拦截」，他点一下开关只会把 "1" 写进去（仍是拦），看起来像开关坏了。
// 实测（2026-10-29）：localStorage 无该键，页面 aria-pressed=false、文案「导出硬拦截：关」，
// 而闸门判定为 true；当时库里有 4 条已过期/30 天内到期证书（1 expired + 3 critical），
// 即这个不一致当场就能让一次导出被莫名阻断。
//
// 口径裁定（沿用 2026-10-24 P0-9 的决定，本文件只把它固化成可测函数）：
//   **默认拦**。证书过期直接废标，宁可先拦住让人去处理；只有用户显式关掉（写 "0"）才放行。
//
// 降级口径与闸门保持一致：localStorage 不可用（隐私模式/被禁用）时返回 false，按软警告处理，
// 不因为读不到开关就把导出全锁死。
//
// 纪律：以后凡是要读这个开关，一律调 readQualHardBlock()，不许再在页面/钩子里各写一份判定
// （qualHardBlock.test.ts 有跨文件哨兵盯着）。
// ---------------------------------------------------------------------------

export const QUAL_HARD_BLOCK_KEY = "qual_hard_block"

/**
 * 是否启用导出硬拦截。
 * - 键不存在（新用户/清过缓存）→ true（默认拦）
 * - "0" → false（用户显式关闭）
 * - 其它任何值（"1" / "" / "true" …）→ true（只有显式 "0" 才算关，避免脏值静默放行）
 * - localStorage 不可用 → false（与导出闸门的 catch 分支同口径：读不到就按软警告）
 */
export function readQualHardBlock(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false
    return window.localStorage.getItem(QUAL_HARD_BLOCK_KEY) !== "0"
  } catch {
    return false
  }
}

/** 写入开关。开 → "1"，关 → "0"（必须写 "0" 而不是删键，否则会被读成默认的「拦」）。 */
export function writeQualHardBlock(on: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(QUAL_HARD_BLOCK_KEY, on ? "1" : "0")
  } catch {
    /* 仅本次会话生效：读不到写入结果时按原值继续，不抛错打断操作 */
  }
}
