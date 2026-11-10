// 方案工作室 屏内 Tab 口径守卫（UX-v2）。
// 与 modelConfigTabs.test.ts 同思路：Tab 名称/顺序是「1:1 对齐原型 manifest」的口径，
// 测试直接断言，不让我或后续轮次悄悄改屏名、加屏、砍屏。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  SOLUTION_STUDIO_TABS,
  parseSolutionStudioTab,
  solutionStudioTabHref,
  type SolutionStudioTab,
} from "./solutionStudioTabs"

const readSrc = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 solution 四屏", () => {
  it("顺序固定为 方案列表 → 方案编辑器 → 建设清单 → 交付检查", () => {
    expect(SOLUTION_STUDIO_TABS.map((t) => t.key)).toEqual(["list", "editor", "checklist", "delivery"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(SOLUTION_STUDIO_TABS.map((t) => t.label)).toEqual(["方案列表", "方案编辑器", "建设清单", "交付检查"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of SOLUTION_STUDIO_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省一律落「方案列表」，旧书签 /solution-studio 行为不变", () => {
    expect(parseSolutionStudioTab(null)).toBe("list")
    expect(parseSolutionStudioTab("")).toBe("list")
    expect(parseSolutionStudioTab("editor ")).toBe("list")
    expect(parseSolutionStudioTab("../")).toBe("list")
  })

  it("合法值原样透传", () => {
    const keys: SolutionStudioTab[] = ["list", "editor", "checklist", "delivery"]
    for (const k of keys) expect(parseSolutionStudioTab(k)).toBe(k)
  })

  it("默认 Tab 地址不带参数，其余屏带 ?tab=", () => {
    expect(solutionStudioTabHref("list")).toBe("/solution-studio")
    expect(solutionStudioTabHref("editor")).toBe("/solution-studio?tab=editor")
    expect(solutionStudioTabHref("delivery")).toBe("/solution-studio?tab=delivery")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("四屏组件与页面壳里都没有拆前/拆后文案", () => {
    const files = [
      "../../components/solution-studio/SolutionSubtabs.tsx",
      "../../components/solution-studio/EditorWorkspace.tsx",
      "../../components/solution-studio/SolutionDeliveryScreen.tsx",
      "../../components/solution-studio/RequirementCoverageRail.tsx",
      "./SolutionStudioPage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})
