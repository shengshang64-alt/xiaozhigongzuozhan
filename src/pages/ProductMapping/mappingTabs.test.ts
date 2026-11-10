// 产品映射 屏内 Tab 口径守卫（UX-v2：prototype/mapping/ 四屏）。
// 与其余模块的 tabs 守卫同思路：Tab 名称/顺序对齐原型 manifest；拆屏零丢失钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MAPPING_TABS, mappingTabHref, parseMappingTab, type MappingTab } from "./mappingTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 mapping 四屏", () => {
  it("顺序固定为 ① 选择清单 → ② 对照 → ③ 结果 → 产品库", () => {
    expect(MAPPING_TABS.map((t) => t.key)).toEqual(["upload", "compare", "result", "library"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(MAPPING_TABS.map((t) => t.label)).toEqual(["① 选择清单", "② 对照", "③ 结果", "产品库"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of MAPPING_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省一律落「① 选择清单」，旧书签行为不变", () => {
    expect(parseMappingTab(null)).toBe("upload")
    expect(parseMappingTab("")).toBe("upload")
    expect(parseMappingTab("compare ")).toBe("upload")
    expect(parseMappingTab("../")).toBe("upload")
  })

  it("合法值原样透传", () => {
    const keys: MappingTab[] = ["upload", "compare", "result", "library"]
    for (const k of keys) expect(parseMappingTab(k)).toBe(k)
  })

  it("默认 Tab 地址不带参数，其余屏带 ?tab=", () => {
    expect(mappingTabHref("upload")).toBe("/product-mapping")
    expect(mappingTabHref("compare")).toBe("/product-mapping?tab=compare")
    expect(mappingTabHref("library")).toBe("/product-mapping?tab=library")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与新屏组件里都没有拆前/拆后文案", () => {
    const files = [
      "../../components/product-mapping/MappingSubtabs.tsx",
      "./ProductMappingPage.tsx",
    ]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失：既有能力全部保留并归位", () => {
  it("页面壳引用了全部既有组件与导出能力（一个不删，只重新归位）", () => {
    const page = readSrc("./ProductMappingPage.tsx")
    for (const mod of [
      "SourcePanel",
      "CompareTable",
      "ChecklistTable",
      "RatingFilterBar",
      "UploadWizardDialog",
      "MappingMemoryDialog",
      "CompanyLibraryDialog",
      "CostConfirmDialog",
      "previewOneLink",
      "exportCompare",
      "exportCoverage",
      "exportRatingCoverage",
      "exportCompanyStandard",
      "exportSkeleton",
      "saveMapping",
      "adoptAllSuggestions",
      "runAiMatch",
    ]) {
      expect(page.includes(mod), `产品映射拆屏丢了模块/能力：${mod}`).toBe(true)
    }
  })

  it("②③ 无结果时给指向 ① 的空态，不渲染死白页", () => {
    const page = readSrc("./ProductMappingPage.tsx")
    expect(page).toContain("EmptyStepHint")
    expect((page.match(/EmptyStepHint/g) ?? []).length).toBeGreaterThanOrEqual(3) // 定义 + 两处使用
  })

  it("产品库为「公司库 / 记忆库 / 导入 ONE-LINK」三合一资产页（manifest 口径）", () => {
    const page = readSrc("./ProductMappingPage.tsx")
    expect(page).toContain("LibraryHub")
    expect(page).toContain("映射记忆库")
    expect(page).toContain("导入 ONE-LINK 清单")
  })
})
