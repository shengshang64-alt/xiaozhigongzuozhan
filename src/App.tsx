import { Route, Routes } from "react-router-dom"
import { WorkbenchShell } from "@/components/shell/WorkbenchShell"

// 路由匹配只保留一个「壳」入口：具体页面由 shell 内的标签宿主（TabbedOutlet）按
// lib/routeRegistry.ts 的唯一路由表渲染，且支持多标签保活（切走不卸载）。
//
// 为什么不再在这里逐页写 <Route path element>：路由元数据原本分散在四处（这里的 17 段
// lazy 路由、routePreload 的 LOADERS、SidebarNav 的分组 label、TopBarShell/WorkbenchShell
// 的标题映射）且文案互相漂移（同一路径出现「标书工作」与「标书工作台」两种写法）。标签栏要显示
// 标签名，必须有唯一口径，故全部收敛到 routeRegistry：新增页面只改那一处。
//
// path="*" 仍然有用：它让任意深链接（含写错的地址）都落到壳里，由壳渲染页面或 NotFound，
// 保持地址栏/前进后退与改造前完全一致（BrowserRouter + basename 亦不变）。
function App() {
  return (
    <Routes>
      <Route path="*" element={<WorkbenchShell />} />
    </Routes>
  )
}

export default App
