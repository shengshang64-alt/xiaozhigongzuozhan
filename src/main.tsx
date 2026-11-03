import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { BrowserRouter } from 'react-router-dom'
import { getBasename } from './lib/pb'
import { applyAppearance, loadAppearance } from './lib/appearance'
import './_rh_session_bootstrap'
import { registerGlobalErrorCatch } from './lib/globalErrorCatch'
// 个性化外观：挂载前恢复上次设置（模式/配色/圆角/背景图），避免闪变
applyAppearance(loadAppearance())
// 全局异步错误兜底（ErrorBoundary 管不到的 promise rejection / uncaught error）
registerGlobalErrorCatch()
// Visual Edit runtime, dev only. 不要删这一行.
// (生产 build 时 import.meta.env.DEV = false, 整段被 tree-shake 掉.)
if (import.meta.env.DEV) import('./_rh_inspect').catch(() => undefined)


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={getBasename()}><App /></BrowserRouter>
  </StrictMode>,
)
