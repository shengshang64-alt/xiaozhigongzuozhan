import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { useMemo } from "react"
import { ChecklistView } from "@/components/solution-studio/checklist/ChecklistView"
import { EditorWorkspace } from "@/components/solution-studio/EditorWorkspace"
import { ExportTemplateCard } from "@/components/solution-studio/ExportTemplateCard"
import { SsFormatCard } from "@/components/solution-studio/SsFormatCard"
import { NewSolutionWizard } from "@/components/solution-studio/NewSolutionWizard"
import { SolutionListPanel } from "@/components/solution-studio/SolutionListPanel"
import { SolutionToKbWizard } from "@/components/solution-studio/SolutionToKbWizard"
import { StudioToolbar } from "@/components/solution-studio/StudioToolbar"
import type { useSolutionStudio } from "./useSolutionStudio"

const STUDIO_VIEWS: { key: "checklist" | "solution"; label: string }[] = [
  { key: "checklist", label: "建设清单" },
  { key: "solution", label: "方案编制" },
]

export function SolutionStudioPage(p: ReturnType<typeof useSolutionStudio>) {
  // 从 CheckProduct 产品库取“产品/系统”候选标签：优先 in_company=true，否则回退全部；去重 + 排序
  const productNames = useMemo(() => {
    const source = p.checklist.companyProducts.length > 0 ? p.checklist.companyProducts : p.checklist.products
    return Array.from(new Set(source.map((x) => x.product_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
  }, [p.checklist.companyProducts, p.checklist.products])
  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <StudioToolbar
        inEditor={p.mode === "editor"}
        onBackToList={p.backToList}
        modelOptions={p.modelOptions}
        selectedModelKey={p.selectedModelKey}
        onSelectModel={p.handleSelectModel}
      />

      <div className="mb-5 flex w-fit items-center gap-1 rounded-full bg-muted p-0.5">
        {STUDIO_VIEWS.map((v) => {
          const active = p.studioView === v.key
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => p.setStudioView(v.key)}
              className={`rounded-full px-4 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      {p.studioView === "checklist" ? (
        <main>
          <ChecklistView ck={p.checklist} onStartSolution={p.startSolutionFromChecklist} />
        </main>
      ) : p.mode === "list" ? (
        <main>
          <SolutionListPanel
            solutions={p.solutions}
            solutionStats={p.solutionStats}
            listLoading={p.listLoading}
            searchKeyword={p.searchKeyword}
            setSearchKeyword={p.setSearchKeyword}
            openNewWizard={p.openNewWizard}
            openSolution={p.openSolution}
            openReuseWizard={p.openReuseWizard}
            openSolutionToKb={p.openSolutionToKb}
            deleteSolution={p.deleteSolution}
            userId={p.userId}
          />
        </main>
      ) : (
        <main>
          <EditorWorkspace
            activeSolution={p.activeSolution}
            activeChapter={p.activeChapter}
            activeChapterId={p.activeChapterId}
            selectChapter={p.selectChapter}
            editingContent={p.editingContent}
            setEditingContent={p.setEditingContent}
            chapterBusy={p.chapterBusy}
            generateChapter={p.generateChapter}
            refineChapter={p.refineChapter}
            reviewChapter={p.reviewChapter}
            optimizeByIssues={p.optimizeByIssues}
            chapterTextareaRef={p.chapterTextareaRef}
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
            chapterMaterialRecos={p.chapterMaterialRecos}
            insertNotice={p.insertNotice}
            undoMaterialInsert={p.undoMaterialInsert}
            missingChapterSections={p.missingChapterSections}
            solutions={p.solutions}
            openSolutionToKb={p.openSolutionToKb}
            bulkGenerating={p.bulkGenerating}
            genProgress={p.genProgress}
            startBulkGenerate={p.startBulkGenerate}
            cancelBulkGenerate={p.cancelBulkGenerate}
            doneChapterCount={p.doneChapterCount}
            docStatusLabel={p.docStatusLabel}
            exportWord={p.exportWord}
            exportingWord={p.exportingWord}
            chapterSkills={p.chapterSkills}
            rewriteSkills={p.rewriteSkills}
            solComplianceMode={p.solComplianceMode}
            setSolComplianceMode={p.setSolComplianceMode}
            solGen={p.solGen}
            setSolGenPatch={p.setSolGenPatch}
          />
          {/* 问题 3：导出格式模板（正文/标题/表格/页面，按方案存 localStorage，导出 Word 生效） */}
          <div className="mt-4">
            <SsFormatCard fmt={p.ssFmt} onPatch={p.setSsFmtPatch} />
          </div>
          {/* R007（B-4 阶段一）：导出模板（封面/目录/页眉，按方案存 localStorage） */}
          <div className="mt-4">
            <ExportTemplateCard tpl={p.expTpl} onPatch={p.setExpTplPatch} />
          </div>
        </main>
      )}

      <NewSolutionWizard
        wizardOpen={p.wizardOpen}
        wizardStep={p.wizardStep}
        setWizardStep={p.setWizardStep}
        closeWizard={p.closeWizard}
        solutionTypes={p.solutionTypes}
        formTypeKey={p.formTypeKey}
        setFormTypeKey={p.setFormTypeKey}
        formSolutionName={p.formSolutionName}
        setFormSolutionName={p.setFormSolutionName}
        formHospital={p.formHospital}
        setFormHospital={p.setFormHospital}
        formOpportunityId={p.formOpportunityId}
        setFormOpportunityId={p.setFormOpportunityId}
        wizardOppOptions={p.wizardOppOptions}
        formInfo={p.formInfo}
        setFormInfo={p.setFormInfo}
        checklistOptions={p.checklist.myChecklists}
        formChecklistId={p.formChecklistId}
        onPickChecklist={p.handlePickChecklist}
        outlineDraft={p.outlineDraft}
        outlineLoading={p.outlineLoading}
        confirming={p.confirming}
        submitWizardInfo={p.submitWizardInfo}
        confirmOutline={p.confirmOutline}
        outlineRename={p.outlineRename}
        outlineRemove={p.outlineRemove}
        outlineAddChild={p.outlineAddChild}
        outlineAddRoot={p.outlineAddRoot}
        outlineMove={p.outlineMove}
        outlineSkills={p.outlineSkills}
        productNames={productNames}
      />

      <SolutionToKbWizard
        solution={p.kbWizardSolution}
        userId={p.userId}
        open={Boolean(p.kbWizardSolution)}
        onOpenChange={(open) => {
          if (!open) p.closeSolutionToKb()
        }}
        onImported={p.handleKbWizardImported}
      />

      <CostConfirmDialog {...p.costConfirm} />
    </div>
  )
}
