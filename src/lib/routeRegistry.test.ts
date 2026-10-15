/** @vitest-environment jsdom */
/**
 * 路由注册表一致性网：把「路由元数据散成多份、互相漂移」这类问题锁死。
 *
 * 背景：改造前同一条路径的文案/图标/加载器分散在四处（App.tsx 的 lazy 列表、routePreload
 * 的 LOADERS、SidebarNav 的分组、TopBarShell+WorkbenchShell 的标题映射），已经漂移出
 * 「标书工作 / 标书工作台」两种写法；标签栏显示标签名后，这种漂移会直接出现在页签上。
 */
import { describe, expect, it } from "vitest"
import { HOME_PATH, NAV_GROUPS, ROUTES, ROUTE_BY_PATH, hasRoute, labelFor, preloadRoute } from "./routeRegistry"

describe("routeRegistry 一致性", () => {
  it("路径唯一，且都带文案/图标/组件/加载器", () => {
    const paths = ROUTES.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const r of ROUTES) {
      expect(r.path.startsWith("/")).toBe(true)
      expect(r.label.trim().length).toBeGreaterThan(0)
      // lucide 图标是 forwardRef 组件（typeof 为 object），只校存在性
      expect(r.icon, `缺少图标：${r.path}`).toBeTruthy()
      expect(r.Component).toBeTruthy()
      expect(typeof r.loader).toBe("function")
    }
  })

  it("侧栏分组的每条路径都能在注册表找到，且没有页面漏挂分组", () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.paths)
    for (const p of grouped) expect(ROUTE_BY_PATH[p], `分组引用了不存在的路径 ${p}`).toBeTruthy()
    // 页面不进导航就没有入口，属配置遗漏（当前 17 个页面全部在导航里）
    const orphans = ROUTES.map((r) => r.path).filter((p) => !grouped.includes(p))
    expect(orphans, `以下页面未挂进任何导航分组：${orphans.join("、")}`).toEqual([])
    expect(new Set(grouped).size).toBe(grouped.length) // 同一页面不重复挂
  })

  it("首页已注册；未注册路径回落「工作台」而不是抛错", () => {
    expect(hasRoute(HOME_PATH)).toBe(true)
    expect(labelFor(HOME_PATH)).toBe(ROUTE_BY_PATH[HOME_PATH].label)
    expect(labelFor("/no-such-page")).toBe("工作台")
    expect(hasRoute("/no-such-page")).toBe(false)
  })

  it("preloadRoute 幂等且对未注册路径静默（不抛错）", () => {
    expect(() => preloadRoute("/no-such-page")).not.toThrow()
    expect(() => {
      preloadRoute("/knowledge")
      preloadRoute("/knowledge")
    }).not.toThrow()
  })
})
