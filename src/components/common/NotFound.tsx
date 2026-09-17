import { Link } from "react-router-dom"
import { Compass, LayoutGrid } from "lucide-react"

/**
 * 404 兜底页：未知路径不再静默渲染首页，给出明确提示与回工作台入口。
 */
export function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 py-16 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 shadow-sm">
        <Compass className="h-7 w-7 text-primary" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">页面不存在</h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        你访问的地址没有对应的工作台页面，可能链接有误或页面已下线。
      </p>
      <Link
        to="/"
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <LayoutGrid className="h-4 w-4" />
        回工作台首页
      </Link>
    </main>
  )
}
