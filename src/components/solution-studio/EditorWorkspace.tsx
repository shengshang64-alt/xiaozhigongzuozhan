import { useState } from "react"
import { FileText, Library, Loader2, Play, Square } from "lucide-react"
import { PrintChapterFlow, PrintExportButton } from "@/components/common/PrintExport"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChapterEditor } from "@/components/solution-studio/ChapterEditor"
import { ChapterNavTree } from "@/components/solution-studio/ChapterNavTree"
import { MaterialAmmoPanel } from "@/components/solution-studio/MaterialAmmoPanel"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"
import { typeLabel } from "@/pages/SolutionStudio/solutionTypes"

type EditorWorkspaceProps = Pick<
  UseSolutionStudio,
  | "activeSolution"
  | "activeChapter"
  | "activeChapterId"
  | "selectChapter"
  | "editingContent"
  | "setEditingContent"
  | "chapterBusy"
  | "generateChapter"
  | "refineChapter"
  | "reviewChapter"
  | "optimizeByIssues"
  | "chapterTextareaRef"
  | "materialTab"
  | "setMaterialTab"
  | "materialQueryInput"
  | "setMaterialQueryInput"
  | "materialQuery"
  | "materialKbHits"
  | "materialAmmoPairs"
  | "materialHistoryBlocks"
  | "materialLoading"
  | "insertMaterialToChapter"
  | "solutions"
  | "openSolutionToKb"
  | "bulkGenerating"
  | "genProgress"
  | "startBulkGenerate"
  | "cancelBulkGenerate"
  | "doneChapterCount"
  | "docStatusLabel"
  | "exportWord"
  | "exportingWord"
  | "chapterSkills"
  | "rewriteSkills"
>

export function EditorWorkspace(p: EditorWorkspaceProps) {
  // 素材栏折叠 / 窄屏抽屉均为纯 UI 状态，留在 View 层
  const [materialCollapsed, setMaterialCollapsed] = useState(false)
  const [mobileMaterialOpen, setMobileMaterialOpen] = useState(false)
  const sol = p.activeSolution
  if (!sol) return null
  const chapterIndex = sol.chapters.findIndex((c) => c.node_id === p.activeChapterId)
  const total = sol.chapters.length
  const bulkPct = p.genProgress.total ? Math.round((p.genProgress.current / p.genProgress.total) * 100) : 0
  const materialPanel = (
    <MaterialAmmoPanel
      materialTab={p.materialTab}
      setMaterialTab={p.setMaterialTab}
      materialQueryInput={p.materialQueryInput}
      setMaterialQueryInput={p.setMaterialQueryInput}
      materialQuery={p.materialQuery}
      materialKbHits={p.materialKbHits}
      materialAmmoPairs={p.materialAmmoPairs}
      materialHistoryBlocks={p.materialHistoryBlocks}
      materialLoading={p.materialLoading}
      insertMaterialToChapter={p.insertMaterialToChapter}
      activeChapterId={p.activeChapterId}
      solutions={p.solutions}
      collapsed={materialCollapsed}
      onToggleCollapsed={() => setMaterialCollapsed((prev) => !prev)}
      onOpenKbWizard={() => p.openSolutionToKb(sol)}
    />
  )
  return (
    <section className="mx-auto max-w-7xl px-4 pb-12">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{sol.solution_name}</h1>
              <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 text-xs font-normal text-primary">
                {typeLabel(sol.solution_type)}
              </Badge>
              <Badge variant="secondary" className="rounded-full text-xs font-normal">
                {p.docStatusLabel}
              </Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {sol.hospital} · {sol.hospital_info?.hospital_level} · 建设内容：{(sol.hospital_info?.systems ?? []).join("、")}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setMobileMaterialOpen((prev) => !prev)}
              className="border-border text-card-foreground shadow-sm hover:bg-secondary lg:hidden"
            >
              <Library className="mr-1.5 h-4 w-4 text-primary" />
              {mobileMaterialOpen ? "收起素材" : "素材"}
            </Button>
            {p.bulkGenerating ? (
              <Button variant="outline" onClick={p.cancelBulkGenerate} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                <Square className="mr-1.5 h-4 w-4" />
                停止生成
              </Button>
            ) : (
              <>
                <SkillPickerFor scope="solution-chapter" source={p.chapterSkills} align="right" />
                <Button onClick={p.startBulkGenerate} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
                  <Play className="mr-1.5 h-4 w-4" />
                  {p.doneChapterCount > 0 && p.doneChapterCount < total ? "继续生成正文" : "逐章生成正文"}
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => void p.exportWord()} disabled={p.exportingWord} className="border-border text-card-foreground shadow-sm hover:bg-secondary disabled:opacity-60">
              {p.exportingWord ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin text-primary" /> : <FileText className="mr-1.5 h-4 w-4" />}
              {p.exportingWord ? "导出中…" : "导出 Word"}
            </Button>
            {/* 循环 11 块 B：打印 / 存 PDF 回退 */}
            <PrintExportButton title="把当前方案正文按只读版式调起打印，可在打印对话框选择「另存为 PDF」" />
          </div>
        </div>
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
      </header>

      {/* 窄屏：素材栏改为成稿区上方抽屉式弹层（按钮唤出，默认隐藏） */}
      {mobileMaterialOpen && <div className="mt-4 lg:hidden">{materialPanel}</div>}

      <div
        className={`mt-5 grid grid-cols-1 items-start gap-4 ${
          materialCollapsed ? "lg:grid-cols-[200px_2.75rem_minmax(0,1fr)]" : "lg:grid-cols-[200px_300px_minmax(0,1fr)]"
        }`}
      >
        <div className="lg:sticky lg:top-20">
          <ChapterNavTree
            activeSolution={p.activeSolution}
            activeChapterId={p.activeChapterId}
            selectChapter={p.selectChapter}
            doneChapterCount={p.doneChapterCount}
          />
        </div>
        <div className="hidden lg:block">{materialPanel}</div>
        <ChapterEditor
          activeChapter={p.activeChapter}
          activeChapterId={p.activeChapterId}
          editingContent={p.editingContent}
          setEditingContent={p.setEditingContent}
          chapterBusy={p.chapterBusy}
          generateChapter={p.generateChapter}
          refineChapter={p.refineChapter}
          reviewChapter={p.reviewChapter}
          optimizeByIssues={p.optimizeByIssues}
          textareaRef={p.chapterTextareaRef}
          bulkGenerating={p.bulkGenerating}
          chapterIndex={chapterIndex}
          genPickerSlot={<SkillPickerFor scope="solution-chapter" source={p.chapterSkills} align="right" />}
          refinePickerSlot={<SkillPickerFor scope="solution-rewrite" source={p.rewriteSkills} align="right" />}
        />
      </div>

      {/* 循环 11 块 B：打印 / 存 PDF 只读正文块（屏幕隐藏，打印独占显示） */}
      <PrintChapterFlow
        docTitle={p.activeSolution?.solution_name || "方案文件"}
        chapters={(p.activeSolution?.chapters ?? []).map((c) => ({
          title: c.title ?? "",
          content: c.content ?? "",
          sections: c.sections,
        }))}
      />

      <footer className="mt-10 border-t border-border pt-5 text-center text-xs text-muted-foreground">
        正文按章节顺序串行生成以保持全文一致，编辑内容自动保存；导出 Word 保留章—节标题层级
      </footer>
    </section>
  )
}
