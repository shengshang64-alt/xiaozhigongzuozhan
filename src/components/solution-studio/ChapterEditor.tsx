import type { ReactNode, RefObject } from "react"
import { ChevronsRight, ClipboardCheck, Loader2, Minimize2, PenLine, RefreshCw, ScanText, Sparkles, TextQuote } from "lucide-react"
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
                商务·线下填写
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {readOnly
              ? "已归档项目为只读，解除归档后可编辑"
              : isBiz
                ? "商务文书与证照章节，不生成 AI 正文，线下填写后随 Word 导出合并"
                : busy
                  ? "AI 正在撰写本章…"
                  : hasContent
                    ? `${editingContent.length} 字 · 编辑后自动保存`
                    : "尚未生成正文"}
          </p>
        </div>
        {!isBiz && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
        {!isBiz && activeChapter.selfCheck && reviewChapter && (
          <ChapterScoreCard
            selfCheck={activeChapter.selfCheck}
            busy={busy}
            onOptimize={optimizeByIssues ? () => optimizeByIssues(activeChapter.node_id) : undefined}
            onRecheck={() => reviewChapter(activeChapter.node_id)}
          />
        )}
        {isBiz ? (
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
        {!!figures?.length && (
          <div className="grid shrink-0 grid-cols-1 gap-3">
            <p className="text-xs font-medium text-muted-foreground">本章配图（{figures.length} 张，导出 Word 时自动插入正文）</p>
            {figures.map((fig, i) => (
              <BidFigure key={`${fig.type}-${i}`} spec={fig} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
