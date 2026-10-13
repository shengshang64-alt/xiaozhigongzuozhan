import { useCallback, useEffect, useMemo, useState } from "react"
import { pbJsonGet } from "@/lib/pbJson"
import {
  buildActiveWork,
  countActiveWork,
  formatActiveWorkCaveat,
  loadActiveWork,
  UNKNOWN_SERVER_TOTALS,
  type ActiveWorkKind,
  type ActiveWorkServerTotals,
  type ActiveWorkSourceRows,
} from "@/pages/Home/activeWork"

// ---------------------------------------------------------------------------
// 首页「工作台进行中事项」取数（R196，docs/13 §3.2；R197 扩展分工作台明细；R302 修正 r281 谎报口径）：
// 并行拉标书 / 方案 / PPT / 报价四个集合最近各 30 条，交给纯函数派生——buildActiveWork 出只读卡的
// 展示条目（上限 12），countActiveWork 出顶部统计卡的计数。旧注释把计数称做「真实总数」，其实它是
// 最多 30×4 的取样下限：集合一旦长大就静默偏小（同类 bug 历史上已出现两次：kb-cap-01、delivery-p1-03）。
// R302 起把 list 路由回显的服务端总数一起带进统计，如实导出 activeWorkTruncated / activeWorkExact /
// activeWorkCaveat，由界面补「+」并说明取样口径；报价无状态字段，直接采用服务端总数出精确值。
// 全部失败时返回空，不阻塞首页（同 useActivityFeed）。取数编排在 activeWork.ts 里，可脱离 React 单测。
// ---------------------------------------------------------------------------

const PER_ENTITY = 30

const EMPTY_SOURCE: ActiveWorkSourceRows = { bids: [], solutions: [], decks: [], quotes: [] }
const ZERO_BY_KIND: Record<ActiveWorkKind, number> = { bid: 0, solution: 0, deck: 0, quote: 0 }

export function useActiveWork(userId: string | null) {
  const [source, setSource] = useState<ActiveWorkSourceRows>(EMPTY_SOURCE)
  const [totals, setTotals] = useState<ActiveWorkServerTotals>(UNKNOWN_SERVER_TOTALS)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (uid: string) => {
    setLoading(true)
    const { rows, totals: srvTotals } = await loadActiveWork((path) => pbJsonGet(path), uid, PER_ENTITY)
    setSource(rows)
    setTotals(srvTotals)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) {
      // 登出即清空跨工作台聚合视图；setState 在空态分支同步触发，与 useActivityFeed 同模式（每 effect 只报首处）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSource(EMPTY_SOURCE)
      setTotals(UNKNOWN_SERVER_TOTALS)
      setLoading(false)
      return
    }
    void load(userId)
  }, [userId, load])

  const items = useMemo(() => buildActiveWork(source), [source])
  const stats = useMemo(() => countActiveWork(source, totals), [source, totals])
  const caveat = useMemo(() => formatActiveWorkCaveat(stats, totals, PER_ENTITY), [stats, totals])

  return {
    activeWork: items,
    activeWorkTotal: stats.total,
    activeWorkByKind: stats.byKind ?? ZERO_BY_KIND,
    /** R302：某工作台的样本未覆盖全库 → 该计数只是下限（界面补「+」） */
    activeWorkTruncated: stats.truncated,
    /** R302：四个计数是否全为精确值 */
    activeWorkExact: stats.exact,
    /** R302：取样口径的中文说明，精确时为空串 */
    activeWorkCaveat: caveat,
    activeWorkLoading: loading,
  }
}
