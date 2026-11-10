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
  // UX-v2 四屏拆分后，抓取结果区从 MaterialLibraryPage 迁到 MaterialWebScreen；
  // 哨兵口径不变，扫描对象跟着搬到新家。
  const page = readFileSync(path.join(HERE, "MaterialWebScreen.tsx"), "utf-8")

  it("hook 暴露 clearSelection 且确为整批清空", () => {
    expect(hook).toContain("const clearSelection = useCallback(() => setSelectedUrls([]), [])")
    expect(hook).toMatch(/selectedUrls,\s*toggleSelectUrl,\s*clearSelection,/)
  })

  it("「取消选择」按钮接 clearSelection，不再误用单项 toggle", () => {
    // 按钮样式在四屏重排里会调 className，所以只钉「ghost 变体 + onClick={p.clearSelection}」这对语义
    expect(page).toMatch(/<Button[^>]*variant="ghost"[^>]*onClick=\{p\.clearSelection\}/)
    expect(page).not.toContain("p.toggleSelectUrl(p.selectedUrls[0])")
  })
})
