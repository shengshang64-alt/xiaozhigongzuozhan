import { useState } from "react"
import { FileText, Library, Loader2, Play, Square } from "lucide-react"
import { PrintChapterFlow, PrintExportButton } from "@/components/common/PrintExport"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChapterEditor } from "@/components/solution-studio/ChapterEditor"
import { ChapterNavTree } from "@/components/solution-studio/ChapterNavTree"
import { MaterialAmmoPanel } from "@/components/solution-studio/MaterialAmmoPanel"
import { RequirementCoverageCard } from "@/components/solution-studio/RequirementCoverageCard"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"
import { typeLabel, SOL_COMPLIANCE_MODES, SOL_COMPLIANCE_MODE_LABEL, SOL_COMPLIANCE_MODE_HINT } from "@/pages/SolutionStudio/solutionTypes"
import { bulkResumeNotice, resumeBannerVisible } from "@/pages/SolutionStudio/bulkResume"

type EditorWorkspaceProps = Pick<
  UseSolutionStudio,
  | "activeSolution"
  | "activeChapter"
  | "activeChapterId"
  | "selectChapter"
  | "editingContent"
  | "setEditingContent"
  | "autoSaveState"
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
  | "chapterMaterialRecos"
  | "insertNotice"
  | "undoMaterialInsert"
  | "missingChapterSections"
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
  | "solComplianceMode"
  | "setSolComplianceMode"
  | "solGen"
  | "setSolGenPatch"
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
      recos={p.chapterMaterialRecos}
      recoChapterTitle={p.activeChapter?.title ?? null}
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
        {/* 05 §6：方案侧生成模式三选一 + 问题1/2：目标页数与配图开关（均按方案存 localStorage） */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">生成模式</span>
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              {SOL_COMPLIANCE_MODES.map((m) => {
                const active = p.solComplianceMode === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => p.setSolComplianceMode(m)}
                    title={SOL_COMPLIANCE_MODE_HINT[m]}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {SOL_COMPLIANCE_MODE_LABEL[m]}
                  </button>
                )
              })}
            </div>
            <span className="text-xs text-muted-foreground">{SOL_COMPLIANCE_MODE_HINT[p.solComplianceMode]}</span>
          </div>
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="按每页折算字数（默认版式经 2026-10 实测校准约 950 字/页，随格式设置缩放）折算逐章字数预算：生成不足 60% 自动续写（最多 2 轮），超写按 1.3× 预算裁剪；留空或 0 = 不限页数（维持每章 1200-2000 字）"
          >
            <span className="font-medium text-foreground">目标页数</span>
            <input
              type="number"
              min={0}
              max={200}
              placeholder="不限"
              value={p.solGen.targetPages || ""}
              onChange={(e) => {
                const n = Number(e.target.value)
                p.setSolGenPatch({ targetPages: e.target.value === "" || !Number.isFinite(n) ? 0 : n })
              }}
              className="h-7 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            页
          </label>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            title="开启后生成章节可附架构图/流程图/系统界面示意（结构化数据绘制，导出 Word 自动插图）；关闭则只输出纯文本"
          >
            <input
              type="checkbox"
              checked={p.solGen.figuresEnabled}
              onChange={(e) => p.setSolGenPatch({ figuresEnabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            生成架构图/流程图配图
          </label>
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

      {/* 生成链路 D1 对齐（r148 挂账解除）：上次批量中断内联恢复横幅——非批量中且有已完成章未全，点按钮从断点续跑（done 章天然 skip） */}
      {resumeBannerVisible(p.doneChapterCount, total, p.bulkGenerating) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-card-foreground animate-in fade-in duration-300">
          <span className="min-w-0 flex-1 text-xs">
            {bulkResumeNotice(p.doneChapterCount, total)}（已生成 {p.doneChapterCount}/{total} 章）
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={p.startBulkGenerate}
            className="shrink-0 border-warning/50 text-foreground hover:bg-warning/20"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            继续生成正文
          </Button>
        </div>
      )}

      {/* R162 需求条目落位核验：关联清单条目与大纲/正文两级逐字命中（零 AI 零费用），补写后随自动保存实时复核 */}
      <RequirementCoverageCard
        snapshot={sol.hospital_info?.ref_checklist_snapshot}
        chapters={sol.chapters}
        onSelectChapter={p.selectChapter}
      />

      {/* 窄屏：素材栏改为成稿区上方抽屉式弹层（按钮唤出，默认隐藏） */}
      {mobileMaterialOpen && <div className="mt-4 lg:hidden">{materialPanel}</div>}

      <div
        className={`mt-5 grid grid-cols-1 items-start gap-4 ${
          materialCollapsed ? "lg:grid-cols-[200px_minmax(0,1fr)_2.75rem]" : "lg:grid-cols-[200px_minmax(0,1fr)_300px]"
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
          autoSaveState={p.autoSaveState}
          chapterIndex={chapterIndex}
          figures={p.activeChapter?.figures}
          missingSections={p.missingChapterSections}
          insertNotice={p.insertNotice}
          onUndoInsert={p.undoMaterialInsert}
          genPickerSlot={<SkillPickerFor scope="solution-chapter" source={p.chapterSkills} align="right" />}
          refinePickerSlot={<SkillPickerFor scope="solution-rewrite" source={p.rewriteSkills} align="right" />}
        />
        <div className="hidden lg:block">{materialPanel}</div>
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
        正文按章节顺序串行生成以保持全文一致，编辑内容自动保存；导出 Word 按下方格式模板应用字体/标题/行距与章节配图
      </footer>
    </section>
  )
}
