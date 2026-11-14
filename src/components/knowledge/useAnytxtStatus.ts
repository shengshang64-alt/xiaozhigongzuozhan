// 本机资料（AnyTXT）可用性 · 共享 Hook。
//
// ## 为什么需要它
//
// 原型 kb/browse.html 与 kb/search.html 都有一条「本机资料全文检索未启用」的提示，
// 但**不能常驻占位**——原型自己把它从「一整块百余字的警告条」压成了「一行可收起」。
//
// 三条纪律：
//   ① 未启用时才提示（在线就不提示，别制造噪音）；
//   ② 提示可收起，且收起状态记 localStorage（7 天内不再出现），不是每次刷新都弹；
//   ③ 「未启用」≠「出错」——这是环境状态，用中性语气，不要用错误色。
//
// probeAnytxt 自带 60s/10s 缓存（见 lib/anytxtClient.ts），多屏共用不会重复打 sidecar。

import { useCallback, useEffect, useState } from "react"
import { probeAnytxt, type AnytxtHealth } from "@/lib/anytxtClient"

const DISMISS_KEY = "kb_anytxt_notice_dismissed_at"
/** 收起后 7 天内不再出现 */
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function readDismissedAt(): number {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    const n = Number(raw ?? "")
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export type AnytxtStatusState = {
  /** AnyTXT 是否可用（null = 尚未探测完） */
  online: boolean | null
  /** 探测失败时的原因（用于 ErrorState/提示文案） */
  error: string | null
  /** 提示是否已被用户收起 */
  dismissed: boolean
  dismiss: () => void
  reload: () => void
}

export function useAnytxtStatus(): AnytxtStatusState {
  const [health, setHealth] = useState<AnytxtHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    const at = readDismissedAt()
    return at > 0 && Date.now() - at < DISMISS_TTL_MS
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    probeAnytxt(true)
      .then((h) => {
        if (!alive) return
        setHealth(h)
        setError(h.online ? null : (h.message ?? "本机资料检索服务未响应"))
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [nonce])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* 隐私模式：静默降级，本次会话内不再显示 */
    }
  }, [])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return {
    online: health?.online ?? null,
    error,
    dismissed,
    dismiss,
    reload,
  }
}
