// UX-R2: PPT 与报价 已按 docs/ux-review-2026-11 修复 2026-11-07（统计随 Tab 联动/空态主按钮/最近报价单）
import { useMemo } from "react"
import { ReceiptText } from "lucide-react"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { DeckEditorWorkspace } from "@/components/ppt-quote/DeckEditorWorkspace"
import { DeckListPanel } from "@/components/ppt-quote/DeckListPanel"
import { PptStatsRow } from "@/components/ppt-quote/PptStatsRow"
import { NewDeckWizard } from "@/components/ppt-quote/NewDeckWizard"
import { ProductPickerDialog } from "@/components/ppt-quote/ProductLibraryPanel"
import { CheckProductPickerDialog } from "@/components/ppt-quote/CheckProductPickerDialog"
import { ChecklistImportDialog } from "@/components/ppt-quote/ChecklistImportDialog"
import { NewQuoteDialog, QuoteDraftDialog } from "@/components/ppt-quote/QuoteDialogs"
import { QuoteEditor } from "@/components/ppt-quote/QuoteEditor"
import { QuoteListPanel } from "@/components/ppt-quote/QuoteListPanel"
import { QuoteToolbar } from "@/components/ppt-quote/QuoteToolbar"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { centsToYuan } from "@/lib/money"
import { formatMoney, quoteTotalCents } from "./pptQuoteTypes"
import type { usePptQuote } from "./usePptQuote"

