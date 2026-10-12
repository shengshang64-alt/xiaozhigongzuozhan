// R248 防回流哨兵：素材库联网抓取顶栏「取消选择」按钮必须清空整批选择，
// 而非只移除首个选中项。此前实现为 onClick={() => p.toggleSelectUrl(p.selectedUrls[0])}，
// 多选时点击后仍残留 N-1 张高亮且「已选 N 张」不清零，与按钮语义相悖。
// 现改为 hook 暴露 clearSelection（setSelectedUrls([])）并由按钮直接调用。
// 采用源码扫描（与 disclosureA11y.test.ts / onDemandHeavyLibs.test.ts 同风格，纯 node fs，无需 jsdom）。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe("R248 素材库「取消选择」清空整批选择（防回流）", () => {
  const hook = readFileSync(path.join(HERE, "useMaterialLibrary.ts"), "utf-8")
  const page = readFileSync(path.join(HERE, "MaterialLibraryPage.tsx"), "utf-8")

  it("hook 暴露 clearSelection 且确为整批清空", () => {
    expect(hook).toContain("const clearSelection = useCallback(() => setSelectedUrls([]), [])")
    expect(hook).toMatch(/selectedUrls,\s*toggleSelectUrl,\s*clearSelection,/)
  })

  it("「取消选择」按钮接 clearSelection，不再误用单项 toggle", () => {
    expect(page).toContain("<Button size=\"sm\" variant=\"ghost\" onClick={p.clearSelection}>")
    expect(page).not.toContain("p.toggleSelectUrl(p.selectedUrls[0])")
  })
})
