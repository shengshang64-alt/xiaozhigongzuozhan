// R124 防回潮哨兵：docx/xlsx/pptxgenjs 三个数百 kB 级的重导出库，必须只在用户点击
// 「导出/导入 Excel/Word/PPT」时经 await import() 按需加载，不允许再被“静态 import
// 链可达入口(main.tsx)或页级路由壳”的形式打进首载 bundle（历史事故：docx 经浮动助手
// 静态链漏进入口 chunk，全站每一页首访都要多载数百 kB）。
// 本用例对静态 import 图做 BFS（不含动态 import、不含 import type），钉住 R124 拆分成果。
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** 解析一个源文件里的“静态”依赖说明符：import x from "m" / import "m" / export ... from "m"。
 *  动态 import("m") 与 import type {...} from "m"（编译期擦除）不计。 */
function staticSpecs(code: string): string[] {
  const out: string[] = []
  const re = /(?:^|\n)[ \t]*(?:import|export)\b([\s\S]*?)from[ \t]*["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const clause = m[1]
    // import type { ... } / export type { ... } 纯类型导入不计（子句以 type 开头）
    if (/^[ \t]*type\b/.test(clause)) continue
    out.push(m[2])
  }
  const bare = /(?:^|\n)[ \t]*import[ \t]*["']([^"']+)["']/g
  while ((m = bare.exec(code))) out.push(m[1])
  return out
}

/** 从 start 文件出发 BFS 静态 import 图，找是否可达指定第三方包。返回首个命中与到达链。 */
function findStaticReach(start: string, libs: string[]): { hit: string | null; chain: string[] } {
  const seen = new Set<string>()
  const queue: Array<{ file: string; trail: string[] }> = [{ file: start, trail: [path.relative(SRC, start)] }]
  while (queue.length) {
    const cur = queue.shift() as { file: string; trail: string[] }
    if (seen.has(cur.file)) continue
    seen.add(cur.file)
    let code: string
    try {
      code = readFileSync(cur.file, "utf-8")
    } catch {
      continue
    }
    for (const spec of staticSpecs(code)) {
      const pkgRoot = spec.split("/")[0]
      if (!spec.startsWith(".") && !spec.startsWith("@/") && libs.includes(pkgRoot)) {
        return { hit: spec, chain: [...cur.trail, `${path.relative(SRC, cur.file)} -> ${spec}`] }
      }
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : path.resolve(path.dirname(cur.file), spec)
        if (/\.(css|svg|png|jpg)$/.test(base)) continue
        for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
          if (existsSync(cand) && /\.(tsx?|mjs)$/.test(cand)) {
            queue.push({ file: cand, trail: [...cur.trail, path.relative(SRC, cur.file)] })
            break
          }
        }
      }
    }
  }
  return { hit: null, chain: [] }
}

const ALL_HEAVY = ["docx", "xlsx", "pptxgenjs"]

describe("R124 重型导出库不进静态首载图（防回潮）", () => {
  it("入口 main.tsx 静态不可达 docx/xlsx/pptxgenjs（每页共享的 bundle 不被导出库拖累）", () => {
    const r = findStaticReach(path.join(SRC, "main.tsx"), ALL_HEAVY)
    expect(r.hit, `静态链：${r.chain.join(" > ")}`).toBeNull()
  })

  it("PptQuote 路由壳静态不可达 xlsx/docx/pptxgenjs（导出点击时才加载）", () => {
    const r = findStaticReach(path.join(SRC, "pages", "PptQuote", "index.tsx"), ALL_HEAVY)
    expect(r.hit, `静态链：${r.chain.join(" > ")}`).toBeNull()
  })

  it("IntelCenter 路由壳静态不可达 xlsx", () => {
    const r = findStaticReach(path.join(SRC, "pages", "IntelCenter", "index.tsx"), ["xlsx"])
    expect(r.hit, `静态链：${r.chain.join(" > ")}`).toBeNull()
  })

  // R147 解除 r124-solutionstudio-docx-defer：useSolutionStudio 导出链（docx/bidFiles/
  // exportTemplate 封面目录）已全部点击时按需化，三个路由壳升级为钉全量重库。
  it("SolutionStudio 路由壳静态不可达 docx/xlsx/pptxgenjs（R147 解除 docx 挂账）", () => {
    const r = findStaticReach(path.join(SRC, "pages", "SolutionStudio", "index.tsx"), ALL_HEAVY)
    expect(r.hit, `静态链：${r.chain.join(" > ")}`).toBeNull()
  })

  it("BidWorkspace 路由壳静态不可达 docx/xlsx/pptxgenjs（R147：bidFiles/defenseHandbook 按需）", () => {
    const r = findStaticReach(path.join(SRC, "pages", "BidWorkspace", "index.tsx"), ALL_HEAVY)
    expect(r.hit, `静态链：${r.chain.join(" > ")}`).toBeNull()
  })

  it("Knowledge 路由壳静态不可达 docx（R147：kbUpload 走 bidFiles 动态导入）", () => {
    const r = findStaticReach(path.join(SRC, "pages", "Knowledge", "index.tsx"), ["docx"])
    expect(r.hit, `静态链：${r.chain.join(" > ")}`).toBeNull()
  })
})
