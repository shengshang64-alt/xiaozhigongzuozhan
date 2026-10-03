import { ArrowUp } from "lucide-react"
import { useEffect, useState } from "react"

/**
 * 回到顶部浮动按钮：窗口滚动超过 400px 时淡入，点击平滑滚回顶部。
 * 仅在长列表页（知识库、情报、客户等）有意义，渲染在 WorkbenchShell 层。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-24 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg transition-all hover:bg-primary hover:text-primary-foreground hover:shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  )
}
