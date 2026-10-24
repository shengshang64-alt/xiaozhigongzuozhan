// 上传弹窗：拖拽或选择文件（md/markdown/txt/docx/pdf/zip），选目标库、目录与分类，逐文件展示解析入库结果。
// 轮次 D-1：分类选择（默认「其他」），按文件名关键词智能预选，可手动覆盖。
import { useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, FileArchive, FileText, FolderInput, Loader2, UploadCloud } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isSupportedUpload } from "@/pages/Knowledge/kbUpload"
import { readKbUploadHistory, type KbUploadHistoryEntry } from "@/pages/Knowledge/kbUploadHistory"

import { guessCategoryFromFileName, KB_CATEGORIES } from "@/lib/kbPolicy"
import type { LibTab, UploadRowResult } from "@/pages/Knowledge/useKnowledge"

type UploadDialogProps = {
  uploadOpen: boolean
  closeUpload: () => void
  uploadVisibility: LibTab
  setUploadVisibility: (v: LibTab) => void
  uploadFolder: string
  setUploadFolder: (v: string) => void
  uploadCategory: string
  setUploadCategory: (v: string) => void
  uploadResults: UploadRowResult[]
  uploading: boolean
  processUploadFiles: (files: File[], category?: string) => void
  processUploadFolder: () => void
  supportsFolder: boolean
  allFolderPaths: string[]
}

