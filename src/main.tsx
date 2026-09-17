import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { BrowserRouter } from 'react-router-dom'
import { getBasename } from './lib/pb'
import './_rh_session_bootstrap'
// Visual Edit runtime, dev only. 不要删这一行.
// (生产 build 时 import.meta.env.DEV = false, 整段被 tree-shake 掉.)
if (import.meta.env.DEV) import('./_rh_inspect').catch(() => undefined)


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={getBasename()}><App /></BrowserRouter>
  </StrictMode>,
)
