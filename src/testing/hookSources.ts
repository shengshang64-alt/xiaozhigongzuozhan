/**
 * 源码哨兵的**单一读取入口**（R57 · 对应审计三稿 §3.1 点名的「把哨兵的读取目标收敛成一个
 * `hookSources()` 帮助函数」，此后搬簇只改一行路径数组）。
 *
 * 为什么需要这个文件——下面每一条都是本仓实际踩过的，不是设计洁癖：
 *
 * ① **路径口径曾有三套并存**：`path.join(SRC, rel)`（src 相对）、`new URL("./x.ts", import.meta.url)`
 *    （文件相对），以及两者混用。测试文件一挪目录、hook 一搬簇，每套都要重算一遍。
 * ② **行尾假设是假红的源头**：`proseFallbackWiring` 的 `/\n\s*"bid-outline",\n/` 在 CRLF 下**静默匹配 0 处**，
 *    把「接线完好」误判成「接线缺失」（R55 报告与审计 §2 P0-1 都记过这一次）。此处统一归一到 LF，
 *    全仓「源码哨兵的行尾策略」从此只有这一行。
 *    **注意**：这里修的是「读取侧」。断言里凡带换行的行锚，仍建议写 `\r?\n`——两道保险不冲突。
 * ③ **正则计数漏 `g` 会静默退化**：`String.match` 不带 `g` 时只返回首个匹配，`expect(n).toBe(7)`
 *    会失真成 1；`countMatches` 强制要求 `g` 并给出可读报错。
 * ④ **路径写错时要会喊**：读不到文件时抛出带「仓库相对路径 + 解析后的绝对路径 + 补救提示」的错误，
 *    而不是让 Node 甩一句 `ENOENT ... open 'D:\...'` 让后来者猜是哪个路径数组过期了。
 *
 * 约定：本文件所有路径都是**仓库相对 POSIX 路径**（如 `src/pages/BidWorkspace/useBidWorkspace.ts`），
 * 与 AgentTeams 的 inScope/outOfScope 口径一致。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** 仓库根目录（本文件位于 `src/testing/` 下，上溯两级）。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * God Hook 的仓库相对路径。
 * **搬簇时只改这一行**，所有 `hookSources()` 调用点自动跟随——这正是本文件存在的理由。
 */
export const HOOK_PATH = "src/pages/BidWorkspace/useBidWorkspace.ts"

/** 同进程内每个文件只读一次：既省掉重复读 500 KB，也保证各哨兵看到的是**同一份**文本。 */
const cache = new Map<string, string>()

/** 清空读取缓存（仅当某个测试在本进程内改写了被读文件时才需要）。 */
export function resetSourceCache(): void {
  cache.clear()
}

/**
 * 行尾归一：CRLF / CR → LF。单独导出是为了**能被直接测**——
 * 若把它内联在 sourceText 里，这条策略就只能靠「当前工作区恰好是 CRLF」才测得到，
 * 而工作区行尾会被 `.gitattributes` / `core.autocrlf` 改来改去（正是 P0-1 的由来）。
 */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n")
}

/**
 * 读取一个仓库相对路径的源码文本，统一把 CRLF / CR 归一成 LF。
 * 路径越界或文件不存在时抛出可读错误（含解析后的绝对路径）。
 */
export function sourceText(relPath: string): string {
  const key = relPath.replace(/\\/g, "/")
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const abs = path.resolve(REPO_ROOT, key)
  const rel = path.relative(REPO_ROOT, abs)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `源码哨兵读取越界：${key}\n  解析为：${abs}\n  仓库根：${REPO_ROOT}\n  路径必须是仓库相对 POSIX 路径。`,
    )
  }
  let raw: string
  try {
    raw = readFileSync(abs, "utf-8")
  } catch {
    throw new Error(
      `源码哨兵读取失败：${key}\n  解析为：${abs}\n  仓库根：${REPO_ROOT}\n` +
        `  若刚搬过文件或改过目录结构，请同步 src/testing/hookSources.ts 的 HOOK_PATH，或调用处的路径数组。`,
    )
  }
  const text = normalizeEol(raw)
  cache.set(key, text)
  return text
}

/**
 * God Hook 源码 + 任意附加文件的拼接文本（默认只有 hook 本身）。
 * - `hookSources()` → 只读 God Hook；
 * - `hookSources("src/pages/BidWorkspace/bidTypes.ts")` → hook + 该文件。
 * 变更被钉住的文件时，**只改这里的路径数组**，不必逐个重算正则与计数。
 */
export function hookSources(...extra: string[]): string {
  return [sourceText(HOOK_PATH), ...extra.map((p) => sourceText(p))].join("\n")
}

/**
 * 正则计数：强制要求 `g` 标志。
 * 漏 `g` 时 `String.match` 只返回首个匹配，会把「N 处调用」静默算成 1——这是最难查的一类失真
 * （断言仍然"通过"，只是通过得毫无意义）。宁可直接报错。
 */
export function countMatches(text: string, re: RegExp): number {
  if (!re.flags.includes("g")) {
    throw new Error(
      `countMatches 需要带 g 标志的正则（当前 /${re.source}/${re.flags}）——` +
        `漏 g 时 String.match 只返回首个匹配，计数会静默失真。`,
    )
  }
  return text.match(re)?.length ?? 0
}
