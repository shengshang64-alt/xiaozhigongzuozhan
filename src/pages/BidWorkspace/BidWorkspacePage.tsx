import { useState, type ReactNode } from "react"
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
import { DeptChecklistPanel } from "@/components/bid-workspace/DeptChecklistPanel"
import { MockEvalPanel } from "@/components/bid-workspace/MockEvalPanel"
import { OpportunityLinkBar } from "@/components/bid-workspace/OpportunityLinkBar"
import { ParseConfigDialog } from "@/components/bid-workspace/ParseConfigDialog"
import { PriceScorePanel } from "@/components/bid-workspace/PriceScorePanel"
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

type Step5Tab = { key: string; label: string; node: ReactNode }

/** 第 5 步三块检查的分页签：只做展示分组，各面板自身的 props / 状态完全不变 */
function Step5Tabs({ tabs }: { tabs: Step5Tab[] }) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key ?? "")
  const current = tabs.find((t) => t.key === activeKey)

  return (
    <div>
      <div role="tablist" className="mx-auto mt-4 flex max-w-7xl flex-wrap items-center gap-1 px-4">
        {tabs.map((t) => {
          const isActive = current !== undefined && t.key === current.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveKey(t.key)}
              className={
                isActive
                  ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
                  : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {current ? current.node : null}
    </div>
  )
}

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
          {/* 项目信息栏合一：商机关联 / 开标时间 / 作战室入口收进同一行，步骤条下移，避免三条横杠堆叠 */}
          <div className="mx-auto mt-5 max-w-7xl px-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-md">
              <OpportunityLinkBar
                variant="inline"
                activeProject={p.activeProject}
                activeOppOptions={p.activeOppOptions}
                oppOptionsCapped={p.oppOptionsCapped}
                linkOpportunity={p.linkOpportunity}
                linkedOpportunityName={p.linkedOpportunityName}
                isArchivedLocked={p.isArchivedLocked}
              />
              <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-border lg:block" />
              {/* R198 §3.5：开标时间就地补录/修改/清除（key 绑项目 id，切项目重挂载避免陈旧草稿） */}
              <BidOpenDateBar
                key={p.activeProject.id}
                variant="inline"
                activeProject={p.activeProject}
                isArchivedLocked={p.isArchivedLocked}
                updateProject={p.updateProject}
              />
              <div className="ml-auto shrink-0">
                <BidWarRoom activeProject={p.activeProject} missCount={p.uncoveredClauses.length} riskCount={p.voidCriticalUnresolved} />
              </div>
            </div>
          </div>
          <PipelineStepper
            activeStep={p.activeStep}
            requestStep={p.requestStep}
            activeProject={p.activeProject}
            missCount={p.uncoveredClauses.length}
            riskCount={p.voidCriticalUnresolved}
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
              handleTenderFiles={p.handleTenderFiles}
              tenderFiles={p.tenderFiles}
              removeTenderFileAt={p.removeTenderFileAt}
              moveTenderFileAt={p.moveTenderFileAt}
              setTenderFileRoleAt={p.setTenderFileRoleAt}
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
              <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">AI 解析报告</h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">先看下面这一条结论，再决定下一步。明细按组收着。</p>
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
              </header>
              <div className="mt-4">
                <ParseReportPanel
                  key={p.activeProject.id}
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
                  modelRefForRole={p.modelRefForRole}
                  restoredTables={p.activeProject.tender_tables ?? null}
                  onExportPurchaseList={p.exportPurchaseListWord}
                  onContinue={() => p.requestStep(3)}
                  extraTabs={[
                    {
                      // R005（B-1 阶段一）：实质性条款覆盖矩阵——解析报告本地推导，零 AI 费用
                      id: "matrix",
                      label: "条款覆盖矩阵",
                      node: (
                        <ComplianceMatrixPanel
                          projectId={p.activeProject.id}
                          report={p.activeProject.parse_report}
                          archived={p.isArchivedLocked}
                          tenderText={p.activeProject.tender_text}
                          chapters={p.activeProject.bid_chapters}
                          onImportSections={p.updateParseReport}
                          runWithCostConfirm={p.costConfirm.runWithCostConfirm}
                          modelRefForRole={p.modelRefForRole}
                        />
                      ),
                    },
                    {
                      // R008（B-2 阶段一）：评分项本地交叉核对（原文扫描 vs 解析报告），零 AI 费用
                      id: "crosscheck",
                      label: "评分项核对",
                      node: (
                        <ScoreCrossCheckPanel
                          tenderText={p.activeProject.tender_text}
                          report={p.activeProject.parse_report}
                        />
                      ),
                    },
                  ]}
                />
              </div>
            </section>
          )}
          {p.activeStep === 3 && (
            <>
            <details className="mb-3 rounded-2xl border border-border bg-card px-4 py-3 text-[13px] text-foreground shadow-sm">
              <summary
                className="cursor-pointer font-semibold text-foreground"
                title="大纲体检：残句治理 / 判定纠偏 R-020 / 目录比对 R-023 / 评分覆盖体检 / 评分策略建议 / 底稿增量合并"
              >
                {`大纲体检 · 差 ${p.scoreCheckup?.techMissing ?? 0} 分未落点 · ${p.scoringSuggestions?.length ?? 0} 条建议`}
              </summary>
              <div className="mt-2 space-y-3">
                {p.outlineResidueFixes && p.outlineResidueFixes.length > 0 && (
                  <details open className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2">
                    <summary className="cursor-pointer font-semibold text-foreground" title="残句治理">
                      大纲自动修正
                      <span className="ml-1 font-normal text-muted-foreground">
                        本次已自动修正 {p.outlineResidueFixes.length} 处
                      </span>
                    </summary>
                    <p className="mt-1 text-xs text-muted-foreground">
                      命中残句的标题已并入规范父章、同主题冗余兄弟章已合并，章节正文内容未删除
                    </p>
                    <ul className="mt-2 list-disc pl-5">
                      {p.outlineResidueFixes.map((f, i) => (
                        <li key={i} className="mb-1">
                          <span className="line-through opacity-60">{f.from}</span>
                          {" → "}<b>{f.to}</b>
                          <span className="ml-1.5 opacity-60">（{f.note}）</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {p.mustWriteRescued && p.mustWriteRescued.length > 0 && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <b className="text-destructive" title="R-020 判定纠偏">判定纠偏：</b>
                    {p.mustWriteRescued.length} 个原被模型判为「商务」的章节，按评分办法/技术关键词/★▲ 改判为必写技术内容并已保留：
                    {p.mustWriteRescued.map((x) => x.title).join('、')}
                    （如需回退，可在大纲中手动调整其归属）
                  </div>
                )}
                {p.catalogDiff && p.catalogDiff.hasCatalog && (
                  <details className="rounded-xl border border-border bg-muted/40 px-3 py-2">
                    <summary className="cursor-pointer font-semibold text-foreground" title="目录比对（R-023）">
                      目录比对
                      <span className="ml-1 font-normal text-muted-foreground">
                        已匹配 {p.catalogDiff.matchedCount} / 缺失 {p.catalogDiff.missingCount} / 追加 {p.catalogDiff.extraCount}
                      </span>
                    </summary>
                    {p.catalogDiff.missingCount > 0 && (
                      <div className="mt-1.5">
                        <b className="text-destructive">招标目录中未生成的条目：</b>
                        <ul className="mt-1 list-disc pl-4">
                          {p.catalogDiff.entries.filter((e) => e.status === 'missing').slice(0, 10).map((e, i) => (
                            <li key={i} className="text-destructive">{e.name}</li>
                          ))}
                          {p.catalogDiff.missingCount > 10 && <li className="opacity-60">…另有 {p.catalogDiff.missingCount - 10} 条</li>}
                        </ul>
                        <button
                          type="button"
                          onClick={p.addMissingCatalogToOutline}
                          className="mt-1.5 rounded-lg bg-primary px-3 py-1 text-xs text-primary-foreground"
                        >
                          补入 {p.catalogDiff.missingCount} 条缺失目录
                        </button>
                      </div>
                    )}
                    {p.catalogDiff.extraCount > 0 && (
                      <div className="mt-1.5 opacity-70">
                        大纲新增（非招标目录要求）：{p.catalogDiff.entries.filter((e) => e.status === 'extra').map((e) => e.name).join('、')}
                      </div>
                    )}
                  </details>
                )}
                {p.scoreCheckup && p.scoreCheckup.hasScoring && (
                  <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      <span>评分覆盖体检（按分值）：技术总分 {p.scoreCheckup.techTotal} 分</span>
                      <span>· 已落点 <span className="text-primary">{p.scoreCheckup.techLanded} 分</span></span>
                      <span>· 未落点 <span className={p.scoreCheckup.techMissing > 0 ? "text-destructive" : "text-primary"}>{p.scoreCheckup.techMissing} 分</span></span>
                      {p.scoreCheckup.missingRows.length > 0 && (
                        <button
                          type="button"
                          onClick={p.addUncoveredScoringToOutline}
                          className="ml-auto rounded-lg bg-primary px-3 py-1 text-xs text-primary-foreground"
                        >
                          一键补入 {p.scoreCheckup.missingRows.length} 个未落点评分项
                        </button>
                      )}
                    </div>
                    {p.scoreCheckup.missingRows.length > 0 && (
                      <ul className="mt-2 list-disc pl-5">
                        {p.scoreCheckup.missingRows.slice(0, 12).map((r) => (
                          <li key={r.id} className="mb-0.5">
                            {r.name}
                            <span className="ml-1.5 text-destructive">丢 {r.score} 分</span>
                            {r.subjective && <span className="ml-1.5 opacity-55">（主观分）</span>}
                          </li>
                        ))}
                        {p.scoreCheckup.missingRows.length > 12 && (
                          <li className="opacity-60">…另有 {p.scoreCheckup.missingRows.length - 12} 项未落点</li>
                        )}
                      </ul>
                    )}
                    {p.scoreCheckup.missingRows.length === 0 && (
                      <div className="mt-1.5 text-primary">全部技术评分项均已有对应章节落点。</div>
                    )}
                  </div>
                )}
                {p.scoringSuggestions.length > 0 && (
                  <details className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                    <summary className="cursor-pointer font-semibold text-foreground" title="评分策略建议（纯本地零 AI）">
                      评分策略建议（{p.scoringSuggestions.length} 条）
                    </summary>
                    <ul className="mt-2 list-disc pl-5">
                      {p.scoringSuggestions.map((s) => (
                        <li key={s.id} className="mb-1">
                          「{s.title}」（{s.score} 分）
                          <span className={s.kind === 'evidence' ? "ml-1.5 text-destructive" : "ml-1.5 text-primary"}>
                            {s.kind === 'evidence' ? '证据挂载' : '可加分'}
                          </span>
                          <span className="ml-1.5">{s.text}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {p.demoScoreSummary.hasDemo && (
                  <div>
                    <button
                      type="button"
                      onClick={p.insertDemoSkeleton}
                      className="rounded-lg bg-primary px-3 py-1 text-xs text-primary-foreground"
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
              setTargetPages={p.setTargetPages}
              setSectionWords={p.setSectionWords}
            />
              </div>
            </details>
            <ComposeStep
              activeProject={p.activeProject}
              outlineDraft={p.outlineDraft}
              outlineLoading={p.outlineLoading}
              generateOutline={p.generateOutline}
              outlineCriticalConfirmOpen={p.outlineCriticalConfirmOpen}
              outlineCriticalConfirmText={p.outlineCriticalConfirmText}
              confirmGenerateOutlineCritical={p.confirmGenerateOutlineCritical}
              cancelGenerateOutlineCritical={p.cancelGenerateOutlineCritical}
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
              // 2026-10-31：为空商务章补填写框架
              fillBizSkeletons={p.fillBizSkeletons}
              emptyBizChapters={p.emptyBizChapters}
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
              figureBackfillBusy={p.figureBackfillBusy}
              figureBackfillProgress={p.figureBackfillProgress}
              figureBackfillPending={p.figureBackfillPending}
              startFigureBackfill={p.startFigureBackfill}
              contentFocus={p.contentFocus}
              focusSectionInChapter={p.focusSectionInChapter}
              focusPositionInChapter={p.focusPositionInChapter}
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
              deviationSourceLabel={p.deviationSourceLabel}
              mapLoading={p.mapLoading}
              generateDeviationTable={p.generateDeviationTable}
              deviationTable={p.deviationTable}
              deviationSummary={p.deviationSummary}
              jumpToResponseNode={p.jumpToResponseNode}
              exportDeviationWord={p.exportDeviationWord}
              exportTechParamWord={p.exportTechParamWord}
              generateCommitmentLetter={p.generateCommitmentLetter}
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
            <Step5Tabs
              tabs={[
                {
                  key: "void",
                  label: "废标检查",
                  node: (
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
                  ),
                },
                {
                  key: "compliance",
                  label: "合规检查",
                  node: (
                    // T18+：文本审计卡同步挂第5步——错别字/逻辑检查只依赖正文成稿（比第6步准入门槛低），成稿即可审
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
                  ),
                },
                {
                  key: "dept",
                  label: "部门清单",
                  node: (
                    // 部门检查清单：三份参照清单（招标书 / 投标文件 / 解决方案）原样导入，人工勾选 + 交叉检查 + 签名留痕。
                    // 落既有 checklists 集合的项目级副本（零 schema 变更），零 AI、不做自动判定。
                    <DeptChecklistPanel
                      key={`dept-check-${p.activeProject.id}`}
                      projectId={p.activeProject.id}
                      projectName={p.activeProject.project_name}
                      locked={p.isArchivedLocked}
                    />
                  ),
                },
              ]}
            />
          )}
          {p.activeStep === 6 && (
            <>
              <p className="mx-auto mt-4 max-w-7xl px-4 text-xs text-muted-foreground">
                本步只做模拟评标、报价测算和答辩准备；废标/合规检查在第 5 步。
              </p>
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
              {/* R38（B12）：价格分测算——R35 算法层 + R36 临界价闭式解接进第 6 步（本地零 AI、零新集合） */}
              <PriceScorePanel
                key={p.activeProject?.id ?? "none"}
                activeProject={p.activeProject}
                quoteRefs={p.quoteRefs}
                goParseStep={p.goParseStep}
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
              splitProseLongParagraphs={p.splitProseLongParagraphs}
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
          modelRefForRole={p.modelRefForRole}
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
