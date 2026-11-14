import { useCallback, useState } from "react"
import { toast } from "sonner"
import type { ChecklistLine } from "./checklistTypes"
import { collectStandardChapters } from "./standardChapterCollect"
import type { StandardChapterPreview } from "./standardChapters"

export function useStandardChapters() {
  const [preview, setPreview] = useState<StandardChapterPreview | null>(null)
  const [busy, setBusy] = useState(false)

  const closePreview = useCallback(() => {
    if (!busy) setPreview(null)
  }, [busy])

  const openFromLines = useCallback(async (lines: ChecklistLine[], opts?: { typeKey?: string; title?: string }) => {
    const checked = (lines ?? []).filter((l) => l.checked !== false && (l.product_name || l.module_name))
    if (!checked.length) {
      toast.error("请先确认并勾选建设清单模块，再预览标准章节")
      return
    }
    setBusy(true)
    setPreview(null)
    try {
      const next = await collectStandardChapters(checked, {
        typeKey: opts?.typeKey ?? "standard",
        title: opts?.title ?? "标准章节预览",
      })
      setPreview(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "整理标准章节失败")
    } finally {
      setBusy(false)
    }
  }, [])

  return { preview, busy, openFromLines, closePreview, setPreview }
}
