import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

// ---------------------------------------------------------------------------
// R304(r303-kb-cache-bypass-sites) 全仓漂移守卫：知识库「全量含正文语料」只有一个取用出口
// —— kbAssemble.getCachedVisibleDocs（并发去重 + 5 分钟 TTL + 经 onKbMutation 的变更即时失效）。
// 此前这个口径只靠 R229（问答通道）、R303（方案通道）各补一条「单文件断言」守着，全仓没有总闸，
// 于是助手取数 / 竞品事实聚合 / 标书素材面板 / 方案入库向导四处一直各自裸调全库直拉：实测同一批
// ~7000 篇含正文语料（35 页）被按通道数重复下载，竞品侧还在内存里另存一份，且知识库变更后最长
// 5 分钟把旧语料喂进 AI。本文件把「谁允许直拉」写成显式清单：新增绕过点即红；清单里的文件若不再
// 直拉也必须报错移除（防清单腐烂）。单文件级断言仍留在 solKbWarm.test.ts，本文件补全仓视角。
// ---------------------------------------------------------------------------

const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const ROOT = process.cwd()

function splitLines(txt: string): string[] {
  return txt.split(LF).map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l))
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      walk(p, acc)
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.includes(".test.") &&
      !name.includes(".spec.")
    ) {
      acc.push(p)
    }
  }
  return acc
}

/** 只留代码行：本项目修复说明的注释里大量引用旧函数名 listKbDocs()，注释命中不算绕过点 */
function codeOnly(txt: string): string {
  return splitLines(txt)
    .map((line) => {
      const t = line.trim()
      if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return ""
      const idx = line.indexOf("//")
      if (idx > 1 && line.charAt(idx - 1) !== ":") return line.slice(0, idx)
      return line
    })
    .join(LF)
}

/** relPath（POSIX 分隔）-> 该文件里出现 listKbDocs 的代码行 */
const sites = new Map<string, string[]>()
for (const file of walk(join(ROOT, "src"))) {
  const hits = codeOnly(readFileSync(file, "utf8"))
    .split(LF)
    .map((l) => l.trim())
    .filter((l) => l.includes("listKbDocs"))
  if (hits.length > 0) sites.set(relative(ROOT, file).split(sep).join("/"), hits)
}

/**
 * 允许直接调用 listKbDocs 的文件与理由。要往这里加一条，必须先说明为什么不能走共享缓存
 * （返回形态不同 / 只要其中一小部分 / 与缓存语义冲突），否则应改调用方而不是扩清单。
 */
const ALLOW: Record<string, string> = {
  "src/lib/kbCore.ts": "定义处本身",
  "src/lib/kbAssemble.ts": "共享缓存的唯一包装点：getCachedVisibleDocs 内部就是那一次全库拉取",
  "src/lib/kbCorpusLazy.ts":
    "2026-10-31 新增的渐进加载入口：只拉元数据(slim，省 94% 体积)再按 query 补正文，被 kbAssemble.getDocsForQuery 统一收口，不构成旁路",
  "src/pages/Knowledge/useKnowledge.ts":
    "知识库列表通道：slim=1 服务端置空 content + onBatch 渐进直显，与共享缓存的「含正文全量」形态互斥",
  "src/components/shell/useGlobalSearch.ts":
    "命令面板：服务端 q= 加 fields 裁剪只取 20 条，改走全量缓存反而是性能倒退",
}

/** R304 本轮收敛掉的四个绕过点 */
const CONVERGED = [
  "src/lib/assistantCore.ts",
  "src/components/bid-workspace/BidMaterialAmmoPanel.tsx",
  "src/pages/Competitors/competitorEvidence.ts",
  "src/components/solution-studio/SolutionToKbWizard.tsx",
]

function readCode(rel: string): string {
  return codeOnly(readFileSync(join(ROOT, rel), "utf8"))
}

describe("R304 全库语料单一出口（r303-kb-cache-bypass-sites）", () => {
  it("除清单内文件外，没有任何模块直拉 listKbDocs", () => {
    const offenders = [...sites.keys()].filter((f) => !(f in ALLOW))
    const detail = offenders.map((f) => f + " -> " + (sites.get(f) ?? [""])[0]).join(" | ")
    expect(detail, "以下文件绕过 kbAssemble 共享缓存直拉全库语料：" + detail).toBe("")
  })

  it("允许清单不腐烂：清单里的文件确实还在直拉", () => {
    const stale = Object.keys(ALLOW).filter((f) => !sites.has(f))
    expect(stale, "这些文件已不再直拉 listKbDocs，请把它们从 ALLOW 移除：" + stale.join(", ")).toEqual([])
  })

  it("R304 收敛的四个通道全部改走共享缓存且不再出现直拉", () => {
    for (const rel of CONVERGED) {
      expect(sites.has(rel), rel + " 仍直拉 listKbDocs").toBe(false)
      expect(readCode(rel), rel + " 未走共享缓存").toContain("getCachedVisibleDocs")
    }
  })

  it("竞品通道不再自建第二份全库缓存（内存双份 + 知识库变更不失效）", () => {
    const code = readCode("src/pages/Competitors/competitorEvidence.ts")
    expect(code).not.toContain("let kbCache")
    expect(code).not.toContain("KB_CACHE_TTL_MS")
  })

  it("助手通道的可见性过滤收敛到缓存处（不再自行 visibleKbDocs 二次过滤）", () => {
    const code = readCode("src/lib/assistantCore.ts")
    expect(code).not.toContain("visibleKbDocs")
    expect(code).toContain("getCachedVisibleDocs(userId)")
  })
})
