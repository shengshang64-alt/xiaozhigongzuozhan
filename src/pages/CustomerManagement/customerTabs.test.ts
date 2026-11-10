// 客户管理 屏内 Tab 口径守卫（UX-v2：prototype/customer/ 五屏）。
// 与 solutionStudioTabs.test.ts / homeTabs.test.ts 同思路：Tab 名称/顺序是
// 「1:1 对齐原型 manifest」的口径，测试直接断言；并把拆屏零丢失钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CUSTOMER_TABS, customerTabHref, parseCustomerTab, type CustomerTab } from "./customerTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 customer 五屏", () => {
  it("顺序固定为 客户列表 → 客户详情 → 商机看板 → 跟进队列 → 导入与体检", () => {
    expect(CUSTOMER_TABS.map((t) => t.key)).toEqual(["list", "detail", "board", "followup", "import"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(CUSTOMER_TABS.map((t) => t.label)).toEqual(["客户列表", "客户详情", "商机看板", "跟进队列", "导入与体检"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of CUSTOMER_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省一律落「客户列表」，旧书签行为不变", () => {
    expect(parseCustomerTab(null)).toBe("list")
    expect(parseCustomerTab("")).toBe("list")
    expect(parseCustomerTab("board ")).toBe("list")
    expect(parseCustomerTab("../")).toBe("list")
  })

  it("合法值原样透传", () => {
    const keys: CustomerTab[] = ["list", "detail", "board", "followup", "import"]
    for (const k of keys) expect(parseCustomerTab(k)).toBe(k)
  })

  it("默认 Tab 地址不带参数，其余屏带 ?tab=", () => {
    expect(customerTabHref("list")).toBe("/customer-management")
    expect(customerTabHref("detail")).toBe("/customer-management?tab=detail")
    expect(customerTabHref("import")).toBe("/customer-management?tab=import")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与新屏组件里都没有拆前/拆后文案", () => {
    const files = [
      "../../components/customer-management/CustomerSubtabs.tsx",
      "../../components/customer-management/FollowupQueueScreen.tsx",
      "../../components/customer-management/ImportCheckupScreen.tsx",
      "./CustomerManagementPage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失：既有能力全部保留并归位", () => {
  it("页面壳引用了全部既有组件（一个不删，只重新归位）", () => {
    const page = readSrc("./CustomerManagementPage.tsx")
    for (const mod of [
      "CrmStatsRow",
      "CustomerListPanel",
      "CustomerDetailPanel",
      "CustomerHealthPanel",
      "OpportunityDetailPanel",
      "KanbanBoard",
      "WinLossReviewPanel",
      "DataTable",
      "CustomerDataCheckupDialog",
      "CustomerFormDialog",
      "OpportunityDialog",
      "StageChangeDialog",
      "CostConfirmDialog",
      "CrmToolbar",
    ]) {
      expect(page.includes(mod), `客户管理拆屏丢了模块：${mod}`).toBe(true)
    }
  })

  it("点客户/商机统一落到「客户详情」Tab（列表、表格、看板、队列四条路同源）", () => {
    const page = readSrc("./CustomerManagementPage.tsx")
    // 列表/表格/队列/体检 → openCustomerDetail；看板开商机 → goTab("detail")
    expect(page).toContain("const openCustomerDetail")
    expect((page.match(/openCustomerDetail/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })

  it("跟进队列按 30/60/90 分桶 + 未跟进单独成组，字数口径为真实日期差", () => {
    const queue = readSrc("../../components/customer-management/FollowupQueueScreen.tsx")
    expect(queue).toContain("last_follow_at")
    expect(queue).toContain("86_400_000")
  })

  it("导入与体检：文件导入如实「暂未提供」，不造假上传；体检入口接既有弹窗", () => {
    const imp = readSrc("../../components/customer-management/ImportCheckupScreen.tsx")
    expect(imp).toContain("暂未提供")
    expect(imp).toContain("onOpenCheckup")
  })
})
