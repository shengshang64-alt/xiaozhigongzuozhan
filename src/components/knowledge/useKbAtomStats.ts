// 知识原子统计 · 共享 Hook（文档库屏 / 知识原子屏共用一份请求）。
//
// ## 为什么单独一个 Hook
//
// 原型里「312 条原子待审核」「被引用 12 次」这些信号横跨两屏：
// 文档库屏的标题徽标与左栏「按引用数排」，知识原子屏的数据条与右栏排行。
// 两处各拉一次会打两次接口，也会让两屏的数字在刷新间隙对不上。
//
// ## 三态语义
//
// loading / error / ok 三者严格区分（DataStates 的约定）：
// 拿不到统计 ≠ 库里没有原子。拉取失败时 error 非空，界面用 ErrorState 显示
// 「不是没有数据」，绝不用 0 顶替。

import { useCallback, useEffect, useState } from "react"
import { fetchKbAtomStats, type KbAtomStats } from "@/components/knowledge/kbAtomsApi"

export type KbAtomStatsState = {
  stats: KbAtomStats | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useKbAtomStats(): KbAtomStatsState {
  const [stats, setStats] = useState<KbAtomStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    // setTimeout(0)：让 setState 发生在微任务之后（react-hooks/set-state-in-effect 规则），
    // 与 useKbReview.ts 的队列加载同款写法。
    const t = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      fetchKbAtomStats()
        .then((s) => {
          if (!alive) return
          setStats(s)
        })
        .catch((e: unknown) => {
          if (!alive) return
          setStats(null)
          setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [nonce])

  return { stats, loading, error, reload }
}
