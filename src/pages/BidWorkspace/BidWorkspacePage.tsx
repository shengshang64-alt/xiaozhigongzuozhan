import { useState, type ReactNode } from "react"
import { AlertTriangle, Loader2, ScanSearch } from "lucide-react"
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
import { DeviationPanel } from "@/components/bid-workspace/DeviationPanel"
import { TechParamResponsePanel } from "@/components/bid-workspace/TechParamResponsePanel"
import { SubjectiveScorePanel } from "@/components/bid-workspace/SubjectiveScorePanel"
import { DeptChecklistPanel } from "@/components/bid-workspace/DeptChecklistPanel"
import { MockEvalPanel } from "@/components/bid-workspace/MockEvalPanel"
import { OpportunityLinkBar } from "@/components/bid-workspace/OpportunityLinkBar"
import { ParseConfigDialog } from "@/components/bid-workspace/ParseConfigDialog"
import { PriceScorePanel } from "@/components/bid-workspace/PriceScorePanel"
import { ParseReportPanel } from "@/components/bid-workspace/ParseReportPanel"
import { BidPipelineStepperEnhanced } from "@/components/bid-workspace/BidPipelineStepperEnhanced"
import { ScoreCrossCheckPanel } from "@/components/bid-workspace/ScoreCrossCheckPanel"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { QuickToolsPanel } from "@/components/bid-workspace/QuickToolsPanel"
import { StandardsPickerDialog } from "@/components/bid-workspace/StandardsPickerDialog"
import { SubmissionCheckPanel } from "@/components/bid-workspace/SubmissionCheckPanel"
import { TenderStep } from "@/components/bid-workspace/TenderStep"
import { VoidCheckPanel } from "@/components/bid-workspace/VoidCheckPanel"
import { displayStageLabel } from "@/pages/BidWorkspace/bidTypes"
import type { useBidWorkspace } from "./useBidWorkspace"

type Step5Tab = { key: string; label: string; node: ReactNode }

/**
 * 步骤内的分页签：只做展示分组，各面板自身的 props / 状态完全不变。
 * UX-v2：⑥ 交卷自查把原第 4/5/6 步（查重 / 废标·合规·部门 / 模拟评标）收进一个步骤的多个 Tab。
 */
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

/** 兼容别名：⑥ 交卷自查 与旧第 5 步共用同一套 Tab 布局 */
const Step6Tabs = Step5Tabs

