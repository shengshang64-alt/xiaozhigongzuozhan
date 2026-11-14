// 知识库 · ① 文档库屏（UX-v2：/knowledge?tab=browse，对齐 prototype/kb/browse.html）。
//
// ## 这一屏解决什么
//
// 原型的定位写得很准：**「这一屏是知识库的入口」**——一个搜索框找东西，一棵目录树看结构，
// 一屏扫完最近活跃的文档；往深里走分别是「全文检索」「知识原子」「原子审核」「问知识库」。
//
// ## 五条改造（原型里每一条「原来怎样 → 现在怎样」的对照，逐条落地）
//
// 1. 两个搜索框 → 一个。本屏的搜索框同时查标题与正文（正文命中由全文检索屏给分组结果），
//    顶部不再另设一个「正文全文检索」框。
// 2. AnyTXT 长警告条 → 一行可收起（useAnytxtStatus；收起状态记 localStorage，7 天不再出现）。
// 3. 「团队 2175 / 我的笔记 4825」两个大数字 Tab → 目录卡里的一行计数 + 分段切换。
// 4. 目录树宽度固定 → 可拖拽（useResizableSidebar，默认 260px）。
// 5. 文档卡缺价值信号 → 补「被引用 N 次」（没有真数据时**不渲染**，见 DocListPanel 注释）。
//
// ## 零能力丢失
//
// 原有三栏布局里的「列表栏」整体搬进右栏（DocListPanel 不改职责，只加三信号），
// 「阅读区」搬进弹窗（KbDocReaderDialog，DocReaderPanel 一字未改）。
// 批量管理 / 导出 CSV / 最近删除 / 分类筛选 / 排序 / 移动目录 / 删除确认全部保留。

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCheck, MessageCircleQuestion, Search, Sparkles, Upload } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shell/PageHeader"
import { useResizableSidebar } from "@/components/common/useResizableSidebar"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/DataStates"
import { FolderTree } from "@/components/knowledge/FolderTree"
import { DocListPanel } from "@/components/knowledge/DocListPanel"
import { KbDocReaderDialog } from "@/components/knowledge/KbDocReaderDialog"
import { KbLocalSearchDialog } from "@/components/knowledge/KbLocalSearchDialog"
import {
  KbAlert,
  KbBarRow,
  KbCard,
  KbCardBody,
  KbCardFoot,
  KbCardHead,
  KbSeg,
} from "@/components/knowledge/KbPrimitives"
import { docCitationMap } from "@/components/knowledge/kbAtomsApi"
import { citationBucketRows, type KbDocMeta } from "@/components/knowledge/kbDocMeta"
import { useKbAtomStats } from "@/components/knowledge/useKbAtomStats"
import { useAnytxtStatus } from "@/components/knowledge/useAnytxtStatus"
import { useKbDocExtract } from "@/components/knowledge/useKbDocExtract"
import type { KbTab } from "@/components/knowledge/kbTabs"
import type { KbDocRow } from "@/lib/kbCore"
import type { useKnowledge } from "@/pages/Knowledge/useKnowledge"

/** 热词：点一下即填进搜索框（行业通用词，不是随机推荐） */
const HOT_WORDS = ["电子病历评级", "互联互通四甲", "等保三级", "DRG"]

