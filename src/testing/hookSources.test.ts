/**
 * `hookSources()` 单一入口自身的回归网（R57 · 审计 §3.1）。
 *
 * 这个文件守的是「哨兵的地基」：路径口径（仓库相对 POSIX）、行尾归一（CRLF→LF，
 * P0-1 假红的根因）、读取缓存、漏 `g` 的计数失真、读不到文件时要会喊。
 * 地基塌了，上面所有源码哨兵的「红/绿」都不再可信。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  HOOK_PATH,
  REPO_ROOT,
  countMatches,
  hookSources,
  normalizeEol,
  resetSourceCache,
  sourceText,
} from "./hookSources"

describe("hookSources：源码哨兵的单一读取入口", () => {
  it("normalizeEol：CRLF 与裸 CR 都归一成 LF（P0-1 假红的根因）", () => {
    expect(normalizeEol("a\r\nb\r\nc")).toBe("a\nb\nc")
    expect(normalizeEol("a\rb")).toBe("a\nb")
    expect(normalizeEol("a\nb")).toBe("a\nb")
    // 行锚只在归一后才可能命中——这正是 proseFallbackWiring 那次假红的机制
    const crlf = 'const x = 1\r\n  "bid-outline",\r\n'
    expect(crlf.match(/\n\s*"bid-outline",\n/g)).toBeNull()
    expect(normalizeEol(crlf).match(/\n\s*"bid-outline",\n/g)?.length).toBe(1)
  })

  it("sourceText：读到真实源码、行尾已归一、路径是仓库相对 POSIX", () => {
    const hook = sourceText(HOOK_PATH)
    expect(hook).toContain("export function useBidWorkspace()")
    expect(hook).not.toContain("\r")
    // 未归一的对照片段：直接读原始文件（若工作区此刻是 LF，这条对照自动退化为恒真，不影响主断言）
    const raw = readFileSync(path.resolve(REPO_ROOT, HOOK_PATH), "utf-8")
    expect(hook.length).toBeLessThanOrEqual(raw.length)
    expect(hook.replace(/\n/g, "")).toBe(raw.replace(/\r?\n/g, ""))
  })

  it("sourceText：同进程内缓存优先（命中返回同一对象；文件变了仍读旧值，清缓存后才读到新值）", () => {
    resetSourceCache()
    const a = sourceText(HOOK_PATH)
    expect(sourceText(HOOK_PATH)).toBe(a) // 命中缓存 = 同一字符串对象，未重新读盘

    // 用可观察语义钉死缓存，而**不是**用对象身份去赌引擎行为（`not.toBe` 会随 V8 字符串去重翻车）：
    // 文件内容真的变了、但缓存未清 → 仍读旧值；清缓存 → 读到新值。
    const probe = ".scratch/r57-cache-probe.txt" // .scratch 已 gitignore，且不在测试发现白名单内
    const abs = path.resolve(REPO_ROOT, probe)
    mkdirSync(path.dirname(abs), { recursive: true })
    try {
      writeFileSync(abs, "v1", "utf-8")
      resetSourceCache()
      expect(sourceText(probe)).toBe("v1")
      writeFileSync(abs, "v2", "utf-8")
      expect(sourceText(probe)).toBe("v1")
      resetSourceCache()
      expect(sourceText(probe)).toBe("v2")
    } finally {
      rmSync(abs, { force: true })
    }
  })

  it("sourceText：读不到时报可读错误（含仓库相对路径 + 补救提示），不甩 ENOENT", () => {
    expect(() => sourceText("src/__r57_not_a_real_file__.ts")).toThrowError(/源码哨兵读取失败/)
    expect(() => sourceText("src/__r57_not_a_real_file__.ts")).toThrowError(/hookSources\.ts 的 HOOK_PATH/)
    expect(() => sourceText("src/__r57_not_a_real_file__.ts")).not.toThrowError(/ENOENT/)
  })

  it("sourceText：拒绝越界路径（仓库外的文件不许被哨兵偷看）", () => {
    expect(() => sourceText("../../../etc/hosts")).toThrowError(/越界/)
  })

  it("hookSources：默认只读 God Hook；带参时按顺序拼接附加文件", () => {
    expect(hookSources()).toBe(sourceText(HOOK_PATH))
    const joined = hookSources("src/pages/BidWorkspace/bidTypes.ts", "src/pages/BidWorkspace/parseCoverage.ts")
    expect(joined.startsWith(sourceText(HOOK_PATH))).toBe(true)
    expect(joined).toContain("SNAPSHOT_DIAG_KEY") // bidTypes 的真实标记
    expect(joined).toContain("missingCriticalSections") // parseCoverage 的真实标记
  })

  it("countMatches：正常计数，且漏 g 时直接报错而不是静默算成 1", () => {
    expect(countMatches("a a a", /a/g)).toBe(3)
    expect(countMatches("a a a", /zzz/g)).toBe(0)
    // 漏 g 的对照组：String.match 的真实行为就是「只给首个匹配」
    expect("a a a".match(/a/)?.length).toBe(1)
    expect(() => countMatches("a a a", /a/)).toThrowError(/需要带 g 标志/)
  })

  it("countMatches 在真实 hook 上给出与朴素 match 一致的结果（守住计数口径）", () => {
    const hook = hookSources()
    const re = /\n\s*"bid-outline",\n/g
    expect(countMatches(hook, re)).toBe((hook.match(re) ?? []).length)
  })
})
