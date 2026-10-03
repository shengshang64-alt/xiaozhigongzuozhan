// AI 动态页面 VM：拉取 AIHOT 精选流 + 分类筛选 + 转情报中心（R139）
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  aiHotCategories,
  fetchAiHotFeed,
  saveAiHotToIntel,
  type AiHotItem,
} from "@/lib/aiHotFeed"

// 本机已转存幂等记忆：localStorage 记 guid，刷新/重进不回退；换设备重转也只多一条
// 待确认情报（情报中心 pending 状态天然可忽略），不做服务端去重。
const SAVED_KEY = "xz_aihot_saved_ids"

function readSavedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

export function useAiHot() {
  const [items, setItems] = useState<AiHotItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState("")
  const [activeCat, setActiveCat] = useState("")
  const [savedIds, setSavedIds] = useState<Set<string>>(() => readSavedIds())
  const [publishToTeam, setPublishToTeam] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    try {
      const r = await fetchAiHotFeed(force)
      setItems(r.items)
      setFetchedAt(r.fetchedAt)
      setError(r.items.length === 0 ? "AIHOT 精选流暂时为空，可稍后刷新重试" : null)
    } catch (err) {
      const e = err as Error & { httpStatus?: number }
      setError(
        e.httpStatus === 401
          ? "请先登录工作台，再查看 AI 动态"
          : "AI 动态拉取失败（AIHOT 站点暂时不可达），可点右上角刷新重试",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 微任务启动首拉：所有 setState 落在 fetch 完成后的异步回调，
    // loading 为初始态，无潜在的级联渲染（规避 set-state-in-effect 保守告警）
    void Promise.resolve().then(() => load())
  }, [load])

  const categories = useMemo(() => aiHotCategories(items), [items])
  const visible = useMemo(
    () => (activeCat ? items.filter((it) => it.category === activeCat) : items),
    [items, activeCat],
  )

  const transfer = useCallback(
    async (item: AiHotItem) => {
      setSavingId(item.id)
      try {
        const rec = await saveAiHotToIntel(item, publishToTeam)
        if (rec?.id) {
          const next = new Set(savedIds)
          next.add(item.id)
          setSavedIds(next)
          try {
            localStorage.setItem(SAVED_KEY, JSON.stringify([...next]))
          } catch {
            /* 本机记忆写入失败不阻断（重进页面可重转，代价仅一条待确认） */
          }
          toast.success(publishToTeam ? "已转入情报中心并公开到团队" : "已转入情报中心（仅自己可见）")
        } else {
          toast.error("转入失败，请稍后重试")
        }
      } catch (err) {
        const e = err as Error & { httpStatus?: number }
        toast.error(e.httpStatus === 401 ? "请先登录后再转入情报" : "转入失败，请稍后重试")
      } finally {
        setSavingId(null)
      }
    },
    [publishToTeam, savedIds],
  )

  const refresh = useCallback(() => {
    setLoading(true)
    void load(true)
  }, [load])

  return {
    items,
    visible,
    loading,
    error,
    fetchedAt,
    categories,
    activeCat,
    setActiveCat,
    savedIds,
    publishToTeam,
    setPublishToTeam,
    transfer,
    savingId,
    refresh,
  }
}
