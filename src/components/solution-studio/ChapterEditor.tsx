import type { ReactNode, RefObject } from "react"
import { AlertTriangle, Check, CheckCircle2, ChevronsRight, ClipboardCheck, Loader2, Minimize2, PenLine, RefreshCw, ScanText, Sparkles, TextQuote, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { BidFigure } from "@/components/bid-workspace/BidFigure"
import { ChapterScoreCard } from "@/components/solution-studio/ChapterScoreCard"
import type { FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"

type ChapterEditorProps = Pick<
  UseSolutionStudio,
  | "activeChapter"
  | "activeChapterId"
  | "editingContent"
  | "setEditingContent"
  | "chapterBusy"
  | "generateChapter"
  | "refineChapter"
  | "bulkGenerating"
> & {
  /** 自动保存状态指示（仅方案编制注入，标书工作区可不传） */
  autoSaveState?: "idle" | "saving" | "saved"
  chapterIndex: number
  figures?: FigureSpec[]
  /** 标书工作页注入：整章重写覆盖（不传则不渲染按钮，方案编制页不受影响） */
  regenerateChapter?: (nodeId: string) => void
  /** 标书工作页注入：从断点续写补足篇幅（不传则不渲染按钮） */
  continueChapter?: (nodeId: string) => void
  /** 「生成正文 / 重新生成 / 继续生成」旁的带入技能选择器（页面注入） */
  genPickerSlot?: ReactNode
  /** 「改写 / 扩写 / 精简」旁的带入技能选择器（页面注入） */
  refinePickerSlot?: ReactNode
  /** 轮次 E-4：章节自检（不传则不渲染自检按钮与评分卡动作） */
  reviewChapter?: (nodeId: string) => void
  /** 轮次 E-4：评分卡「按建议优化」 */
  optimizeByIssues?: (nodeId: string) => void
  /** 轮次 E-1：素材面板光标插入用的 textarea ref（页面注入） */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** 循环 5 A3：归档只读——禁用全部生成/改写/自检按钮并锁定正文编辑（标书工作页注入，方案编制页不传不受影响） */
  readOnly?: boolean
  /** sol5 待补充小节：小节标题尚未在正文出现的项，渲染橙色提醒条（可选，不传不渲染） */
  missingSections?: string[]
  /** sol5 插入回执：刚从素材弹药库插入的内容标注，渲染绿色提示条 */
  insertNotice?: { label: string } | null
  /** sol5 插入回执：撤销最近一次插入 */
  onUndoInsert?: () => void
  /** 2026-10 配图需求轮：配图区右上角工具槽（上传截图/图模板库，标书工作页注入；不传不渲染） */
  figureToolbar?: ReactNode
}

export function ChapterEditor({
  activeChapter,
  activeChapterId,
  editingContent,
  setEditingContent,
  chapterBusy,
  generateChapter,
  refineChapter,
  bulkGenerating,
  autoSaveState = "idle",
  chapterIndex,
  figures,
  regenerateChapter,
  continueChapter,
  genPickerSlot,
  refinePickerSlot,
  reviewChapter,
  optimizeByIssues,
  textareaRef,
  readOnly = false,
  missingSections,
  insertNotice,
  onUndoInsert,
  figureToolbar,
}: ChapterEditorProps) {
  if (!activeChapter || !activeChapterId) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-10 text-center shadow-md">
        <ScanText className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">从左侧目录选择一个章节</p>
        <p className="mt-1 text-xs text-muted-foreground">选中后可生成本章正文，并进行改写 / 扩写 / 精简</p>
      </div>
    )
  }
  // 循环 8 A1：批量生成期间所有章节的生成/重生成/继续/改写类按钮一律禁用（busy 判定不再限「当前章正在被批量生成」，
  // 防止取消批量后旧循环仍在飞时点单章入口并发写同批章节）
  const busy = chapterBusy === activeChapter.node_id || bulkGenerating
  const hasContent = (activeChapter.content ?? "").trim().length > 0
  // 标书第十三轮改造 4：商务骨架章不生成正文——隐藏全部生成/改写入口，正文区替换为线下填写骨架指引
  const isBiz = activeChapter.part === "biz"
  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">
            <span className="mr-1.5 font-mono text-xs text-primary">第{chapterIndex + 1}章</span>
            {activeChapter.title}
            {isBiz && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-xs font-medium text-muted-foreground">
                {hasContent ? "商务文书" : "商务·线下填写"}
              </span>
            )}
            {autoSaveState !== "idle" && (
              <span className={`ml-2 inline-flex items-center gap-1 text-[11px] font-normal transition-opacity duration-300 ${autoSaveState === "saved" ? "text-primary" : "text-muted-foreground"}`}>
                {autoSaveState === "saving" ? (<><Loader2 className="h-3 w-3 animate-spin" />保存中</>)
                  : (<><Check className="h-3 w-3" />已保存</>)}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {readOnly
              ? "已归档项目为只读，解除归档后可编辑"
              : isBiz
                ? hasContent
                  ? "本章由系统按 ★/▲ 实质性条款逐字生成，不参与 AI 逐章生成，可直接编辑校对并随 Word 导出"
                  : "商务文书与证照章节，不生成 AI 正文，线下填写后随 Word 导出合并"
                : busy
                  ? "AI 正在撰写本章…"
                  : hasContent
                    ? `${editingContent.length} 字 · 编辑后自动保存`
                    : "尚未生成正文"}
          </p>
        </div>
        {!isBiz && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {genPickerSlot}
          {!hasContent && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || readOnly}
              onClick={() => generateChapter(activeChapter.node_id)}
              className="border-primary/40 text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              生成正文
            </Button>
          )}
          {regenerateChapter && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hasContent || readOnly}
              onClick={() => regenerateChapter(activeChapter.node_id)}
              className="border-border text-muted-foreground hover:text-foreground"
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              重新生成本章
            </Button>
          )}
          {continueChapter && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hasContent || readOnly}
              onClick={() => continueChapter(activeChapter.node_id)}
              className="border-primary/40 text-primary hover:bg-primary/10"
            >
              <ChevronsRight className="mr-1 h-3.5 w-3.5" />
              继续生成
            </Button>
          )}
          {refinePickerSlot}
          <Button size="sm" variant="outline" disabled={busy || !hasContent || readOnly} onClick={() => refineChapter(activeChapter.node_id, "rewrite")} className="border-border text-muted-foreground hover:text-foreground">
            <PenLine className="mr-1 h-3.5 w-3.5" />
            改写
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !hasContent || readOnly} onClick={() => refineChapter(activeChapter.node_id, "expand")} className="border-border text-muted-foreground hover:text-foreground">
            <TextQuote className="mr-1 h-3.5 w-3.5" />
            扩写
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !hasContent || readOnly} onClick={() => refineChapter(activeChapter.node_id, "condense")} className="border-border text-muted-foreground hover:text-foreground">
            <Minimize2 className="mr-1 h-3.5 w-3.5" />
            精简
          </Button>
          {reviewChapter && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hasContent || readOnly}
              onClick={() => reviewChapter(activeChapter.node_id)}
              className="border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1 h-3.5 w-3.5" />}
              自检
            </Button>
          )}
        </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!!missingSections?.length && (
          <div className="flex shrink-0 items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p>
              <b className="text-warning">待补充（{missingSections.length}）：</b>
              本章小节「{missingSections.join("、")}」尚未在正文覆盖，建议生成/补写或从右侧弹药库插入参考段落。
            </p>
          </div>
        )}
        {insertNotice && (
          <div className="flex shrink-0 items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="flex flex-wrap items-center gap-2">
              <span>
                <b className="text-primary">已从弹药库插入：</b>「{insertNotice.label}」，可继续改写融合，源文档不受影响。
              </span>
              {onUndoInsert && (
                <Button size="sm" variant="ghost" onClick={onUndoInsert} className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground">
                  <Undo2 className="mr-1 h-3 w-3" />
                  撤销插入
                </Button>
              )}
            </p>
          </div>
        )}
        {!isBiz && activeChapter.selfCheck && reviewChapter && (
          <ChapterScoreCard
            selfCheck={activeChapter.selfCheck}
            busy={busy}
            onOptimize={optimizeByIssues ? () => optimizeByIssues(activeChapter.node_id) : undefined}
            onRecheck={() => reviewChapter(activeChapter.node_id)}
          />
        )}
        {isBiz && !hasContent ? (
          <div className="flex flex-1 flex-col rounded-md border border-dashed border-border bg-muted/40 p-6">
            <p className="text-sm font-medium text-foreground">本章为商务骨架章，不参与 AI 正文生成</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              投标函、资质证照、业绩证明、报价表等商务文书请按下列小节线下填写；导出 Word 时本章会输出章标题、小节标题与占位行，线下补齐后合并进标书即可。
            </p>
            <ul className="mt-4 grid gap-1.5">
              {(activeChapter.sections ?? []).length === 0 && (
                <li className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  本章暂无预设小节，可在大纲环节补充
                </li>
              )}
              {(activeChapter.sections ?? []).map((s, i) => (
                <li
                  key={`${s}-${i}`}
                  className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-sm"
                >
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {chapterIndex + 1}.{i + 1}
                  </span>
                  <span className="font-medium">{s}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">线下填写</span>
                </li>
              ))}
            </ul>
          </div>
        ) : busy && !hasContent ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-primary/30 bg-primary/5 p-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">正在生成本章正文</p>
            <p className="text-xs text-muted-foreground">长文生成可能需要一两分钟，期间可切换到其他章节查看</p>
          </div>
        ) : (
          <Textarea
            ref={textareaRef}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            readOnly={readOnly}
            placeholder="点击「生成正文」由 AI 撰写，或直接手动输入本章内容…"
            className="min-h-96 flex-1 resize-none border-border bg-background font-sans text-sm leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
          />
        )}
        {(!!figures?.length || figureToolbar) && (
          <div className="grid shrink-0 grid-cols-1 gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {figures?.length ? `本章配图（${figures.length} 张，导出 Word 时自动插入正文）` : "本章暂无配图"}
              </p>
              {/* 2026-10 配图需求轮：上传截图 / 图模板库工具槽（标书工作页注入，方案编制页不传不渲染） */}
              {figureToolbar}
            </div>
            {(figures ?? []).map((fig, i) => (
              <BidFigure key={`${fig.type}-${i}`} spec={fig} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
