// ---------------------------------------------------------------------------
// 原子抽取断点续跑（2026-10-31 知识库优化）
//
// 问题：kbExtract.extractAtomsFromDoc 是「一次性跑完」的纯函数，
//   300 篇文档冷启动抽取需要数小时，中途断网/关页面/模型限流都会前功尽弃，
//   重跑又要重新付费（每段一次 LLM 调用）。
//
// 本模块提供**按段粒度**的续跑能力：
//   · 每完成一段就持久化进度（localStorage，键 = 文档 id）
//   · 中断后再跑，从上次成功段之后继续，已抽到的原子不丢
//   · 支持「只补失败段」（模型恢复后重试之前失败的段）
//
// 为什么不落库：抽取进度是**临时状态**，落库会污染集合且要写迁移；
//   localStorage 足够（单机工具，进度丢了最多重跑），且天然按用户隔离。
//
// 与 kbExtract 的分工：
//   kbExtract    = 纯抽取逻辑（无状态、可单测）
//   kbExtractResume = 进度管理 + 编排（有状态、操作 localStorage）
// ---------------------------------------------------------------------------

import type { ExtractedAtom } from "./kbAtoms"
import type { LlmMessage } from "@/lib/llm"
import { buildExtractionMessages, parseSegmentExtraction, EXTRACT_VERSION } from "./kbExtract"
import { splitWithAnchor } from "./kbParse"

const PROGRESS_PREFIX = "kb-extract-progress:"

/** 单篇文档的抽取进度 */
export type ExtractProgress = {
  docId: string
  docTitle: string
  /** 抽取器版本（版本变了旧进度作废，因为提示词改了结果会不同） */
  version: string
  /** 已成功完成的段序号（0 基），按升序 */
  doneSegments: number[]
  /** 失败的段序号（可重试） */
  failedSegments: number[]
  /** 已抽到的原子（累计） */
  atoms: ExtractedAtom[]
  /** 那些段抽到的原子分别来自哪段（用于续跑时不重复） */
  atomsBySegment: Record<number, ExtractedAtom[]>
  /** 总段数 */
  totalSegments: number
  /** 最后更新时间 */
  updatedAt: number
}

/** 读取某篇文档的进度（版本不符或损坏则返回 null，从头开始） */
export function loadProgress(docId: string): ExtractProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + docId)
    if (!raw) return null
    const p = JSON.parse(raw) as ExtractProgress
    if (!p || p.version !== EXTRACT_VERSION) return null
    if (!Array.isArray(p.doneSegments)) return null
    return p
  } catch {
    return null
  }
}

/** 保存进度 */
export function saveProgress(p: ExtractProgress): void {
  try {
    localStorage.setItem(PROGRESS_PREFIX + p.docId, JSON.stringify(p))
  } catch {
    /* 配额不足/隐私模式：静默降级为无断点（不影响本次抽取） */
  }
}

/** 清除进度（抽取完成或用户主动重跑时） */
export function clearProgress(docId: string): void {
  try {
    localStorage.removeItem(PROGRESS_PREFIX + docId)
  } catch {
    /* ignore */
  }
}

