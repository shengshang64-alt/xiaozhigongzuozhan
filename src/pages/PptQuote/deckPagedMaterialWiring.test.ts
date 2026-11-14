import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, "usePptQuote.ts"), "utf8")

function sliceFn(name: string): string {
  const re = new RegExp(`const ${name} = useCallback\\(`)
  const m = re.exec(src)
  if (!m) throw new Error(`未找到 ${name}`)
  // 取该回调到下一个顶层 const / 文件片段（足够覆盖函数体）
  const start = m.index
  const next = src.slice(start + m[0].length).search(/\n  const [A-Za-z]/)
  return next >= 0 ? src.slice(start, start + m[0].length + next) : src.slice(start, start + 8000)
}

describe("确认路径与一键直出走同一套按页取材", () => {
  it("generateFromOutline / runDeckGeneration 源码出现 fetchMaterialParts 与 withPageAtoms", () => {
    const run = sliceFn("runDeckGeneration")
    const fromOutline = sliceFn("generateFromOutline")
    const draft = sliceFn("draftDeckOutline")
    expect(run).toContain("fetchMaterialParts")
    expect(run).toContain("withPageAtoms")
    expect(run).not.toMatch(/ctx\.materialText = await fetchMaterialText/)
    expect(fromOutline).not.toMatch(/await fetchMaterialText\(/)
    expect(draft).toContain("fetchMaterialParts")
    expect(draft).not.toMatch(/ctx\.materialText = await fetchMaterialText/)
    // 一键直出路径保持按页注入
    const oneClick = sliceFn("doGenerateDeck")
    expect(oneClick).toContain("fetchMaterialParts")
    expect(oneClick).toContain("withPageAtoms")
  })
})
