/**
 * 收敛哨兵（R57 · 审计三稿 §3.1 的自守边界）。
 *
 * 这一层不测业务，测的是**以后写新哨兵的人会不会把路径口径重新散出去**。
 * 背景：审计量出 God Hook 的真实回归网 = 12+ 处源码 grep 哨兵，每处自带
 * `readFileSync` + 自算路径 + 自定行尾策略；搬一次簇要改 N 个文件，
 * 这正是 §3.1 说的「M / 中」风险来源。收敛到 `src/testing/hookSources.ts` 之后，
 * 本文件把「N 处」钉成「1 处」——谁再把路径写回去、谁再自带读取器，这里就红。
 *
 * 四条边界：
 *  ① 路径字面量 `useBidWorkspace.ts` 全仓只允许出现在 `src/testing/hookSources.ts`
 *    （注释里提到它是允许的：注释不参与路径解析，而解释性注释有存在价值）；
 *  ② 凡 import 了单一入口的哨兵，不得再自带 `readFileSync(` 调用（一律走 sourceText / hookSources）；
 *  ③ 单一入口的定义处必须真的可读（HOOK_PATH 指向的文件存在），否则所有哨兵会一起假绿；
 *  ④ 扫描本身要有下限（找到的文件数、走单一入口的文件数），避免「什么都没扫到」也算通过。
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { HOOK_PATH, REPO_ROOT, hookSources, sourceText } from "./hookSources"

/** 唯一定义处：路径字面量与读取策略都只允许出现在这里。 */
const ENTRY = "src/testing/hookSources.ts"
/** 单一入口自身的单测：它是唯一被允许直接 readFileSync 的哨兵（要对照「未归一」的原始文本）。 */
const ENTRY_TEST = "src/testing/hookSources.test.ts"
/**
 * 搜索用的文件名**从 HOOK_PATH 派生**，不写成第二个字面量——
 * 否则「重命名 hook 文件」会变成两处要改，本哨兵自己就成了它要防的那个东西（第一版正是这么翻车的）。
 */
const HOOK_LITERAL = path.posix.basename(HOOK_PATH)
const ENTRY_SPECIFIER = /from\s+"[^"]*testing\/hookSources"/

/** 扫描 src/ 与 scripts/ 下的全部 TS/TSX（跳过 node_modules / dist / .loop——本就在扫描根之外）。 */
function scanSources(): string[] {
  const out: string[] = []
  const walk = (relDir: string): void => {
    for (const ent of readdirSync(path.join(REPO_ROOT, relDir), { withFileTypes: true })) {
      const rel = `${relDir}/${ent.name}`
      if (ent.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(ent.name)) out.push(rel)
    }
  }
  walk("src")
  walk("scripts")
  return out
}

const FILES = scanSources()
const textOf = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf-8").replace(/\r\n?/g, "\n")
const isComment = (line: string): boolean => {
  const t = line.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/** 路径字面量出现在**代码**里的行（注释不算）。 */
function literalCodeLines(rel: string): string[] {
  return textOf(rel)
    .split("\n")
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => line.includes(HOOK_LITERAL) && !isComment(line))
    .map(({ line, no }) => `${rel}:${no} ${line.trim()}`)
}

describe("R57 源码哨兵收敛边界（审计 §3.1：搬簇只改一行路径数组）", () => {
  it("扫描有下限：真的扫到了仓库源码（避免空扫描也算通过）", () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(FILES).toContain(ENTRY)
    expect(FILES).toContain(HOOK_PATH)
  })

  it("① 路径字面量只在单一入口的定义处出现（其余文件一律 hookSources()）", () => {
    const offenders = FILES.filter((rel) => rel !== ENTRY).flatMap(literalCodeLines)
    expect(offenders, `这些地方又把 hook 路径写死了，搬簇时会被漏掉：\n${offenders.join("\n")}`).toEqual([])
    // 定义处必须恰好只有一个（多一个 HOOK_PATH 之外的写法就是又散了一处）
    expect(literalCodeLines(ENTRY).length).toBe(1)
    expect(literalCodeLines(ENTRY)[0]).toContain("HOOK_PATH")
  })

  it("② 走单一入口的哨兵不得再自带 readFileSync 调用", () => {
    const entryUsers = FILES.filter((rel) => ENTRY_SPECIFIER.test(textOf(rel)))
    expect(entryUsers.length, "应有多个哨兵走单一入口").toBeGreaterThanOrEqual(8)
    const offenders = entryUsers.filter(
      (rel) => rel !== ENTRY && rel !== ENTRY_TEST && /readFileSync\s*\(/.test(textOf(rel)),
    )
    expect(offenders, `这些哨兵一边走单一入口、一边自带读取器：${offenders.join(", ")}`).toEqual([])
  })

  it("③ 单一入口指向的文件真的存在且能读（否则所有哨兵会一起假绿）", () => {
    expect(() => sourceText(HOOK_PATH)).not.toThrow()
    expect(hookSources()).toContain("export function useBidWorkspace()")
    expect(HOOK_PATH).toMatch(/^src\/.+\.ts$/) // 仓库相对 POSIX 路径，不是绝对路径、不是 URL
  })

  it("④ 日志口径：列出当前走单一入口的哨兵（搬簇时的复核清单）", () => {
    const entryUsers = FILES.filter((rel) => ENTRY_SPECIFIER.test(textOf(rel))).sort()
    // 不是快照断言（不锁死名单，新增哨兵不该红），只保证清单非空且都在 src/ 下
    expect(entryUsers.every((rel) => rel.startsWith("src/"))).toBe(true)
    expect(entryUsers).toContain("src/pages/BidWorkspace/clauseOutlineAlignment.test.ts")
  })
})
