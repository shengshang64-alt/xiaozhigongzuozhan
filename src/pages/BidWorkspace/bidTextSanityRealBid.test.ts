// R55（2026-10-16）：bidTextSanity 真实语料校准（首次把"误报率"从推断变成实测）
// ---------------------------------------------------------------------------
// 为什么要有这个文件：
//   R-301 上线时只写了「误报率几乎为 0 / 极低」的**设计推断**，从未在真实标书正文上量过；
//   而同类本地检测（R-302 文风 lint）恰恰是拿真实语料校准后才修掉误报的。
//   本文件把语料校准固化成回归哨兵：日后任何"扩召回"改动若把合法中文判成丢字，这里立刻变红。
//
// 语料：__fixtures__/azhongyiRealBid.json（安中医项目脱敏子集，真实生产数据）
//   bid_text     47,103 字 —— AI 生成的投标正文（本检测器的真实输入）
//   tender_text  32,957 字 —— 招标原文（表格 / OCR 抽取文本，不是本检测器的输入）
//
// R55 实测（另含 .probe/az-fixture/azhongyi.full.json 全量 138,810 字）：
//   投标正文合计 185,913 字 → **0 命中**（残缺搭配族 0 / 过短行族 0）
//   招标原文 32,957 字 → 只有过短行族命中，且全部是表格单元格被抽成独立行的误报
//     （「条款」「号」「部门」「序」…），残缺搭配族依旧 0
//   → 结论一：「词中留白」判据（BROKEN_PAIRS）连表格/OCR 文本都不误伤，可放心扩召回；
//     结论二：过短行族只适用于正文，生产路径也只扫章节正文（applyAutoRepair），风险已隔离。
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { detectLostChars } from "./bidTextSanity"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SUBSET_PATH = path.join(DIR, "__fixtures__", "azhongyiRealBid.json")
/** 全量语料在 .probe 下（不在 src 内，CI 可能没有）——有就多一道校准，没有就跳过 */
const FULL_PATH = path.join(DIR, "..", "..", "..", ".probe", "az-fixture", "azhongyi.full.json")

type Fixture = { bid_text: string; tender_text: string; meta: { bid_chars: number; tender_chars: number } }

const subset = JSON.parse(readFileSync(SUBSET_PATH, "utf-8")) as Fixture
const hasFull = existsSync(FULL_PATH)
const full = hasFull ? (JSON.parse(readFileSync(FULL_PATH, "utf-8")) as { bid_text: string }) : null

describe("R55 真实语料校准：投标正文零误报", () => {
  it("语料自证：确实含 AI 正文与「门诊患者」正写法（否则 0 命中是空洞结论）", () => {
    expect(subset.bid_text.length).toBeGreaterThan(40000)
    expect(subset.tender_text.length).toBeGreaterThan(30000)
    // 校准对象必须真的存在：13 处「门诊患」在真实语料里**全部**是正确写法「门诊患者」，
    // 所以 R55 新模式（门诊患 + 数字/量词）在真实语料上的真实暴露 = 0 误报。
    expect(subset.bid_text).toContain("门诊患者")
    expect((subset.bid_text.match(/门诊患/g) ?? []).length).toBeGreaterThan(0)
    // 反面：真实语料里不存在残缺样本，说明"0 命中"不能被解读为"检测器没跑"
    expect(subset.bid_text).not.toContain("门诊患 15000")
  })

  it("47,103 字真实投标正文 → 0 命中（含 R55 新模式）", () => {
    const r = detectLostChars(subset.bid_text, 99)
    expect(
      r.hits.map((h) => `[${h.kind}] ${h.reason} @${h.offset}`),
      "真实投标正文出现丢字误报（补丁把合法中文判成了丢字）",
    ).toEqual([])
    expect(r.summary).toBe("")
  })

  it("32,957 字招标原文：只有过短行族会响，「词中留白」判据零误报", () => {
    const r = detectLostChars(subset.tender_text, 99)
    // 表格单元格被抽成独立行 → 过短行族必然误报，这是**已知且已隔离**的（不扫招标原文）
    expect(r.hits.every((h) => h.kind === "short_line")).toBe(true)
    // 关键不变量：残缺搭配族在表格/OCR 文本上也不误报 → 该判据可以安全扩召回
    expect(r.hits.filter((h) => h.kind === "missing_modifier").length).toBe(0)
  })

  it.skipIf(!hasFull)("138,810 字全量真实投标正文 → 0 命中", () => {
    const r = detectLostChars(full!.bid_text, 99)
    expect(r.hits.map((h) => `[${h.kind}] ${h.reason} @${h.offset}`)).toEqual([])
  })
})
