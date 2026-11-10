// 方案工作室（UX-v2：docs/ux-v2-2026-11/prototype/solution/ 四屏）
//
// 拆屏：方案列表 / 方案编辑器 / 建设清单 / 交付检查，用 ?tab= 在一个工作区标签内切换
// （口径见 solutionStudioTabs.ts；切屏统一走 useSolutionStudio.goStudioTab——编辑器有
// 未落盘正文与进行中的批量生成，离开前要 flush / 停批量，不能只改地址）。
//
// 编辑器屏三栏：左大纲+素材弹药（小卡）· 中正文 · 右需求覆盖+事实接地（骨架）；
// 体检横幅（需求落位核验 / 交付前本地体检 / 整本 AI 自检）整体迁到「交付检查」屏，
// 不再压住写作区。建设清单 1:1 已收口，本壳只换导航不动画。
import { useMemo } from "react"
import { ChevronDown, FileEdit, Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { ChecklistView } from "@/components/solution-studio/checklist/ChecklistView"
import { EditorWorkspace } from "@/components/solution-studio/EditorWorkspace"
import { ExportTemplateCard } from "@/components/solution-studio/ExportTemplateCard"
import { SsFormatCard } from "@/components/solution-studio/SsFormatCard"
import { NewSolutionWizard } from "@/components/solution-studio/NewSolutionWizard"
import { SolutionDeliveryScreen } from "@/components/solution-studio/SolutionDeliveryScreen"
import { SolutionListPanel } from "@/components/solution-studio/SolutionListPanel"
import { SolutionSubtabs } from "@/components/solution-studio/SolutionSubtabs"
import { SolutionToKbWizard } from "@/components/solution-studio/SolutionToKbWizard"
import { StudioToolbar } from "@/components/solution-studio/StudioToolbar"
import type { useSolutionStudio } from "./useSolutionStudio"

export function SolutionStudioPage(p: ReturnType<typeof useSolutionStudio>) {
  // 从 CheckProduct 产品库取“产品/系统”候选标签：优先 in_company=true，否则回退全部；去重 + 排序
  const productNames = useMemo(() => {
    const source = p.checklist.companyProducts.length > 0 ? p.checklist.companyProducts : p.checklist.products
    return Array.from(new Set(source.map((x) => x.product_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
  }, [p.checklist.companyProducts, p.checklist.products])

  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <StudioToolbar
        inEditor={p.studioTab === "editor" && Boolean(p.activeSolution)}
        onBackToList={p.backToList}
        modelOptions={p.modelOptions}
        selectedModelKey={p.selectedModelKey}
        onSelectModel={p.handleSelectModel}
      />

      <SolutionSubtabs active={p.studioTab} onSelect={p.goStudioTab} />

      {p.studioTab === "checklist" ? (
        <main>
          <ChecklistView ck={p.checklist} onStartSolution={p.startSolutionFromChecklist} />
        </main>
      ) : p.studioTab === "editor" ? (
        p.activeSolution ? (
          <main>
            <EditorWorkspace
              activeSolution={p.activeSolution}
              activeChapter={p.activeChapter}
              activeChapterId={p.activeChapterId}
              selectChapter={p.selectChapter}
              editingContent={p.editingContent}
              setEditingContent={p.setEditingContent}
              autoSaveState={p.autoSaveState}
              autoSaveFailedReason={p.autoSaveFailedReason}
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
              onGoDelivery={() => p.goStudioTab("delivery")}
            />
            {/* 导出设置折叠：格式模板 + 导出模板都在，但收进折叠，不再占据写作屏版面 */}
            <details className="group mx-auto mt-5 max-w-7xl rounded-lg border border-border bg-card px-4 py-3 shadow-md">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-card-foreground [&::-webkit-details-marker]:hidden">
                <Settings2 className="h-4 w-4 shrink-0 text-primary" />
                导出与版式设置（导出 Word / 打印时生效，按方案记忆）
                <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3">
                <SsFormatCard fmt={p.ssFmt} onPatch={p.setSsFmtPatch} />
              </div>
              <div className="mt-4">
                <ExportTemplateCard tpl={p.expTpl} onPatch={p.setExpTplPatch} />
              </div>
            </details>
          </main>
        ) : (
          /* 编辑器空态：?tab=editor 直达且未打开方案时，给下一步而不是死白页 */
          <main>
            <section className="mx-auto mt-10 max-w-md rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center shadow-md">
              <FileEdit className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <h2 className="mt-3 text-sm font-semibold text-card-foreground">还没打开方案</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                从方案列表选一个方案开始写，或新建一份方案（可关联建设清单，生成大纲后逐章成稿）。
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => p.goStudioTab("list")} className="border-border text-card-foreground hover:bg-secondary">
                  去方案列表
                </Button>
                <Button size="sm" onClick={p.openNewWizard} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  新建方案
                </Button>
              </div>
            </section>
          </main>
        )
      ) : p.studioTab === "delivery" ? (
        <main>
          <SolutionDeliveryScreen
            activeSolution={p.activeSolution}
            selectChapter={p.selectChapter}
            selfCheckOverview={p.selfCheckOverview}
            bulkReviewBusy={p.bulkReviewBusy}
            reviewProgress={p.reviewProgress}
            startBulkReview={p.startBulkReview}
            cancelBulkReview={p.cancelBulkReview}
            onGoEditor={() => p.goStudioTab("editor")}
            onGoList={() => p.goStudioTab("list")}
          />
        </main>
      ) : (
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
        assembleOutlineFromChecklist={p.assembleOutlineFromChecklist}
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
