// 路由级 chunk 预加载（薄转发）
//
// 实现已迁入 lib/routeRegistry.ts —— 那里是路由唯一真源，LOADERS 与路由表同源后
// 不必再维护第二份 import 列表（原先预加载表与 App.tsx 的 lazy 列表是两份手工同步的映射）。
// 本文件保留为转发入口，既有 import 点零改动。
export { preloadRoute } from "./routeRegistry"
