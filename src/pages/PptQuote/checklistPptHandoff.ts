import type { SlidePlan } from "./pptQuoteTypes"

// 建设清单 / 标准章节 → PPT 向导大纲确认步的跨页交接（sessionStorage）。
// 只带大纲草稿，不写 ppt_decks，也不调用模型。

export const CHECKLIST_PPT_OUTLINE_KEY = "xiaozhi-ppt-checklist-outline"
export const CHECKLIST_PPT_FROM = "checklist-outline"

export type ChecklistPptOutlinePayload = {
  topic: string
  deckName: string
  plan: SlidePlan[]
  keyPoints?: string
}

export function stashChecklistPptOutline(payload: ChecklistPptOutlinePayload): void {
  const plan = Array.isArray(payload.plan) ? payload.plan : []
  const topic = (payload.topic || "建设清单汇报").trim()
  const body = JSON.stringify({
    topic,
    deckName: (payload.deckName || topic).trim(),
    plan,
    keyPoints: payload.keyPoints ?? "",
  })
  sessionStorage.setItem(CHECKLIST_PPT_OUTLINE_KEY, body)
}

export function consumeChecklistPptOutline(): ChecklistPptOutlinePayload | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(CHECKLIST_PPT_OUTLINE_KEY)
    if (raw) sessionStorage.removeItem(CHECKLIST_PPT_OUTLINE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as ChecklistPptOutlinePayload
    if (!data || !Array.isArray(data.plan) || !data.plan.length) return null
    const topic = String(data.topic || "").trim() || "建设清单汇报"
    return {
      topic,
      deckName: String(data.deckName || topic).trim() || topic,
      plan: data.plan,
      keyPoints: String(data.keyPoints || ""),
    }
  } catch {
    return null
  }
}

export function checklistPptOutlinePath(): string {
  return `/ppt-quote?tab=deck-editor&from=${CHECKLIST_PPT_FROM}`
}