/** 列出所有未完成的抽取（界面可展示"继续上次抽取"） */
export function listUnfinished(): ExtractProgress[] {
  const out: ExtractProgress[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (!k?.startsWith(PROGRESS_PREFIX)) continue
      const p = loadProgress(k.slice(PROGRESS_PREFIX.length))
      if (!p) continue
      const finished = p.doneSegments.length + p.failedSegments.length >= p.totalSegments
      if (!finished) out.push(p)
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export type ResumeExtractOptions = {
  docId: string
  docTitle: string
  content: string
  callLlm: (messages: LlmMessage[]) => Promise<string>
  /** 单段尝试次数；默认 2 */
  maxAttempts?: number
  /** 只重跑失败段（模型恢复后用），默认 false = 补所有未完成段 */
  onlyFailed?: boolean
  onProgress?: (info: { done: number; total: number; atoms: number; currentSegment: number }) => void
}

export type ResumeExtractResult = {
  atoms: ExtractedAtom[]
  /** 本次新抽取的段数 */
  newlyDone: number
  /** 累计完成段数 */
  totalDone: number
  /** 仍失败的段 */
  stillFailed: number[]
  /** 是否全部完成（可清除进度） */
  finished: boolean
}

/**
 * 带断点续跑的整篇抽取。
 *
 * 与 kbExtract.extractAtomsFromDoc 的差别：
 *   · 每段成功即持久化，中断不丢
 *   · 下次调用自动跳过已完成段
 *   · 只对未完成/失败段调用 LLM（省钱）
 */
export async function extractWithResume(opts: ResumeExtractOptions): Promise<ResumeExtractResult> {
  const paragraphs = splitWithAnchor(opts.content)
  if (!paragraphs.length) {
    return { atoms: [], newlyDone: 0, totalDone: 0, stillFailed: [], finished: true }
  }

  // 1) 载入或初始化进度
  let prog = loadProgress(opts.docId)
  if (!prog || prog.totalSegments !== paragraphs.length) {
    prog = {
      docId: opts.docId,
      docTitle: opts.docTitle,
      version: EXTRACT_VERSION,
      doneSegments: [],
      failedSegments: [],
      atoms: [],
      atomsBySegment: {},
      totalSegments: paragraphs.length,
      updatedAt: Date.now(),
    }
  }

  const doneSet = new Set(prog.doneSegments)
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2)

  // 2) 确定要跑的段
  const targets: number[] = []
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (opts.onlyFailed) {
      // 只补失败段（已完成的不动）
      if (prog.failedSegments.includes(i)) targets.push(i)
    } else if (!doneSet.has(i)) {
      targets.push(i)
    }
  }

  let newlyDone = 0
  const stillFailed = new Set(prog.failedSegments.filter((i) => !doneSet.has(i)))

  for (const i of targets) {
    const p = paragraphs[i]
    let segOk = false
    for (let attempt = 0; attempt < maxAttempts && !segOk; attempt += 1) {
      try {
        const messages = buildExtractionMessages({
          text: p.text,
          docTitle: opts.docTitle,
          index: i + 1,
          total: paragraphs.length,
        })
        const raw = await opts.callLlm(messages)
        const parsed = parseSegmentExtraction(raw, p.text)
        if (!parsed.ok) continue
        segOk = true
        prog.doneSegments.push(i)
        prog.atomsBySegment[i] = parsed.atoms
        // 重算累计（避免重复累加）
        prog.atoms = Object.values(prog.atomsBySegment).flat()
        prog.failedSegments = prog.failedSegments.filter((x) => x !== i)
        stillFailed.delete(i)
        prog.updatedAt = Date.now()
        saveProgress(prog)
        newlyDone += 1
      } catch {
        /* 本段失败，继续尝试 */
      }
    }
    if (!segOk) {
      if (!prog.failedSegments.includes(i)) prog.failedSegments.push(i)
      stillFailed.add(i)
      prog.updatedAt = Date.now()
      saveProgress(prog)
    }
    opts.onProgress?.({
      done: prog.doneSegments.length,
      total: paragraphs.length,
      atoms: prog.atoms.length,
      currentSegment: i + 1,
    })
  }

  const finished = prog.doneSegments.length + prog.failedSegments.filter((i) => !doneSet.has(i)).length >= paragraphs.length
  // 全部成功则清理进度（下次抽取从头开始，版本可能已变）
  const allDone = prog.doneSegments.length >= paragraphs.length
  if (allDone) clearProgress(opts.docId)

  return {
    atoms: prog.atoms,
    newlyDone,
    totalDone: prog.doneSegments.length,
    stillFailed: [...stillFailed],
    finished: finished || allDone,
  }
}

/** 进度百分比（界面进度条用） */
export function progressPercent(p: ExtractProgress): number {
  if (!p.totalSegments) return 0
  return Math.round(((p.doneSegments.length + p.failedSegments.length) / p.totalSegments) * 100)
}
