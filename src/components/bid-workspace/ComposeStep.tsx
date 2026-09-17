import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Download, FolderInput, LayoutGrid, Loader2, PenLine, Play, RefreshCw, Sparkles, Square, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChapterEditor } from "@/components/solution-studio/ChapterEditor"
import { OutlineTreeEditor } from "@/components/solution-studio/OutlineTreeEditor"
import { ChapterBudgetBar } from "@/components/bid-workspace/ChapterBudgetBar"
import { DeviationPanel } from "@/components/bid-workspace/DeviationPanel"
import { FormatSettingsPanel } from "@/components/bid-workspace/FormatSettingsPanel"
import { GenerationSettingsBar } from "@/components/bid-workspace/GenerationSettingsBar"
import { GlobalFactsPanel } from "@/components/bid-workspace/GlobalFactsPanel"
import { OutlineCoverage } from "@/components/bid-workspace/OutlineCoverage"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { PrintChapterFlow, PrintExportButton } from "@/components/common/PrintExport"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { BID_OUTLINE_REQ_KEY, sectionText } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import { typeLabel } from "@/pages/SolutionStudio/solutionTypes"

type ComposeStepProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "outlineDraft"
  | "outlineLoading"
  | "generateOutline"
  | "outlineLevel"
  | "setOutlineLevel"
  | "targetPages"
  | "setTargetPages"
  | "estimatedPages"
  | "figuresEnabled"
  | "setFiguresEnabled"
  | "maxFigures"
  | "setMaxFigures"
  | "orchestrationSummary"
  | "orchestrationBusy"
  | "orchestrationProgress"
  | "startOrchestration"
  | "sectionWords"
  | "setSectionWords"
  | "genOptions"
  | "setClauseResponse"
  | "setMaterialBoost"
  | "setIncludeBiz"
  | "bizRemoveCount"
  | "confirmRemoveBizChapters"
  | "cancelRemoveBizChapters"
  | "globalFactsSource"
  | "factDraft"
  | "setFactDraft"
  | "factAiBusy"
  | "startGenerateFactSettings"
  | "saveGlobalFacts"
  | "settingsSaved"
  | "formatSettings"
  | "effectiveFormatSettings"
  | "formatCheckItems"
  | "setFormatSettingsPatch"
  | "setFormatMarginsPatch"
  | "setFormatHeadingLevel"
  | "setFormatBodyPatch"
  | "setFormatTablePatch"
  | "toggleFormatCheckItem"
  | "setAllFormatCheckItems"
  | "identityWords"
  | "setIdentityWords"
  | "leafTarget"
  | "totalAdjustProgress"
  | "outlineMissingTitles"
  | "goParseStep"
  | "outlineRename"
  | "outlineRemove"
  | "outlineAddChild"
  | "outlineAddRoot"
  | "outlineSetPart"
  | "outlineMove"
  | "confirmOutline"
  | "importDialogOpen"
  | "setImportDialogOpen"
  | "importCandidates"
  | "importLoading"
  | "openImportDialog"
  | "importFromSolution"
  | "activeChapter"
  | "activeChapterId"
  | "selectChapter"
  | "editingContent"
  | "setEditingContent"
  | "chapterBusy"
  | "generateChapter"
  | "regenerateChapter"
  | "regenerateSection"
  | "resizeSection"
  | "isArchivedLocked"
  | "continueChapter"
  | "refineChapter"
  | "bulkGenerating"
  | "genProgress"
  | "startBulkGenerate"
  | "cancelBulkGenerate"
  | "doneChapterCount"
  | "techChapterTotal"
  | "chapterBudgets"
  | "supplementState"
  | "sectionGenState"
  | "pageCap"
  | "pageInfo"
  | "startFillPages"
  | "pageFillBusy"
  | "contentFocus"
  | "focusSectionInChapter"
  | "outlineClauseTotal"
  | "coveredClauseCount"
  | "uncoveredClauses"
  | "addClauseToOutline"
  | "addAllClausesToOutline"
  | "clauseGranularity"
  | "setClauseGranularity"
  | "deviationClauseCount"
  | "mapLoading"
  | "generateDeviationTable"
  | "deviationTable"
  | "deviationSummary"
  | "jumpToResponseNode"
  | "exportDeviationWord"
  | "exportBusy"
  | "bidOutlineSkills"
  | "bidChapterSkills"
  | "deviationSkills"
