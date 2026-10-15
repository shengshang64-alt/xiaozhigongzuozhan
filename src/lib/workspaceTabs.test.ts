/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest"
import { HOME_PATH, ROUTES } from "./routeRegistry"
import {
  TAB_LIMIT,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  initialTabs,
  loadTabs,
  openTab,
  saveTabs,
  type WorkspaceTabsState,
} from "./workspaceTabs"

const PATHS = ROUTES.map((r) => r.path)
const open = (state: WorkspaceTabsState, ...paths: string[]) => paths.reduce((s, p) => openTab(s, p), state)

afterEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // ignore
  }
})

describe("initialTabs", () => {
  it("用传入路径开局；非法路径退回首页", () => {
    expect(initialTabs("/knowledge")).toEqual({ items: ["/knowledge"], active: "/knowledge", touched: ["/knowledge"] })
    expect(initialTabs("/not-a-route").active).toBe(HOME_PATH)
  })
})

describe("openTab", () => {
  it("同一路径不重复开，激活它且不改变顺序", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace")
    expect(s.items).toEqual([HOME_PATH, "/knowledge", "/bid-workspace"])

    const back = openTab(s, "/knowledge")
    expect(back.active).toBe("/knowledge")
    // 顺序稳定：激活不重排（否则标签会来回跳）
    expect(back.items).toEqual([HOME_PATH, "/knowledge", "/bid-workspace"])
  })

  it("未注册路径不建标签（由外壳渲染 NotFound）", () => {
    const s = initialTabs(HOME_PATH)
    expect(openTab(s, "/nope")).toBe(s)
  })

  it(`超上限回收最久未用的非当前标签（上限 ${TAB_LIMIT}）`, () => {
    const first = PATHS.slice(0, TAB_LIMIT) // 含 "/"，它是第一个打开的
    let s = open(initialTabs(HOME_PATH), ...first.slice(1))
    // 把第 2 个标签重新激活一次（变成最近用过），最久未用就轮到最先打开的首页
    s = openTab(s, first[1])
    s = openTab(s, PATHS[TAB_LIMIT]) // 第 11 个 → 触发回收

    expect(s.items.length).toBe(TAB_LIMIT)
    expect(s.items).not.toContain(HOME_PATH) // 最久没用过的被回收
    expect(s.items).toContain(first[1]) // 刚用过的不回收
    expect(s.items).toContain(s.active) // 当前标签必须在
  })

  it("无论怎么开，当前标签始终在列表里（回收绝不动当前）", () => {
    let s = initialTabs(HOME_PATH)
    for (const p of PATHS) {
      s = openTab(s, p)
      expect(s.items).toContain(s.active)
    }
    s = openTab(s, "/knowledge")
    expect(s.items).toContain("/knowledge")
    expect(s.items.length).toBeLessThanOrEqual(TAB_LIMIT)
  })
})

describe("closeTab", () => {
  it("关非当前标签：当前不变", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace")
    const after = closeTab(s, "/knowledge")
    expect(after.items).toEqual([HOME_PATH, "/bid-workspace"])
    expect(after.active).toBe("/bid-workspace")
  })

  it("关当前标签：优先激活右邻", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace")
    const after = closeTab(s, "/knowledge")
    expect(after.active).toBe("/bid-workspace")
  })

  it("关最右的当前标签：激活左邻", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace")
    const after = closeTab(s, "/bid-workspace")
    expect(after.active).toBe("/knowledge")
  })

  it("关到空时保底回首页（永不空标签）", () => {
    const s = initialTabs("/knowledge")
    const after = closeTab(s, "/knowledge")
    expect(after).toEqual({ items: [HOME_PATH], active: HOME_PATH, touched: [HOME_PATH] })
  })

  it("关不存在的标签：状态不变", () => {
    const s = initialTabs(HOME_PATH)
    expect(closeTab(s, "/knowledge")).toEqual(s)
  })
})

describe("批量关闭", () => {
  it("关闭其他：只留指定标签并激活", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace")
    expect(closeOtherTabs(s, "/knowledge")).toEqual({ items: ["/knowledge"], active: "/knowledge", touched: ["/knowledge"] })
  })

  it("关闭右侧：保留左侧 + 自己；被关掉的当前标签回落到保留的标签", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace", "/bid-check")
    const after = closeTabsToRight(s, "/knowledge")
    expect(after.items).toEqual([HOME_PATH, "/knowledge"])
    expect(after.active).toBe("/knowledge")
  })

  it("全部关闭：回首页", () => {
    expect(closeAllTabs()).toEqual({ items: [HOME_PATH], active: HOME_PATH, touched: [HOME_PATH] })
  })
})

describe("持久化", () => {
  it("存读往返一致", () => {
    const s = open(initialTabs(HOME_PATH), "/knowledge", "/bid-workspace")
    saveTabs(s)
    expect(loadTabs()).toEqual(s)
  })

  it("坏数据/非法路由/重复项一律丢弃，不留死标签", () => {
    window.localStorage.setItem(
      "xz_workspace_tabs",
      JSON.stringify({
        items: ["/knowledge", "/已下线路径", "/knowledge", 42, "/bid-workspace"],
        active: "/已下线路径",
        touched: ["/knowledge", "nope"],
      }),
    )
    const loaded = loadTabs()
    expect(loaded).not.toBeNull()
    expect(loaded!.items).toEqual(["/knowledge", "/bid-workspace"])
    // active 非法 → 回落到最后一个合法标签
    expect(loaded!.active).toBe("/bid-workspace")
    expect(loaded!.touched.every((p) => loaded!.items.includes(p))).toBe(true)
  })

  it("读不到或解析失败返回 null（由调用方用 initialTabs 兜底）", () => {
    expect(loadTabs()).toBeNull()
    window.localStorage.setItem("xz_workspace_tabs", "{不是 JSON")
    expect(loadTabs()).toBeNull()
    window.localStorage.setItem("xz_workspace_tabs", JSON.stringify({ items: ["/不存在"] }))
    expect(loadTabs()).toBeNull()
  })
})