export function UploadDialog({
  uploadOpen,
  closeUpload,
  uploadVisibility,
  setUploadVisibility,
  uploadFolder,
  setUploadFolder,
  uploadCategory,
  setUploadCategory,
  uploadResults,
  uploading,
  processUploadFiles,
  processUploadFolder,
  supportsFolder,
  allFolderPaths,
}: UploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  // 用户手动改过分类后，不再按文件名智能预选
  const [categoryTouched, setCategoryTouched] = useState(false)
  // P2-8：上传历史（本机记录）——弹窗打开时读入，成败可回溯
  const [uploadHistory, setUploadHistory] = useState<KbUploadHistoryEntry[]>([])
  useEffect(() => {
    if (!uploadOpen) return
    // 微任务读入规避 set-state-in-effect 保守告警（同 DocListPanel 回收站首拉）
    void Promise.resolve().then(() => setUploadHistory(readKbUploadHistory(null).slice(0, 10)))
  }, [uploadOpen])

  useEffect(() => {
    if (uploadOpen) setCategoryTouched(false)
  }, [uploadOpen])

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return
    // A2-9：不支持的文件不再静默丢弃，明确提示忽略了几个
    const allFiles = Array.from(fileList)
    const files = allFiles.filter((f) => isSupportedUpload(f.name))
    const ignoredCount = allFiles.length - files.length
    if (ignoredCount > 0) {
      toast.info(`已忽略 ${ignoredCount} 个不支持的文件，仅支持 md / txt / docx / pdf / pptx / xlsx / zip`)
    }
    if (files.length === 0) return
    if (categoryTouched) {
      void processUploadFiles(files, uploadCategory)
      return
    }
    // 智能预选：按第一个文件名猜分类并回显到选择器；逐文件仍各自按文件名匹配
    const guessed = guessCategoryFromFileName(files[0].name)
    setUploadCategory(guessed)
    void processUploadFiles(files)
  }

  return (
    <Dialog open={uploadOpen} onOpenChange={(open) => !open && closeUpload()}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(e) => {
          // 循环7 C4：本弹窗无 textarea，输入区 Enter 直接触发主动作「选择文件」；按钮交给原生行为避免双触发
          // 循环8 C3：原生 select（文档分类）键盘选完选项的 Enter 豁免；datalist 目录 input 无法区分
          // 「选中候选」与「主动提交」意图，一并豁免带 list 属性的 input（目录选择不再误触文件选择器）
          if (e.key !== "Enter" || e.shiftKey) return
          const target = e.target as HTMLElement
          if (
            target.tagName === "BUTTON" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            (target.tagName === "INPUT" && Boolean((target as HTMLInputElement).getAttribute("list"))) ||
            target.closest("[data-radix-popper-content-wrapper]")
          )
            return
          e.preventDefault()
          if (!uploading) inputRef.current?.click()
        }}
      >
        <DialogHeader>
          <DialogTitle>上传文档</DialogTitle>
          <DialogDescription>
            md / markdown / txt 直接入库，docx / pdf / pptx / xlsx 自动转文本，zip 整包在本地解压并保留目录结构（不上传原文件）
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">目标库</p>
            <div className="flex rounded-full bg-muted p-0.5">
              {(
                [
                  { key: "team", label: "团队知识库" },
                  { key: "personal", label: "我的笔记" },
                ] as { key: LibTab; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={uploading}
                  onClick={() => setUploadVisibility(opt.key)}
                  className={`flex-1 rounded-full px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    uploadVisibility === opt.key
                      ? "bg-card font-medium text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">目标目录（可留空）</p>
            <input
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              disabled={uploading}
              list="kb-upload-folder-options"
              placeholder="例如：售前方法论"
              aria-label="目标目录"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <datalist id="kb-upload-folder-options">
              {allFolderPaths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              文档分类
              <span className="ml-1.5 font-normal">不手动选时按文件名智能匹配；合同商务、资质证书默认脱敏不进 AI 原文</span>
            </p>
            <select
              value={uploadCategory}
              onChange={(e) => {
                setCategoryTouched(true)
                setUploadCategory(e.target.value)
              }}
              disabled={uploading}
              aria-label="文档分类"
              className="h-9 w-full cursor-pointer rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {KB_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            if (!uploading) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFiles(e.dataTransfer.files)
          }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/40"
          }`}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <UploadCloud className={`h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
          )}
          <p className="text-sm font-medium text-foreground">{uploading ? "正在解析入库…" : "拖拽文件到这里，或"}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="gap-1.5 border-primary/40 text-xs text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
          >
            <FileText className="h-3.5 w-3.5" />
            选择文件（可多选）
          </Button>
          {supportsFolder ? (
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => processUploadFolder()}
              className="gap-1.5 text-xs shadow-sm"
              title="递归导入整个文件夹，保留子目录结构，按内容自动归类"
            >
              <FolderInput className="h-3.5 w-3.5" />
              导入整个文件夹（自动分类）
            </Button>
          ) : null}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileArchive className="h-3.5 w-3.5" />
            zip 包内支持 .md/.markdown/.txt 与 .docx/.pdf/.pptx/.xls/.xlsx（保留目录结构，损坏条目自动跳过）；文件夹导入自动跳过代码与缓存目录
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,.docx,.pdf,.pptx,.xls,.xlsx,.zip"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ""
            }}
          />
        </div>

        {uploadResults.length > 0 ? (
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-background p-2.5 shadow-sm">
            {uploadResults.map((row, idx) => (
              <div key={`${row.fileName}_${idx}`} className="flex items-start gap-2 text-xs">
                {!row.done ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : row.failReason ? (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.fileName}</span>
                <span className={`shrink-0 ${row.failReason ? "text-destructive" : "text-muted-foreground"}`}>
                  {!row.done ? "处理中…" : row.failReason ? row.failReason : `入库 ${row.okCount} 篇`}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* P2-8：最近上传历史（本机记录，最近 10 条）——成败与失败原因关闭弹窗后仍可回溯 */}
        {!uploading && uploadHistory.length > 0 ? (
          <div className="mt-3 border-t border-border pt-2.5">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">最近上传（本机记录，最近 10 条）</p>
            <ul className="max-h-36 space-y-1 overflow-y-auto">
              {uploadHistory.map((h, i) => (
                <li key={h.at + '_' + i} className="flex items-start gap-2 text-xs">
                  {h.failReason ? (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-foreground">{h.fileName}</span>
                  <span className={`shrink-0 ${h.failReason ? "text-destructive" : "text-muted-foreground"}`}>
                    {h.failReason ? h.failReason : `入库 ${h.okCount} 篇`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button variant="outline" onClick={closeUpload} disabled={uploading}>
            {uploadResults.some((r) => r.done && !r.failReason) ? "完成" : "关闭"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
