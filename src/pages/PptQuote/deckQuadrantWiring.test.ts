// ---------------------------------------------------------------------------
// 四象限版式接线哨兵（2026-11-05 v4）
//
// 手工小样验证过的方案，必须钉住"接线到位"，不能只测纯函数：
//   · 引擎选样张页时要按内容形态（4 条并列）优先挑四象限页；
//   · 注入时要真的把 4 条要点拆到 8 个格子（而不是全塞一个框）；
//   · 不适配时必须安全退回，不能为了套四象限把内容弄坏。
//
// 背景（为什么值得单独立哨兵）：这个能力前面失败过 6 次，每次都是
// "纯函数对了、接线没到位"或"判据与实际数据不符"。源码级断言能防回归。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const FID = new URL("./templateFidelity.ts", import.meta.url)
const QUAD = new URL("./deckQuadrant.ts", import.meta.url)
const PROMPT = new URL("./pptQuoteTypes.ts", import.meta.url)

describe("四象限能力 · 接线哨兵", () => {
  it("引擎 import 了四象限模块的三个能力", () => {
    const code = readFileSync(FID, "utf-8")
    expect(code).toContain('from "./deckQuadrant"')
    expect(code).toContain("detectQuadrantSlots")
    expect(code).toContain("fitsQuadrant")
    expect(code).toContain("splitQuadrantText")
  })

  it("选样张页时按内容形态偏好四象限页（否则永远选中默认页）", () => {
    const code = readFileSync(FID, "utf-8")
    // 必须把 fitsQuadrant 的结果传进 pickSampleByLayout
    expect(code).toMatch(/pickSampleByLayout\([^)]*fitsQuadrant\(lines\)/)
    // pickSampleByLayout 里要有 quadrant 分支
    expect(code).toContain('prefer === "quadrant"')
  })

  it("注入时把要点分配到四象限格子，并同时写主标题与底部标签", () => {
    const code = readFileSync(FID, "utf-8")
    expect(code).toContain("slots.cells.forEach")
    expect(code).toContain("slots.footerTags.forEach")
    expect(code).toContain("slots.headline")
    // 四象限走通后，不允许再走「全塞一个框」的老路
    expect(code).toMatch(/quadrantUsed/)
    expect(code).toMatch(/!quadrantUsed && bIdx >= 0/)
  })

  it("detectQuadrantSlots 的判据用「文字长度」而不是字号（实测字号常缺省为 0）", () => {
    const code = readFileSync(QUAD, "utf-8")
    // 说明行必须比标题行更长
    expect(code).toContain("botLen > topLen")
    // 不应再依赖"上大下小"的字号比较
    expect(code).not.toContain("topSz > botSz")
  })

  it("生成侧提示词给了「4 条并列 + 短标签：说明」的写法指引", () => {
    const code = readFileSync(PROMPT, "utf-8")
    expect(code).toContain("短标签：一句说明")
    expect(code).toContain("四象限")
  })

  it("不适配时安全退回（fitsQuadrant 为 false 就不走四象限）", () => {
    const code = readFileSync(FID, "utf-8")
    // 触发条件是 fitsQuadrant(lines)，不是无条件尝试
    expect(code).toMatch(/if \(fitsQuadrant\(lines\)\)/)
  })
})