>

const LEVEL_OPTIONS: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: "不指定" },
  { value: 1, label: "一级" },
  { value: 2, label: "二级" },
  { value: 3, label: "三级" },
]

const LEVEL_HINT: Record<0 | 1 | 2 | 3, string> = {
  0: "按招标要求自动：AI 按评分办法与章节要求自行决定合理层级（默认）",
  1: "只生成「部分 / 章」一级目录",
  2: "生成「章—节」两级目录",
  3: "生成「章—节—条」三级目录，颗粒度最细",
}

// ------------------------------ 第十一轮改造 6：三级目录树 ------------------------------

/** 节/条是否已生成：标题在章节 sections 清单里，或正文存在以该标题开头的行（兼容编号前缀） */
function sectionReady(title: string, ch: Chapter | undefined): boolean {
  if (!ch) return false
  const needle = title.trim()
  if (!needle) return false
  if ((ch.sections ?? []).some((s) => s.trim() === needle)) return true
  const content = ch.content ?? ""
  if (!content.trim()) return false
  return content.split("\n").some((line) => line.trimStart().replace(/^\d+(\.\d+)*\s*/, "").startsWith(needle))
}

function OutlineNavTree({
  outline,
  chapters,
  chapterBudgets,
  activeChapterId,
  supplementState,
  sectionState,
  chapterBusy,
  bulkGenerating,
  locked,
  onSelectChapter,
  onFocusSection,
  onRegenerateSection,
  onResizeSection,
}: {
  outline: OutlineNode[]
  chapters: Chapter[]
  /** 第十五轮改造 3：章预算（chapterWordBudgets 同公式），小节目标字 = 章预算 / 小节数 */
  chapterBudgets: number[]
  activeChapterId: string | null
  supplementState: { nodeId: string; round: number } | null
  sectionState: { nodeId: string; current: number; total: number } | null
  /** 章节级忙碌键：章生成时为 nodeId，小节重写时为 `${nodeId}#s${idx}`（行级转圈） */
  chapterBusy: string | null
  bulkGenerating: boolean
  /** 循环 5 A3：归档只读——小节级重写 / 扩写 / 缩写按钮统一禁用 */
  locked: boolean
  onSelectChapter: (nodeId: string) => void
  onFocusSection: (nodeId: string, title: string) => void
  onRegenerateSection: (nodeId: string, sectionIdx: number) => void
  /** 循环 5 A1：小节级局部扩写 / 缩写 */
  onResizeSection: (nodeId: string, sectionIdx: number, mode: "expand" | "shrink") => void
}) {
  // 大纲缺失时按章节清单兜底成两级树，导航不留白（第十三轮：兜底节点保留 part 归属）
  const tree: OutlineNode[] = outline.length
    ? outline
    : chapters.map((c) => ({
        id: c.node_id,
        title: c.title,
        children: (c.sections ?? []).map((s, i) => ({ id: `${c.node_id}-s${i}`, title: s, children: [] })),
        ...(c.part ? { part: c.part } : {}),
      }))
  const indentClass = ["pl-2", "pl-6", "pl-10"]

  function renderNode(node: OutlineNode, depth: number, chapterId: string): ReactNode {
    const isChapter = depth === 0
    const chapterIdx = chapters.findIndex((c) => c.node_id === chapterId)
    const ch = chapterIdx >= 0 ? chapters[chapterIdx] : undefined
    const isBiz = isChapter && (node.part === "biz" || ch?.part === "biz")
    // 第十五轮改造 3：小节行——状态点 / 实际目标字 / 重写按钮按 section_stats 驱动
    const sections = ch?.sections ?? []
    const sectionIdx = !isChapter && !isBiz ? sections.findIndex((s) => s.trim() === node.title.trim()) : -1
    const stats = ch?.section_stats?.length ? ch.section_stats : undefined
    const stat = sectionIdx >= 0 ? stats?.[sectionIdx] : undefined
    const hasContent = ((ch?.content ?? "").trim().length > 0)
    const sectionTarget = sectionIdx >= 0 && ch ? Math.max(1, Math.round((chapterBudgets[chapterIdx] ?? 0) / Math.max(1, sections.length))) : 0
    const ready = isBiz
      ? true
      : isChapter
        ? !!ch && hasContent
        : stat
          ? stat.chars > 0
          : sectionReady(node.title, ch)
    const isActiveChapter = isChapter && chapterId === activeChapterId
    const supplementing = isChapter && supplementState?.nodeId === chapterId
    const sectioning = isChapter && sectionState?.nodeId === chapterId
    const rowBusyKey = sectionIdx >= 0 ? `${chapterId}#s${sectionIdx}` : ""
    const rowBusy = !!rowBusyKey && chapterBusy === rowBusyKey
    const showSectionControls = sectionIdx >= 0 && !isBiz
    const rewriteDisabled =
      locked || !stats || !stat || !hasContent || rowBusy || !!chapterBusy || bulkGenerating || chapterIdx < 0
    const rewriteTitle = locked
      ? "已归档项目为只读，解除归档后可编辑"
      : !stats || !stat
        ? "重新生成本章后可按条重写"
        : rowBusy
          ? "本小节重写中…"
          : chapterBusy || bulkGenerating
            ? "正文生成进行中，完成后可重写小节"
            : `仅重写小节「${node.title}」，其余小节不变`
    return (
      <li key={node.id}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (isChapter ? onSelectChapter(node.id) : onFocusSection(chapterId, node.title))}
            title={isChapter ? `切换到「${node.title}」` : `在右侧编辑器中定位「${node.title}」`}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${indentClass[Math.min(depth, 2)]} ${
              isActiveChapter ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isBiz ? "bg-muted-foreground/40" : ready ? "bg-primary" : "bg-border"}`} />
            <span className="min-w-0 flex-1 truncate">{node.title}</span>
            {isChapter && (
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs ${
                  isBiz ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                }`}
              >
                {isBiz ? "商务·线下填写" : "技术"}
              </span>
            )}
            {(supplementing || sectioning) && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />}
            {supplementing && supplementState && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">补足 {supplementState.round}</span>
            )}
            {sectioning && sectionState && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                小节 {sectionState.current}/{sectionState.total}
              </span>
            )}
          </button>
          {showSectionControls && (
            <>
              {stat && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={`本小节实际 ${stat.chars} 字 / 目标约 ${sectionTarget} 字`}>
                  {stat.chars}/{sectionTarget} 字
                </span>
              )}
              <button
                type="button"
                disabled={rewriteDisabled}
                onClick={() => onRegenerateSection(chapterId, sectionIdx)}
                title={rewriteTitle}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  rowBusy
                    ? "text-primary"
                    : rewriteDisabled
                      ? "cursor-not-allowed text-muted-foreground disabled:opacity-60"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                }`}
              >
                {rowBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />}
              </button>
              {/* 循环 5 A1：小节级局部扩写 / 缩写（确定性切片替换，只动本小节） */}
              <button
                type="button"
                disabled={rewriteDisabled}
                onClick={() => onResizeSection(chapterId, sectionIdx, "expand")}
                title={locked ? "已归档项目为只读，解除归档后可编辑" : `仅扩写小节「${node.title}」至约 1.5 倍篇幅，事实口径不变，其余小节不变`}
                className={`h-6 shrink-0 rounded-md px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  rewriteDisabled
                    ? "cursor-not-allowed text-muted-foreground/60"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                }`}
              >
                扩写
              </button>
              <button
                type="button"
                disabled={rewriteDisabled}
                onClick={() => onResizeSection(chapterId, sectionIdx, "shrink")}
                title={locked ? "已归档项目为只读，解除归档后可编辑" : `仅缩写小节「${node.title}」至约 6 成篇幅，保留硬指标与承诺要点，其余小节不变`}
                className={`h-6 shrink-0 rounded-md px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  rewriteDisabled
                    ? "cursor-not-allowed text-muted-foreground/60"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                }`}
              >
                缩写
              </button>
            </>
          )}
        </div>
        {!!node.children?.length && depth < 2 && (
          <ul className="space-y-0.5">{node.children.map((kid) => renderNode(kid, depth + 1, chapterId))}</ul>
        )}
      </li>
    )
  }

  return (
    <nav className="rounded-lg border border-border bg-card p-3 shadow-md">
      <p className="px-2 pb-2 text-xs font-semibold text-foreground">投标文件目录</p>
      <ul className="space-y-0.5">{tree.map((n) => renderNode(n, 0, n.id))}</ul>
      <p className="mt-2 px-2 text-xs leading-relaxed text-muted-foreground">
        绿点表示已生成；点章切换编辑器，点节 / 条在正文中定位对应行；小节行显示「实际/目标字」，点重写图标可仅重写该小节；「商务·线下填写」章不生成正文
      </p>
    </nav>
  )
}

export function ComposeStep(p: ComposeStepProps) {
  const proj = p.activeProject
  // 循环 5 A3：归档只读——编辑/生成控件禁用，导出与查看保留
  const locked = p.isArchivedLocked
  // 大纲「重新生成」覆盖前的二次确认（本地 UI 状态）
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false)
  // 第十一轮改造 6：编辑器定位——contentFocus 变化时找到标题行并选中滚动
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [focusFlash, setFocusFlash] = useState(false)
  useEffect(() => {
    const focus = p.contentFocus
    if (!focus) return
    const el = textareaRef.current
    if (!el) return
    const value = el.value ?? ""
    if (!value.trim()) return
    const lines = value.split("\n")
    let offset = 0
    let hitIdx = -1
    let hitPos = 0
    for (const line of lines) {
      const trimmed = line.trimStart()
      const stripped = trimmed.replace(/^\d+(\.\d+)*\s*/, "")
      const inLine = line.length - trimmed.length
      if (trimmed.startsWith(focus.title) || stripped.startsWith(focus.title)) {
        hitIdx = offset + inLine
        hitPos = trimmed.startsWith(focus.title) ? offset + inLine : offset + line.indexOf(stripped)
        break
      }
      offset += line.length + 1
    }
    if (hitIdx < 0) return
    el.focus()
    el.setSelectionRange(hitPos, hitPos + focus.title.length)
    const ratio = value.length > 0 ? hitPos / value.length : 0
    el.scrollTop = Math.max(0, el.scrollHeight * ratio - el.clientHeight / 3)
    setFocusFlash(true)
    const timer = window.setTimeout(() => setFocusFlash(false), 2200)
    return () => window.clearTimeout(timer)
  }, [p.contentFocus])
  if (!proj) return null
  const hasChapters = proj.bid_chapters.length > 0
  const bulkPct = p.genProgress.total ? Math.round((p.genProgress.current / p.genProgress.total) * 100) : 0
  const hasParse = !!proj.parse_report
  // 第十七轮 17A：招标文件规定了投标文件目录且已解析到 → 大纲遵循生效
  const outlineReqActive = sectionText(proj.parse_report ?? null, BID_OUTLINE_REQ_KEY).trim().length > 0
  // 改造 1：当前章的实时字数（编辑器内容优先）与字数预算
  const activeChapterIdx = proj.bid_chapters.findIndex((c) => c.node_id === p.activeChapterId)
  const activeBudget = activeChapterIdx >= 0 ? p.chapterBudgets[activeChapterIdx] ?? 0 : 0
  const activeCharCount = p.activeChapter ? p.editingContent.length : 0
  // 第十一轮改造 2：页数硬约束信息条——治理区间 [0.9,1.1]×有效目标页数×500 字
  const info = p.pageInfo
  const pageCapExceeded = p.pageCap !== null && p.targetPages !== null && p.targetPages > p.pageCap

  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground lg:text-2xl">投标文件编制</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {hasParse
                ? "按解析出的评分办法与响应要求组织技术标，可从方案编制引入底稿"
                : "尚未完成招标文件解析，建议先回到「AI 解析报告」环节，大纲才能对准评分办法"}
            </p>
          </div>
          {hasChapters && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {p.bulkGenerating ? (
                <Button variant="outline" onClick={p.cancelBulkGenerate} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                  <Square className="mr-1.5 h-4 w-4" />
                  停止生成
                </Button>
              ) : (
                <Button onClick={p.startBulkGenerate} disabled={locked} title={locked ? "已归档项目为只读" : undefined} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
                  <Play className="mr-1.5 h-4 w-4" />
                  {p.doneChapterCount > 0 && p.doneChapterCount < p.techChapterTotal ? "继续生成正文" : "逐章生成正文"}
                </Button>
              )}
              {/* 循环 11 块 B：打印 / 存 PDF 回退（浏览器打印对话框另存为 PDF） */}
              <PrintExportButton title="把当前标书正文按只读版式调起打印，可在打印对话框选择「另存为 PDF」" />
            </div>
          )}
        </div>
        {hasChapters && info.totalChars > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground">
              正文实际 ≈{info.actualPages} 页 · 目标 {info.targetPages} 页（硬约束 ±10%）
            </span>
            {pageCapExceeded && (
              <Badge variant="warning">招标文件要求 ≤{p.pageCap} 页，当前目标超出，已按上限收敛</Badge>
            )}
            {info.status === "in" && <Badge variant="success">达标</Badge>}
            {info.status === "under" && (
              <>
                <Badge variant="danger">
                  实际 ≈{info.actualPages} 页，距目标差 {info.gapPages} 页
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={p.pageFillBusy || locked || p.bulkGenerating}
                  title={
                    locked
                      ? "已归档项目为只读"
                      : p.bulkGenerating
                        ? "批量生成进行中，请先停止批量或等待其完成"
                        : undefined
                  }
                  onClick={p.startFillPages}
                  className="h-7 border-primary/40 text-primary hover:bg-primary/10"
                >
                  {p.pageFillBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                  {p.pageFillBusy ? "补齐生成中…" : "一键补齐"}
                </Button>
              </>
            )}
            {info.status === "over" && (
              <span className="text-muted-foreground">已超出治理区间，生成完成后会自动按章精简收敛到上限内</span>
            )}
          </div>
        )}
        {p.bulkGenerating && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                正在生成第 {p.genProgress.current} / 共 {p.genProgress.total} 章
              </span>
              <span>{bulkPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${bulkPct}%` }} />
            </div>
          </div>
        )}
        {p.totalAdjustProgress && (
          <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            全文校正中 第 {p.totalAdjustProgress.current} / {p.totalAdjustProgress.total} 章
          </div>
        )}
      </header>

      {/* 循环 5 A3：归档只读——生成设置 / 格式设置 / 全局事实面板整体锁交互（内部 setter 另有 hook 兜底拦截） */}
      {/* 用户反馈轮项 2：设置三卡纵向堆叠间距统一 space-y-4（原各面板根部散落 mt-4 收敛到包裹层） */}
      <div className={locked ? "pointer-events-none mt-4 space-y-4 opacity-60" : "mt-4 space-y-4"}>
        <GenerationSettingsBar {...p} />

        {/* 第十七轮 17C：格式与暗标设置面板（纸张/边距/标题正文字体/目录页码/暗标/格式检查项） */}
        <FormatSettingsPanel {...p} />

        <GlobalFactsPanel {...p} />
      </div>

      {p.outlineMissingTitles.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <p className="text-xs text-foreground">
            大纲生成依赖「{p.outlineMissingTitles.join("、")}」解析项，请先回到解析环节勾选并解析
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={p.goParseStep}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            前往解析环节
          </Button>
        </div>
      )}

      {!hasChapters ? (
        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_3fr]">
          <div>
            {outlineReqActive && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                <Badge variant="warning">本大纲遵循招标规定目录</Badge>
                <span className="text-xs text-muted-foreground">
                  AI 提取目录可能存在幻想，确认前请对照招标原文核对
                </span>
              </div>
            )}
            {/* 循环 5 A3：归档只读——条款覆盖与大纲树编辑锁交互（查看保留） */}
            <div className={locked ? "pointer-events-none opacity-60" : undefined}>
              <OutlineCoverage
                outlineClauseTotal={p.outlineClauseTotal}
                coveredClauseCount={p.coveredClauseCount}
                uncoveredClauses={p.uncoveredClauses}
                addClauseToOutline={p.addClauseToOutline}
                addAllClausesToOutline={p.addAllClausesToOutline}
              />
              <OutlineTreeEditor
                nodes={p.outlineDraft}
                onRename={p.outlineRename}
                onRemove={p.outlineRemove}
                onMove={p.outlineMove}
                onAddChild={p.outlineAddChild}
                onAddRoot={p.outlineAddRoot}
                onSetPart={p.outlineSetPart}
              />
            </div>
            {p.outlineDraft.length > 0 && (
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={p.confirmOutline}
                  disabled={locked}
                  title={locked ? "已归档项目为只读" : undefined}
                  className="flex-1 bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
                >
                  确认大纲，开始逐章编制
                </Button>
                <Button
                  variant="outline"
                  disabled={p.outlineLoading || locked}
                  title={locked ? "已归档项目为只读" : undefined}
                  onClick={() => setRegenConfirmOpen(true)}
                  className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                >
                  <RefreshCw className={`mr-1.5 h-4 w-4 ${p.outlineLoading ? "animate-spin" : ""}`} />
                  重新生成
                </Button>
              </div>
            )}
          </div>
          <aside className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-card p-5 shadow-md">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                全新生成技术标大纲
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                AI 以评分办法为纲生成大纲，重要评分项都会落到具体章节，可再手动增删调整。
              </p>
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">目录级数（可不选）</p>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {LEVEL_OPTIONS.map((opt) => {
                    const active = p.outlineLevel === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => p.setOutlineLevel(opt.value)}
                        className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:text-card-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{LEVEL_HINT[p.outlineLevel]}</p>
              </div>
              {/* 用户反馈轮项 3：商务标章节开关（搭 gen_options.include_biz，applySetting 防抖落库，与 material_boost 同机制） */}
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
                <input
                  type="checkbox"
                  checked={p.genOptions.include_biz !== false}
                  onChange={(e) => p.setIncludeBiz(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-xs leading-snug">
                  <span className="font-medium text-foreground">包含商务标章节</span>
                  <span className="block text-muted-foreground">投标函、资质证照、商务偏离表等骨架章（线下填写，不生成正文）；关闭后大纲仅含技术标章节</span>
                </span>
              </label>
              <div className="mt-3 flex items-center gap-2">
                <SkillPickerFor scope="bid-outline" source={p.bidOutlineSkills} />
                <Button
                  onClick={p.generateOutline}
                  disabled={p.outlineLoading || locked}
                  title={locked ? "已归档项目为只读" : undefined}
                  variant="outline"
                  className="flex-1 border-primary/40 text-primary hover:bg-primary/10"
                >
                  {p.outlineLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  {p.outlineLoading ? "大纲生成中…" : "AI 生成大纲"}
                </Button>
              </div>
              {p.outlineLoading && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  长标书可能需要几分钟；若超过 5 分钟仍无响应，说明请求被网络波动打断，直接重试即可。
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-5 shadow-md">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FolderInput className="h-4 w-4 text-primary" />
                从方案编制引入底稿
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                选择你已编制的方案（规划 / 可研 / 初设 / 定制 / 标准），大纲与已成稿章节会深拷贝进本投标项目作为底稿。
              </p>
              <Button
                onClick={() => void p.openImportDialog()}
                disabled={locked}
                title={locked ? "已归档项目为只读" : undefined}
                variant="outline"
                className="mt-3 w-full border-border text-card-foreground shadow-sm hover:bg-secondary"
              >
                <FolderInput className="mr-1.5 h-4 w-4" />
                选择方案底稿
              </Button>
            </div>
          </aside>
        </div>
      ) : (
        <>
          <div className="mt-4">
            {/* 循环 5 A3：归档只读——条款覆盖补入锁交互（查看保留） */}
            <div className={locked ? "pointer-events-none opacity-60" : undefined}>
              <OutlineCoverage
                outlineClauseTotal={p.outlineClauseTotal}
                coveredClauseCount={p.coveredClauseCount}
                uncoveredClauses={p.uncoveredClauses}
                addClauseToOutline={p.addClauseToOutline}
                addAllClausesToOutline={p.addAllClausesToOutline}
              />
            </div>
          </div>
          {/* 第十六轮 B2 改造 2.1：智能编排——大纲确认后对技术章叶子预编排正文版面（表格/配图），结果供正文生成消费 */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <LayoutGrid className="h-4 w-4 text-primary" />
                正文智能编排
                {p.orchestrationSummary && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">已编排</span>
                )}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {p.orchestrationSummary
                  ? `已编排 ${p.orchestrationSummary.leafCount} 个叶子：${p.orchestrationSummary.tableCount} 节建议表格、选定 ${p.orchestrationSummary.figureCount} 张配图（全文上限 ${p.maxFigures} 张，均匀分布全文），之后生成的正文自动执行编排`
                  : "动笔前为每节预先编排版面：哪节宜用表格、哪节配一张图（架构 / 流程 / 界面示意）；配图在全文上限内择优、均匀散布各章，避免前密后疏"}
              </p>
              {!p.figuresEnabled && (
                <p className="mt-1 text-xs text-muted-foreground">章节配图开关已关闭，请先在「生成设置」中开启后再编排</p>
              )}
              {p.orchestrationBusy && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {p.orchestrationProgress
                    ? `正在编排第 ${p.orchestrationProgress.current}/${p.orchestrationProgress.total} 批叶子…`
                    : "正在编排…"}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              disabled={!p.figuresEnabled || p.orchestrationBusy || locked}
              onClick={p.startOrchestration}
              title={
                locked
                  ? "已归档项目为只读"
                  : !p.figuresEnabled
                    ? "请先在生成设置中开启章节配图开关"
                    : "为技术章叶子预编排正文表格与配图，生成正文时自动执行"
              }
              className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
            >
              {p.orchestrationBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
              {p.orchestrationBusy ? "编排中…" : p.orchestrationSummary ? "重新编排" : "智能编排"}
            </Button>
          </div>
          {hasChapters && p.doneChapterCount === 0 && !p.bulkGenerating && !locked ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm text-card-foreground animate-in fade-in duration-300">
              <span className="min-w-0 flex-1">
                大纲已确认，正文还是空的——点右上「逐章生成正文」或「一键补齐」开始生成；也可以点左侧目录选中某一章单独生成。生成进度与状态会实时同步到目录。
              </span>
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_3fr]">
            <div className="lg:sticky lg:top-20">
              <OutlineNavTree
                outline={proj.bid_outline}
                chapters={proj.bid_chapters}
                chapterBudgets={p.chapterBudgets}
                activeChapterId={p.activeChapterId}
                supplementState={p.supplementState}
                sectionState={p.sectionGenState}
                chapterBusy={p.chapterBusy}
                bulkGenerating={p.bulkGenerating}
                locked={locked}
                onSelectChapter={p.selectChapter}
                onFocusSection={p.focusSectionInChapter}
                onRegenerateSection={p.regenerateSection}
                onResizeSection={p.resizeSection}
              />
            </div>
            <div>
              {p.activeChapter?.part !== "biz" && (
                <>
                  <ChapterBudgetBar
                    activeChapter={p.activeChapter}
                    charCount={activeCharCount}
                    budget={activeBudget}
                    supplementState={p.supplementState}
                  />
                  {p.activeChapter?.underlength && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                      <span className="badge-warning">偏短</span>
                      <span className="text-xs text-muted-foreground">
                        本章成稿字数低于预算六成，可对当前章「扩写」或「继续生成」补足，达标后徽标自动消失
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className={`rounded-lg transition-colors ${focusFlash ? "bg-primary/15" : ""}`}>
                <ChapterEditor
                  activeChapter={p.activeChapter}
                  activeChapterId={p.activeChapterId}
                  editingContent={p.editingContent}
                  setEditingContent={p.setEditingContent}
                  chapterBusy={p.chapterBusy}
                  generateChapter={p.generateChapter}
                  regenerateChapter={p.regenerateChapter}
                  continueChapter={p.continueChapter}
                  refineChapter={p.refineChapter}
                  bulkGenerating={p.bulkGenerating}
                  chapterIndex={activeChapterIdx}
                  figures={p.activeChapter?.figures ?? []}
                  textareaRef={textareaRef}
                  readOnly={locked}
                  genPickerSlot={<SkillPickerFor scope="bid-chapter" source={p.bidChapterSkills} align="right" />}
                />
              </div>
            </div>
          </div>

          <DeviationPanel
            clauseGranularity={p.clauseGranularity}
            setClauseGranularity={p.setClauseGranularity}
            deviationClauseCount={p.deviationClauseCount}
            mapLoading={p.mapLoading}
            generateDeviationTable={p.generateDeviationTable}
            deviationTable={p.deviationTable}
            deviationSummary={p.deviationSummary}
            doneChapterCount={p.doneChapterCount}
            jumpToResponseNode={p.jumpToResponseNode}
            exportDeviationWord={p.exportDeviationWord}
            exportBusy={p.exportBusy}
            deviationSkills={p.deviationSkills}
          />
        </>
      )}

      <footer className="mt-10 border-t border-border pt-5 text-center text-xs text-muted-foreground">
        正文按章节顺序串行生成以保持全文口径一致，编辑内容自动保存；改写 / 扩写 / 精简随时可用
      </footer>

      <Dialog open={p.importDialogOpen} onOpenChange={p.setImportDialogOpen}>
        <DialogContent className="max-w-lg rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">从方案编制引入底稿</DialogTitle>
            <DialogDescription>选择方案后，其大纲与已成稿章节将深拷贝进本投标项目</DialogDescription>
          </DialogHeader>
          {p.importLoading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs">方案列表加载中…</p>
            </div>
          ) : p.importCandidates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
              <p className="text-xs text-muted-foreground">还没有可用的方案底稿</p>
              <Link
                to="/solution-studio"
                onClick={() => p.setImportDialogOpen(false)}
                className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                去「方案编制」完成一份方案
              </Link>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {p.importCandidates.map((sol) => (
                <li key={sol.id}>
                  <button
                    type="button"
                    onClick={() => p.importFromSolution(sol)}
                    className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Download className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{sol.solution_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {typeLabel(sol.solution_type)} · {sol.hospital || "未填医院"} · {sol.chapters?.filter((c) => c.content?.trim()).length ?? 0} 章成稿
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">重新生成大纲？</DialogTitle>
            <DialogDescription>
              将沿用当前生成入口的参数重跑大纲生成，现有大纲与手动调整会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRegenConfirmOpen(false)} className="border-border text-muted-foreground shadow-sm hover:text-foreground">
              取消
            </Button>
            <Button
              onClick={() => {
                setRegenConfirmOpen(false)
                p.generateOutline()
              }}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              确认覆盖
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* 循环 11 块 B：打印 / 存 PDF 只读正文块（屏幕隐藏，打印独占显示） */}
      <PrintChapterFlow
        docTitle={p.activeProject?.project_name || "投标文件"}
        chapters={(p.activeProject?.bid_chapters ?? []).map((c) => ({
          title: c.title ?? "",
          content: c.content ?? "",
          sections: c.sections,
        }))}
      />
      {/* 用户反馈轮：关闭商务标开关时，存量大纲商务章移除确认 */}
      <ConfirmDialog
        open={p.bizRemoveCount != null}
        onOpenChange={(open) => {
          if (!open) p.cancelRemoveBizChapters()
        }}
        title={`一并移除目录中的 ${p.bizRemoveCount ?? 0} 个商务标章节？`}
        description="投标函、资质证照、商务偏离表等骨架章将从当前目录删除（不影响已生成技术章正文）；选择保留则章节留在目录但不会生成正文。"
        confirmText="移除商务章"
        tone="danger"
        onConfirm={p.confirmRemoveBizChapters}
      />
    </section>
  )
}
