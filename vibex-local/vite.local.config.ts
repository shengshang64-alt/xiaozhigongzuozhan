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
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 8000,
    strictPort: true,
    proxy: {
      // 线上由 VibeX 网关剥离 /__pb 前缀；本地必须自行 rewrite，
      // 否则 /__pb/api/x 原样转发给 PocketBase，PB 只认 /api/x -> 404。
      '/__pb': {
        target: 'http://127.0.0.1:7000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__pb/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 8000,
    strictPort: true,
  },
})
