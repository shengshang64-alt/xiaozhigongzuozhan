import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import type { ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"
import { collectStandardChapters } from "@/pages/SolutionStudio/standardChapterCollect"
import type { StandardChapterPreview } from "@/pages/SolutionStudio/standardChapters"
import { checklistPptOutlinePath, stashChecklistPptOutline } from "./checklistPptHandoff"
import { standardChaptersToDeckPlan } from "./standardChaptersToDeckPlan"

/** 从已确认清单或已预览标准章节生成 PPT 大纲，打开向导并停在大纲确认步。 */
export function useChecklistPptOutline() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const openFromPreview = useCallback(
    (preview: StandardChapterPreview, opts?: { topic?: string }) => {
      if (!preview?.modules?.length) {
        toast.error("没有可带入的标准章节，请先确认建设清单模块")
        return
      }
      const { topic, plan } = standardChaptersToDeckPlan(preview, { topic: opts?.topic || preview.title })
      stashChecklistPptOutline({ topic, deckName: topic, plan })
      toast.success(`已整理 ${plan.length} 页 PPT 大纲，请确认后再逐页生成`)
      navigate(checklistPptOutlinePath())
    },
    [navigate],
  )

  const openFromLines = useCallback(
    async (lines: ChecklistLine[], opts?: { title?: string; typeKey?: string }) => {
      const checked = (lines ?? []).filter((l) => l.checked !== false && (l.product_name || l.module_name))
      if (!checked.length) {
        toast.error("请先确认并勾选建设清单模块，再生成 PPT 大纲")
        return
      }
      setBusy(true)
      try {
        const preview = await collectStandardChapters(checked, {
          typeKey: opts?.typeKey ?? "standard",
          title: opts?.title ?? "建设清单汇报",
        })
        openFromPreview(preview, { topic: opts?.title || preview.title })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "整理 PPT 大纲失败")
      } finally {
        setBusy(false)
      }
    },
    [openFromPreview],
  )

  return { busy, openFromLines, openFromPreview }
}
