/** @vitest-environment jsdom */
/**
 * R66（2026-10-29）资质「导出硬拦截」开关：口径单一真源 + 跨文件防回流哨兵。
 *
 * 修的缺陷：同一个 localStorage 键两处各写一套判定，且默认值相反——
 *   资质台账页 `=== "1"`（键不存在 → 显示「关」）
 *   导出闸门   `!== "0"`（键不存在 → 实际在拦）
 * 于是**从没碰过开关的人**（默认态）看到「导出硬拦截：关」，导出时却被红字阻断；
 * 而提示让他「去关闭硬拦截」，点一下只会写入 "1"（仍在拦），看起来像开关坏了。
 *
 * 本文件三组断言：
 *   ① readQualHardBlock 的三种状态口径（缺失/关/开/脏值）+ storage 不可用降级；
 *   ② 写入必须是 "0"/"1"（写空串或删键都会被读成默认的「拦」，是这次 bug 的同类复发点）；
 *   ③ **跨文件哨兵**：台账页不得再退回 `=== "1"`；导出闸门必须仍是「只有 "0" 才放行」
 *      （若哪天闸门改成别的口径，这里立刻变红，强制两边一起改）。
 */
import { describe, expect, it, beforeEach } from "vitest"
import { QUAL_HARD_BLOCK_KEY, readQualHardBlock, writeQualHardBlock } from "./qualHardBlock"
import { countMatches, HOOK_PATH, sourceText } from "@/testing/hookSources"

const QUALS_HOOK = "src/pages/QualCerts/useQualCerts.ts"
// 导出闸门所在文件一律用单一入口的 HOOK_PATH，不在这里另写路径字面量
// （src/testing/hookSourcesConvergence.test.ts 的边界①盯着这条）。
const BID_HOOK = HOOK_PATH

describe("readQualHardBlock · 默认拦，只有显式 \"0\" 才放行", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("键不存在（新用户/清缓存）→ 拦（与导出闸门同口径）", () => {
    expect(window.localStorage.getItem(QUAL_HARD_BLOCK_KEY)).toBeNull()
    expect(readQualHardBlock()).toBe(true)
  })

  it("用户显式关闭写 \"0\" → 放行", () => {
    window.localStorage.setItem(QUAL_HARD_BLOCK_KEY, "0")
    expect(readQualHardBlock()).toBe(false)
  })

  it("用户显式开启写 \"1\" → 拦", () => {
    window.localStorage.setItem(QUAL_HARD_BLOCK_KEY, "1")
    expect(readQualHardBlock()).toBe(true)
  })

  it("脏值（空串 / true / 大小写变体）一律按「拦」——脏值不得静默放行", () => {
    for (const dirty of ["", "true", "false", " 0", "0 ", "null"]) {
      window.localStorage.setItem(QUAL_HARD_BLOCK_KEY, dirty)
      expect(readQualHardBlock(), `脏值「${dirty}」被当成了关闭`).toBe(true)
    }
  })

  it("localStorage 不可用（读抛错）→ 放行并按软警告处理，不把导出全锁死", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage disabled")
      },
    })
    try {
      expect(readQualHardBlock()).toBe(false)
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original)
    }
  })
})

describe("writeQualHardBlock · 写值必须能被读回同一状态", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("关 → 落盘 \"0\"（不能删键，删键会被读成默认「拦」）", () => {
    writeQualHardBlock(false)
    expect(window.localStorage.getItem(QUAL_HARD_BLOCK_KEY)).toBe("0")
    expect(readQualHardBlock()).toBe(false)
  })

  it("开 → 落盘 \"1\"", () => {
    writeQualHardBlock(true)
    expect(window.localStorage.getItem(QUAL_HARD_BLOCK_KEY)).toBe("1")
    expect(readQualHardBlock()).toBe(true)
  })

  it("往返：开 → 关 → 开，三次读回都正确", () => {
    writeQualHardBlock(true)
    expect(readQualHardBlock()).toBe(true)
    writeQualHardBlock(false)
    expect(readQualHardBlock()).toBe(false)
    writeQualHardBlock(true)
    expect(readQualHardBlock()).toBe(true)
  })
})

describe("跨文件哨兵 · 台账页与导出闸门不许再各写一套判定", () => {
  it("台账页走单一真源，且不得退回 `=== \"1\"` 的旧判定", () => {
    const src = sourceText(QUALS_HOOK)
    expect(countMatches(src, /readQualHardBlock\(\)/g)).toBe(1)
    expect(countMatches(src, /writeQualHardBlock\(/g)).toBe(1)
    // 旧判定（默认关）必须彻底消失：它正是「界面说关、实际在拦」的根因
    expect(countMatches(src, /qual_hard_block[\s\S]{0,80}===\s*"1"/g)).toBe(0)
  })

  it("导出闸门仍是「只有显式 \"0\" 才放行」（改口径必须两边一起改，此断言强制同步）", () => {
    const src = sourceText(BID_HOOK)
    const viaShared = countMatches(src, /readQualHardBlock\(\)/g)
    const viaInline = countMatches(src, /qual_hard_block"\)\s*!==\s*"0"/g)
    // 允许两种形态：已接入单一真源，或仍是等价的「!== "0"」内联判定；两者都没有则说明口径被改了
    expect(viaShared + viaInline, "导出闸门的硬拦截判定既没走 readQualHardBlock()，也不再是 !== \"0\"——请同步 lib/qualHardBlock 与台账页").toBeGreaterThan(0)
  })
})
