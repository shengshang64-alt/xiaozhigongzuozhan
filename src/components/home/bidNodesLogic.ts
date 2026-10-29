// 首页「投标节点 · 未来 N 天」卡的纯逻辑（R67）。
//
// 为什么单独成文件：这段逻辑原来内联在 BidNodesCard.tsx 的渲染体里，没有任何测试能碰到它，
// 于是「开标日期解析失败 → 项目被静默跳过」这个缺陷活了很久——卡片永远显示「未来 60 天没有
// 开标项目」，而同一批项目在标书工作台列表里是有倒计时的（那边用 daysUntil 直接 new Date()）。
// 抽成纯函数后：① 可以注入 todayMs 固定时钟；② 有回归网；③ 解析口径只有这一份。
//
// 红线自查：不动 bidTypes.ts / useBidWorkspace.ts，不碰数据、不碰导出、不碰提示词。

export type BidNodeRow = {
  id: string
  project_name?: string
  hospital?: string
  bid_open_date?: string
  stage?: string
  deleted_at?: string
}

export type UpcomingBidNode = {
  id: string
  title: string
  hospital: string
  /** 展示用日期，恒为 `YYYY-MM-DD`（绝不把库里的日期时间串直接打到界面上） */
  date: string
  daysLeft: number
}

export const BID_NODE_HORIZON_DAYS = 60

const MS_PER_DAY = 86_400_000

/**
 * 开标日期 → **当地零点**毫秒；无法识别返回 NaN。
 *
 * 库里 `bid_open_date` 有两种历史格式并存：
 *   - `2026-12-01`（新建/补录表单写入，date-only）
 *   - `2026-12-01 00:00:00.000Z`（招标解析与旧版写入，PocketBase 的日期时间串）
 *
 * 旧实现写的是 `new Date(`${d}T00:00:00`)`，只认第一种：第二种会被拼成
 * `2026-12-01 00:00:00.000ZT00:00:00` → Invalid Date → `continue` 静默跳过。
 * 2026-10-30 实测：19 个可见投标项目里 3 个有开标时间，3 个**全部**因此被跳过，
 * 卡片恒显示「未来 60 天没有开标项目」，而其中「【UI测试】中医院信息化建设项目」
 * 距开标 32 天、本该出现在卡里。
 *
 * 这里只取前 10 位（年月日）按本地零点重建，两种格式同口径；月份/日越界（如 2026-13-01）
 * 会被 Date 顺延成别的日子，所以做一次回读校验，越界一律判为无法识别。
 */
export function bidOpenDayMs(raw: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? "").trim())
  if (!m) return NaN
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(year, month - 1, day)
  if (Number.isNaN(d.getTime())) return NaN
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return NaN
  return d.getTime()
}

export type BidNodeLists = {
  /** 未来 horizonDays 天内开标的项目，按剩余天数升序 */
  upcoming: UpcomingBidNode[]
  /** 有开标提醒价值但没填开标时间的项目（归档项目不再提醒补录） */
  missing: BidNodeRow[]
}

/**
 * 把投标项目行分成「未来 N 天要开标的」与「未填开标时间待补录的」两组。
 * @param todayMs 今天**当地零点**毫秒（调用方注入，便于单测固定时钟）
 */
export function buildBidNodeLists(
  rows: readonly BidNodeRow[],
  todayMs: number,
  horizonDays: number = BID_NODE_HORIZON_DAYS,
): BidNodeLists {
  const upcoming: UpcomingBidNode[] = []
  const missing: BidNodeRow[] = []
  for (const b of rows) {
    if (b.deleted_at) continue
    const raw = String(b.bid_open_date ?? "").trim()
    if (!raw) {
      // 已归档项目不再需要补录提醒
      if (b.stage && b.stage !== "archived") missing.push(b)
      continue
    }
    const t = bidOpenDayMs(raw)
    if (Number.isNaN(t)) continue
    const daysLeft = Math.round((t - todayMs) / MS_PER_DAY)
    if (daysLeft < 0 || daysLeft > horizonDays) continue
    upcoming.push({
      id: b.id,
      title: b.project_name || "未命名项目",
      hospital: b.hospital || "",
      date: raw.slice(0, 10),
      daysLeft,
    })
  }
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft)
  return { upcoming, missing }
}
