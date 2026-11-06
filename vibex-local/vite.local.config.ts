import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// R2（整仓重构 · 部署壳）：出口反代（/__pb + /__sc）的定义在根 vite.proxy.ts，
// 与根 vite.config.ts 的 `vite preview` 共用同一份口径，避免两条部署路径静默分叉。
import { buildProxy } from '../vite.proxy'

export default defineConfig({
  plugins: [react()],
  // 独立缓存目录：避免与根 vite.config.ts 共用 node_modules/.vite 造成预构建混版
  cacheDir: 'node_modules/.vite-xzlocal',
  resolve: {
    // 强制单例 React，杜绝 "more than one copy of React" → Invalid hook call 白屏
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  // 预声明首趟要打包的依赖：消除浏览器加载时懒发现依赖触发的二次 re-optimize 竞态
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'lucide-react',
      'react-router-dom',
      'pocketbase',
      'sonner',
      // T16：mermaid 配图（~1MB 级 ESM，声明进 include 保证首趟预构建完成，浏览器请求不触发二次 re-optimize）
      'mermaid',
    ],
  },
  server: {
    // T13-LAN（2026-09-29）：绑定全部网卡，允许内网其他电脑经本机 IP 访问；
    // 后端 PocketBase 仍只监听 127.0.0.1:7000（不对外），其流量一律走下方 /__pb 代理
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
    // 内网自用：放开 Host 头校验，机器名/自定域名访问不被 vite 拦截（IP 访问本就不受限）
    allowedHosts: true,
    // R2（整仓重构 · 部署壳）：/__pb 与 /__sc 两条前缀的定义搬到根 vite.proxy.ts 单一真源，
    // 与 `vite preview`（build 后托管）共用同一份口径——否则增强服务在 preview 路径上会静默 404。
    proxy: buildProxy(),
  },
  preview: {
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
    // R2：`vite build` + `vite preview` 也要能把 /__pb 与 /__sc 转出去，
    // 否则「改走 build 产物」这一条部署路径会让数据全空 + 增强功能静默降级。
    proxy: buildProxy(),
  },
})
