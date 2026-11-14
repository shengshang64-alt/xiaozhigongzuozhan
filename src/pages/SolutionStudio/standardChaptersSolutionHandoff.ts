import type { StandardChapterPreview } from "./standardChapters"

// 标准章节预览确认后，带到新建方案向导第 3 步（大纲确认）。只带草稿，不写已有方案。

export const STANDARD_CHAPTERS_SOLUTION_KEY = "xiaozhi-standard-chapters-solution"
export const STANDARD_CHAPTERS_SOLUTION_FROM = "standard-chapters"

export type StandardChaptersSolutionPayload = {
  preview: StandardChapterPreview
  solutionName: string
  hospital: string
  checklistId?: string
}

export function stashStandardChaptersSolution(payload: StandardChaptersSolutionPayload): void {
  if (!payload?.preview) return
  sessionStorage.setItem(
    STANDARD_CHAPTERS_SOLUTION_KEY,
    JSON.stringify({
      preview: payload.preview,
      solutionName: (payload.solutionName || "建设清单方案").trim(),
      hospital: (payload.hospital || payload.solutionName || "").trim(),
      checklistId: payload.checklistId || "",
    }),
  )
}

export function consumeStandardChaptersSolution(): StandardChaptersSolutionPayload | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(STANDARD_CHAPTERS_SOLUTION_KEY)
    if (raw) sessionStorage.removeItem(STANDARD_CHAPTERS_SOLUTION_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as StandardChaptersSolutionPayload
    if (!data?.preview?.modules) return null
    const solutionName = String(data.solutionName || "").trim() || "建设清单方案"
    return {
      preview: data.preview,
      solutionName,
      hospital: String(data.hospital || solutionName).trim(),
      checklistId: data.checklistId || "",
    }
  } catch {
    return null
  }
}

export function standardChaptersSolutionPath(): string {
  return `/solution-studio?from=${STANDARD_CHAPTERS_SOLUTION_FROM}`
}
