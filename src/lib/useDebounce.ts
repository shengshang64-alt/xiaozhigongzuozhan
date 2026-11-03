import { useEffect, useState } from "react"

/**
 * 将快速变化的值延迟指定毫秒后再输出，适合搜索输入等场景。
 * 首次立即输出初始值（避免列表首屏空白）；后续变化按 delay 防抖。
 */
export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}