export function KbBrowseScreen({
  p,
  onTab,
}: {
  p: ReturnType<typeof useKnowledge>
  onTab: (tab: KbTab) => void
}) {
  const { stats, loading: statsLoading, error: statsError } = useKbAtomStats()
  const anytxt = useAnytxtStatus()
  const extract = useKbDocExtract()
  const { width: treeWidth, onDragStart, reset: resetTreeWidth } = useResizableSidebar({
    storageKey: "kb_tree_width",
    initial: 260,
    min: 200,
    max: 460,
  })
  const [readerOpen, setReaderOpen] = useState(false)
  const [localSearchOpen, setLocalSearchOpen] = useState(false)

  const citationMap = useMemo(() => (stats ? docCitationMap(stats) : {}), [stats])
  const bucketRows = useMemo(() => citationBucketRows(citationMap), [citationMap])
  const pendingCount = Number(stats?.byStatus?.pending ?? 0)
  const approvedCount = Number(stats?.byStatus?.approved ?? 0)
  const totalDocs = p.teamCount + p.personalCount
  const lastUpdated = useMemo(() => {
    const times = p.docs.map((d) => d.updated).filter(Boolean).sort()
    return times.length ? times[times.length - 1] : ""
  }, [p.docs])

  const openDoc = (doc: KbDocRow | null) => {
    if (!doc) return
    p.selectDoc(doc)
    setReaderOpen(true)
  }

  /** 「在项目中引用」：复制一条可追溯的引用文本（标题 · 目录） */
  const copyCitation = (doc: KbDocMeta) => {
    const where = doc.folder_path ? ` · ${doc.folder_path}` : ""
    const line = `《${doc.title}》${where}`
    void navigator.clipboard
      ?.writeText(line)
      .then(() => toast.success("已复制引用，粘贴到方案或标书的对应章节即可"))
      .catch(() => toast.error("复制失败，请手动选中标题复制"))
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="文档库"
        titleExtra={
          <>
            <Badge variant="secondary">{totalDocs.toLocaleString("zh-CN")} 篇</Badge>
            {pendingCount > 0 ? <Badge variant="warning">{pendingCount.toLocaleString("zh-CN")} 条原子待审核</Badge> : null}
          </>
        }
        desc={
          <>
            这一屏是知识库的<b>入口</b>：一个搜索框找东西，一棵目录树看结构，一屏扫完最近活跃的文档。
            往深里走分别是「全文检索」「知识原子」「原子审核」「问知识库」。
          </>
        }
        meta={
          <>
            <span>
              团队知识库 <b className="font-mono font-semibold text-foreground">{p.teamCount.toLocaleString("zh-CN")}</b> 篇
            </span>
            <span>
              我的笔记 <b className="font-mono font-semibold text-foreground">{p.personalCount.toLocaleString("zh-CN")}</b> 条
            </span>
            <span>
              最近更新{" "}
              <b className="font-mono font-semibold text-foreground">{lastUpdated ? lastUpdated.slice(0, 16).replace("T", " ") : "—"}</b>
            </span>
          </>
        }
      />

      {/* 搜索 + 四个深水区入口 */}
      <KbCard>
        <KbCardBody>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[320px] grow">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={p.searchQuery}
                onChange={(e) => p.setSearchQuery(e.target.value)}
                placeholder="搜标题与正文 —— 如「电子病历五级」「互联互通四甲」「DRG 智能分组」"
                aria-label="搜索知识库文档"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            <Button variant="outline" className="gap-1.5" onClick={() => onTab("search")}>
              <Search className="h-4 w-4" />
              全文检索
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => onTab("atoms")}>
              <Sparkles className="h-4 w-4" />
              知识原子 {approvedCount > 0 ? approvedCount.toLocaleString("zh-CN") : ""}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => onTab("review")}>
              <CheckCheck className="h-4 w-4" />
              审核原子 {pendingCount > 0 ? <span className="rounded-full bg-muted px-1.5 text-[10px]">{pendingCount}</span> : null}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => onTab("qa")}>
              <MessageCircleQuestion className="h-4 w-4" />
              问知识库
            </Button>
            <Button className="gap-1.5" onClick={() => onTab("upload")}>
              <Upload className="h-4 w-4" />
              上传文档
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              一次搜索同时查标题与正文，结果按「标题命中 / 正文命中」分组，不再需要选是哪个框。
            </span>
            <div className="grow" />
            <span className="text-[11px] text-muted-foreground">热词：</span>
            {HOT_WORDS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => p.setSearchQuery(w)}
                className="text-[11px] text-primary underline-offset-2 hover:underline"
              >
                {w}
              </button>
            ))}
          </div>
        </KbCardBody>
      </KbCard>

      {/* 本机资料检索未启用：一行可收起（原型把它从百余字的警告条压成了这样） */}
      {anytxt.online === false && !anytxt.dismissed ? (
        <KbAlert
          tone="warning"
          className="mt-3"
          icon={<AlertTriangle className="h-4 w-4" />}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => setLocalSearchOpen(true)}>
                查看配置
              </Button>
              <Button size="sm" variant="outline" onClick={anytxt.dismiss}>
                收起
              </Button>
            </>
          }
        >
          <b>本机资料全文检索未启用</b> —— 硬盘里的 Word / PDF 暂时搜不到，云端知识库检索不受影响。
          {anytxt.error ? <span className="ml-1 text-muted-foreground">（{anytxt.error}）</span> : null}
        </KbAlert>
      ) : null}

      {extract.state.error ? (
        <KbAlert
          tone="danger"
          className="mt-3"
          icon={<AlertTriangle className="h-4 w-4" />}
          actions={
            <Button size="sm" variant="outline" onClick={extract.dismissError}>
              知道了
            </Button>
          }
        >
          {extract.state.error}
        </KbAlert>
      ) : null}

      <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* 左：目录 + 引用排行 */}
        <div className="col sticky top-16 flex flex-col gap-4" style={{ width: treeWidth }}>
          <KbCard>
            <KbCardHead
              title="目录"
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => p.openCreateFolder(p.activeFolderPath ?? "")}
                  title="新建目录"
                >
                  ＋ 新建
                </Button>
              }
            />
            <KbCardBody tight>
              {/* 原型把「团队 / 我的笔记」两个大数字 Tab 降成了目录里的一行计数 */}
              <KbSeg
                className="mb-2 w-full"
                value={p.libTab}
                onChange={(v) => p.setLibTab(v)}
                options={[
                  { value: "team", label: `团队知识库 ${p.teamCount.toLocaleString("zh-CN")}` },
                  { value: "personal", label: `我的笔记 ${p.personalCount.toLocaleString("zh-CN")}` },
                ]}
              />
              {p.docsLoading && p.folderTree.children.length === 0 ? (
                <LoadingState tone="compact" text="正在加载目录…" />
              ) : (
                <FolderTree
                  folderTree={p.folderTree}
                  activeFolderPath={p.activeFolderPath}
                  selectFolder={p.selectFolder}
                  openCreateFolder={p.openCreateFolder}
                  openRenameFolder={p.openRenameFolder}
                  submitDeleteFolder={p.submitDeleteFolder}
                  onCollapse={() => undefined}
                  storageScope={`${p.userId ?? "anon"}:${p.libTab}`}
                />
              )}
            </KbCardBody>
            <KbCardFoot>
              <button
                type="button"
                onClick={() => p.setTrashOpen(true)}
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                回收站 {p.trashItems.length}
              </button>
              <div className="grow" />
              <span className="text-[11px]">拖右边缘可调宽（双击复位）</span>
            </KbCardFoot>
            {/* 拖拽把手：贴着目录卡右边缘 */}
            <div
              onDoubleClick={resetTreeWidth}
              onPointerDown={onDragStart}
              title="拖拽调整目录宽度，双击复位"
              className="absolute -right-1 top-1/2 h-10 w-2 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/50"
              style={{ position: "relative", marginLeft: -4 }}
            />
          </KbCard>

          {/* 按引用数排：只有真有引用数据时才画柱子 */}
          <KbCard>
            <KbCardHead title="按引用数排" sub="活知识优先复用" />
            <KbCardBody tight>
              {statsLoading ? (
                <LoadingState tone="compact" text="正在统计引用…" />
              ) : statsError ? (
                <ErrorState
                  tone="compact"
                  title="引用统计加载失败"
                  reason={statsError}
                  hint="目录与文档列表不受影响。"
                />
              ) : bucketRows.length === 0 ? (
                <EmptyState
                  tone="compact"
                  title="还没有引用数据"
                  hint="引用次数在知识原子被方案 / 标书实际引用后才会累积。目前库里还没有产生过引用记录。"
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {bucketRows.map((r) => (
                    <KbBarRow
                      key={r.key}
                      label={r.label}
                      value={r.count}
                      pct={r.pct}
                      tone={r.key === "hot" ? "success" : r.key === "warm" ? "warning" : "primary"}
                    />
                  ))}
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    把「活知识」浮出来：被引用多的通常是可以直接复用的段落。
                  </p>
                </div>
              )}
            </KbCardBody>
          </KbCard>
        </div>

        {/* 右：文档列表 */}
        <div className="min-w-0">
          <DocListPanel
            sortedDocs={p.sortedDocs}
            selectedDoc={p.selectedDoc}
            selectDoc={openDoc}
            sortKey={p.sortKey}
            setSortKey={p.setSortKey}
            docsLoading={p.docsLoading}
            docsCalibrating={p.docsCalibrating}
            libTab={p.libTab}
            searchQuery={p.searchQuery}
            openUpload={() => onTab("upload")}
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
            citationByDoc={citationMap}
            onCiteDoc={(doc) => copyCitation(doc)}
            onExtractDoc={(doc) =>
              extract.extract(doc, p.activeModelKey ?? "", p.costText ?? "", p.costConfirm.runWithCostConfirm)
            }
            extractingDocId={extract.state.runningDocId}
            extractHint={
              extract.state.runningDocId
                ? `${extract.state.stage}${extract.state.total ? ` · ${extract.state.done}/${extract.state.total} 段` : ""}`
                : null
            }
          />
        </div>
      </div>

      <KbDocReaderDialog p={p} open={readerOpen} onClose={() => setReaderOpen(false)} />
      <KbLocalSearchDialog open={localSearchOpen} onClose={() => setLocalSearchOpen(false)} />
    </div>
  )
}
