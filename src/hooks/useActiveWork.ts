import { useCallback, useEffect, useMemo, useState } from "react"
import { pbJsonGet } from "@/lib/pbJson"
import {
  buildActiveWork,
  countActiveWork,
  type ActiveWorkKind,
  type ActiveWorkSourceRows,
  type BidLike,
  type DeckLike,
  type QuoteLike,
  type SolutionLike,
} from "@/pages/Home/activeWork"

// ---------------------------------------------------------------------------
// 首页「工作台进行中事项」取数（R196，docs/13 §3.2；R197 扩展导出真实总数）：
// 并行拉标书 / 方案 / PPT / 报价四个集合最近各 30 条，交给纯函数派生——
// buildActiveWork 出只读卡的展示条目（上限 12），countActiveWork 出顶部统计卡的
// 真实总数与分工作台明细（不受展示截断）。全部失败时返回空，不阻塞首页（同 useActivityFeed）。
// ---------------------------------------------------------------------------

const PER_ENTITY = 30

type ListResponse<T> = { items?: T[] }

const EMPTY_SOURCE: ActiveWorkSourceRows = { bids: [], solutions: [], decks: [], quotes: [] }
const ZERO_BY_KIND: Record<ActiveWorkKind, number> = { bid: 0, solution: 0, deck: 0, quote: 0 }

export function useActiveWork(userId: string | null) {
  const [source, setSource] = useState<ActiveWorkSourceRows>(EMPTY_SOURCE)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (uid: string) => {
    setLoading(true)
    const q = encodeURIComponent(uid)
    const [bidRes, solRes, deckRes, quoteRes] = await Promise.all([
      pbJsonGet<ListResponse<BidLike>>(`/api/bid_projects?rh_user_id=${q}&perPage=${PER_ENTITY}&sort=-updated`),
      pbJsonGet<ListResponse<SolutionLike>>(`/api/solutions?rh_user_id=${q}&perPage=${PER_ENTITY}&sort=-updated`),
      pbJsonGet<ListResponse<DeckLike>>(`/api/ppt_decks?rh_user_id=${q}&perPage=${PER_ENTITY}&sort=-updated`),
      pbJsonGet<ListResponse<QuoteLike>>(`/api/quotes?rh_user_id=${q}&perPage=${PER_ENTITY}&sort=-updated`),
    ])
    setSource({
      bids: bidRes?.items ?? [],
      solutions: solRes?.items ?? [],
      decks: deckRes?.items ?? [],
      quotes: quoteRes?.items ?? [],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) {
      // 登出即清空跨工作台聚合视图；setState 在空态分支同步触发，与 useActivityFeed 同模式（每 effect 只报首处）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSource(EMPTY_SOURCE)
      setLoading(false)
      return
    }
    void load(userId)
  }, [userId, load])

  const items = useMemo(() => buildActiveWork(source), [source])
  const stats = useMemo(() => countActiveWork(source), [source])

  return {
    activeWork: items,
    activeWorkTotal: stats.total,
    activeWorkByKind: stats.byKind ?? ZERO_BY_KIND,
    activeWorkLoading: loading,
  }
}
