import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// R303 漂移守卫：方案编制的 KB 语料通道口径。
// 实机网络日志取证到的两类浪费——① 进方案不预热共享缓存，首章「生成正文」在关键路径上串行等
// 全库拉取（实测 33 页 ×500 条）；② 素材面板裸调 listKbDocs() 绕过共享缓存，同批全量语料被
// 并发下载两遍。修法与标书侧 openProject（r89-guard-kb-cold-01）、问答侧 R229 同构，
// 本文件锁死三条口径，防止后续改动顺手退回旧行为（这类退化在本项目已复发过：R229 修前 QA 同病）。
const HOOK = "src/pages/SolutionStudio/useSolutionStudio.ts"
const SRC = readFileSync(HOOK, "utf8")

/** 取某个 useCallback 函数体的文本片段（从声明到下一个顶层 useCallback/const 声明） */
function fnBody(name: string): string {
  const begin = SRC.indexOf(`const ${name} = useCallback`)
  expect(begin, `未能定位 ${name}（结构可能已变，请同步本测试）`).toBeGreaterThan(-1)
  const rest = SRC.slice(begin + 1)
  const next = rest.search(/\n {2}const [A-Za-z]+ = useCallback/)
  return next > 0 ? SRC.slice(begin, begin + 1 + next) : SRC.slice(begin)
}

describe("R303 方案侧 KB 语料通道口径", () => {
  it("打开方案即预热共享语料缓存（不再把全库冷拉压进首章生成的关键路径）", () => {
    const body = fnBody("openSolution")
    expect(body).toContain("prewarmKbCache(userId)")
    expect(body).toContain("applySolutionState(target)")
    // 预热必须排在状态应用之后、且整段仍在 openSolution 内（顺序错了就还是冷启动）
    expect(body.indexOf("applySolutionState(target)")).toBeLessThan(body.indexOf("prewarmKbCache(userId)"))
  })

  it("素材面板走共享缓存，绝不裸调 listKbDocs()", () => {
    const body = fnBody("loadMaterialSources")
    expect(body).not.toContain("listKbDocs(")
    expect(body).toContain("getCachedVisibleDocs(userId)")
  })

  it("强制刷新仍保证取最新全量（入库向导回填语义不变）", () => {
    const body = fnBody("loadMaterialSources")
    expect(body).toContain("if (force) invalidateKbCache()")
  })

  it("正文生成检索语料同样只经共享缓存（全文件仅一处消费点、零重复下载）", () => {
    // listKbDocs 已从本模块导入中移除：任何新增的全库直拉都会让本断言变红
    expect(SRC).not.toMatch(/^\s*listKbDocs,?$/m)
    expect(SRC).not.toContain("listKbDocs()")
    expect(SRC).toContain("await ensureKbCache()")
    expect(fnBody("ensureKbCache")).toContain("getCachedVisibleDocs")
  })
})