export function PptQuotePage(p: ReturnType<typeof usePptQuote>) {
  const deckInDetail = p.deckMode !== "list"
  const quoteInDetail = p.quoteMode === "editor"
  const pickerGroupName =
    p.activeQuote?.groups.find((g) => g.id === p.productPickerGroup)?.name ?? ""
  const inListMode =
    (p.activeView === "deck" && p.deckMode === "list") ||
    (p.activeView === "quote" && p.quoteMode === "list")
  // 统计卡为全量口径（不受搜索过滤影响），对齐原型 stat-row
  const pptStats = useMemo(() => {
    const deckCount = p.deckList.length
    const deckDone = p.deckList.filter((d) => d.doc_status === "done").length
    const quoteCount = p.quoteList.length
    const sum = p.quoteList.reduce((s, q) => s + quoteTotalCents(q.groups ?? []), 0)
    return { deckCount, deckDone, quoteCount, totalAmount: formatMoney(centsToYuan(sum)) }
  }, [p.deckList, p.quoteList])
  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <QuoteToolbar
        activeView={p.activeView}
        onSwitchView={p.setActiveView}
        inDetail={p.activeView === "deck" ? deckInDetail : quoteInDetail}
        detailLabel={p.activeView === "deck" ? "PPT 列表" : "报价列表"}
        onBackToList={p.activeView === "deck" ? p.backToDeckList : p.backToQuoteList}
        modelOptions={p.modelOptions}
        selectedModelKey={p.selectedModelKey}
        onSelectModel={p.handleSelectModel}
      />

      <main>
        {inListMode && (
          <PptStatsRow
            view={p.activeView}
            deckCount={pptStats.deckCount}
            deckDone={pptStats.deckDone}
            quoteCount={pptStats.quoteCount}
            quoteTotalAmount={pptStats.totalAmount}
          />
        )}
        {p.activeView === "quote" && p.quoteMode === "list" && pptStats.quoteCount > 0 ? (
          (() => {
            const recent = [...p.quoteList]
              .sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")))
              .slice(0, 3)
            return (
              <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <ReceiptText className="h-3.5 w-3.5 text-primary" />
                  最近报价单
                  <span className="text-xs font-normal text-muted-foreground">最近更新的 3 份，点击直接打开</span>
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {recent.map((q) => (
                    <li key={q.id}>
                      <button
                        type="button"
                        onClick={() => p.openQuote(q)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{q.quote_name}</span>
                        {q.version ? <span className="shrink-0 text-xs text-muted-foreground">{q.version}</span> : null}
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          ¥ {formatMoney(centsToYuan(quoteTotalCents(q.groups ?? [])))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()
        ) : null}

        {p.activeView === "deck" ? (
          p.deckMode === "list" ? (
            <DeckListPanel
              decks={p.filteredDecks}
              listLoading={p.deckListLoading}
              search={p.deckSearch}
              setSearch={p.setDeckSearch}
              onNew={p.openNewDeckWizard}
              onOpen={p.openDeck}
              onDelete={p.deleteDeck}
            />
          ) : p.deckMode === "wizard" ? (
            <NewDeckWizard
              wDeckName={p.wDeckName}
              setWDeckName={p.setWDeckName}
              wDeckType={p.wDeckType}
              setWDeckType={p.setWDeckType}
              wTopic={p.wTopic}
              setWTopic={p.setWTopic}
              wAudience={p.wAudience}
              setWAudience={p.setWAudience}
              wDuration={p.wDuration}
              setWDuration={p.setWDuration}
              wKeyPoints={p.wKeyPoints}
              setWKeyPoints={p.setWKeyPoints}
              suggestedPageCount={p.suggestedPageCount}
              wPages={p.wPages}
              setWPages={p.setWPages}
              targetPageCount={p.targetPageCount}
              wMaterial={p.wMaterial}
              setWMaterial={p.setWMaterial}
              solutionOptions={p.solutionOptions}
              bidOptions={p.bidOptions}
              materialLoading={p.materialLoading}
              deckGenerating={p.deckGenerating}
              deckProgress={p.deckProgress}
              onCancel={p.closeDeckWizard}
              onGenerate={p.startDeckGeneration}
              deckPickerSlot={<SkillPickerFor scope="ppt-deck" source={p.deckSkills} />}
              autoFigureMode={p.autoFigureMode}
              setAutoFigureMode={p.setAutoFigureMode}
              autoFigureProvider={p.autoFigureProvider}
              setAutoFigureProvider={p.setAutoFigureProvider}
              // 2026-10-30 四步向导：素材 / 模板 / 大纲
              templateName={p.deckTemplateName ?? null}
              templateOutline={p.templateOutline}
              layoutMapping={p.layoutMapping}
              onUploadTemplate={(f) => p.uploadDeckTemplate(f)}
              onClearTemplate={p.clearDeckTemplateChoice}
              onMappingChange={p.setLayoutMapping}
              // 2026-11-05 内置公司模板（智业浅色母版，走 fetch 通道不受 3MB 上限）
              builtinTemplates={p.builtinTemplates}
              builtinTemplateKey={p.builtinTemplateKey}
              onSelectBuiltinTemplate={(k) => void p.selectBuiltinDeckTemplate(k)}
              outlineDraft={p.draftOutline}
              onDraftOutline={p.draftDeckOutline}
              onOutlineChange={p.setDraftOutline}
              onGenerateFromOutline={() => void p.generateFromOutline(p.draftOutline ?? [])}
            />
          ) : p.activeDeck ? (
            <DeckEditorWorkspace
              deck={p.activeDeck}
              currentSlide={p.currentSlide}
              currentSlideIndex={p.currentSlideIndex}
              setCurrentSlideIndex={p.setCurrentSlideIndex}
              editorTab={p.editorTab}
              setEditorTab={p.setEditorTab}
              slideAiKind={p.slideAiKind}
              onBack={p.backToDeckList}
              onRename={p.renameDeck}
              updateSlide={p.updateSlide}
              addSlide={p.addSlide}
              deleteSlideAt={p.deleteSlideAt}
              moveSlide={p.moveSlide}
              refineSlide={p.refineSlide}
              persistFailed={p.deckPersistFailed}
              onSaveNow={() => void p.saveDeckNow()}
              onExportPptx={p.exportPptx}
              deckTemplateName={p.deckTemplateName}
              templateOutline={p.templateOutline}
              layoutMapping={p.layoutMapping}
              onMappingChange={p.setLayoutMapping}
              // 2026-10-30 全册视觉计划 + 渲染质检
              visualPlan={p.deckVisualPlan}
              renderReport={p.renderReport}
              renderChecking={p.renderChecking}
              renderCapability={p.renderCapability}
              onCheckRenderQuality={() => void p.checkRenderQuality()}
              onUploadDeckTemplate={p.uploadDeckTemplate}
              deckThemePreset={p.deckThemePreset}
              onSelectThemePreset={p.applyDeckThemePreset}
              onPolishText={p.polishText}
              polishingKey={p.polishingKey}
              onClearDeckTemplate={p.clearDeckTemplateChoice}
              deckTemplateProbe={p.deckTemplateProbe}
              onExportSpeech={p.exportSpeech}
              refinePickerSlot={<SkillPickerFor scope="ppt-deck" source={p.deckSkills} align="right" />}
              deckTransition={p.deckTransition}
              setDeckTransition={p.setDeckTransition}
              imagePool={p.imagePool}
              imageBusy={p.slideImageBusy}
              onLoadImagePool={p.loadImagePool}
              attachImageFromUrl={p.attachImageFromUrl}
              attachImageByPastedUrl={p.attachImageByPastedUrl}
              uploadSlideImage={p.uploadSlideImage}
              clearSlideImage={p.clearSlideImage}
              applyPoolImagesToHinted={p.applyPoolImagesToHinted}
              searchAndAttachImage={p.searchAndAttachImage}
              attachImageFromLibrary={p.attachImageFromLibrary}
              reloadLocalMaterials={p.reloadLocalMaterials}
              autoFigureProvider={p.autoFigureProvider}
              setAutoFigureProvider={p.setAutoFigureProvider}
              slideFigureBusy={p.slideFigureBusy}
              blankSlideCount={p.blankSlideCount}
              fillingBlank={p.fillingBlank}
              fillProgress={p.fillProgress}
              onFillBlankSlides={p.fillBlankSlides}
            />
          ) : null
        ) : p.quoteMode === "list" ? (
          <QuoteListPanel
            quotes={p.filteredQuotes}
            listLoading={p.quoteListLoading}
            search={p.quoteSearch}
            setSearch={p.setQuoteSearch}
            onNew={p.openNewQuote}
            onOpen={p.openQuote}
            onCopy={p.copyQuoteAsVersion}
            onDelete={p.deleteQuote}
            onToggleWonSample={p.toggleWonSample}
          />
        ) : p.activeQuote ? (
          <QuoteEditor
            quote={p.activeQuote}
            totals={p.quoteTotals}
            productItems={p.productItems}
            productLoading={p.productLoading}
            onBack={p.backToQuoteList}
            onRename={p.updateQuoteName}
            onTaxNoteChange={p.updateTaxNote}
            onVersionChange={p.updateVersion}
            addGroup={p.addQuoteGroup}
            deleteGroup={p.deleteQuoteGroup}
            renameGroup={p.renameQuoteGroup}
            addItem={p.addQuoteItem}
            updateItem={p.updateQuoteItem}
            setGroupDiscount={p.setGroupDiscount}
            deleteItem={p.deleteQuoteItem}
            saveItemToLibrary={p.saveItemToLibrary}
            openPicker={p.openProductPicker}
            onAddProduct={p.addProductToGroup}
            onRefreshProducts={p.refreshProducts}
            onDeleteProduct={p.deleteProduct}
            onAiDraft={p.openQuoteAi}
            historyQuotes={p.historyQuotes}
            onImportHistory={p.importQuoteHistory}
            recommendation={p.quoteRecommendation}
            onExportXlsx={p.exportQuoteExcel}
            onExportWord={p.exportQuoteWord}
            syncOppAmount={p.syncOppAmountOnSave}
            onSyncOppAmountChange={p.handleSyncOppAmountChange}
            oppSyncFailed={p.oppSyncFailed}
            persistFailed={p.quotePersistFailed}
            onSaveNow={() => void p.saveQuoteNow()}
            openCheckProductPicker={p.openCheckProductPicker}
            openChecklistImport={p.openChecklistImport}
            addManualItem={p.addManualItem}
          />
        ) : null}
      </main>

      <NewQuoteDialog
        open={p.newQuoteOpen}
        onOpenChange={p.setNewQuoteOpen}
        quoteName={p.nqName}
        setQuoteName={p.setNqName}
        quoteRef={p.nqRef}
        setQuoteRef={p.setNqRef}
        solutionOptions={p.solutionOptions}
        bidOptions={p.bidOptions}
        materialLoading={p.materialLoading}
        oppOptions={p.quoteOppOptions}
        oppId={p.nqOpportunityId}
        setOppId={p.setNqOpportunityId}
        busy={p.quoteCreating}
        onCreate={p.createQuote}
      />

      <QuoteDraftDialog
        open={p.quoteAiOpen}
        onOpenChange={p.setQuoteAiOpen}
        draftRef={p.draftRef}
        setDraftRef={p.setDraftRef}
        solutionOptions={p.solutionOptions}
        bidOptions={p.bidOptions}
        materialLoading={p.materialLoading}
        busy={p.quoteAiBusy}
        onGenerate={p.generateQuoteDraft}
        quotePickerSlot={<SkillPickerFor scope="quote-draft" source={p.quoteSkills} />}
      />

      {/* @deprecated 旧 ProductPicker（ProductItem 数据源），下一周期删除 */}
      <ProductPickerDialog
        open={!!p.productPickerGroup}
        onClose={p.closeProductPicker}
        items={p.productItems}
        loading={p.productLoading}
        groupName={pickerGroupName}
        onPick={(productId) => p.addProductToGroup(productId)}
      />

      <CheckProductPickerDialog
        open={p.checkProductPickerOpen}
        onClose={p.closeCheckProductPicker}
        products={p.checkProducts}
        loading={p.checkProductsLoading}
        onConfirm={(picks) => p.addCheckProductsToQuote(picks)}
      />

      <ChecklistImportDialog
        open={p.checklistImportOpen}
        onClose={p.closeChecklistImport}
        checklists={p.checklists}
        loading={p.checklistsLoading}
        onConfirm={(id, opts) => p.importFromChecklist(id, opts)}
      />

      <ConfirmDialog
        open={Boolean(p.confirmRequest)}
        onOpenChange={(open) => {
          if (!open) p.closeConfirmRequest()
        }}
        title={p.confirmRequest?.title ?? ""}
        description={p.confirmRequest?.description}
        confirmText={p.confirmRequest?.confirmText}
        tone={p.confirmRequest?.tone ?? "default"}
        onConfirm={p.runConfirmRequest}
      />

      <CostConfirmDialog {...p.costConfirm} />
    </div>
  )
}
