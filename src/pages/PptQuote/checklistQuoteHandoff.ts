// 已确认建设清单 → 新建报价并导入条目（不覆盖已有报价）。

export const CHECKLIST_QUOTE_KEY = "xiaozhi-checklist-quote"
export const CHECKLIST_QUOTE_FROM = "checklist-quote"

export type ChecklistQuotePayload = {
  checklistId: string
  quoteName: string
}

export function stashChecklistQuote(payload: ChecklistQuotePayload): void {
  const checklistId = (payload.checklistId || "").trim()
  if (!checklistId) return
  sessionStorage.setItem(
    CHECKLIST_QUOTE_KEY,
    JSON.stringify({
      checklistId,
      quoteName: (payload.quoteName || "建设清单报价").trim(),
    }),
  )
}

export function consumeChecklistQuote(): ChecklistQuotePayload | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(CHECKLIST_QUOTE_KEY)
    if (raw) sessionStorage.removeItem(CHECKLIST_QUOTE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as ChecklistQuotePayload
    const checklistId = String(data.checklistId || "").trim()
    if (!checklistId) return null
    return {
      checklistId,
      quoteName: String(data.quoteName || "").trim() || "建设清单报价",
    }
  } catch {
    return null
  }
}

export function checklistQuotePath(): string {
  return `/ppt-quote?tab=quote-editor&from=${CHECKLIST_QUOTE_FROM}`
}
