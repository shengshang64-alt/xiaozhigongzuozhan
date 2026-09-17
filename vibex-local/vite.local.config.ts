import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
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
