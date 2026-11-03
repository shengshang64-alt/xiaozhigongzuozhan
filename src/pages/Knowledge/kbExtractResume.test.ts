/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  clearProgress,
  extractWithResume,
  listUnfinished,
  loadProgress,
  progressPercent,
  saveProgress,
  type ExtractProgress,
} from "./kbExtractResume"
import { EXTRACT_VERSION } from "./kbExtract"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 抽取断点续跑验收测试（2026-10-31）
//
// 核心价值：300 篇文档抽取要数小时，中断后不应重跑（每段一次 LLM 调用，重跑=重复付费）。
// 本测试锁住：
//   ① 已完成段不重复调用 LLM
//   ② 中断后能从断点继续
//   ③ 失败段可单独重试
//   ④ 版本变更时旧进度作废（提示词变了结果会不同）
// ---------------------------------------------------------------------------

const DOC = `第一章 项目概况
六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。医院编制床位 300 张，年门诊量 42 万人次，建筑面积 2 万平方米。

第二章 建设目标
对标电子病历应用水平 5 级与互联互通四级甲等，建设周期 12 个月，投资预算 1800 万元。

第三章 实施计划
调研 2 周，建设 6 个月，试运行 3 个月，验收 1 个月，全程由项目组统一管理并定期汇报进度。`

const GOOD_ATOM = {
  atom_type: "metric",
  title: "电子病历应用水平达 5 级",
  body: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
  subject_key: "metric:电子病历应用水平分级|国家卫健委评测",
  attributes: { value: 5, unit: "级", year: 2021, scope: "国家卫健委评测" },
  source_quote: "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审。",
  confidence: 0.92,
}

beforeEach(() => {
  localStorage.clear()
})

function mkCallLlm(failSegments: number[] = []) {
  return vi.fn(async (msgs: LlmMessage[]) => {
    // 从 prompt 里识别段号
    const m = /第 (\d+)\/(\d+) 个片段/.exec(String(msgs[0].content))
    const seg = m ? Number(m[1]) : 0
    if (failSegments.includes(seg)) return "不是JSON"
    return JSON.stringify({ atoms: [GOOD_ATOM] })
  })
}

describe("进度存取", () => {
  it("保存后能读回", () => {
    const p: ExtractProgress = {
      docId: "d1",
      docTitle: "文档1",
      version: EXTRACT_VERSION,
      doneSegments: [0, 1],
      failedSegments: [],
      atoms: [],
      atomsBySegment: {},
      totalSegments: 3,
      updatedAt: Date.now(),
    }
    saveProgress(p)
    expect(loadProgress("d1")?.doneSegments).toEqual([0, 1])
  })

  it("版本不符时旧进度作废（提示词变更后必须重抽）", () => {
    saveProgress({
      docId: "d1",
      docTitle: "x",
      version: "v0.0-old",
      doneSegments: [0],
      failedSegments: [],
      atoms: [],
      atomsBySegment: {},
      totalSegments: 3,
      updatedAt: Date.now(),
    })
    expect(loadProgress("d1")).toBeNull()
  })

  it("清除后读不到", () => {
    saveProgress({
      docId: "d1", docTitle: "x", version: EXTRACT_VERSION,
      doneSegments: [0], failedSegments: [], atoms: [], atomsBySegment: {},
      totalSegments: 3, updatedAt: Date.now(),
    })
    clearProgress("d1")
    expect(loadProgress("d1")).toBeNull()
  })

  it("进度百分比", () => {
    const base = { docId: "d", docTitle: "t", version: EXTRACT_VERSION, atoms: [], atomsBySegment: {}, totalSegments: 4, updatedAt: 0 }
    expect(progressPercent({ ...base, doneSegments: [0], failedSegments: [] })).toBe(25)
    expect(progressPercent({ ...base, doneSegments: [0, 1], failedSegments: [2] })).toBe(75)
  })
})

