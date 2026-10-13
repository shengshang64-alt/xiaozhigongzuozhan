import { Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { PageHeader } from "@/components/shell/PageHeader"
import { ArchivePanel } from "@/components/bid-workspace/ArchivePanel"
import { BidOpenDateBar } from "@/components/bid-workspace/BidOpenDateBar"
import { BidProjectList } from "@/components/bid-workspace/BidProjectList"
import { BidReviewSummary } from "@/components/bid-workspace/BidReviewSummary"
import { BidToolbar } from "@/components/bid-workspace/BidToolbar"
import { BidWarRoom } from "@/components/bid-workspace/BidWarRoom"
import { ComplianceMatrixPanel } from "@/components/bid-workspace/ComplianceMatrixPanel"
import { ComposeStep } from "@/components/bid-workspace/ComposeStep"
import { DraftMergePanel } from "@/components/bid-workspace/DraftMergePanel"
import { DupCheckPanel } from "@/components/bid-workspace/DupCheckPanel"
import { DefensePanel } from "@/components/bid-workspace/DefensePanel"
import { MockEvalPanel } from "@/components/bid-workspace/MockEvalPanel"
import { OpportunityLinkBar } from "@/components/bid-workspace/OpportunityLinkBar"
import { ParseConfigDialog } from "@/components/bid-workspace/ParseConfigDialog"
import { ParseReportPanel } from "@/components/bid-workspace/ParseReportPanel"
import { PipelineStepper } from "@/components/bid-workspace/PipelineStepper"
import { ScoreCrossCheckPanel } from "@/components/bid-workspace/ScoreCrossCheckPanel"
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
          <PipelineStepper
            activeStep={p.activeStep}
            requestStep={p.requestStep}
            activeProject={p.activeProject}
            missCount={p.uncoveredClauses.length}
            riskCount={p.voidCriticalUnresolved}
          />
          <OpportunityLinkBar
            activeProject={p.activeProject}
            activeOppOptions={p.activeOppOptions}
            oppOptionsCapped={p.oppOptionsCapped}
            linkOpportunity={p.linkOpportunity}
            linkedOpportunityName={p.linkedOpportunityName}
            isArchivedLocked={p.isArchivedLocked}
            warRoomSlot={<BidWarRoom activeProject={p.activeProject} missCount={p.uncoveredClauses.length} riskCount={p.voidCriticalUnresolved} />}
          />
          {/* R198 §3.5：开标时间就地补录/修改/清除（key 绑项目 id，切项目重挂载避免陈旧草稿） */}
          <BidOpenDateBar
            key={p.activeProject.id}
            activeProject={p.activeProject}
            isArchivedLocked={p.isArchivedLocked}
            updateProject={p.updateProject}
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
                        ? `正在解析第 ${p.parseChunkProgress.current}/${p.parseChunkProgress.total} 项…`
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
                  runWithCostConfirm={p.costConfirm.runWithCostConfirm}
                  archived={p.isArchivedLocked}
                />
              </div>
              {/* R005（B-1 阶段一）：实质性条款覆盖矩阵——解析报告本地推导，零 AI 费用 */}
              <div className="mt-5">
                <ComplianceMatrixPanel
                  projectId={p.activeProject.id}
                  report={p.activeProject.parse_report}
                  archived={p.isArchivedLocked}
                  tenderText={p.activeProject.tender_text}
                  chapters={p.activeProject.bid_chapters}
                  onImportSections={p.updateParseReport}
                  runWithCostConfirm={p.costConfirm.runWithCostConfirm}
                />
              </div>
              {/* R008（B-2 阶段一）：评分项本地交叉核对（原文扫描 vs 解析报告），零 AI 费用 */}
              <div className="mt-5">
                <ScoreCrossCheckPanel tenderText={p.activeProject.tender_text} report={p.activeProject.parse_report} />
              </div>
            </section>
          )}
          {p.activeStep === 3 && (
            <>
            {p.outlineResidueFixes && p.outlineResidueFixes.length > 0 && (
              <details
                open
                style={{ margin: "0 0 12px", border: "1px solid rgba(14,159,138,0.25)", background: "rgba(14,159,138,0.06)", borderRadius: 14, padding: "8px 12px", fontSize: 13 }}
              >
                <summary style={{ cursor: "pointer", color: "#0e9f8a", fontWeight: 600 }}>
                  本次大纲已自动修正 {p.outlineResidueFixes.length} 处（残句治理）——命中残句的标题已并入规范父章、同主题冗余兄弟章已合并，章节正文内容未删除
                </summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#16324f" }}>
                  {p.outlineResidueFixes.map((f, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{f.from}</span>
                      {" → "}<b>{f.to}</b>
                      <span style={{ marginLeft: 6, opacity: 0.6 }}>（{f.note}）</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {p.mustWriteRescued && p.mustWriteRescued.length > 0 && (
              <div
                style={{ margin: '0 0 12px', border: '1px solid rgba(192,57,43,0.28)', background: 'rgba(192,57,43,0.06)', borderRadius: 14, padding: '8px 12px', fontSize: 13, color: '#16324f' }}
              >
                <b style={{ color: '#c0392b' }}>R-020 判定纠偏：</b>
                {p.mustWriteRescued.length} 个原被模型判为「商务」的章节，按评分办法/技术关键词/★▲ 改判为必写技术内容并已保留：
                {p.mustWriteRescued.map((x) => x.title).join('、')}
                （如需回退，可在大纲中手动调整其归属）
              </div>
            )}
            {p.catalogDiff && p.catalogDiff.hasCatalog && (
              <details
                style={{ margin: '0 0 12px', border: '1px solid rgba(22,50,79,0.15)', background: '#f8fafb', borderRadius: 14, padding: '8px 12px', fontSize: 13 }}
              >
                <summary style={{ cursor: 'pointer', color: '#16324f', fontWeight: 600 }}>
                  目录比对（R-023）：已匹配 {p.catalogDiff.matchedCount} / 缺失 {p.catalogDiff.missingCount} / 追加 {p.catalogDiff.extraCount}
                </summary>
                {p.catalogDiff.missingCount > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <b style={{ color: '#c0392b' }}>招标目录中未生成的条目：</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                      {p.catalogDiff.entries.filter((e) => e.status === 'missing').slice(0, 10).map((e, i) => (
                        <li key={i} style={{ color: '#c0392b' }}>{e.name}</li>
                      ))}
                      {p.catalogDiff.missingCount > 10 && <li style={{ opacity: 0.6 }}>…另有 {p.catalogDiff.missingCount - 10} 条</li>}
                    </ul>
                    <button
                      type='button'
                      onClick={p.addMissingCatalogToOutline}
                      style={{ marginTop: 6, background: '#16324f', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                    >
                      补入 {p.catalogDiff.missingCount} 条缺失目录
                    </button>
                  </div>
                )}
                {p.catalogDiff.extraCount > 0 && (
                  <div style={{ marginTop: 6, opacity: 0.7 }}>
                    大纲新增（非招标目录要求）：{p.catalogDiff.entries.filter((e) => e.status === 'extra').map((e) => e.name).join('、')}
                  </div>
                )}
              </details>
            )}
            {p.scoreCheckup && p.scoreCheckup.hasScoring && (
              <div
                style={{ margin: "0 0 12px", border: "1px solid rgba(22,50,79,0.18)", background: "rgba(22,50,79,0.04)", borderRadius: 14, padding: "10px 14px", fontSize: 13 }}
              >
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, color: "#16324f", fontWeight: 600 }}>
                  <span>评分覆盖体检（按分值）：技术总分 {p.scoreCheckup.techTotal} 分</span>
                  <span>· 已落点 <span style={{ color: "#0e9f8a" }}>{p.scoreCheckup.techLanded} 分</span></span>
                  <span>· 未落点 <span style={{ color: p.scoreCheckup.techMissing > 0 ? "#c0392b" : "#0e9f8a" }}>{p.scoreCheckup.techMissing} 分</span></span>
                  {p.scoreCheckup.missingRows.length > 0 && (
                    <button
                      type="button"
                      onClick={p.addUncoveredScoringToOutline}
                      style={{ marginLeft: "auto", background: "#0e9f8a", color: "#fff", border: "none", borderRadius: 8, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}
                    >
                      一键补入 {p.scoreCheckup.missingRows.length} 个未落点评分项
                    </button>
                  )}
                </div>
                {p.scoreCheckup.missingRows.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#16324f" }}>
                    {p.scoreCheckup.missingRows.slice(0, 12).map((r) => (
                      <li key={r.id} style={{ marginBottom: 2 }}>
                        {r.name}
                        <span style={{ marginLeft: 6, color: "#c0392b" }}>丢 {r.score} 分</span>
                        {r.subjective && <span style={{ marginLeft: 6, opacity: 0.55 }}>（主观分）</span>}
                      </li>
                    ))}
                    {p.scoreCheckup.missingRows.length > 12 && (
                      <li style={{ opacity: 0.6 }}>…另有 {p.scoreCheckup.missingRows.length - 12} 项未落点</li>
                    )}
                  </ul>
                )}
                {p.scoreCheckup.missingRows.length === 0 && (
                  <div style={{ marginTop: 6, color: "#0e9f8a" }}>全部技术评分项均已有对应章节落点。</div>
                )}
              </div>
            )}
            {p.scoringSuggestions.length > 0 && (
              <details
                style={{ margin: '0 0 12px', border: '1px solid rgba(14,159,138,0.35)', background: 'rgba(14,159,138,0.05)', borderRadius: 14, padding: '8px 12px', fontSize: 13 }}
              >
                <summary style={{ cursor: 'pointer', color: '#16324f', fontWeight: 600 }}>
                  评分策略建议（{p.scoringSuggestions.length} 条，纯本地零 AI）
                </summary>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#16324f' }}>
                  {p.scoringSuggestions.map((s) => (
                    <li key={s.id} style={{ marginBottom: 4 }}>
                      「{s.title}」（{s.score} 分）
                      <span style={{ marginLeft: 6, color: s.kind === 'evidence' ? '#c0392b' : '#0e9f8a' }}>
                        {s.kind === 'evidence' ? '证据挂载' : '可加分'}
                      </span>
                      <span style={{ marginLeft: 6 }}>{s.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {p.demoScoreSummary.hasDemo && (
              <div style={{ margin: '0 0 12px', fontSize: 13 }}>
                <button
                  type='button'
                  onClick={p.insertDemoSkeleton}
                  style={{ background: '#0e9f8a', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                >
                  {`一键插入演示准备骨架（${p.demoScoreSummary.count} 个演示节点）`}
                </button>
              </div>
            )}
            {/* R245 用户 P0 需求 R-001：底稿增量合并——上传商务同事已写好的标书，逐章匹配大纲后原文保留 / 带参考重写 / 缺失补齐 */}
            <DraftMergePanel
              key={`draft-merge-${p.activeProject.id}`}
              activeProject={p.activeProject}
              updateProject={p.updateProject}
              isArchivedLocked={p.isArchivedLocked}
              bidSourceMode={p.bidSourceMode}
              refMaterialsDraft={p.refMaterialsDraft}
              setRefMaterialsDraft={p.setRefMaterialsDraft}
            />
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
              figureTemplates={p.figureTemplates}
              figureUploadBusy={p.figureUploadBusy}
              uploadChapterFigure={p.uploadChapterFigure}
              insertFigureTemplate={p.insertFigureTemplate}
              removeFigureTemplateById={p.removeFigureTemplateById}
              orchestrationSummary={p.orchestrationSummary}
              orchestrationBusy={p.orchestrationBusy}
              orchestrationProgress={p.orchestrationProgress}
              startOrchestration={p.startOrchestration}
              sectionWords={p.sectionWords}
              setSectionWords={p.setSectionWords}
              genOptions={p.genOptions}
              setClauseResponse={p.setClauseResponse}
              setMaterialBoost={p.setMaterialBoost}
              setGenerateDemo={p.setGenerateDemo}
              demoScoreSummary={p.demoScoreSummary}
              setWordRefine={p.setWordRefine}
              setAutoConsistencyAudit={p.setAutoConsistencyAudit}
              setComplianceMode={p.setComplianceMode}
              setIncludeBiz={p.setIncludeBiz}
              scope={p.scope}
              setScope={p.setScope}
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
              generateCommitmentLetter={p.generateCommitmentLetter}
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
              autoSaveState={p.autoSaveState}
              chapterBusy={p.chapterBusy}
              refMaterialsDraft={p.refMaterialsDraft}
              refFileBusy={p.refFileBusy}
              saveMaterialLibrary={p.saveMaterialLibrary}
              applyLibraryDefaults={p.applyLibraryDefaults}
              importLibraryFile={p.importLibraryFile}
              classifyLibraryDraft={p.classifyLibraryDraft}
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
              startWordRefineAll={p.startWordRefineAll}
              wordRefineBusy={p.wordRefineBusy}
              startAiFigures={p.startAiFigures}
              aiFigureBusy={p.aiFigureBusy}
              aiFigureProgress={p.aiFigureProgress}
              figureBackfillBusy={p.figureBackfillBusy}
              figureBackfillProgress={p.figureBackfillProgress}
              figureBackfillPending={p.figureBackfillPending}
              startFigureBackfill={p.startFigureBackfill}
              contentFocus={p.contentFocus}
              focusSectionInChapter={p.focusSectionInChapter}
              outlineClauseTotal={p.outlineClauseTotal}
              coveredClauseCount={p.coveredClauseCount}
              uncoveredClauses={p.uncoveredClauses}
              addClauseToOutline={p.addClauseToOutline}
              addAllClausesToOutline={p.addAllClausesToOutline}
              outlineChapterDrift={p.outlineChapterDrift}
              syncOutlineChapters={p.syncOutlineChapters}
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
              techParamCoverage={p.techParamCoverage}
              addUncoveredTechParamsToOutline={p.addUncoveredTechParamsToOutline}
              requestStep={p.requestStep}
              bidSourceMode={p.bidSourceMode}
              bidExternalText={p.bidExternalText}
              bidExternalBusy={p.bidExternalBusy}
              setBidSourceMode={p.setBidSourceMode}
              setBidExternalText={p.setBidExternalText}
              handleBidExternalFile={p.handleBidExternalFile}
            />
            </>
          )}
          {p.activeStep === 4 && (
            <DupCheckPanel
              activeProject={p.activeProject}
              dupLoading={p.dupLoading}
              requestStep={p.requestStep}
              runDupCheck={p.runDupCheck}
              jumpToChapter={p.jumpToChapter}
              isArchivedLocked={p.isArchivedLocked}
              intraDupThreshold={p.intraDupThreshold}
              setIntraDupThreshold={p.setIntraDupThreshold}
            />
          )}
          {p.activeStep === 5 && (
            <>
            <VoidCheckPanel
              activeProject={p.activeProject}
              voidLoading={p.voidLoading}
              requestStep={p.requestStep}
              startVoidCheck={p.startVoidCheck}
              toggleVoidManual={p.toggleVoidManual}
              setVoidManualStatus={p.setVoidManualStatus}
              setVoidReviewStatus={p.setVoidReviewStatus}
              jumpToResponseNode={p.jumpToResponseNode}
              voidMissingTitles={p.voidMissingTitles}
              goParseStep={p.goParseStep}
              isArchivedLocked={p.isArchivedLocked}
              bidSourceMode={p.bidSourceMode}
              sealBusy={p.sealBusy}
              sealResult={p.sealResult}
              startSealCheck={p.startSealCheck}
            />
            {/* T18+：文本审计卡同步挂第5步——错别字/逻辑检查只依赖正文成稿（比第6步准入门槛低），成稿即可审 */}
            <SubmissionCheckPanel
              activeProject={p.activeProject}
              requestStep={p.requestStep}
              submissionLoading={p.submissionLoading}
              submissionFailed={p.submissionFailed}
              startSubmissionCheck={p.startSubmissionCheck}
              jumpToSubmissionGap={p.jumpToSubmissionGap}
              setSubmissionReviewStatus={p.setSubmissionReviewStatus}
              coverageAudit={p.coverageAudit}
              coverageAuditBusy={p.coverageAuditBusy}
              startCoverageAudit={p.startCoverageAudit}
              supplementFromAudit={p.supplementFromAudit}
              reflowChapterFromAudit={p.reflowChapterFromAudit}
              chapterReflowBusy={p.chapterReflowBusy}
              quoteFixBusy={p.quoteFixBusy}
              startQuoteRewriteFix={p.startQuoteRewriteFix}
              isArchivedLocked={p.isArchivedLocked}
              startFactPatch={p.startFactPatch}
              factPatchBusy={p.factPatchBusy}
              textAuditBusy={p.textAuditBusy}
              startTextAudit={p.startTextAudit}
              fixTyposBusy={p.fixTyposBusy}
              startFixTypos={p.startFixTypos}
              jumpToAuditChapter={p.jumpToAuditChapter}
            />
            </>
          )}
          {p.activeStep === 6 && (
            <>
              <MockEvalPanel
                activeProject={p.activeProject}
                evalLoading={p.evalLoading}
                requestStep={p.requestStep}
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
                requestStep={p.requestStep}
                submissionLoading={p.submissionLoading}
                submissionFailed={p.submissionFailed}
                startSubmissionCheck={p.startSubmissionCheck}
                jumpToSubmissionGap={p.jumpToSubmissionGap}
                setSubmissionReviewStatus={p.setSubmissionReviewStatus}
                coverageAudit={p.coverageAudit}
                coverageAuditBusy={p.coverageAuditBusy}
                startCoverageAudit={p.startCoverageAudit}
                supplementFromAudit={p.supplementFromAudit}
                reflowChapterFromAudit={p.reflowChapterFromAudit}
                chapterReflowBusy={p.chapterReflowBusy}
                quoteFixBusy={p.quoteFixBusy}
                startQuoteRewriteFix={p.startQuoteRewriteFix}
                isArchivedLocked={p.isArchivedLocked}
                startFactPatch={p.startFactPatch}
                factPatchBusy={p.factPatchBusy}
                textAuditBusy={p.textAuditBusy}
                startTextAudit={p.startTextAudit}
                fixTyposBusy={p.fixTyposBusy}
                startFixTypos={p.startFixTypos}
                jumpToAuditChapter={p.jumpToAuditChapter}
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
              requestStep={p.requestStep}
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
          costConfirm={p.costConfirm}
        />
      ) : (
        <main>
          <PageHeader
            title="标书工作"
            desc="标书生成、查重与废标项检查，全流程覆盖投标关键节点"
          />
          {/* R006（B-3 阶段一）：投标复盘汇总——纯统计零 AI */}
          <BidReviewSummary projects={p.projects} />
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
        parseConfigChannel={p.parseConfigChannel}
        setParseConfigChannel={p.setParseConfigChannel}
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
