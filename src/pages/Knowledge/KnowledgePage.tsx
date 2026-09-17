import { ChevronsRight, MessageCircleQuestion, Upload } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "@/components/shell/PageHeader"
import { Button } from "@/components/ui/button"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { KbToolbar } from "@/components/knowledge/KbToolbar"
import { FolderTree } from "@/components/knowledge/FolderTree"
import { DocListPanel } from "@/components/knowledge/DocListPanel"
import { DocReaderPanel } from "@/components/knowledge/DocReaderPanel"
import { UploadDialog } from "@/components/knowledge/UploadDialog"
import { QaDrawer } from "@/components/knowledge/QaDrawer"
import type { useKnowledge } from "./useKnowledge"

export function KnowledgePage(p: ReturnType<typeof useKnowledge>) {
  // 用户反馈轮（2026-09-17 晚）：文件夹树可收起，收起态给列表+阅读区让出宽度
  const [folderCollapsed, setFolderCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem("kb_folder_collapsed") === "1"
    } catch {
      return false
    }
  })
  const toggleFolderCollapsed = () => {
    setFolderCollapsed((prev) => {
      const next = !prev
      try {
        sessionStorage.setItem("kb_folder_collapsed", next ? "1" : "0")
      } catch {
        /* 隐私模式等场景静默降级 */
      }
      return next
    })
  }
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="知识库"
        desc="团队方法论与个人笔记双库沉淀，上传即建索引，问知识库按来源作答"
        actions={
          <>
            <Button
              variant="outline"
              onClick={p.openQa}
              className="gap-1.5 border-primary/40 text-primary shadow-sm transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <MessageCircleQuestion className="h-4 w-4" />
              问知识库
            </Button>
            <Button
              onClick={p.openUpload}
              className="gap-1.5 bg-primary text-primary-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md"
            >
              <Upload className="h-4 w-4" />
              上传文档
            </Button>
          </>
        }
      />

      <div className="sticky top-14 z-20 -mx-1 mb-5 border-b border-border bg-background/85 px-1 py-2 backdrop-blur">
        <KbToolbar
          libTab={p.libTab}
          setLibTab={p.setLibTab}
          teamCount={p.teamCount}
          personalCount={p.personalCount}
          searchQuery={p.searchQuery}
          setSearchQuery={p.setSearchQuery}
        />
      </div>

      <main
        className={`grid gap-4 ${
          folderCollapsed
            ? "lg:grid-cols-[3rem_20rem_1fr] lg:h-[calc(100vh-17rem)]"
            : "lg:grid-cols-[14rem_20rem_1fr] lg:h-[calc(100vh-17rem)]"
        }`}
      >
        {folderCollapsed ? (
          <button
            type="button"
            onClick={toggleFolderCollapsed}
            title="展开文件夹目录"
            className="hidden h-full flex-col items-center gap-2 rounded-xl border border-border bg-card py-3 text-muted-foreground shadow-md transition-colors hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex"
          >
            <ChevronsRight className="h-4 w-4" />
            <span className="text-xs [writing-mode:vertical-rl] tracking-widest">目录</span>
          </button>
        ) : (
          <FolderTree
            folderTree={p.folderTree}
            activeFolderPath={p.activeFolderPath}
            selectFolder={p.selectFolder}
            openCreateFolder={p.openCreateFolder}
            openRenameFolder={p.openRenameFolder}
            submitDeleteFolder={p.submitDeleteFolder}
            onCollapse={toggleFolderCollapsed}
          />
        )}
        <DocListPanel
          sortedDocs={p.sortedDocs}
          selectedDoc={p.selectedDoc}
          selectDoc={p.selectDoc}
          sortKey={p.sortKey}
          setSortKey={p.setSortKey}
          docsLoading={p.docsLoading}
          libTab={p.libTab}
          searchQuery={p.searchQuery}
          openUpload={p.openUpload}
          categoryFilter={p.categoryFilter}
          setCategoryFilter={p.setCategoryFilter}
          batchMode={p.batchMode}
          batchSelectedIds={p.batchSelectedIds}
          batchBusy={p.batchBusy}
          onToggleBatchMode={p.toggleBatchMode}
          onToggleBatchSelect={p.toggleBatchSelect}
          onClearBatchSelect={p.clearBatchSelect}
          onBatchMove={(folder) => void p.batchMoveToFolder(folder)}
          onBatchCategory={(category) => void p.batchSetCategory(category)}
          onBatchDelete={() => void p.batchDeleteDocs()}
          flashDocId={p.flashDocId}
          allFolderPaths={p.allFolderPaths}
          openDocAction={p.openDocAction}
          canEditDoc={p.canEditDoc}
          onClearSearch={() => p.setSearchQuery("")}
          trashCount={p.trashItems.length}
          onOpenTrash={() => p.setTrashOpen(true)}
          trashOpen={p.trashOpen}
          onCloseTrash={() => p.setTrashOpen(false)}
          trashItems={p.trashItems}
          onRestoreTrash={(item) => void p.restoreTrashItem(item)}
          onPurgeTrash={p.purgeTrashItem}
        />
        <DocReaderPanel
          selectedDoc={p.selectedDoc}
          editMode={p.editMode}
          editDraft={p.editDraft}
          setEditDraft={p.setEditDraft}
          savingDoc={p.savingDoc}
          startEdit={p.startEdit}
          cancelEdit={p.cancelEdit}
          saveDocEdit={() => void p.saveDocEdit()}
          canEditDoc={p.canEditDoc}
          openDocAction={p.openDocAction}
          docAction={p.docAction}
          docActionDraft={p.docActionDraft}
          setDocActionDraft={p.setDocActionDraft}
          deleteStrongStage={p.deleteStrongStage}
          submitDocAction={p.submitDocAction}
          closeDocAction={p.closeDocAction}
          allFolderPaths={p.allFolderPaths}
          updateDocPolicy={p.updateDocPolicy}
          citationFocus={p.citationFocus}
        />
      </main>

      <footer className="mt-5 rounded-xl border border-border bg-gradient-to-br from-background via-secondary to-card px-5 py-4 shadow-md">
        <p className="text-xs leading-relaxed text-muted-foreground">
          上传的 md / docx / pdf 文档在浏览器本地完成解析并自动提取摘要与关键词建索引；zip
          整包在本地解压、保留目录结构入库。问知识库先在文档中检索命中片段再作答并标注来源，小智助手同样可以检索这里沉淀的资料。
        </p>
      </footer>

      <UploadDialog
        uploadOpen={p.uploadOpen}
        closeUpload={p.closeUpload}
        uploadVisibility={p.uploadVisibility}
        setUploadVisibility={p.setUploadVisibility}
        uploadFolder={p.uploadFolder}
        setUploadFolder={p.setUploadFolder}
        uploadCategory={p.uploadCategory}
        setUploadCategory={p.setUploadCategory}
        uploadResults={p.uploadResults}
        uploading={p.uploading}
        processUploadFiles={(files, category) => void p.processUploadFiles(files, category)}
        allFolderPaths={p.allFolderPaths}
      />
      <QaDrawer
        qaOpen={p.qaOpen}
        closeQa={p.closeQa}
        qaScope={p.qaScope}
        setQaScope={p.setQaScope}
        qaInput={p.qaInput}
        setQaInput={p.setQaInput}
        qaMessages={p.qaMessages}
        qaSending={p.qaSending}
        sendQaQuestion={p.sendQaQuestion}
        clearQa={p.clearQa}
        openCitation={p.openCitation}
        models={p.models}
        activeModelKey={p.activeModelKey}
        onModelChange={p.onModelChange}
        costText={p.costText}
        qaSkills={p.kbQaSkills}
        approvedQaPairs={p.approvedQaPairs}
        pendingQaPairs={p.pendingQaPairs}
        qaPairsLoading={p.qaPairsLoading}
        createQaPair={p.createQaPair}
        updateQaPair={p.updateQaPair}
        deleteQaPair={p.deleteQaPair}
        approveQaPending={p.approveQaPending}
        askAiAnyway={p.askAiAnyway}
        reportAnswerWrong={p.reportAnswerWrong}
      />
      <CostConfirmDialog {...p.costConfirm} />
    </div>
  )
}
