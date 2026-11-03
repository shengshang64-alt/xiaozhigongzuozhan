// 首页「投标节点 · 未来 N 天」卡的纯逻辑（R67）。
//
// 为什么单独成文件：这段逻辑原来内联在 BidNodesCard.tsx 的渲染体里，没有任何测试能碰到它，
// 于是「开标日期解析失败 → 项目被静默跳过」这个缺陷活了很久——卡片永远显示「未来 60 天没有
// 开标项目」，而同一批项目在标书工作台列表里是有倒计时的（那边用 daysUntil 直接 new Date()）。
// 抽成纯函数后：① 可以注入 todayMs 固定时钟；② 有回归网；③ 解析口径只有这一份
// （R68 起这一份落在 src/lib/bidOpenDay.ts，标书工作台的补录条与流水线倒计时共用）。
//
// 红线自查：不动 bidTypes.ts / useBidWorkspace.ts，不碰数据、不碰导出、不碰提示词。

// R68：开标日期解析已上收到 src/lib/bidOpenDay.ts（标书工作台的补录条与流水线倒计时也要用同一份，
// 留在 home 目录里会让 bid-workspace 反向依赖首页）。此处保留同名导出，既有调用点与测试无需改动。
import { MS_PER_DAY, bidOpenDayMs } from "@/lib/bidOpenDay"

export { bidOpenDayMs }

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
