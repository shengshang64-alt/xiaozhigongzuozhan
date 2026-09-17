import { Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { PageHeader } from "@/components/shell/PageHeader"
import { ArchivePanel } from "@/components/bid-workspace/ArchivePanel"
import { BidProjectList } from "@/components/bid-workspace/BidProjectList"
import { BidToolbar } from "@/components/bid-workspace/BidToolbar"
import { ComplianceMatrixPanel } from "@/components/bid-workspace/ComplianceMatrixPanel"
import { ComposeStep } from "@/components/bid-workspace/ComposeStep"
import { DupCheckPanel } from "@/components/bid-workspace/DupCheckPanel"
import { DefensePanel } from "@/components/bid-workspace/DefensePanel"
import { MockEvalPanel } from "@/components/bid-workspace/MockEvalPanel"
import { OpportunityLinkBar } from "@/components/bid-workspace/OpportunityLinkBar"
import { ParseConfigDialog } from "@/components/bid-workspace/ParseConfigDialog"
import { ParseReportPanel } from "@/components/bid-workspace/ParseReportPanel"
import { PipelineStepper } from "@/components/bid-workspace/PipelineStepper"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { QuickToolsPanel } from "@/components/bid-workspace/QuickToolsPanel"
import { StandardsPickerDialog } from "@/components/bid-workspace/StandardsPickerDialog"
import { SubmissionCheckPanel } from "@/components/bid-workspace/SubmissionCheckPanel"
import { TenderStep } from "@/components/bid-workspace/TenderStep"
import { VoidCheckPanel } from "@/components/bid-workspace/VoidCheckPanel"
import type { useBidWorkspace } from "./useBidWorkspace"

export function BidWorkspacePage(p: ReturnType<typeof useBidWorkspace>) {
  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <BidToolbar
        mainView={p.mainView}
        setMainView={p.setMainView}
        mode={p.mode}
        backToList={p.backToList}
        modelOptions={p.modelOptions}
        selectedModelKey={p.selectedModelKey}
        handleSelectModel={p.handleSelectModel}
      />


      {p.mode === "detail" && p.activeProject ? (
        <main>
          <PipelineStepper activeStep={p.activeStep} requestStep={p.requestStep} activeProject={p.activeProject} />
          <OpportunityLinkBar
            activeProject={p.activeProject}
            activeOppOptions={p.activeOppOptions}
            oppOptionsCapped={p.oppOptionsCapped}
            linkOpportunity={p.linkOpportunity}
            linkedOpportunityName={p.linkedOpportunityName}
            isArchivedLocked={p.isArchivedLocked}
          />
          {/* 循环 5 A3：归档只读硬锁横幅——导出与查看保留，解除归档后可编辑 */}
          {p.isArchivedLocked && (
            <div className="mx-auto mt-4 flex max-w-7xl flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-2.5 shadow-sm">
              <p className="text-xs font-medium text-foreground">
                已归档项目为只读，解除归档后可编辑（导出与查看不受影响）
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={p.unarchiveActiveProject}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                解除归档
              </Button>
            </div>
          )}
          {p.activeStep === 1 && (
            <TenderStep
              activeProject={p.activeProject}
              tenderDraft={p.tenderDraft}
              setTenderDraft={p.setTenderDraft}
              fileBusy={p.fileBusy}
              handleTenderFile={p.handleTenderFile}
              saveTenderText={p.saveTenderText}
              refTemplateDraft={p.refTemplateDraft}
              setRefTemplateDraft={p.setRefTemplateDraft}
              refMaterialsDraft={p.refMaterialsDraft}
              setRefMaterialsDraft={p.setRefMaterialsDraft}
              handleRefFile={p.handleRefFile}
              refFileBusy={p.refFileBusy}
              parseLoading={p.parseLoading}
              parseChunkProgress={p.parseChunkProgress}
              startParse={p.startParse}
              setActiveStep={p.setActiveStep}
              isArchivedLocked={p.isArchivedLocked}
            />
          )}
          {p.activeStep === 2 && (
            <section className="pb-10">
              <header className="rounded-xl border border-border bg-card px-6 py-5 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">AI 解析报告</h1>
                    <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                      解析报告只包含你在解析配置中勾选的分区，每个分区内容都可人工修改补充——后续编制、检查、评标都以这份核对过的报告为准。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={p.startParse}
                    disabled={p.parseLoading || p.isArchivedLocked}
                    className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                  >
                    {p.parseLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-1.5 h-4 w-4" />}
                    {p.parseLoading
                      ? p.parseChunkProgress
                        ? `正在解析第 ${p.parseChunkProgress.current}/${p.parseChunkProgress.total} 段…`
                        : "解析中…"
                      : p.activeProject.parse_report
                        ? "重新解析"
                        : "运行 AI 解析"}
                  </Button>
                </div>
              </header>
              <div className="mt-5">
                <ParseReportPanel
                  report={p.activeProject.parse_report}
                  onChange={p.updateParseReport}
                  onReparse={p.reparseSection}
                  reparseBusyKey={p.reparseBusyKey}
                  skillPickerSlot={<SkillPickerFor scope="bid-parse" source={p.parseSkills} align="right" />}
                  tenderText={p.activeProject.tender_text}
                  warnings={p.parseChunkWarnings}
                  onRescanStar={p.rescanStarClauses}
                  basisMerged={p.basisMergedItems}
                  onOpenStandardsPicker={p.openStandardsPicker}
                />
              </div>
              {/* R005（B-1 阶段一）：实质性条款覆盖矩阵——解析报告本地推导，零 AI 费用 */}
              <div className="mt-5">
                <ComplianceMatrixPanel
                  projectId={p.activeProject.id}
                  report={p.activeProject.parse_report}
                  archived={p.isArchivedLocked}
                />
              </div>
            </section>
          )}
          {p.activeStep === 3 && (
            <ComposeStep
              activeProject={p.activeProject}
              outlineDraft={p.outlineDraft}
              outlineLoading={p.outlineLoading}
              generateOutline={p.generateOutline}
              outlineLevel={p.outlineLevel}
              setOutlineLevel={p.setOutlineLevel}
              targetPages={p.targetPages}
              setTargetPages={p.setTargetPages}
              estimatedPages={p.estimatedPages}
              figuresEnabled={p.figuresEnabled}
              setFiguresEnabled={p.setFiguresEnabled}
              maxFigures={p.maxFigures}
              setMaxFigures={p.setMaxFigures}
              orchestrationSummary={p.orchestrationSummary}
              orchestrationBusy={p.orchestrationBusy}
              orchestrationProgress={p.orchestrationProgress}
              startOrchestration={p.startOrchestration}
              sectionWords={p.sectionWords}
              setSectionWords={p.setSectionWords}
              genOptions={p.genOptions}
              setClauseResponse={p.setClauseResponse}
              setMaterialBoost={p.setMaterialBoost}
              setIncludeBiz={p.setIncludeBiz}
              bizRemoveCount={p.bizRemoveCount}
              confirmRemoveBizChapters={p.confirmRemoveBizChapters}
              cancelRemoveBizChapters={p.cancelRemoveBizChapters}
              formatSettings={p.formatSettings}
              effectiveFormatSettings={p.effectiveFormatSettings}
              formatCheckItems={p.formatCheckItems}
              setFormatSettingsPatch={p.setFormatSettingsPatch}
              setFormatMarginsPatch={p.setFormatMarginsPatch}
              setFormatHeadingLevel={p.setFormatHeadingLevel}
              setFormatBodyPatch={p.setFormatBodyPatch}
              setFormatTablePatch={p.setFormatTablePatch}
              toggleFormatCheckItem={p.toggleFormatCheckItem}
              setAllFormatCheckItems={p.setAllFormatCheckItems}
              identityWords={p.identityWords}
              setIdentityWords={p.setIdentityWords}
              globalFactsSource={p.globalFactsSource}
              factDraft={p.factDraft}
              setFactDraft={p.setFactDraft}
              factAiBusy={p.factAiBusy}
              startGenerateFactSettings={p.startGenerateFactSettings}
              saveGlobalFacts={p.saveGlobalFacts}
              settingsSaved={p.settingsSaved}
              leafTarget={p.leafTarget}
              totalAdjustProgress={p.totalAdjustProgress}
              outlineMissingTitles={p.outlineMissingTitles}
              goParseStep={p.goParseStep}
              outlineRename={p.outlineRename}
              outlineRemove={p.outlineRemove}
              outlineAddChild={p.outlineAddChild}
              outlineAddRoot={p.outlineAddRoot}
              outlineSetPart={p.outlineSetPart}
              outlineMove={p.outlineMove}
              confirmOutline={p.confirmOutline}
              importDialogOpen={p.importDialogOpen}
              setImportDialogOpen={p.setImportDialogOpen}
              importCandidates={p.importCandidates}
              importLoading={p.importLoading}
              openImportDialog={p.openImportDialog}
              importFromSolution={p.importFromSolution}
              activeChapter={p.activeChapter}
              activeChapterId={p.activeChapterId}
              selectChapter={p.selectChapter}
              editingContent={p.editingContent}
              setEditingContent={p.setEditingContent}
              chapterBusy={p.chapterBusy}
              generateChapter={p.generateChapter}
              regenerateChapter={p.regenerateChapter}
              regenerateSection={p.regenerateSection}
              resizeSection={p.resizeSection}
              isArchivedLocked={p.isArchivedLocked}
              continueChapter={p.continueChapter}
              refineChapter={p.refineChapter}
              bulkGenerating={p.bulkGenerating}
              genProgress={p.genProgress}
              startBulkGenerate={p.startBulkGenerate}
              cancelBulkGenerate={p.cancelBulkGenerate}
              doneChapterCount={p.doneChapterCount}
              techChapterTotal={p.techChapterTotal}
              chapterBudgets={p.chapterBudgets}
              supplementState={p.supplementState}
              sectionGenState={p.sectionGenState}
              pageCap={p.pageCap}
              pageInfo={p.pageInfo}
              startFillPages={p.startFillPages}
              pageFillBusy={p.pageFillBusy}
              contentFocus={p.contentFocus}
              focusSectionInChapter={p.focusSectionInChapter}
              outlineClauseTotal={p.outlineClauseTotal}
              coveredClauseCount={p.coveredClauseCount}
              uncoveredClauses={p.uncoveredClauses}
              addClauseToOutline={p.addClauseToOutline}
              addAllClausesToOutline={p.addAllClausesToOutline}
              clauseGranularity={p.clauseGranularity}
              setClauseGranularity={p.setClauseGranularity}
              deviationClauseCount={p.deviationClauseCount}
              mapLoading={p.mapLoading}
              generateDeviationTable={p.generateDeviationTable}
              deviationTable={p.deviationTable}
              deviationSummary={p.deviationSummary}
              jumpToResponseNode={p.jumpToResponseNode}
              exportDeviationWord={p.exportDeviationWord}
              exportBusy={p.exportBusy}
              bidOutlineSkills={p.bidOutlineSkills}
              bidChapterSkills={p.bidChapterSkills}
              deviationSkills={p.deviationSkills}
            />
          )}
          {p.activeStep === 4 && (
            <DupCheckPanel
              activeProject={p.activeProject}
              dupLoading={p.dupLoading}
              runDupCheck={p.runDupCheck}
              jumpToChapter={p.jumpToChapter}
              isArchivedLocked={p.isArchivedLocked}
              intraDupThreshold={p.intraDupThreshold}
              setIntraDupThreshold={p.setIntraDupThreshold}
            />
          )}
          {p.activeStep === 5 && (
            <VoidCheckPanel
              activeProject={p.activeProject}
              voidLoading={p.voidLoading}
              startVoidCheck={p.startVoidCheck}
              toggleVoidManual={p.toggleVoidManual}
              setVoidManualStatus={p.setVoidManualStatus}
              setVoidReviewStatus={p.setVoidReviewStatus}
              jumpToResponseNode={p.jumpToResponseNode}
              voidMissingTitles={p.voidMissingTitles}
              goParseStep={p.goParseStep}
              isArchivedLocked={p.isArchivedLocked}
            />
          )}
          {p.activeStep === 6 && (
            <>
              <MockEvalPanel
                activeProject={p.activeProject}
                evalLoading={p.evalLoading}
                startAiReview={p.startAiReview}
                initManualReview={p.initManualReview}
                setManualScore={p.setManualScore}
                setManualComment={p.setManualComment}
                evalMissingTitles={p.evalMissingTitles}
                goParseStep={p.goParseStep}
                evalPathBusy={p.evalPathBusy}
                evalPathFailed={p.evalPathFailed}
                startEvalPathRerun={p.startEvalPathRerun}
                isArchivedLocked={p.isArchivedLocked}
              />
              <SubmissionCheckPanel
                activeProject={p.activeProject}
                submissionLoading={p.submissionLoading}
                submissionFailed={p.submissionFailed}
                startSubmissionCheck={p.startSubmissionCheck}
                jumpToSubmissionGap={p.jumpToSubmissionGap}
                setSubmissionReviewStatus={p.setSubmissionReviewStatus}
                coverageAudit={p.coverageAudit}
                coverageAuditBusy={p.coverageAuditBusy}
                startCoverageAudit={p.startCoverageAudit}
                supplementFromAudit={p.supplementFromAudit}
                isArchivedLocked={p.isArchivedLocked}
                startFactPatch={p.startFactPatch}
                factPatchBusy={p.factPatchBusy}
              />
              <DefensePanel
                activeProject={p.activeProject}
                defense={p.defense}
                defenseBusy={p.defenseBusy}
                answerBusyId={p.answerBusyId}
                pptSending={p.pptSending}
                defenseConfirm={p.defenseConfirm}
                setDefenseConfirm={p.setDefenseConfirm}
                confirmDefenseRegenerate={p.confirmDefenseRegenerate}
                defenseQuestionsReady={p.defenseQuestionsReady}
                defenseOutlineReady={p.defenseOutlineReady}
                defenseSpeechReady={p.defenseSpeechReady}
                defenseAnsweredCount={p.defenseAnsweredCount}
                startGenerateDefenseQuestions={p.startGenerateDefenseQuestions}
                startGenerateFullAnswer={p.startGenerateFullAnswer}
                updateDefenseQuestion={p.updateDefenseQuestion}
                startGenerateDefenseOutline={p.startGenerateDefenseOutline}
                updateDefenseOutlinePage={p.updateDefenseOutlinePage}
                sendOutlineToPpt={p.sendOutlineToPpt}
                startGenerateSpeechNotes={p.startGenerateSpeechNotes}
                updateSpeechNotes={p.updateSpeechNotes}
                setActiveStep={p.setActiveStep}
                defenseSkills={p.defenseSkills}
                isArchivedLocked={p.isArchivedLocked}
              />
            </>
          )}
          {p.activeStep === 7 && (
            <ArchivePanel
              activeProject={p.activeProject}
              exportBusy={p.exportBusy}
              exportBidWord={p.exportBidWord}
              exportReport={p.exportReport}
              exportDeviationWord={p.exportDeviationWord}
              exportAllDocs={p.exportAllDocs}
              archiveProject={p.archiveProject}
              unarchiveActiveProject={p.unarchiveActiveProject}
              isArchivedLocked={p.isArchivedLocked}
              confirmGate={p.confirmGate}
              resetGate={p.resetGate}
              voidCriticalUnresolved={p.voidCriticalUnresolved}
              gatesUnconfirmed={p.gatesUnconfirmed}
              allGatesConfirmed={p.allGatesConfirmed}
              resultFormOpen={p.resultFormOpen}
              openResultForm={p.openResultForm}
              closeResultForm={p.closeResultForm}
              resultDraft={p.resultDraft}
              setResultDraft={p.setResultDraft}
              bidAmountDraft={p.bidAmountDraft}
              setBidAmountDraft={p.setBidAmountDraft}
              resultLostReasonDraft={p.resultLostReasonDraft}
              setResultLostReasonDraft={p.setResultLostReasonDraft}
              resultSaving={p.resultSaving}
              submitBidResult={p.submitBidResult}
              retrySyncResult={p.retrySyncResult}
              syncFailedStep={p.syncFailedStep}
              linkedOpportunityName={p.linkedOpportunityName}
              stageHistory={p.stageHistory}
              stageHistoryLoading={p.stageHistoryLoading}
              loadStageHistory={p.loadStageHistory}
              restoreSnapshot={p.restoreSnapshot}
              snapshotBusyId={p.snapshotBusyId}
              resetProject={p.resetProject}
              resetConfirmOpen={p.resetConfirmOpen}
              setResetConfirmOpen={p.setResetConfirmOpen}
            />
          )}
        </main>
      ) : p.mainView === "tools" ? (
        <QuickToolsPanel
          toolKind={p.toolKind}
          switchTool={p.switchTool}
          toolMaterial={p.toolMaterial}
          setToolMaterial={p.setToolMaterial}
          toolBidText={p.toolBidText}
          setToolBidText={p.setToolBidText}
          toolFileBusy={p.toolFileBusy}
          handleToolFile={p.handleToolFile}
          toolRunning={p.toolRunning}
          runQuickTool={p.runQuickTool}
          parseLoading={p.parseLoading}
          parseChunkProgress={p.parseChunkProgress}
          toolParseWarnings={p.toolParseWarnings}
          reparseToolSection={p.reparseToolSection}
          reparseBusyKey={p.reparseBusyKey}
          toolParseResult={p.toolParseResult}
          toolDupResult={p.toolDupResult}
          toolVoidResult={p.toolVoidResult}
          toolEvalResult={p.toolEvalResult}
          toolHasResult={p.toolHasResult}
          saveToolAsProject={p.saveToolAsProject}
          parseSkills={p.parseSkills}
          canFactCheck={p.canFactCheck}
          factProjectName={p.factProjectName}
          factCheckBusy={p.factCheckBusy}
          startFactCheck={p.startFactCheck}
          factCheckOpen={p.factCheckOpen}
          setFactCheckOpen={p.setFactCheckOpen}
          factCheckResult={p.factCheckResult}
          factPatchBusy={p.factPatchBusy}
          startFactPatch={p.startFactPatch}
        />
      ) : (
        <main>
          <PageHeader
            title="标书工作"
            desc="标书生成、查重与废标项检查，全流程覆盖投标关键节点"
          />
          <BidProjectList
            projects={p.projects}
            projectsCapped={p.projectsCapped}
            listLoading={p.listLoading}
            searchKeyword={p.searchKeyword}
            setSearchKeyword={p.setSearchKeyword}
            openNewDialog={p.openNewDialog}
            openProject={p.openProject}
            deleteProject={p.deleteProject}
            listView={p.listView}
            setListView={p.setListView}
            recentDeleted={p.recentDeleted}
            softDeleteProject={p.softDeleteProject}
            restoreProject={p.restoreProject}
            setProjectArchived={p.setProjectArchived}
            newDialogOpen={p.newDialogOpen}
            setNewDialogOpen={p.setNewDialogOpen}
            formProjectName={p.formProjectName}
            setFormProjectName={p.setFormProjectName}
            formTenderNo={p.formTenderNo}
            setFormTenderNo={p.setFormTenderNo}
            formHospital={p.formHospital}
            setFormHospital={p.setFormHospital}
            formBidOpenDate={p.formBidOpenDate}
            setFormBidOpenDate={p.setFormBidOpenDate}
            formOpportunityId={p.formOpportunityId}
            setFormOpportunityId={p.setFormOpportunityId}
            dialogOppOptions={p.dialogOppOptions}
            oppOptionsCapped={p.oppOptionsCapped}
            creating={p.creating}
            createProject={p.createProject}
          />
        </main>
      )}

      <ParseConfigDialog
        parseConfigOpen={p.parseConfigOpen}
        closeParseConfig={p.closeParseConfig}
        parseConfigScope={p.parseConfigScope}
        setParseConfigScope={p.setParseConfigScope}
        parseConfigExtras={p.parseConfigExtras}
        toggleParseExtra={p.toggleParseExtra}
        setAllParseExtras={p.setAllParseExtras}
        parseConfigStar={p.parseConfigStar}
        setParseConfigStar={p.setParseConfigStar}
        parseConfigTotal={p.parseConfigTotal}
        saveParseConfig={p.saveParseConfig}
        confirmStartParse={p.confirmStartParse}
        parseLoading={p.parseLoading}
        parseSkills={p.parseSkills}
      />
      <CostConfirmDialog {...p.costConfirm} />
      <StandardsPickerDialog
        standardsPickerOpen={p.standardsPickerOpen}
        closeStandardsPicker={p.closeStandardsPicker}
        basisStyle={p.basisStyle}
        setBasisStyle={p.setBasisStyle}
        basisParsedItems={p.basisParsedItems}
        basisExtraItems={p.basisExtraItems}
        basisMergedItems={p.basisMergedItems}
        toggleBasisStandard={p.toggleBasisStandard}
        clearBasisExtra={p.clearBasisExtra}
      />
    </div>
  )
}
