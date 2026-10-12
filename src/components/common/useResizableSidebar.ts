import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"

type Options = { storageKey: string; initial: number; min: number; max: number }

/**
 * 大纲侧栏可拖拽宽度：指针拖动调宽、双击恢复默认、localStorage 持久化、上下限夹取。
 * 返回 width（px，供 CSS 变量 --ow 使用）与 handle 的 onDragStart / reset。
 */
export function useResizableSidebar({ storageKey, initial, min, max }: Options) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return initial
    try {
      const v = Number(window.localStorage.getItem(storageKey))
      if (Number.isFinite(v) && v >= min && v <= max) return v
    } catch {
      /* ignore */
    }
    return initial
  })
  const latest = useRef(width)
  useEffect(() => {
    latest.current = width
  }, [width])

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = latest.current
      const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)))
      const move = (ev: PointerEvent) => setWidth(clamp(startW + (ev.clientX - startX)))
      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
        document.body.style.userSelect = ""
        document.body.style.cursor = ""
        try {
          window.localStorage.setItem(storageKey, String(latest.current))
        } catch {
          /* ignore */
        }
      }
      document.body.style.userSelect = "none"
      document.body.style.cursor = "col-resize"
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    },
    [min, max, storageKey],
  )

  const reset = useCallback(() => {
    setWidth(initial)
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
  }, [initial, storageKey])

  return { width, onDragStart, reset }
}