export function BidWorkspacePage(p: ReturnType<typeof useBidWorkspace>) {
  return (    <div className="animate-in fade-in duration-500 text-foreground">
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
          {/* UX-v2：项目页头按 prototype/bid/draft.html 的 .ph 结构重排——
              第一行 h1 + 状态徽标 + 右侧动作（作战室）；
              第二行 meta 行（开标提示/开标日/商机关联）用小字 kv 排布，不再两行大卡拼贴。
              UX-R3 S10 的两行拆分保留，只是把视觉密度收回原型口径。 */}
          <div className="mx-auto mt-4 max-w-7xl px-4">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-foreground" title={p.activeProject.project_name}>
                    {p.activeProject.project_name}
                  </h1>
                  <span
                    className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    title="当前所处阶段"
                  >
                    {displayStageLabel(p.activeProject)}
                  </span>
                  {p.isArchivedLocked && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      已归档 · 只读
                    </span>
                  )}
                </div>
                {/* meta 行：开标时间 / 关联商机（均为真值可编辑） */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <BidOpenDateBar
                    key={p.activeProject.id}
                    variant="inline"
                    activeProject={p.activeProject}
                    isArchivedLocked={p.isArchivedLocked}
                    updateProject={p.updateProject}
                  />
                  <span aria-hidden="true" className="hidden h-3.5 w-px shrink-0 bg-border sm:block" />
                  <OpportunityLinkBar
                    variant="inline"
                    activeProject={p.activeProject}
                    activeOppOptions={p.activeOppOptions}
                    oppOptionsCapped={p.oppOptionsCapped}
                    linkOpportunity={p.linkOpportunity}
                    linkedOpportunityName={p.linkedOpportunityName}
                    isArchivedLocked={p.isArchivedLocked}
                  />
                </div>
              </div>
              <div className="shrink-0">
                <BidWarRoom activeProject={p.activeProject} missCount={p.uncoveredClauses.length} riskCount={p.voidCriticalUnresolved} />
              </div>
            </header>
          </div>
          {/* UX-v2 拆屏（2026-11-11）：步骤条只管步骤与闸门；章节树/快捷动作/商务组卷
              全部由 ComposeStep 左栏 BidChapterNavTree 承担，不再渲染通栏「章节导航」。
              与项目卡同容器对齐（原裸奔全宽导致首尾步骤被视口裁切） */}
          <div className="mx-auto mt-2.5 max-w-7xl px-4">
            <BidPipelineStepperEnhanced
              activeStep={p.activeStep}
              requestStep={p.requestStep}
              activeProject={p.activeProject}
            />
          </div>
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
                  <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">② 解析确认</h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    先看下面这一条结论，再决定下一步：四类解析结果（废标条款 / 评分办法 / 技术参数 / 时间节点）逐条确认后才放行 ③ 大纲编制。
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
            {/* UX-v2：大纲体检按原型 draft.html 收成一行摘要条（原来是与页面抢视觉的
                rounded-2xl 大折叠块）。计数为真值；0 分未落点 · 0 条建议时降为中性灰。 */}
            <details className="mx-auto mb-3 max-w-7xl rounded-lg border border-border bg-card px-4 py-2 text-xs shadow-sm">
              <summary
                className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
                title="大纲体检：残句治理 / 判定纠偏 R-020 / 目录比对 R-023 / 评分覆盖体检 / 评分策略建议 / 底稿增量合并"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${(p.scoringSuggestions?.length ?? 0) > 0 || (p.scoreCheckup?.techMissing ?? 0) > 0 ? "bg-warning" : "bg-primary"}`} />
                <span className="font-medium text-foreground">大纲体检</span>
                <span className="tabular-nums">
                  差 {p.scoreCheckup?.techMissing ?? 0} 分未落点 · {p.scoringSuggestions?.length ?? 0} 条建议
                </span>
                <span className="ml-auto shrink-0 text-[11px]">展开明细</span>
              </summary>
              <div className="mt-2.5 space-y-3 border-t border-border pt-2.5">
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
              // UX-v2 拆屏：左树里的商务组卷一键核对补入（原步骤条面板接线迁来）
              addBizAssemblyItems={p.addBizAssemblyItems}
              // UX-v2：③ 大纲编制右栏评分点覆盖热力表（buildScoreCheckup 真值）
              scoreCheckup={p.scoreCheckup}
              // UX-v2 七步语义对齐：本步只渲染「大纲屏」；正文屏在 ④
              view="outline"
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
              setSubjectiveConfirmation={p.setSubjectiveConfirmation}
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

          {/* ---------------- UX-v2 ④ 正文编写（prototype/bid/draft.html） ----------------
              左章节树 / 中正文 / 右废标风险·一致性·写作体检，全部由 ComposeStep 承载。 */}
          {p.activeStep === 4 && (
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
              fillBizSkeletons={p.fillBizSkeletons}
              emptyBizChapters={p.emptyBizChapters}
              addBizAssemblyItems={p.addBizAssemblyItems}
              scoreCheckup={p.scoreCheckup}
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
              jumpToResponseNode={p.jumpToResponseNode}
              clauseGranularity={p.clauseGranularity}
              setClauseGranularity={p.setClauseGranularity}
              deviationClauseCount={p.deviationClauseCount}
              deviationSourceLabel={p.deviationSourceLabel}
              mapLoading={p.mapLoading}
              generateDeviationTable={p.generateDeviationTable}
              deviationTable={p.deviationTable}
              deviationSummary={p.deviationSummary}
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
              // UX-v2 七步语义对齐：偏离/主观分/参数响应已移到 ⑤，但 ComposeStep 的
              // props 面仍声明这几项（生成承诺函属正文动作，留在这里）
              generateCommitmentLetter={p.generateCommitmentLetter}
              setSubjectiveConfirmation={p.setSubjectiveConfirmation}
              exportTechParamWord={p.exportTechParamWord}
              // UX-v2 七步语义对齐：本步只渲染「正文屏」；大纲屏在 ③
              view="draft"
            />
          )}

          {/* ---------------- UX-v2 ⑤ 偏离表（prototype/bid/deviation.html） ----------------
              原第 3 步内的「偏离与响应表」Tab 提升为独立步骤：技术偏离 + 技术参数响应 + 主观分确认。 */}
          {p.activeStep === 5 && (
            <div className="mx-auto mt-4 max-w-7xl space-y-4 px-4">
              {/* 页头（原型 deviation.html .ph）：应答率 / 负偏离 / 未应答三件真值 */}
              <header className="border-b border-border pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">⑤ 偏离表</h1>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium tabular-nums text-primary">
                    技术偏离 {p.deviationSummary.total} 条
                  </span>
                  {p.deviationSummary.needs_review > 0 && (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium tabular-nums text-warning">
                      待人工核对 {p.deviationSummary.needs_review}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  招标原文逐字保留；应答与偏离结论按系统分组，导出即交付物，与本屏写作过程分离
                </p>
              </header>

              {/* 数据条（原型 .databar）：全部为 deviationSummary 真值 */}
              <div className="flex flex-wrap items-center rounded-lg border border-border bg-card px-1 py-2 text-xs shadow-sm">
                <span className="border-r border-border/60 px-3.5 text-muted-foreground">
                  参数总数 <b className="font-mono text-[15px] tabular-nums text-card-foreground">{p.deviationSummary.total}</b>
                </span>
                <span className="border-r border-border/60 px-3.5 text-muted-foreground">
                  完全响应 <b className="font-mono text-[15px] tabular-nums text-primary">{p.deviationSummary.full}</b>
                </span>
                <span className="border-r border-border/60 px-3.5 text-muted-foreground">
                  部分响应 <b className="font-mono text-[15px] tabular-nums text-warning">{p.deviationSummary.partial}</b>
                </span>
                <span className="border-r border-border/60 px-3.5 text-muted-foreground">
                  负偏离 <b className="font-mono text-[15px] tabular-nums text-destructive">{p.deviationSummary.deviation}</b>
                </span>
                <span className="px-3.5 text-muted-foreground">
                  技术参数覆盖 <b className="font-mono text-[15px] tabular-nums text-card-foreground">
                    {p.techParamCoverage.covered}/{p.techParamCoverage.total}
                  </b>
                </span>
              </div>

              {/* 未覆盖警示（原型 .alert--red 同位） */}
              {p.techParamCoverage.uncovered > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">
                    还有 <b className="text-destructive">{p.techParamCoverage.uncovered}</b> 项技术参数未进偏离表也未建大纲节点；
                    负偏离每项扣 {p.techParamCoverage.perItemPenalty} 分。⑥ 交卷自查前请处理完。
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => p.addUncoveredTechParamsToOutline()}
                    className="h-7 shrink-0 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
                  >
                    补入未覆盖（{p.techParamCoverage.uncovered}）
                  </Button>
                </div>
              )}

              <DeviationPanel
                clauseGranularity={p.clauseGranularity}
                setClauseGranularity={p.setClauseGranularity}
                deviationClauseCount={p.deviationClauseCount}
                deviationSourceLabel={p.deviationSourceLabel}
                mapLoading={p.mapLoading}
                generateDeviationTable={p.generateDeviationTable}
                deviationTable={p.deviationTable}
                deviationSummary={p.deviationSummary}
                doneChapterCount={p.doneChapterCount}
                jumpToResponseNode={p.jumpToResponseNode}
                exportDeviationWord={p.exportDeviationWord}
                exportBusy={p.exportBusy}
                deviationSkills={p.deviationSkills}
                techParamCoverage={p.techParamCoverage}
                addUncoveredTechParamsToOutline={p.addUncoveredTechParamsToOutline}
              />
              <TechParamResponsePanel
                key={p.activeProject.id}
                tenderText={p.activeProject.tender_text ?? ""}
                report={p.activeProject.parse_report ?? null}
                onExport={p.exportTechParamWord}
                exportBusy={p.exportBusy === "deviation"}
                restoredTables={p.activeProject?.tender_tables ?? null}
              />
              <SubjectiveScorePanel
                project={p.activeProject}
                onConfirm={p.setSubjectiveConfirmation}
                onJumpToChapter={p.jumpToResponseNode}
                archived={p.isArchivedLocked}
              />
            </div>
          )}

          {/* ---------------- UX-v2 ⑥ 交卷自查（prototype/bid/check.html） ----------------
              原第 4/5/6 步三合一：标书查重 · 废标/合规/部门检查 · 模拟评标。 */}
          {p.activeStep === 6 && (
            <div className="mx-auto mt-4 max-w-7xl px-4">
              {/* 页头（原型 check.html .ph）：只放能对上的真值——废标阻断数、闸门确认进度、查重/评标是否已跑。
                  原型这里的「废标/一致性/暗标/格式 四类闸门」是它自己的闸门模型，现网是
                  「解析/大纲/编制/检查/评标」五类 stage_gates，口径不同不硬凑，按现网真实闸门展示。 */}
              <header className="border-b border-border pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">⑥ 交卷自查</h1>
                  {p.voidCriticalUnresolved > 0 ? (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium tabular-nums text-destructive">
                      {p.voidCriticalUnresolved} 项阻断
                    </span>
                  ) : (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      无废标阻断
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    闸门 {p.gatesUnconfirmed > 0 ? `待确认 ${p.gatesUnconfirmed}` : "全部已确认"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  查重 · 废标项检查 · 合规/部门清单 · 模拟评标 · 报价测算 · 答辩准备；全部过闸后才解锁 ⑦ 组卷导出
                </p>
              </header>
              {p.voidCriticalUnresolved > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">
                    还有 <b className="text-destructive">{p.voidCriticalUnresolved}</b> 条废标级条款未核销——
                    未逐条应答的废标条款按无效投标处理，请在 ⑦ 组卷导出前处理完。
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => p.requestStep(5)}
                    className="h-7 shrink-0 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
                  >
                    回 ⑤ 偏离表处理
                  </Button>
                </div>
              )}
              <Step6Tabs
                tabs={[
                  { key: "dup", label: "标书查重", node: (
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
                  ) },
                  { key: "void", label: "废标检查", node: (
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
                      stageHistory={p.stageHistory}
                    />
                  ) },
                  { key: "compliance", label: "合规检查", node: (
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
                  ) },
                  { key: "dept", label: "部门清单", node: (
                    <DeptChecklistPanel
                      key={`dept-check-${p.activeProject.id}`}
                      projectId={p.activeProject.id}
                      projectName={p.activeProject.project_name}
                      locked={p.isArchivedLocked}
                    />
                  ) },
                  { key: "eval", label: "模拟评标", node: (
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
                  ) },
                  // 原第 6 步的报价测算与答辩准备一并保留（原属于「模拟评标」步骤的配套）
                  { key: "price", label: "报价测算", node: (
                    <PriceScorePanel
                      key={p.activeProject?.id ?? "none"}
                      activeProject={p.activeProject}
                      quoteRefs={p.quoteRefs}
                      goParseStep={p.goParseStep}
                    />
                  ) },
                  { key: "defense", label: "答辩准备", node: (
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
                  ) },
                ]}
              />
            </div>
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
