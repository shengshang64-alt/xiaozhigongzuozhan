/** @vitest-environment jsdom */
/**
 * 工作区标签 store 的行为网（壳级单例）。
 *
 * 为什么单独测 store：标签的"开/关/换账号清空/刷新恢复"发生在 store 里而不是组件里，
 * 组件只派发动作。这些规则出错的表现很隐蔽——比如换账号后继承了上一个账号的标签
 * （连带其页面状态），或刷新后恢复了已下线的路径。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  __resetTabStoreForTest,
  activateTab,
  closeEveryTab,
  closeOthersAt,
  closeRightOf,
  closeTabAt,
  ensureTab,
  getTabsSnapshot,
} from "./workspaceTabStore"

const UID = "local-user"

beforeEach(() => {
  __resetTabStoreForTest()
  window.localStorage.clear()
})
afterEach(() => __resetTabStoreForTest())

describe("ensureTab（路由 → 标签）", () => {
  it("首个标签就是当前页（不塞一个多余首页）", () => {
    ensureTab(UID, "/knowledge")
    expect(getTabsSnapshot().tabs).toEqual({ items: ["/knowledge"], active: "/knowledge", touched: ["/knowledge"] })
  })

  it("再访问新路径则追加并激活，同一路径不重复开", () => {
    ensureTab(UID, "/knowledge")
    ensureTab(UID, "/bid-workspace")
    expect(getTabsSnapshot().tabs.items).toEqual(["/knowledge", "/bid-workspace"])

    ensureTab(UID, "/knowledge")
    const t = getTabsSnapshot().tabs
    expect(t.active).toBe("/knowledge")
    expect(t.items).toEqual(["/knowledge", "/bid-workspace"]) // 顺序稳定
  })

  it("未注册路径不建标签（内容区自己渲染 NotFound）", () => {
    ensureTab(UID, "/knowledge")
    ensureTab(UID, "/nope")
    expect(getTabsSnapshot().tabs.items).toEqual(["/knowledge"])
    expect(getTabsSnapshot().tabs.active).toBe("/knowledge")
  })

  it("换账号清空标签回当前页（不继承上一个账号的标签）", () => {
    ensureTab(UID, "/knowledge")
    ensureTab(UID, "/bid-workspace")
    ensureTab("another-user", "/assistant")
    expect(getTabsSnapshot().tabs).toEqual({ items: ["/assistant"], active: "/assistant", touched: ["/assistant"] })
    expect(getTabsSnapshot().uid).toBe("another-user")
  })
})

describe("关闭动作", () => {
  it("关当前标签 → 激活右邻；关非当前标签 → 当前不变", () => {
    ensureTab(UID, "/knowledge")
    ensureTab(UID, "/bid-workspace")
    ensureTab(UID, "/assistant")

    closeTabAt("/knowledge") // 非当前
    expect(getTabsSnapshot().tabs.active).toBe("/assistant")

    closeTabAt("/assistant") // 当前 → 左邻（右侧已无）
    const t = getTabsSnapshot().tabs
    expect(t.active).toBe("/bid-workspace")
    expect(t.items).toEqual(["/bid-workspace"])
  })

  it("关到空保底回首页", () => {
    ensureTab(UID, "/knowledge")
    closeTabAt("/knowledge")
    expect(getTabsSnapshot().tabs).toEqual({ items: ["/"], active: "/", touched: ["/"] })
  })

  it("关闭其他 / 关闭右侧 / 全部关闭", () => {
    for (const p of ["/knowledge", "/bid-workspace", "/assistant"]) ensureTab(UID, p)

    closeOthersAt("/bid-workspace")
    expect(getTabsSnapshot().tabs).toEqual({ items: ["/bid-workspace"], active: "/bid-workspace", touched: ["/bid-workspace"] })

    ensureTab(UID, "/assistant")
    closeRightOf("/bid-workspace")
    expect(getTabsSnapshot().tabs.items).toEqual(["/bid-workspace"])

    closeEveryTab()
    expect(getTabsSnapshot().tabs).toEqual({ items: ["/"], active: "/", touched: ["/"] })
  })

  it("activateTab 只切激活，不改顺序", () => {
    for (const p of ["/knowledge", "/bid-workspace"]) ensureTab(UID, p)
    activateTab("/knowledge")
    expect(getTabsSnapshot().tabs).toEqual({ items: ["/knowledge", "/bid-workspace"], active: "/knowledge", touched: ["/bid-workspace", "/knowledge"] })
  })
})

describe("持久化与恢复", () => {
  it("同账号刷新恢复上次标签；已下线/非法路径被丢弃", () => {
    ensureTab(UID, "/knowledge")
    ensureTab(UID, "/bid-workspace")
    // 手工塞一条已下线路由，模拟发版后残留
    const raw = JSON.parse(window.localStorage.getItem("xz_workspace_tabs_v2") as string)
    raw.tabs.items.push("/removed-page")
    window.localStorage.setItem("xz_workspace_tabs_v2", JSON.stringify(raw))

    __resetTabStoreForTest()
    ensureTab(UID, "/assistant") // 刷新后落在别的页面
    const t = getTabsSnapshot().tabs
    expect(t.items).toEqual(["/knowledge", "/bid-workspace", "/assistant"])
    expect(t.items).not.toContain("/removed-page")
  })

  it("不同账号不读取对方留下的标签", () => {
    ensureTab(UID, "/knowledge")
    ensureTab(UID, "/bid-workspace")
    __resetTabStoreForTest()
    ensureTab("other-user", "/model-config")
    expect(getTabsSnapshot().tabs.items).toEqual(["/model-config"])
  })
})
