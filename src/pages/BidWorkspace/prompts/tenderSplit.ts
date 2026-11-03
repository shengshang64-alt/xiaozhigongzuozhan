// ---------------------------------------------------------------------------
// T14（2026-09-29）整文通道超限切段：移植 OpenBidKit_Yibiao（AGPL-3.0）electron/utils/userTextSplitter.cjs
// 的 splitUserTextByContextLimit，按其语义以 TS 重写（署名披露遵循内网自用口径）。
// 语义：按目标段数均匀取理想切点，在半径窗口内找自然边界（markdown 标题行 > 空行 > 换行 >
// 句号 > 分号 > 逗号），避开代码围栏与代理对，段长受 [35% 目标段长, 110% 上限] 约束；
// 全部找不到边界才硬切。切点是纯切片下标——各段按序拼接与原文逐字节一致（tenderSplit.test 锁定）。
// ---------------------------------------------------------------------------

const STRICT_WINDOW_RATIO = 0.12
const RELAXED_WINDOW_RATIO = 0.25
const MIN_SEGMENT_RATIO = 0.35
const MAX_SEGMENT_LIMIT_RATIO = 1.1

const BOUNDARY_GROUPS: RegExp[][] = [
  [/\r?\n(?=\s{0,3}#{1,6}\s+)/g, /\r?\n[ \t]*\r?\n/g],
  [/\r?\n/g],
  [/[。！？!?]/g],
  [/[；;]/g],
  [/[，,、：:]/g],
]

interface CutState {
  idealCut: number
  previousCut: number
  totalLength: number
  remainingSegments: number
  minimumSegmentLength: number
  maximumSegmentLength: number
}

function collectMarkdownFenceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const regex = /(^|\n)(```|~~~)/g
  let openedAt = -1
  let openedMarker = ""
  let match = regex.exec(text)
  while (match) {
    const markerStart = match.index + match[1].length
    const marker = match[2]
    if (openedAt < 0) {
      openedAt = markerStart
      openedMarker = marker
    } else if (marker === openedMarker) {
      ranges.push([openedAt, markerStart + marker.length])
      openedAt = -1
      openedMarker = ""
    }
    if (!match[0]) regex.lastIndex += 1
    match = regex.exec(text)
  }
  if (openedAt >= 0) ranges.push([openedAt, text.length])
  return ranges
}

function isInsideRange(index: number, ranges: [number, number][]): boolean {
  for (const [start, end] of ranges) {
    if (index <= start) return false
    if (index < end) return true
  }
  return false
}

function avoidsBreakingSurrogatePair(text: string, cut: number): number {
  if (cut <= 0 || cut >= text.length) return cut
  const previous = text.charCodeAt(cut - 1)
  const next = text.charCodeAt(cut)
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return cut + 1
  return cut
}

function clampHardCut(text: string, idealCut: number, previousCut: number, remainingSegments: number): number {
  const minimumCut = previousCut + 1
  const maximumCut = text.length - remainingSegments
  if (maximumCut < minimumCut) return Math.min(text.length, minimumCut)
  const clamped = Math.min(maximumCut, Math.max(minimumCut, Math.round(idealCut)))
  return avoidsBreakingSurrogatePair(text, clamped)
}

function canUseCandidate(candidate: number, state: CutState): boolean {
  if (candidate <= state.previousCut || candidate >= state.totalLength) return false
  const currentLength = candidate - state.previousCut
  if (currentLength < state.minimumSegmentLength) return false
  if (currentLength > state.maximumSegmentLength) return false
  if (state.remainingSegments > 0) {
    const remainingLength = state.totalLength - candidate
    if (remainingLength < state.remainingSegments) return false
    if (remainingLength / state.remainingSegments > state.maximumSegmentLength) return false
  }
  return true
}

function findBoundaryForGroup(text: string, from: number, to: number, group: RegExp[], state: CutState, fenceRanges: [number, number][]): number {
  let best: { cut: number; score: number } | null = null
  const content = text.slice(from, to)
  for (const pattern of group) {
    pattern.lastIndex = 0
    let match = pattern.exec(content)
    while (match) {
      const candidate = from + match.index + match[0].length
      if (!isInsideRange(candidate, fenceRanges) && canUseCandidate(candidate, state)) {
        const score = Math.abs(candidate - state.idealCut)
        if (!best || score < best.score) best = { cut: candidate, score }
      }
      if (!match[0]) pattern.lastIndex += 1
      match = pattern.exec(content)
    }
  }
  return best?.cut || 0
}

function findNaturalCut(text: string, idealCut: number, previousCut: number, state: CutState, fenceRanges: [number, number][], radius: number): number {
  const from = Math.max(previousCut + 1, Math.floor(idealCut - radius))
  const to = Math.min(text.length - state.remainingSegments, Math.ceil(idealCut + radius))
  if (to <= from) return 0
  for (const group of BOUNDARY_GROUPS) {
    const cut = findBoundaryForGroup(text, from, to, group, state, fenceRanges)
    if (cut) return cut
  }
  return 0
}

/**
 * 按段长上限切分长文本：≤ 上限原样单段返回；否则均匀取理想切点找自然边界。
 * 段与段之间无重叠——与检索通道的 300 字重叠分块不同，这里靠任务 prompt 的
 * 「没有提及」契约 + 合并阶段兜跨段断裂（易标同款语义）。
 */
export function splitTenderText(text: string, segmentLimit: number): string[] {
  const source = String(text ?? "")
  const limit = Math.max(1, Math.floor(segmentLimit))
  if (source.length <= limit) return [source]
  const segmentCount = Math.ceil(source.length / limit)
  const targetSize = Math.max(1, Math.ceil(source.length / segmentCount))
  const strictRadius = Math.max(1, Math.floor(targetSize * STRICT_WINDOW_RATIO))
  const relaxedRadius = Math.max(strictRadius, Math.floor(targetSize * RELAXED_WINDOW_RATIO))
  const maximumSegmentLength = Math.max(targetSize, Math.ceil(limit * MAX_SEGMENT_LIMIT_RATIO))
  const minimumSegmentLength = Math.max(1, Math.floor(targetSize * MIN_SEGMENT_RATIO))
  const fenceRanges = collectMarkdownFenceRanges(source)
  const cuts: number[] = []
  let previousCut = 0
  for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex += 1) {
    const idealCut = (source.length * segmentIndex) / segmentCount
    const remainingSegments = segmentCount - segmentIndex
    const state: CutState = {
      idealCut,
      previousCut,
      totalLength: source.length,
      remainingSegments,
      minimumSegmentLength,
      maximumSegmentLength,
    }
    const naturalCut =
      findNaturalCut(source, idealCut, previousCut, state, fenceRanges, strictRadius) ||
      findNaturalCut(source, idealCut, previousCut, state, fenceRanges, relaxedRadius)
    const cut = naturalCut || clampHardCut(source, idealCut, previousCut, remainingSegments)
    cuts.push(cut)
    previousCut = cut
  }
  const parts: string[] = []
  let start = 0
  for (const cut of cuts) {
    parts.push(source.slice(start, cut))
    start = cut
  }
  parts.push(source.slice(start))
  return parts
}
