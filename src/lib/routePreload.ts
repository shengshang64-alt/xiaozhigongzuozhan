// 路由级 chunk 预加载：侧栏 hover 时触发对应页面的 import()，
// React.lazy 内部会复用同一 module promise，正式导航时瞬切。
// 与 App.tsx 中的 lazy(() => import(...)) 路径一一对应。

const LOADERS: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Home/index.tsx"),
  "/solution-studio": () => import("@/pages/SolutionStudio/index.tsx"),
  "/bid-workspace": () => import("@/pages/BidWorkspace/index.tsx"),
  "/ppt-quote": () => import("@/pages/PptQuote/index.tsx"),
  "/model-config": () => import("@/pages/ModelConfig/index.tsx"),
  "/intel-center": () => import("@/pages/IntelCenter/index.tsx"),
  "/competitors": () => import("@/pages/Competitors/index.tsx"),
  "/customer-management": () => import("@/pages/CustomerManagement/index.tsx"),
  "/knowledge": () => import("@/pages/Knowledge/index.tsx"),
  "/format-tool": () => import("@/pages/FormatTool/index.tsx"),
  "/assistant": () => import("@/pages/Assistant/index.tsx"),
  "/team": () => import("@/pages/Team/index.tsx"),
  "/qual-certs": () => import("@/pages/QualCerts/index.tsx"),
  "/ai-hot": () => import("@/pages/AiHot/index.tsx"),
}

/** 已在飞行中/已完成的 path 集合（防重复触发） */
const preloaded = new Set<string>()

/** 预加载指定路由的 lazy chunk（幂等、静默失败） */
export function preloadRoute(path: string): void {
  if (preloaded.has(path)) return
  const loader = LOADERS[path]
  if (!loader) return
  preloaded.add(path)
  // 触发 import() 让 webpack/vite 开始拉 chunk；失败不标记（下次 hover 可重试）
  loader().catch(() => preloaded.delete(path))
}
