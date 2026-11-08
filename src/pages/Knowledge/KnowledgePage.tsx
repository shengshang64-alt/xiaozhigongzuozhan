// UX-R2: 知识库 已按 docs/ux-review-2026-11 修复 2026-11-07（双搜索框合并/结果分组）
import { CheckCheck, ChevronsLeft, ChevronsRight, MessageCircleQuestion, Upload } from "lucide-react"
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { KbReviewPage } from "./KbReviewPage"
import { PageHeader } from "@/components/shell/PageHeader"
import { Button } from "@/components/ui/button"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { KbToolbar } from "@/components/knowledge/KbToolbar"
import { FolderTree } from "@/components/knowledge/FolderTree"
import { DocListPanel } from "@/components/knowledge/DocListPanel"
import { DocReaderPanel } from "@/components/knowledge/DocReaderPanel"
import { UploadDialog } from "@/components/knowledge/UploadDialog"
import { QaDrawer } from "@/components/knowledge/QaDrawer"
import { KbContentSearchPanel } from "@/components/knowledge/KbContentSearchPanel"
import { LocalDocSearchPanel } from "@/components/common/LocalDocSearchPanel"
import type { useKnowledge } from "./useKnowledge"

export function KnowledgePage(p: ReturnType<typeof useKnowledge>) {
  // ⌘K 点「本机文件」结果时带 ?local=关键词 跳到本页，这里接住并预填搜索
  const [searchParams] = useSearchParams()
  const localQuery = searchParams.get("local") ?? ""
  // 2026-10-30 审核台：作为独立视图（占满屏、键盘操作），不塞进 Tab
  const [reviewOpen, setReviewOpen] = useState(false)
  // 用户反馈轮（2026-09-17 晚）：文件夹树可收起，收起态给列表+阅读区让出宽度
  const [folderCollapsed, setFolderCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem("kb_folder_collapsed") === "1"
    } catch {
      return false
    }
  })
  // 2026-10-31：列表栏也可折叠——实测三栏 224/320/420px，正文阅读区仅 420px 太窄。
  // 折起列表后阅读区可占 ~740px，读方案/标书正文才不憋屈。
  const [listCollapsed, setListCollapsed] = useState(false)
  const toggleListCollapsed = () => setListCollapsed((v) => !v)

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
  // 2026-10-30 审核台：独立视图（快捷键与卡片流需要专注，不叠加知识库侧栏）
  if (reviewOpen) {
    return <KbReviewPage userId={p.userId} onBack={() => setReviewOpen(false)} />
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="知识库"
        desc="团队方法论与个人笔记双库沉淀，上传即建索引，问知识库按来源作答"
        actions={
          <>
            {/* 2026-10-30 审核台入口：抽取出的原子必须人工审核才能进检索链路 */}
            <Button
              variant="outline"
              onClick={() => setReviewOpen(true)}
              className="gap-1.5"
              title="审核 AI 抽取的知识原子（通过后才会被方案/PPT/标书消费）"
            >
              <CheckCheck className="h-4 w-4" />
              审核原子
            </Button>
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

      {/* UX-R2（docs/ux-review-2026-11 §二十三）：顶部两个搜索框合并为一个——
          工具栏输入即「标题命中」（列表过滤）+「正文命中」（本面板 FTS），结果分组呈现 */}
      <div className="mb-4">
        <KbContentSearchPanel
          key={p.libTab}
          libTab={p.libTab}
          onOpenDoc={p.locateDoc}
          externalQuery={p.searchQuery.trim() ? p.searchQuery.trim() : null}
        />
      </div>

      {/* 本机资料检索（2026-10-30 API 已启用）：搜知识库之外、硬盘里的历史标书/方案/扫描件 */}
      <div className="mb-4">
        <LocalDocSearchPanel initialQuery={localQuery} />
      </div>

      {/* 2026-10-31 移动端修复：原 grid 在窄屏是单列，但子项默认 min-width:auto，
          会被内部长内容（目录树/文档列表的长标题）撑到 1885px，导致整页横向滚动。
          min-w-0 让每个单元格可收缩，配合各面板内部的 truncate 才能正常省略。 */}
      <main
        // 2026-11-02 实测修复（知识库排版乱）：三栏栏项的 h-full 在 grid 容器里**不生效**
        // ——Chrome 把 grid item 的 height:100% 解析为 auto，于是栏高各自被内容撑乱
        // （实测 1000px 视口：grid 728px 但目录 420/列表 420/阅读区 293）。
        // 修法：不给 grid 定高再让子项继承，而是直接给**每个栏项**一个确定高度
        // lg:h-[calc(100vh-17rem)]（[] 里的表达式原样来自各栏原设计意图），
        // 栏项之间再也不互相参照，折叠/展开切列时天然一致。
        className={`grid min-w-0 grid-cols-1 gap-4 [&>*]:min-w-0 ${
          folderCollapsed && listCollapsed
            ? "lg:grid-cols-[3rem_3rem_1fr]"
            : folderCollapsed
              ? "lg:grid-cols-[3rem_20rem_1fr]"
              : listCollapsed
                ? "lg:grid-cols-[14rem_2rem_1fr]"
                : "lg:grid-cols-[14rem_20rem_1fr]"
        }`}
      >
        {folderCollapsed ? (
          <button
            type="button"
            onClick={toggleFolderCollapsed}
            title="展开文件夹目录"
            className="hidden flex-col items-center gap-2 rounded-xl border border-border bg-card py-3 text-muted-foreground shadow-md transition-colors hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex lg:h-[calc(100vh-17rem)]"
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
            storageScope={`${p.userId ?? "anon"}:${p.libTab}`}
          />
        )}
        {listCollapsed ? (
          <button
            type="button"
            onClick={toggleListCollapsed}
            title="展开文档列表"
            className="hidden flex-col items-center gap-2 rounded-xl border border-border bg-card py-3 text-muted-foreground shadow-md transition-colors hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex lg:h-[calc(100vh-17rem)]"
          >
            <ChevronsRight className="h-4 w-4" />
            <span className="text-xs [writing-mode:vertical-rl] tracking-widest">文档列表</span>
          </button>
        ) : (
        <DocListPanel
            sortedDocs={p.sortedDocs}
            selectedDoc={p.selectedDoc}
            selectDoc={p.selectDoc}
            sortKey={p.sortKey}
            setSortKey={p.setSortKey}
            docsLoading={p.docsLoading}
            docsCalibrating={p.docsCalibrating}
            libTab={p.libTab}
            searchQuery={p.searchQuery}
            openUpload={p.openUpload}
            onListRefresh={p.refreshDocs}
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
        )}
        {!listCollapsed && (
          <button
            type="button"
            onClick={toggleListCollapsed}
            title="折叠文档列表（放大阅读区）"
            className="hidden w-2 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex lg:h-[calc(100vh-17rem)]"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        )}
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
          recentDocs={p.recentDocs}
          onOpenRecent={p.selectDoc}
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
        processUploadFolder={() => void p.processUploadFolder()}
        supportsFolder={p.supportsFolderImport}
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
        qaIndexing={p.qaIndexing}
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
