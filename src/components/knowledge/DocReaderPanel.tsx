// 右栏阅读视图：Markdown 渲染 / 纯文本编辑切换 + 重命名、移动到、删除（含团队文档二次强确认）。
// 轮次 D：分类与 AI 策略块（DocPolicySection）+ 引用跳转近似定位（citationFocus）。
import { useEffect, useRef, useState } from "react"
import { BookOpen, Check, FileText, FolderInput, Pencil, ShieldAlert, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { KbMarkdown } from "@/components/knowledge/KbMarkdown"
import { DocPolicySection } from "@/components/knowledge/DocPolicySection"
import { effectivePolicy } from "@/lib/kbPolicy"
import type { CitationFocus, DocActionState } from "@/pages/Knowledge/useKnowledge"
import type { KbDocRow } from "@/lib/kbCore"

type DocReaderPanelProps = {
  selectedDoc: KbDocRow | null
  editMode: boolean
  editDraft: string
  setEditDraft: (v: string) => void
  savingDoc: boolean
  startEdit: () => void
  cancelEdit: () => void
  saveDocEdit: () => void
  canEditDoc: (doc: KbDocRow | null) => boolean
  openDocAction: (mode: "rename" | "move" | "delete", doc: KbDocRow) => void
  docAction: DocActionState
  docActionDraft: string
  setDocActionDraft: (v: string) => void
  deleteStrongStage: boolean
  submitDocAction: () => void
  closeDocAction: () => void
  allFolderPaths: string[]
  updateDocPolicy: (doc: KbDocRow, patch: Partial<Pick<KbDocRow, "doc_category" | "ai_context_mode" | "retrieval_weight" | "is_sensitive">>) => void
  citationFocus: CitationFocus | null
  /** perf-01：最近阅读（未选文档时的空态引导列表，最多 6 条） */
  recentDocs?: KbDocRow[]
  onOpenRecent?: (doc: KbDocRow) => void
}

export function DocReaderPanel({
  selectedDoc,
  editMode,
  editDraft,
  setEditDraft,
  savingDoc,
  startEdit,
  cancelEdit,
  saveDocEdit,
  canEditDoc,
  openDocAction,
  docAction,
  docActionDraft,
  setDocActionDraft,
  deleteStrongStage,
  submitDocAction,
  closeDocAction,
  allFolderPaths,
  updateDocPolicy,
  citationFocus,
  recentDocs = [],
  onOpenRecent,
}: DocReaderPanelProps) {
  const editable = canEditDoc(selectedDoc)
  const policy = selectedDoc ? effectivePolicy(selectedDoc) : null
  const scrollBoxRef = useRef<HTMLDivElement>(null)
  const [focusBanner, setFocusBanner] = useState<string | null>(null)

  // 引用跳转近似定位：按 chunkStart/总长比例滚动 + 片段高亮 2 秒
  useEffect(() => {
    if (!citationFocus || !selectedDoc || citationFocus.docId !== selectedDoc.id || editMode) return
    const el = scrollBoxRef.current
    if (el && citationFocus.ratio > 0.02) {
      requestAnimationFrame(() => {
        el.scrollTop = Math.max(0, el.scrollHeight * citationFocus.ratio - el.clientHeight / 3)
      })
    }
    setFocusBanner(citationFocus.snippet)
    const timer = window.setTimeout(() => setFocusBanner(null), 2200)
    return () => window.clearTimeout(timer)
  }, [citationFocus, selectedDoc, editMode])

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-md">
      {selectedDoc ? (
        <>
          <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
                <span className="min-w-0 truncate">{selectedDoc.title}</span>
                {policy?.is_sensitive ? (
                  <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                    <ShieldAlert className="h-3 w-3" />
                    敏感
                  </span>
                ) : null}
                {policy?.ai_context_mode === "blocked" ? (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    不进 AI
                  </span>
                ) : null}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {selectedDoc.folder_path ? `${selectedDoc.folder_path} / ` : "根目录 / "}
                <span className="rounded-full bg-muted px-1.5 font-mono uppercase">{selectedDoc.doc_format || "md"}</span>
                {selectedDoc.visibility === "personal" ? " · 个人笔记" : " · 团队知识库"}
                {selectedDoc.uploader_name ? ` · ${selectedDoc.uploader_name} 上传` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {editMode ? (
                <>
                  <Button size="sm" variant="outline" onClick={cancelEdit} className="h-8 gap-1 text-xs">
                    <X className="h-3.5 w-3.5" />
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void saveDocEdit()}
                    disabled={savingDoc}
                    className="h-8 gap-1 bg-primary text-xs text-primary-foreground shadow-sm hover:shadow-md"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {savingDoc ? "保存中…" : "保存"}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={startEdit} disabled={!editable} className="h-8 gap-1 text-xs" title={editable ? "编辑正文" : "这篇笔记仅本人可编辑"}>
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDocAction("rename", selectedDoc)} disabled={!editable} className="h-8 gap-1 text-xs">
                    重命名
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDocAction("move", selectedDoc)} disabled={!editable} className="h-8 gap-1 text-xs">
                    <FolderInput className="h-3.5 w-3.5" />
                    移动到
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDocAction("delete", selectedDoc)} className="h-8 gap-1 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </>
              )}
            </div>
          </header>
          <DocPolicySection doc={selectedDoc} editable={editable} updateDocPolicy={updateDocPolicy} />
          <div ref={scrollBoxRef} className="relative min-h-0 flex-1 overflow-y-auto">
            {focusBanner ? (
              <p className="sticky top-0 z-10 mx-3 mt-2 rounded-md bg-secondary px-2.5 py-1.5 text-xs leading-relaxed text-secondary-foreground shadow-sm">
                已定位到引用片段附近：{focusBanner.slice(0, 80)}
                {focusBanner.length > 80 ? "…" : ""}
              </p>
            ) : null}
            {editMode ? (
              <Textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                aria-label="编辑文档正文"
                className="h-full min-h-96 resize-none rounded-none border-0 bg-background font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0"
              />
            ) : (
              <article className="px-5 py-4">
                <KbMarkdown content={selectedDoc.content || "（这篇文档没有正文内容）"} />
              </article>
            )}
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 py-16 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">选择一篇文档开始阅读</h2>
          <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
            从左侧目录或中间列表点开文档，支持 Markdown 渲染、在线编辑与移动归档
          </p>
          {/* perf-01：有阅读史时把最近看过的前 6 篇直接列在这里，回到页面可一键续读 */}
          {recentDocs.length > 0 && (
            <div className="mt-2 w-full max-w-80 text-left">
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">最近阅读</p>
              <ul className="space-y-1">
                {recentDocs.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => onOpenRecent?.(doc)}
                      title={doc.folder_path ? `${doc.folder_path} · ${doc.title}` : doc.title}
                      className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-card-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                      {doc.folder_path ? (
                        <span className="max-w-28 shrink-0 truncate text-muted-foreground">
                          {doc.folder_path.split("/").filter(Boolean).pop()}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Dialog open={docAction !== null} onOpenChange={(open) => !open && closeDocAction()}>
        <DialogContent className="sm:max-w-md">
          {docAction?.mode === "rename" ? (
            <>
              <DialogHeader>
                <DialogTitle>重命名文档</DialogTitle>
                <DialogDescription>修改文档标题，正文内容不受影响。</DialogDescription>
              </DialogHeader>
              <input
                value={docActionDraft}
                onChange={(e) => setDocActionDraft(e.target.value)}
                aria-label="新标题"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </>
          ) : null}
          {docAction?.mode === "move" ? (
            <>
              <DialogHeader>
                <DialogTitle>移动文档</DialogTitle>
                <DialogDescription>选择或输入目标目录，留空表示移动到根目录。</DialogDescription>
              </DialogHeader>
              <input
                value={docActionDraft}
                onChange={(e) => setDocActionDraft(e.target.value)}
                list="kb-folder-options"
                placeholder="例如：售前方法论/评级"
                aria-label="目标目录"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <datalist id="kb-folder-options">
                {allFolderPaths.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </>
          ) : null}
          {docAction?.mode === "delete" ? (
            <DialogHeader>
              <DialogTitle className="text-destructive">{deleteStrongStage ? "再次确认删除" : "删除文档"}</DialogTitle>
              <DialogDescription>
                {deleteStrongStage
                  ? `「${docAction.doc.title}」是团队共享文档，且不是你上传的。删除后全团队都看不到，确定继续吗？`
                  : `确定删除「${docAction.doc.title}」吗？删除后不可恢复。`}
              </DialogDescription>
            </DialogHeader>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDocAction}>
              取消
            </Button>
            <Button
              variant={docAction?.mode === "delete" ? "destructive" : "default"}
              onClick={() => void submitDocAction()}
              className={docAction?.mode === "delete" ? "" : "bg-primary text-primary-foreground"}
            >
              {docAction?.mode === "delete" ? (deleteStrongStage ? "仍要删除" : "删除") : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
