import { useRef, useState } from "react"
import { ArrowDown, ArrowUp, FileUp, Loader2, ScanSearch, Save, ClipboardPaste, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { classifyTenderTable, summarizeTenderTables } from "@/pages/BidWorkspace/tenderTables"
import { TENDER_FILE_ROLE_HINTS, TENDER_FILE_ROLE_LABELS, TENDER_FILE_ROLES, type TenderFileRole } from "@/pages/BidWorkspace/tenderFiles"

type TenderStepProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "tenderDraft"
  | "setTenderDraft"
  | "fileBusy"
  | "handleTenderFiles"
  | "tenderFiles"
  | "removeTenderFileAt"
  | "moveTenderFileAt"
  | "setTenderFileRoleAt"
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
  handleTenderFiles,
  tenderFiles,
  removeTenderFileAt,
  moveTenderFileAt,
  setTenderFileRoleAt,
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
  const [dragActive, setDragActive] = useState(false)
  const saved = (activeProject?.tender_text ?? "").trim().length > 0
  // B4（2026-10-22）：上传 docx 时本地还原的表格——原文件不上传，只有行列数据
  const restoredTables = activeProject?.tender_tables ?? []
  const tableSummary = summarizeTenderTables(restoredTables)
  const previewTable =
    restoredTables.find((t) => classifyTenderTable(t.rows) === "purchase_list") ?? restoredTables[0] ?? null
  const previewRows = previewTable ? previewTable.rows.slice(0, 8) : []
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">导入招标文件</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          支持 .docx / .pdf / .txt，<span className="font-medium text-primary">可一次导入多份</span>（招标正文 + 技术附件 + 评分办法…），文件在浏览器本地解析成文本，<span className="font-medium text-primary">原文件不会上传</span>；扫描版 PDF 提取不到文字时，可直接粘贴招标文件文本。每份文件标好角色后点「AI 解析」——解析时会按角色只读相关文件，技术附件不会被每个解析项重复读取。
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
            onDragOver={(e) => {
              if (isArchivedLocked) return
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragActive(false)
              if (isArchivedLocked) return
              void handleTenderFiles(e.dataTransfer.files)
            }}
            className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed bg-card p-8 text-center shadow-md transition-colors ${
              isArchivedLocked
                ? "cursor-not-allowed border-border opacity-60"
                : dragActive
                  ? "cursor-pointer border-primary bg-primary/10"
                  : "cursor-pointer border-border hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            }`}
          >
            {fileBusy ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <FileUp className="h-8 w-8 text-primary" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {fileBusy ? "正在本地解析文件…" : "点击或拖拽上传招标文件（可多选）"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">.docx / .pdf / .txt / .md，解析在浏览器内完成</p>
              <p className="mt-1 text-[11px] text-muted-foreground">正文、技术附件、评分办法可一次全选，下面逐份标角色</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".docx,.pdf,.txt,.md"
              className="hidden"
              onChange={(e) => {
                void handleTenderFiles(e.target.files)
                e.target.value = ""
              }}
            />
          </div>

          {tenderFiles.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 shadow-md">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <p className="text-sm font-semibold text-foreground">文件清单（{tenderFiles.length} 份）</p>
                <span className="text-[11px] text-muted-foreground">角色决定解析时哪些项会读这份文件</span>
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {tenderFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="rounded-md border border-border bg-background px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={file.name}>
                        {index + 1}. {file.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{file.chars} 字</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Select
                        value={file.role}
                        disabled={isArchivedLocked}
                        onValueChange={(value) => setTenderFileRoleAt(index, value as TenderFileRole)}
                      >
                        <SelectTrigger className="h-7 flex-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TENDER_FILE_ROLES.map((role) => (
                            <SelectItem key={role} value={role} className="text-xs">
                              {TENDER_FILE_ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0"
                        disabled={index === 0 || isArchivedLocked}
                        onClick={() => moveTenderFileAt(index, -1)}
                        title="上移"
                        aria-label="上移"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0"
                        disabled={index === tenderFiles.length - 1 || isArchivedLocked}
                        onClick={() => moveTenderFileAt(index, 1)}
                        title="下移"
                        aria-label="下移"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        disabled={isArchivedLocked}
                        onClick={() => removeTenderFileAt(index)}
                        title="移除这份文件"
                        aria-label="移除这份文件"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{TENDER_FILE_ROLE_HINTS[file.role]}</p>
                  </li>
                ))}
              </ul>
              {restoredTables.length > 0 && (
                <div className="mt-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-foreground">
                    已从 docx 还原 <span className="font-semibold text-primary">{tableSummary.total}</span> 张表格
                    （采购清单 {tableSummary.purchaseList} · 技术参数 {tableSummary.techParams}）——原文件未上传，只保留表格行列。
                  </p>
                  {previewTable && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        查看「{previewTable.file}」第 {previewTable.index + 1} 张表（前 {previewRows.length} 行）
                      </summary>
                      <div className="mt-2 max-h-64 overflow-auto">
                        <table className="w-full text-left text-[11px]">
                          <tbody>
                            {previewRows.map((r, ri) => (
                              <tr key={ri} className={ri === 0 ? "bg-muted/40 font-medium" : ""}>
                                {r.map((c, ci) => (
                                  <td key={ci} className="whitespace-nowrap border-b border-border/50 px-2 py-1">
                                    {c || "—"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                合并文本里每份文件前有「〖附件N｜角色｜文件名〗」来源标记；删除或调序按文件块重建，块内正文与手工修订都会保留。
              </p>
            </div>
          )}

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
              <p className="text-xs text-muted-foreground">
                {tenderFiles.length > 0
                  ? "多份文件已按来源标记合并；补充内容请加在对应文件的标记之后"
                  : "上传解析或粘贴后，可在此人工核对修正"}
              </p>
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
