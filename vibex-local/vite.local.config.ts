import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    proxy: {
      // 线上由 VibeX 网关剥离 /__pb 前缀；本地必须自行 rewrite，
      // 否则 /__pb/api/x 原样转发给 PocketBase，PB 只认 /api/x -> 404。
      "/__pb": {
        target: "http://127.0.0.1:7000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__pb/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
  },
})
