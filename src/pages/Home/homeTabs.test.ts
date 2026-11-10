// 工作台总览 屏内 Tab 口径守卫（UX-v2：prototype/home/ 四屏）。
// 与 solutionStudioTabs.test.ts 同思路：Tab 名称/顺序是「1:1 对齐原型 manifest」的口径，
// 测试直接断言，防止后续轮次悄悄改屏名、加屏、砍屏或把拆前/拆后说明条搬进生产。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { HOME_TABS, homeTabHref, parseHomeTab, type HomeTab } from "./homeTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 home 四屏", () => {
  it("顺序固定为 总览 → 待办中心 → 投标节点 → 投标复盘", () => {
    expect(HOME_TABS.map((t) => t.key)).toEqual(["overview", "todos", "calendar", "review"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(HOME_TABS.map((t) => t.label)).toEqual(["总览", "待办中心", "投标节点", "投标复盘"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of HOME_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省一律落「总览」，旧书签 / 行为不变", () => {
    expect(parseHomeTab(null)).toBe("overview")
    expect(parseHomeTab("")).toBe("overview")
    expect(parseHomeTab("todos ")).toBe("overview")
    expect(parseHomeTab("../")).toBe("overview")
  })

  it("合法值原样透传", () => {
    const keys: HomeTab[] = ["overview", "todos", "calendar", "review"]
    for (const k of keys) expect(parseHomeTab(k)).toBe(k)
  })

  it("默认 Tab 地址不带参数，其余屏带 ?tab=", () => {
    expect(homeTabHref("overview")).toBe("/")
    expect(homeTabHref("todos")).toBe("/?tab=todos")
    expect(homeTabHref("calendar")).toBe("/?tab=calendar")
    expect(homeTabHref("review")).toBe("/?tab=review")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与子屏组件里都没有拆前/拆后文案", () => {
    const files = [
      "../../components/home/HomeSubtabs.tsx",
      "./HomePage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失：每个原有模块都还能在某个 Tab 里被找到", () => {
  it("页面壳引用了全部既有模块（一个不删，只重新归位）", () => {
    const page = readSrc("./HomePage.tsx")
    for (const mod of [
      "CompactWelcomeBar",
      "NewKeyMetrics",
      "PriorityTasksBoard",
      "CompactProgressPanel",
      "QuickActionButtons",
      "FollowUpReminderCard",
      "ProjectsSection",
      "StatsRow",
      "TodoCard",
      "MustSeeTodayBar",
      "BidNodesCard",
      "FunnelCard",
      "BidReviewCard",
      "OppsCard",
      "ActiveWorkSection",
      "ActivityFeedSection",
      "IntelSection",
    ]) {
      expect(page.includes(mod), `首页拆屏丢了模块：${mod}`).toBe(true)
    }
  })

  it("投标节点 / 投标复盘是独立 Tab 内容，不再被折进「更多模块」", () => {
    const page = readSrc("./HomePage.tsx")
    expect(page).toContain("CalendarTab")
    expect(page).toContain("ReviewTab")
    // 折叠区只收非原型模块，投标节点/复盘/待办不进折叠区
    expect(page).toContain("MoreHomeModules")
  })
})