describe("extractWithResume：断点续跑", () => {
  it("首次抽取全部段并清理进度", async () => {
    const callLlm = mkCallLlm()
    const r = await extractWithResume({ docId: "d1", docTitle: "文档", content: DOC, callLlm })
    expect(r.totalDone).toBeGreaterThan(0)
    expect(r.atoms.length).toBeGreaterThan(0)
    // 全部完成 → 进度已清理
    expect(loadProgress("d1")).toBeNull()
  })

  it("中断后再跑，已完成的段不重复调用 LLM（省钱核心）", async () => {
    // 第一次：只跑前 1 段（模拟中断）
    const first = mkCallLlm()
    await extractWithResume({ docId: "d1", docTitle: "文档", content: DOC, callLlm: first, maxAttempts: 1 })
    const firstCalls = first.mock.calls.length

    // 手动构造"只完成了 1 段"的中断现场
    localStorage.clear()
    const paragraphs = DOC.split(/\n{2,}/).filter((s) => s.trim().length >= 40)
    saveProgress({
      docId: "d1",
      docTitle: "文档",
      version: EXTRACT_VERSION,
      doneSegments: [0],
      failedSegments: [],
      atoms: [],
      atomsBySegment: { 0: [] },
      totalSegments: paragraphs.length,
      updatedAt: Date.now(),
    })

    // 第二次续跑：应跳过第 0 段
    const second = mkCallLlm()
    const r = await extractWithResume({ docId: "d1", docTitle: "文档", content: DOC, callLlm: second, maxAttempts: 1 })
    expect(r.newlyDone).toBe(paragraphs.length - 1)
    expect(second.mock.calls.length).toBeLessThan(firstCalls + paragraphs.length)
  })

  it("失败段记入 failedSegments，可后续重试", async () => {
    const callLlm = mkCallLlm([1]) // 第 2 段永远失败
    const r = await extractWithResume({ docId: "d1", docTitle: "文档", content: DOC, callLlm, maxAttempts: 1 })
    expect(r.stillFailed.length).toBeGreaterThan(0)
    const p = loadProgress("d1")
    expect(p?.failedSegments.length).toBeGreaterThan(0)
  })

  it("onlyFailed=true 只重跑失败段", async () => {
    // 先制造失败
    const first = mkCallLlm([1])
    await extractWithResume({ docId: "d1", docTitle: "文档", content: DOC, callLlm: first, maxAttempts: 1 })
    const p = loadProgress("d1")
    const failedCount = p?.failedSegments.length ?? 0
    expect(failedCount).toBeGreaterThan(0)

    // 只重试失败段
    const retry = mkCallLlm()
    const r = await extractWithResume({ docId: "d1", docTitle: "文档", content: DOC, callLlm: retry, onlyFailed: true, maxAttempts: 1 })
    expect(retry.mock.calls.length).toBe(failedCount)
    expect(r.stillFailed).toHaveLength(0)
  })

  it("空文档安全返回", async () => {
    const r = await extractWithResume({ docId: "d1", docTitle: "空", content: "", callLlm: mkCallLlm() })
    expect(r.atoms).toHaveLength(0)
    expect(r.finished).toBe(true)
  })

  it("有进度回调（界面可显示进度条）", async () => {
    const seen: number[] = []
    await extractWithResume({
      docId: "d1",
      docTitle: "文档",
      content: DOC,
      callLlm: mkCallLlm(),
      onProgress: (i) => seen.push(i.done),
    })
    expect(seen.length).toBeGreaterThan(0)
  })
})

describe("listUnfinished：列出可续跑的任务", () => {
  it("只列出未完成的", () => {
    saveProgress({
      docId: "done", docTitle: "完成的", version: EXTRACT_VERSION,
      doneSegments: [0, 1, 2], failedSegments: [], atoms: [], atomsBySegment: {},
      totalSegments: 3, updatedAt: Date.now(),
    })
    saveProgress({
      docId: "half", docTitle: "一半", version: EXTRACT_VERSION,
      doneSegments: [0], failedSegments: [], atoms: [], atomsBySegment: {},
      totalSegments: 3, updatedAt: Date.now(),
    })
    const list = listUnfinished()
    expect(list.map((p) => p.docId)).toContain("half")
    expect(list.map((p) => p.docId)).not.toContain("done")
  })
})
