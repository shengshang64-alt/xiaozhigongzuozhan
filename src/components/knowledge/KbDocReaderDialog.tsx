// 知识库 · 文档阅读弹窗（UX-v2 文档库屏 / 检索屏共用）。
//
// ## 为什么把阅读区从「第三栏」改成「弹窗」
//
// 原型 kb/browse.html 是**两栏**（左目录树 / 右文档卡），没有常驻的第三栏阅读区。
// 但线上原本的三栏布局里，阅读区（DocReaderPanel）承担着**真实能力**：
// 读正文、改正文、重命名、移动目录、删除（团队文档二次强确认）、分类与 AI 策略、引用跳转。
//
// 把这三栏改成两栏，阅读能力不能跟着消失（铁律 3：不许删既有功能）。
// 做法：**阅读区原样搬进弹窗**，一个文档卡点「打开」就弹出来读；
// 阅读区内部所有动作（编辑 / 移动 / 删除 / 策略）一字不改。
//
// 宽 880px：标书正文与技术方案在 640px 里读会挤成窄条（实测线上阅读区只有 420px 时
// 正文折行严重）。

import { useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DocReaderPanel } from "@/components/knowledge/DocReaderPanel"
import type { useKnowledge } from "@/pages/Knowledge/useKnowledge"

export function KbDocReaderDialog({
  p,
  open,
  onClose,
}: {
  p: ReturnType<typeof useKnowledge>
  open: boolean
  onClose: () => void
}) {
  // 打开时把浏览器焦点交给弹窗，关闭后不留下滚动锁残影
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent
        className="flex max-h-[86vh] w-[min(880px,94vw)] flex-col overflow-hidden p-0"
        aria-label={p.selectedDoc ? `阅读文档：${p.selectedDoc.title}` : "阅读文档"}
      >
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-base">{p.selectedDoc?.title ?? "文档"}</DialogTitle>
          <DialogDescription className="text-xs">
            {p.selectedDoc?.folder_path ? `目录：${p.selectedDoc.folder_path}` : "未归类目录"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 grow overflow-y-auto px-5 py-4">
          <DocReaderPanel
            selectedDoc={p.selectedDoc}
            editMode={p.editMode}
            editDraft={p.editDraft}
            setEditDraft={p.setEditDraft}
            savingDoc={p.savingDoc}
            startEdit={p.startEdit}
            cancelEdit={p.cancelEdit}
            saveDocEdit={() => void p.saveDocEdit()}
            canEditDoc={p.canEditDoc}
            openDocAction={p.openDocAction}
            docAction={p.docAction}
            docActionDraft={p.docActionDraft}
            setDocActionDraft={p.setDocActionDraft}
            deleteStrongStage={p.deleteStrongStage}
            submitDocAction={p.submitDocAction}
            closeDocAction={p.closeDocAction}
            allFolderPaths={p.allFolderPaths}
            updateDocPolicy={p.updateDocPolicy}
            citationFocus={p.citationFocus}
            recentDocs={p.recentDocs}
            onOpenRecent={p.selectDoc}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
