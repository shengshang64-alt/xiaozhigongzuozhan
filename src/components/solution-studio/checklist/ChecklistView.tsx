import { useEffect, useRef } from "react"
import { ChecklistWorkbench } from "./ChecklistWorkbench"
import { NewChecklistWizard } from "./NewChecklistWizard"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"

// ---------------------------------------------------------------------------
// 建设清单视图组合层：UX-v2 三栏工作面 + 新建向导 / 确认框
// 列表 + 产品库不再作为本屏默认主路径（改由工作面内「切换清单」「从产品库追加」进入）
// ---------------------------------------------------------------------------

export function ChecklistView({
  ck,
  onStartSolution,
  preferredChecklistId,
  outlineGeneratedFor,
}: {
  ck: UseChecklist
  onStartSolution: (checklistId: string) => void
  preferredChecklistId?: string | null
  outlineGeneratedFor?: ReadonlySet<string>
}) {
  const autoOpenedRef = useRef(false)
  const appliedPreferredRef = useRef<string | null>(null)

  useEffect(() => {
    if (ck.checklistsLoading) return
    if (preferredChecklistId) {
      if (appliedPreferredRef.current === preferredChecklistId) return
      if (ck.myChecklists.some((c) => c.id === preferredChecklistId)) {
        appliedPreferredRef.current = preferredChecklistId
        if (ck.activeChecklist?.id !== preferredChecklistId) ck.openChecklistDetail(preferredChecklistId)
      }
      return
    }
    if (autoOpenedRef.current) return
    if (ck.activeChecklist) {
      autoOpenedRef.current = true
      return
    }
    const latest = [...ck.myChecklists].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))[0]
    if (latest) {
      autoOpenedRef.current = true
      ck.openChecklistDetail(latest.id)
    }
  }, [ck.checklistsLoading, ck.myChecklists, ck.activeChecklist, ck.openChecklistDetail, preferredChecklistId])

  const outlineGenerated = Boolean(ck.activeChecklist && outlineGeneratedFor?.has(ck.activeChecklist.id))

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ChecklistWorkbench ck={ck} onStartSolution={onStartSolution} outlineGenerated={outlineGenerated} />

      <NewChecklistWizard ck={ck} />

      <ConfirmDialog
        open={Boolean(ck.confirmRequest)}
        onOpenChange={(open) => {
          if (!open) ck.closeConfirmRequest()
        }}
        title={ck.confirmRequest?.title ?? ""}
        description={ck.confirmRequest?.description}
        confirmText={ck.confirmRequest?.confirmText}
        tone={ck.confirmRequest?.tone ?? "default"}
        onConfirm={ck.runConfirmRequest}
      />
    </div>
  )
}
