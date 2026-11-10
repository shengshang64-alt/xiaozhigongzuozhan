// 情报中心 屏内 Tab 口径守卫（UX-v2：prototype/intel/ 五屏）。
// 与 solutionStudioTabs.test.ts / homeTabs.test.ts / customerTabs.test.ts 同思路：
// Tab 名称/顺序是「1:1 对齐原型 manifest」的口径，测试直接断言；并把拆屏零丢失钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { INTEL_TABS, intelTabHref, parseIntelTab, type IntelTab } from "./intelTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 intel 五屏", () => {
  it("顺序固定为 审阅 → 浏览 → 详情 → 行业前沿 → 数据源", () => {
    expect(INTEL_TABS.map((t) => t.key)).toEqual(["review", "browse", "detail", "industry", "sources"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(INTEL_TABS.map((t) => t.label)).toEqual(["审阅", "浏览", "详情", "行业前沿", "数据源"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of INTEL_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省一律落「审阅」，旧书签行为不变（原默认即待办模式）", () => {
    expect(parseIntelTab(null)).toBe("review")
    expect(parseIntelTab("")).toBe("review")
    expect(parseIntelTab("browse ")).toBe("review")
    expect(parseIntelTab("../")).toBe("review")
  })

  it("合法值原样透传", () => {
    const keys: IntelTab[] = ["review", "browse", "detail", "industry", "sources"]
    for (const k of keys) expect(parseIntelTab(k)).toBe(k)
  })

  it("默认 Tab 地址不带参数，其余屏带 ?tab=", () => {
    expect(intelTabHref("review")).toBe("/intel-center")
    expect(intelTabHref("browse")).toBe("/intel-center?tab=browse")
    expect(intelTabHref("sources")).toBe("/intel-center?tab=sources")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与子屏组件里都没有拆前/拆后文案", () => {
    const files = [
      "../../components/intel-center/IntelSubtabs.tsx",
      "./IntelCenterPage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失：既有能力全部保留并归位", () => {
  it("页面壳引用了全部既有模块（一个不删，只重新归位）", () => {
    const page = readSrc("./IntelCenterPage.tsx")
    for (const mod of [
      "IntelToolbar",
      "IntelStatsRow",
      "IntelDailyBrief",
      "IntelItemCard",
      "IntelBrowseRow",
      "IntelDetailPanel",
      "SourceManagerPanel",
      "ManualEntryDialog",
      "CleanupIrrelevantDialog",
      "PrefsDialog",
      "DataTable",
      "CostConfirmDialog",
    ]) {
      expect(page.includes(mod), `情报中心拆屏丢了模块：${mod}`).toBe(true)
    }
  })

  it("行业前沿收编 /ai-hot：同一页面组件 + 同一 hook（两入口一套 UI），且仅本 Tab 挂载时首拉", () => {
    const page = readSrc("./IntelCenterPage.tsx")
    expect(page).toContain("IndustryTab")
    expect(page).toContain('from "@/pages/AiHot/AiHotPage"')
    expect(page).toContain('from "@/pages/AiHot/useAiHot"')
    // /ai-hot 顶层路由保留（旧深链不死），与行业前沿 Tab 共用同一组件
    const route = readSrc("../../lib/routeRegistry.ts")
    expect(route).toContain('"/ai-hot"')
  })

  it("审阅/浏览保留右侧审阅面板（原型 review.html 口径），详情 Tab 为整屏阅读", () => {
    const page = readSrc("./IntelCenterPage.tsx")
    // 右栏面板仍挂 IntelDetailPanel（aside 内），详情 Tab 另有整屏挂载
    expect((page.match(/<IntelDetailPanel/g) ?? []).length).toBe(2)
  })

  it("双模式 pill 已被五 Tab 取代（setViewMode 切换态不再存在）", () => {
    const page = readSrc("./IntelCenterPage.tsx")
    expect(page).toContain("IntelSubtabs")
    // 原双模式的状态机（useState + setViewMode）删除；viewMode 改为 ?tab= 派生
    expect(page.includes("setViewMode")).toBe(false)
    expect(page).toContain('const viewMode: "todo" | "browse" = tab === "browse" ? "browse" : "todo"')
  })
})
