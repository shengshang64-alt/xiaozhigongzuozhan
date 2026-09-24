import { useRef } from "react"
import { FileUp, Loader2, ScanSearch, Save, ClipboardPaste } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type TenderStepProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "tenderDraft"
  | "setTenderDraft"
  | "fileBusy"
  | "handleTenderFile"
  | "saveTenderText"
  | "refTemplateDraft"
  | "setRefTemplateDraft"
  | "refMaterialsDraft"
  | "setRefMaterialsDraft"
  | "handleRefFile"
  | "refFileBusy"
  | "parseLoading"
  | "parseChunkProgress"
  | "startParse"
  | "setActiveStep"
  | "isArchivedLocked"
>

export function TenderStep({
  activeProject,
  tenderDraft,
  setTenderDraft,
  fileBusy,
  handleTenderFile,
  saveTenderText,
  refTemplateDraft,
  setRefTemplateDraft,
  refMaterialsDraft,
  setRefMaterialsDraft,
  handleRefFile,
  refFileBusy,
  parseLoading,
  parseChunkProgress,
  startParse,
  setActiveStep,
  isArchivedLocked,
}: TenderStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const refTemplateInputRef = useRef<HTMLInputElement>(null)
  const refMaterialsInputRef = useRef<HTMLInputElement>(null)
  const saved = (activeProject?.tender_text ?? "").trim().length > 0
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">导入招标文件</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          支持 .docx / .pdf / .txt，文件在浏览器本地解析成文本，<span className="font-medium text-primary">原文件不会上传</span>；扫描版 PDF 提取不到文字时，可直接粘贴招标文件文本。导入后点「AI 解析」提取评分办法、资质要求与废标条款。
        </p>
      </header>

      <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-4">
          {/* 循环 5 A3：归档只读——上传 / 粘贴 / 保存 / 解析全部锁定，查看保留 */}
          <div
            role="button"
            tabIndex={isArchivedLocked ? -1 : 0}
            aria-disabled={isArchivedLocked}
            onClick={() => {
              if (isArchivedLocked) return
              fileInputRef.current?.click()
            }}
            onKeyDown={(e) => {
              if (isArchivedLocked) return
              if (e.key === "Enter") fileInputRef.current?.click()
            }}
            className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border bg-card p-8 text-center shadow-md transition-colors ${
              isArchivedLocked
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            }`}
          >
            {fileBusy ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <FileUp className="h-8 w-8 text-primary" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">{fileBusy ? "正在本地解析文件…" : "点击上传招标文件"}</p>
              <p className="mt-1 text-xs text-muted-foreground">.docx / .pdf / .txt，解析在浏览器内完成</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf,.txt,.md"
              className="hidden"
              onChange={(e) => {
                void handleTenderFile(e.target.files?.[0])
                e.target.value = ""
              }}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-md">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ClipboardPaste className="h-4 w-4 text-primary" />
              也可以直接粘贴
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              把招标公告、评分办法、废标条款等关键内容粘贴到右侧文本框即可，内容越完整解析越准。粘贴或上传的内容会自动随项目保存，重开项目不丢失。
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="outline" onClick={saveTenderText} disabled={!tenderDraft.trim() || isArchivedLocked} className="border-border text-card-foreground shadow-sm hover:bg-secondary">
                <Save className="mr-1.5 h-4 w-4" />
                保存招标文件
              </Button>
              <Button
                onClick={startParse}
                disabled={parseLoading || !tenderDraft.trim() || isArchivedLocked}
                className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
              >
                {parseLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-1.5 h-4 w-4" />}
                {parseLoading
                  ? parseChunkProgress
                    ? `正在解析第 ${parseChunkProgress.current}/${parseChunkProgress.total} 项…`
                    : "AI 解析中，约需 1-2 分钟…"
                  : "AI 解析招标文件"}
              </Button>
            </div>
            {saved &&
              (activeProject?.parse_report ? (
                <button
                  type="button"
                  onClick={() => setActiveStep(2)}
                  className="mt-3 w-full rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  已有解析报告，去查看 / 重新解析
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startParse}
                  disabled={parseLoading || !tenderDraft.trim() || isArchivedLocked}
                  className="mt-3 w-full rounded-md border border-primary/40 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  招标文件已保存，去运行 AI 解析
                </button>
              ))}
          </div>
        </div>

        <div className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
          <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div>
              <p className="text-sm font-semibold text-foreground">招标文件文本</p>
              <p className="text-xs text-muted-foreground">上传解析或粘贴后，可在此人工核对修正</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              {tenderDraft.length} 字
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <Textarea
              value={tenderDraft}
              onChange={(e) => setTenderDraft(e.target.value)}
              readOnly={isArchivedLocked}
              placeholder="上传招标文件后文本会出现在这里，也可以直接粘贴招标公告与评分办法全文…"
              className="min-h-[28rem] flex-1 resize-none border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
            />
          </div>
        </div>
      </div>

      {/* 第十七轮 17D：范本与资料分离——两个可选导入槽（范本=结构章法参考，资料=内容引用） */}
      <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <header>
          <h2 className="text-sm font-semibold text-foreground">范本与写作资料（可选，两者用途不同）</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-primary">范本 = 结构章法</span>
            ：生成大纲时参考它的目录结构与章节粒度，不会照抄标题；
            <span className="font-medium text-primary">资料 = 内容引用</span>
            ：生成正文时引用自有人员、案例、资质与制度的事实与口径。两项都在浏览器本地解析、随项目自动保存，各自超过 20 万字将自动截断。
          </p>
        </header>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex h-full flex-col rounded-lg border border-border bg-background">
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">历史标书范本</p>
                <p className="text-xs text-muted-foreground">参考目录结构与章节写法</p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {refTemplateDraft.length} 字
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
              <Button
                variant="outline"
                disabled={refFileBusy || isArchivedLocked}
                onClick={() => refTemplateInputRef.current?.click()}
                className="border-border text-card-foreground shadow-sm hover:bg-secondary"
              >
                {refFileBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileUp className="mr-1.5 h-4 w-4" />}
                上传范本文件
              </Button>
              <input
                ref={refTemplateInputRef}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  void handleRefFile(e.target.files?.[0], "template")
                  e.target.value = ""
                }}
              />
              <Textarea
                value={refTemplateDraft}
                onChange={(e) => setRefTemplateDraft(e.target.value)}
                readOnly={isArchivedLocked}
                placeholder="也可直接粘贴历史标书范本全文（取其目录结构与章节写法作参考）…"
                className="min-h-[12rem] flex-1 resize-none border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
              />
            </div>
          </div>
          <div className="flex h-full flex-col rounded-lg border border-border bg-background">
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">写作资料</p>
                <p className="text-xs text-muted-foreground">人员 / 案例 / 资质 / 制度，供内容引用</p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {refMaterialsDraft.length} 字
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
              <Button
                variant="outline"
                disabled={refFileBusy || isArchivedLocked}
                onClick={() => refMaterialsInputRef.current?.click()}
                className="border-border text-card-foreground shadow-sm hover:bg-secondary"
              >
                {refFileBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileUp className="mr-1.5 h-4 w-4" />}
                上传资料文件
              </Button>
              <input
                ref={refMaterialsInputRef}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  void handleRefFile(e.target.files?.[0], "materials")
                  e.target.value = ""
                }}
              />
              <Textarea
                value={refMaterialsDraft}
                onChange={(e) => setRefMaterialsDraft(e.target.value)}
                readOnly={isArchivedLocked}
                placeholder="也可直接粘贴团队人员简历、同类项目案例、资质证书清单、管理制度等写作资料…"
                className="min-h-[12rem] flex-1 resize-none border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-8 border-t border-border pt-5 text-center text-xs text-muted-foreground">
        解析使用长文档档位模型，评分办法分值与废标条款均以招标文件原文为准，AI 提取后请务必人工核对
      </footer>
    </section>
  )
}
