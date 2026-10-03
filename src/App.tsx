import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router-dom"
import { WorkbenchShell } from "@/components/shell/WorkbenchShell"
import { NotFound } from "@/components/common/NotFound"

// p2-perf：路由级 code splitting——11 个大页面各自一个 chunk，首屏只加载首页
// + 共享依赖，其余在浏览器空闲 + 用户导航时按需拉取。历史所有页面均已是
// 默认导出的薄壳（pages/X/index.tsx 里做 vm 拼装），直接 lazy 即可。
// WorkbenchShell 与 NotFound 保持同步（首帧渲染骨架需要 Shell，NotFound 极小）。
const HomeRoute = lazy(() => import("./pages/Home/index.tsx"))
const SolutionStudioRoute = lazy(() => import("./pages/SolutionStudio/index.tsx"))
const BidWorkspaceRoute = lazy(() => import("./pages/BidWorkspace/index.tsx"))
const PptQuoteRoute = lazy(() => import("./pages/PptQuote/index.tsx"))
const ModelConfigRoute = lazy(() => import("./pages/ModelConfig/index.tsx"))
const IntelCenterRoute = lazy(() => import("./pages/IntelCenter/index.tsx"))
const CompetitorsRoute = lazy(() => import("./pages/Competitors/index.tsx"))
const CustomerManagementRoute = lazy(() => import("./pages/CustomerManagement/index.tsx"))
const KnowledgeRoute = lazy(() => import("./pages/Knowledge/index.tsx"))
const FormatToolRoute = lazy(() => import("./pages/FormatTool/index.tsx"))
const AssistantRoute = lazy(() => import("./pages/Assistant/index.tsx"))
const TeamRoute = lazy(() => import("./pages/Team/index.tsx"))
const QualCertsRoute = lazy(() => import("./pages/QualCerts/index.tsx"))
const AiHotRoute = lazy(() => import("./pages/AiHot/index.tsx"))

// Suspense fallback 骨架：只在页面 chunk 首次加载的一瞬展示，通常 <50ms；
// 保持与 WorkbenchShell 内容区一致的 padding，视觉上无跳跃感。
function RouteFallback() {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <span className="text-xs">页面加载中…</span>
      </div>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<WorkbenchShell />}>
        <Route
          path="/"
          element={
            <Suspense fallback={<RouteFallback />}>
              <HomeRoute />
            </Suspense>
          }
        />
        <Route
          path="/solution-studio"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SolutionStudioRoute />
            </Suspense>
          }
        />
        <Route
          path="/bid-workspace"
          element={
            <Suspense fallback={<RouteFallback />}>
              <BidWorkspaceRoute />
            </Suspense>
          }
        />
        <Route
          path="/ppt-quote"
          element={
            <Suspense fallback={<RouteFallback />}>
              <PptQuoteRoute />
            </Suspense>
          }
        />
        <Route
          path="/model-config"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ModelConfigRoute />
            </Suspense>
          }
        />
        <Route
          path="/intel-center"
          element={
            <Suspense fallback={<RouteFallback />}>
              <IntelCenterRoute />
            </Suspense>
          }
        />
        <Route
          path="/competitors"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CompetitorsRoute />
            </Suspense>
          }
        />
        <Route
          path="/customer-management"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CustomerManagementRoute />
            </Suspense>
          }
        />
        <Route
          path="/knowledge"
          element={
            <Suspense fallback={<RouteFallback />}>
              <KnowledgeRoute />
            </Suspense>
          }
        />
        <Route
          path="/format-tool"
          element={
            <Suspense fallback={<RouteFallback />}>
              <FormatToolRoute />
            </Suspense>
          }
        />
        <Route
          path="/assistant"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AssistantRoute />
            </Suspense>
          }
        />
        <Route
          path="/team"
          element={
            <Suspense fallback={<RouteFallback />}>
              <TeamRoute />
            </Suspense>
          }
        />
        <Route
          path="/qual-certs"
          element={
            <Suspense fallback={<RouteFallback />}>
              <QualCertsRoute />
            </Suspense>
          }
        />
        <Route
          path="/ai-hot"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AiHotRoute />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
