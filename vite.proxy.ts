// ---------------------------------------------------------------------------
// 开发/预览出口的**反代单一真源**（R2 · 整仓重构 · 部署壳）
//
// 为什么单拎出来：本仓有两个 vite 配置
//     vite.config.ts                 （根配置，`npm run dev` / `vite preview` 用）
//     vibex-local/vite.local.config.ts（`start-local.cmd` 日常用，带 /__pb 代理）
// 两边各写一份 proxy 的结果，历史上已经出现过一次「界面能开但数据全空」——
// 因为根配置**没有** /__pb 代理，而两者都声明 port 8000 + strictPort，谁先起谁占。
//
// R2 要加第二条前缀 `/__sc`（增强服务 sidecar）。如果只加在日常那份里，
// 那么「build + preview」这条路径上 /__sc 又会静默 404，同事机的增强功能
// 再次默默降级——正是 R2 验收句点名要消灭的形态。所以两条前缀、两个配置
// 共用本文件，改口径只改这里。
//
// 口径说明：
//   /__pb  →  PocketBase（剥前缀再转发，PB 只认 /api/x）
//   /__sc  →  sidecar（剥前缀再转发，sidecar 只认 /health、/export/docx …）
// 两者都 changeOrigin：否则 PB 的 Origin 校验与 sidecar 的日志里会出现
// 访问者本机地址，排查时误导。
// ---------------------------------------------------------------------------

/** 反代目标端口。与 start-local.cmd / vibex-local/sidecar/server.mjs 的默认值同源。 */
export const PB_PORT = 7000
export const SIDECAR_PORT = 7001

export type ProxyEntry = {
  target: string
  changeOrigin: boolean
  rewrite: (path: string) => string
  /** 增强服务是长任务（导出/渲染可达数分钟），不能让反代先超时 */
  timeout?: number
  proxyTimeout?: number
}

/**
 * 生成 vite 的 `server.proxy` / `preview.proxy` 配置对象。
 *
 * @param opts.sidecarPort 覆盖 sidecar 端口（默认 7001，与 ZX_SIDECAR_PORT 对齐）
 */
export function buildProxy(opts?: { pbPort?: number; sidecarPort?: number }): Record<string, ProxyEntry> {
  const pb = opts?.pbPort ?? PB_PORT
  const sc = opts?.sidecarPort ?? SIDECAR_PORT
  return {
    // 线上由 VibeX 网关剥离 /__pb 前缀；本地必须自行 rewrite，
    // 否则 /__pb/api/x 原样转发给 PocketBase，PB 只认 /api/x -> 404。
    "/__pb": {
      target: `http://127.0.0.1:${pb}`,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/__pb/, ""),
    },
    // R2：增强服务同源出口。前端 lib/sidecarBase.ts 默认走这条前缀，
    // 于是「同事机 / 本机」用的是同一套相对路径，谁也不用知道服务端 IP。
    "/__sc": {
      target: `http://127.0.0.1:${sc}`,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/__sc/, ""),
      // 导出大文档 / PPT 渲染质检实测可达 1-4 分钟；反代先超时会让前端
      // 看到「后端不可用」而实际后端还在干活——这是最难查的一类假降级。
      timeout: 300_000,
      proxyTimeout: 300_000,
    },
  }
}
