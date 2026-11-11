import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Download, Eye, FileUp, FolderInput, LayoutGrid, Loader2, PenLine, Play, RefreshCw, Sparkles, Square, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { ChapterEditor } from "@/components/solution-studio/ChapterEditor"
import { OutlineTreeEditor } from "@/components/solution-studio/OutlineTreeEditor"
import { ChapterBudgetBar } from "@/components/bid-workspace/ChapterBudgetBar"
import { BidChapterNavTree } from "@/components/bid-workspace/BidChapterNavTree"
import { ConsistencyRail, ProseCheckRail, VoidRiskRail } from "@/components/bid-workspace/ComposeRightRail"
import { ScoreCoverageRail } from "@/components/bid-workspace/ScoreCoverageRail"
import { DeviationPanel } from "@/components/bid-workspace/DeviationPanel"
import { TechParamResponsePanel } from "@/components/bid-workspace/TechParamResponsePanel"
import { SubjectiveScorePanel } from "@/components/bid-workspace/SubjectiveScorePanel"
import { FigureInsertTools } from "@/components/bid-workspace/FigureInsertTools"
import { ScoreMappingPanel } from "@/components/bid-workspace/ScoreMappingPanel"
import { BidMaterialAmmoPanel } from "@/components/bid-workspace/BidMaterialAmmoPanel"
import { FormatSettingsPanel } from "@/components/bid-workspace/FormatSettingsPanel"
import { GenerationSettingsBar } from "@/components/bid-workspace/GenerationSettingsBar"
import { GlobalFactsPanel } from "@/components/bid-workspace/GlobalFactsPanel"
import { MaterialLibraryPanel } from "@/components/bid-workspace/MaterialLibraryPanel"
import { OutlineCoverage } from "@/components/bid-workspace/OutlineCoverage"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { PrintChapterFlow, PrintExportButton } from "@/components/common/PrintExport"
import { useResizableSidebar } from "@/components/common/useResizableSidebar"
import { BidWordPreview } from "./BidWordPreview"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { BID_OUTLINE_REQ_KEY, bulkQueueClear, bulkQueueLoad, FIGURES_UNLIMITED, sectionText } from "@/pages/BidWorkspace/bidTypes"
// UX-R3 S3：偏离与响应表 Tab 角标——与 TechParamResponsePanel 同一套纯本地函数（零 AI）算「待人工确认」数
import {
  DEVIATION_MIN_SECTION_CHARS,
  buildParamResponseRows,
  paramRowsFromTable,
  resolveDeviationClauses,
  resolveTechParamSource,
  summarizeParamResponse,
} from "@/pages/BidWorkspace/techParamResponse"
import { pickTableOfKind, tableToParamItems } from "@/pages/BidWorkspace/tenderTables"
import { isIncompleteSectionChapter } from "@/pages/BidWorkspace/chapterCompletion"
import { summarizeBidGenFailures } from "@/pages/BidWorkspace/bidGenFailure"
import { typeLabel } from "@/pages/SolutionStudio/solutionTypes"
// R-302：按字符偏移定位 textarea（抽成纯函数，jsdom 单测覆盖边界）
import { jumpTextareaToOffset } from "@/pages/BidWorkspace/bidFocusJump"
import { formatCount } from "@/lib/money"
import { toast } from "sonner"

type ComposeStepProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "outlineDraft"
  | "outlineLoading"
  | "generateOutline"
  // R58（B28）：关键项缺失但已有大纲时的二次确认（默认取消，防一键覆盖）
  | "outlineCriticalConfirmOpen"
  | "outlineCriticalConfirmText"
  | "confirmGenerateOutlineCritical"
  | "cancelGenerateOutlineCritical"
  | "outlineLevel"
  | "setOutlineLevel"
  | "targetPages"
  | "setTargetPages"
  | "estimatedPages"
  | "figuresEnabled"
  | "setFiguresEnabled"
  | "maxFigures"
  | "setMaxFigures"
  | "orchestrationSummary"
  // 2026-10 配图需求轮：上传截图 / 图模板库
  | "figureTemplates"
  | "figureUploadBusy"
  | "uploadChapterFigure"
  | "insertFigureTemplate"
  | "removeFigureTemplateById"
  | "orchestrationBusy"
  | "orchestrationProgress"
  | "startOrchestration"
  | "sectionWords"
  | "setSectionWords"
  | "genOptions"
  | "setGenerateDemo"
  | "demoScoreSummary"
  | "setClauseResponse"
  | "setMaterialBoost"
  | "setComplianceMode"
  | "setIncludeBiz"
  | "scope"
  | "setScope"
  | "bizRemoveCount"
  | "confirmRemoveBizChapters"
  | "cancelRemoveBizChapters"
  // 2026-10-31：为空商务章补填写框架
  | "fillBizSkeletons"
  | "emptyBizChapters"
  // UX-v2 拆屏：步骤条通栏「章节导航」拆除后，S4 商务组卷一键核对入口随左树迁入本步
  | "addBizAssemblyItems"
  // UX-v2：③ 大纲编制右栏评分点覆盖热力表（buildScoreCheckup 真值）
  | "scoreCheckup"
  | "globalFactsSource"
  | "factDraft"
  | "setFactDraft"
  | "factAiBusy"
  | "startGenerateFactSettings"
  | "saveGlobalFacts"
  | "settingsSaved"
  | "formatSettings"
  | "effectiveFormatSettings"
  | "formatCheckItems"
  | "setFormatSettingsPatch"
  | "setFormatMarginsPatch"
  | "setFormatHeadingLevel"
  | "setFormatBodyPatch"
  | "setFormatTablePatch"
  | "toggleFormatCheckItem"
  | "setAllFormatCheckItems"
  | "identityWords"
  | "setIdentityWords"
  | "leafTarget"
  | "totalAdjustProgress"
  | "outlineMissingTitles"
  | "goParseStep"
  | "outlineRename"
  | "outlineRemove"
  | "outlineAddChild"
  | "outlineAddRoot"
  | "outlineSetPart"
  | "outlineMove"
  | "confirmOutline"
  | "generateCommitmentLetter"
  | "importDialogOpen"
  | "setImportDialogOpen"
  | "importCandidates"
  | "importLoading"
  | "openImportDialog"
  | "importFromSolution"
  | "activeChapter"
  | "activeChapterId"
  | "selectChapter"
  | "editingContent"
  | "setEditingContent"
  | "chapterBusy"
  // R167：公司优质素材库（五类标准件）面板所需
  | "refMaterialsDraft"
  | "refFileBusy"
  | "saveMaterialLibrary"
  | "applyLibraryDefaults"
  | "importLibraryFile"
  | "classifyLibraryDraft"
  | "generateChapter"
  | "regenerateChapter"
  | "regenerateSection"
  | "resizeSection"
  | "isArchivedLocked"
  | "continueChapter"
  | "refineChapter"
  | "bulkGenerating"
  | "autoSaveState"
  | "genProgress"
  | "startBulkGenerate"
  | "cancelBulkGenerate"
  | "doneChapterCount"
  | "techChapterTotal"
  | "chapterBudgets"
  | "supplementState"
  | "sectionGenState"
  | "pageCap"
  | "pageInfo"
  | "startFillPages"
  | "pageFillBusy"
  | "startWordRefineAll"
  | "wordRefineBusy"
  | "setWordRefine"
  | "setAutoConsistencyAudit"
  | "figureBackfillBusy"
  | "figureBackfillProgress"
  | "figureBackfillPending"
  | "startFigureBackfill"
  | "contentFocus"
  | "focusSectionInChapter"
  | "focusPositionInChapter"
  | "outlineClauseTotal"
  | "coveredClauseCount"
  | "uncoveredClauses"
  | "addClauseToOutline"
  | "addAllClausesToOutline"
  | "outlineChapterDrift"
  | "syncOutlineChapters"
  | "clauseGranularity"
  | "setClauseGranularity"
  | "deviationClauseCount"
  | "deviationSourceLabel"
  | "mapLoading"
  | "generateDeviationTable"
  | "deviationTable"
  | "deviationSummary"
  | "jumpToResponseNode"
  // UX-R3 S12：主观分逐条确认（写 subjective_confirmations）
  | "setSubjectiveConfirmation"
  | "exportDeviationWord"
  | "exportTechParamWord"
  | "exportBusy"
  | "bidOutlineSkills"
  | "bidChapterSkills"
  | "deviationSkills"
  | "techParamCoverage"
  | "addUncoveredTechParamsToOutline"
  | "requestStep"
  | "bidSourceMode"
  | "bidExternalText"
  | "bidExternalBusy"
  | "setBidSourceMode"
  | "setBidExternalText"
  | "handleBidExternalFile"
>

const LEVEL_OPTIONS: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: "不指定" },
  { value: 1, label: "一级" },
  { value: 2, label: "二级" },
  { value: 3, label: "三级" },
]

// REQ-054（2026-10-18）：大纲固定两级。此前 0 档写给「AI 自行决定合理层级」、3 档写「三级颗粒度最细」，
// 但 Chapter.sections 是 string[]（只装一层小节），第 3 级节点入库即丢——界面承诺与实际不符。
// 实测 15 个存量项目 929 个三级节点只有 5 个成为小节。故三档文案一律说清「目录两级」，
// 3 档额外说明为什么选了三级还是两级，避免用户以为选三级能拿到三级目录。
const LEVEL_HINT: Record<0 | 1 | 2 | 3, string> = {
  0: "自动：章 + 节两级；更深的功能层次由正文（一）/（1）/① 表达（默认）",
  1: "只生成「部分 / 章」一级目录",
  2: "两级：章 + 节（大纲不生成第三层）",
  3: "两级：章 + 节（本产品的「三级」等价于两级，第三层由正文（一）/（1）/① 承载）",
}

export function ComposeStep(p: ComposeStepProps) {
  const proj = p.activeProject
  // R-039②（R259）mustWrite 读时自愈注（2026-11-11 UX-v2 拆屏）：原 navOutline =
  // healMustWriteOnRead(bid_outline) 只喂给旧 OutlineNavTree 的 outline prop，而该组件
  // 从未消费它（新 BidChapterNavTree 同样以 bid_chapters 为准），属死代码，连同
  // healMustWriteOnRead 导入一并移除；读时自愈的真实生效点在生成/导出侧。
  // 性能（2026-10-20）：这条「继续上次批量生成」的判据原来直接写在渲染体里，每次渲染都要跑
  // bulkQueueLoad(proj.id)——它是 localStorage.getItem + JSON.parse + O(队列 × 章数) 的嵌套扫描
  // （bidTypes.ts 的 bulkQueueLoad）。而正文编辑是逐键触发重渲染（setEditingContent 未防抖，
  // 只对落库做了防抖），于是每敲一个字都要白跑一遍。deps 用 proj 而不是 proj.bid_chapters：
  // 打字时变的是 editingContent、activeProject 的对象身份不变，正好被 memo 挡住；
  // 生成/改章走 updateProject 会换 proj 身份，横幅该出现/该消失都能及时跟上。
  const bulkResumePending = useMemo(() => {
    if (!proj) return false
    const queued = bulkQueueLoad(proj.id)
    return queued.length > 0 && queued.some((nid) => proj.bid_chapters.some((c) => c.node_id === nid && c.gen_status !== "done"))
  }, [proj])
  /** UX-v2：评分点覆盖表的「已覆盖章标题 → node_id」映射（点条目跳章；同一标题多章取首个）。
      必须在 `if (!proj) return null` 之前声明——hooks 不能放在早退之后。 */
  const chapterIdByTitle = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of proj?.bid_chapters ?? []) {
      const title = (c.title ?? "").trim()
      if (title && !map[title]) map[title] = c.node_id
    }
    return map
  }, [proj])
  // 循环 5 A3：归档只读——编辑/生成控件禁用，导出与查看保留
  const locked = p.isArchivedLocked
  // 大纲「重新生成」覆盖前的二次确认（本地 UI 状态）
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false)
  // 用户反馈（2026-10-15）：大纲确认后进入逐章编制，大纲面板整块被条件渲染掉，想重生成大纲只能
  // 退回解析环节。这里加一个"大纲视图开关"：编制阶段也能展开大纲编辑视图（改完再确认）。
  const [outlineViewOpen, setOutlineViewOpen] = useState(false)
  // UX-R3 S3（2026-11-08）：第 3 步内部双 Tab——「章节编制」/「偏离与响应表」。
  // 响应表 400 条级的长表搬进独立 Tab 后不再把正文顶出视口；jumpToResponseNode 由包装版接入，点「定位到章节」自动切回编制 Tab。
  const [composeTab, setComposeTab] = useState<"edit" | "tables">("edit")
  // 角标：响应表「待人工确认 N」——与 TechParamResponsePanel 同参同源（customHint 面板本地态、角标按默认口径算）
  const techParamNeedsReview = useMemo(() => {
    if (!proj) return 0
    try {
      const clauseResolution = resolveDeviationClauses(proj.tender_text, proj.parse_report ?? null, {
        limit: 200,
        granularity: "l3",
      })
      const source = resolveTechParamSource(proj.tender_text, proj.parse_report ?? null, "", {
        minBodyChars: DEVIATION_MIN_SECTION_CHARS,
      })
      const sourceText =
        clauseResolution.how === "parse" && source.how !== "parse"
          ? sectionText(proj.parse_report ?? null, "delivery_req")
          : source.text
      const restoredParamTable = pickTableOfKind(proj.tender_tables, "tech_params")
      const rows = restoredParamTable
        ? paramRowsFromTable(tableToParamItems(restoredParamTable.rows), { cap: 400 })
        : buildParamResponseRows(sourceText, { cap: 400 })
      return summarizeParamResponse(rows).needs_review
    } catch {
      return 0
    }
  }, [proj])
  // S3 联动：偏离表「定位到章节」→ 先切回编制 Tab 再执行原跳转（selectChapter + 滚动由 jumpToChapter 完成）
  const jumpToResponseNodeRaw = p.jumpToResponseNode
  const jumpResponseCompose = useCallback(
    (nodeTitle: string) => {
      setComposeTab("edit")
      jumpToResponseNodeRaw(nodeTitle)
    },
    [jumpToResponseNodeRaw],
  )
  // R294「确认大纲」清空既有正文前的二次确认：confirmOutline 是全量重建 bid_chapters
  // （content:"" + gen_status:"pending"），已生成正文的项目误点一次即清零（实测 21 个项目里
  // 12 个有正文、共 92 章 106.5 万字）。此处按「有正文才拦」的口径提示，不影响新项目一键确认。
  const [confirmOutlineGuard, setConfirmOutlineGuard] = useState<null | { chapters: number; words: number }>(null)
  // @r211 R-004 标书 Word 式分页预览开关
  const [wordPreviewOpen, setWordPreviewOpen] = useState(false)
  // 第十一轮改造 6：编辑器定位——contentFocus 变化时找到标题行并选中滚动
  // R-302 扩展：当 contentFocus.offset 有值时（来自"版式?"徽标点击），直接按 offset 定位，不再按 title 找。
  //   预览模式下 textarea 未挂载 → 先切到编辑模式（setViewMode），本 effect 因 deps 含 viewMode 会再次执行并完成跳转。
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const bidFileInputRef = useRef<HTMLInputElement | null>(null)
  const [focusFlash, setFocusFlash] = useState(false)
  // 切片A3：正文视图模式——有内容时默认预览（折叠卡片），无内容或手动编辑时切 textarea
  // R-302：声明位置前移到定位 effect 之前（effect 需要读 viewMode 决定是否先切编辑模式）
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview")
  /** R-302：已完成的定位指令 seq——防止手动切换 preview/edit 或正文变动时重复跳转 */
  const handledFocusSeqRef = useRef<number>(-1)
  /** R-302：闪烁计时器（用 ref 管理而非 effect cleanup，避免正文变动导致 cleanup 提前取消、闪烁卡住） */
  const flashTimerRef = useRef<number | null>(null)

  /** R-302：触发一次 2.2 秒的定位闪烁 */
  const flashFocus = () => {
    setFocusFlash(true)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => {
      setFocusFlash(false)
      flashTimerRef.current = null
    }, 2200)
  }
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    }
  }, [])

  // R-302：按字符偏移定位的原语已抽到 @/pages/BidWorkspace/bidFocusJump（可 jsdom 单测）
  // ——边界（越界 clamp / 空正文 / hitLen=0 至少选 1 字）由 bidFocusJump.test.ts 钉死

  useEffect(() => {
    const focus = p.contentFocus
    if (!focus) return
    if (focus.seq === handledFocusSeqRef.current) return

    // R-302 路径 A：按 offset 跳转（title 字段存 excerpt，仅用于选区长度）
    if (typeof focus.offset === "number") {
      const el = textareaRef.current
      // textarea 未挂载（仍处预览态）时直接返回：切编辑态由点击方负责
      // （不在此处 setViewMode —— effect 内同步 setState 会触发 react-hooks/set-state-in-effect，
      //   且"跳转需要可编辑视图"本就是点击时的 UI 决策）
      if (!el) return
      const ok = jumpTextareaToOffset(el, focus.offset, (focus.title ?? "").length)
      // 正文尚未注入（刚切章 / 异步加载）：不标记 handled，等 editingContent 到货后 deps 变化自动重试
      if (!ok) return
      handledFocusSeqRef.current = focus.seq
      flashFocus()
      return
    }

    // 预览模式：在 Word 样式连续预览里定位（滚动到标题节点 + 闪烁高亮）；编辑模式仍走 textarea 选中
    const box = previewScrollRef.current
    if (box) {
      const target = [...box.querySelectorAll<HTMLElement>("[data-wp-title]")].find((n) =>
        (n.dataset.wpTitle ?? "").includes(focus.title),
      )
      if (!target) return
      handledFocusSeqRef.current = focus.seq
      target.scrollIntoView({ behavior: "smooth", block: "start" })
      const prevBg = target.style.backgroundColor
      target.style.transition = "background-color 0.4s"
      target.style.backgroundColor = "rgba(14, 159, 138, 0.18)"
      const timer = window.setTimeout(() => {
        target.style.backgroundColor = prevBg
      }, 2200)
      return () => window.clearTimeout(timer)
    }
    const el = textareaRef.current
    if (!el) return
    const value = el.value ?? ""
    if (!value.trim()) return
    const lines = value.split("\n")
    let offset = 0
    let hitIdx = -1
    let hitPos = 0
    for (const line of lines) {
      const trimmed = line.trimStart()
      const stripped = trimmed.replace(/^\d+(\.\d+)*\s*/, "")
      const inLine = line.length - trimmed.length
      if (trimmed.startsWith(focus.title) || stripped.startsWith(focus.title)) {
        hitIdx = offset + inLine
        hitPos = trimmed.startsWith(focus.title) ? offset + inLine : offset + line.indexOf(stripped)
        break
      }
      offset += line.length + 1
    }
    if (hitIdx < 0) return
    handledFocusSeqRef.current = focus.seq
    el.focus()
    el.setSelectionRange(hitPos, hitPos + focus.title.length)
    const ratio = value.length > 0 ? hitPos / value.length : 0
    el.scrollTop = Math.max(0, el.scrollHeight * ratio - el.clientHeight / 3)
    flashFocus()
  }, [p.contentFocus, viewMode, p.editingContent])
  // 切片A4：生成总览面板折叠态
  const [overviewOpen, setOverviewOpen] = useState(false)
  // 大纲侧栏可拖拽宽度（原固定 200px 太窄看不清章名）：拖动右侧分隔条调宽，双击恢复默认，localStorage 持久化
  const { width: outlineW, onDragStart: outlineDrag, reset: outlineReset } = useResizableSidebar({
    storageKey: "bidkit.compose.outlineW",
    initial: 280,
    min: 200,
    max: 600,
  })
  // R204 切片 0：右栏（评分点映射）折叠态——用户反馈正文被挤到 60% 宽，可折叠扩宽；localStorage 持久化
  const [asideCollapsed, setAsideCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try { return window.localStorage.getItem("bidkit.compose.asideCollapsed") === "1" } catch { return false }
  })
  const toggleAside = () => {
    setAsideCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem("bidkit.compose.asideCollapsed", next ? "1" : "0") } catch { /* ignore */ }
      return next
    })
  }
  // R212 切片0.5B：右栏双 Tab（评分映射 / 素材弹药）；素材弹药「插入正文」写向当前章 textarea 光标处
  const [asideTab, setAsideTab] = useState<"score" | "material">("score")
  const insertMaterial = (text: string, label: string) => {
    if (!p.activeChapterId) {
      toast.error("先在左侧选中章节")
      return
    }
    const cur = p.editingContent ?? ""
    const payload = `> 素材来源：${label}\n${text.trim()}`
    const ta = textareaRef.current
    let next: string
    if (ta && document.activeElement === ta && typeof ta.selectionStart === "number") {
      const startPos = ta.selectionStart
      const endPos = ta.selectionEnd ?? startPos
      next = cur.slice(0, startPos) + payload + cur.slice(endPos)
    } else {
      next = cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${payload}` : payload
    }
    p.setEditingContent(next)
    setViewMode("edit")
    toast.success("已插入，记得改写融合")
  }
  if (!proj) return null
  const hasChapters = proj.bid_chapters.length > 0
  // 切片A4：failedCount（hooks 在上方已声明）
  const failedCount = proj.bid_chapters.filter((c) => !c.part?.startsWith("biz") && c.gen_status === "failed").length
  // R301：技术章生成失败归因（复用 SolutionStudio 纯函数），供「生成总览」列出「哪些章因同一原因失败」
  const genFail = failedCount > 0 ? summarizeBidGenFailures(proj.bid_chapters) : null
  // R175：done 但小节未补齐的残缺章数（总览单列「待补小节」，与「完成」口径互斥）
  const pendingSectionCount = proj.bid_chapters.filter((c) => !c.part?.startsWith("biz") && isIncompleteSectionChapter(c)).length
  const bulkPct = p.genProgress.total ? Math.round((p.genProgress.current / p.genProgress.total) * 100) : 0
  const hasParse = !!proj.parse_report
  // 第十七轮 17A：招标文件规定了投标文件目录且已解析到 → 大纲遵循生效
  const outlineReqActive = sectionText(proj.parse_report ?? null, BID_OUTLINE_REQ_KEY).trim().length > 0
  // 改造 1：当前章的实时字数（编辑器内容优先）与字数预算
  const activeChapterIdx = proj.bid_chapters.findIndex((c) => c.node_id === p.activeChapterId)
  const activeBudget = activeChapterIdx >= 0 ? p.chapterBudgets[activeChapterIdx] ?? 0 : 0
  const activeCharCount = p.activeChapter ? p.editingContent.length : 0
  // 第十一轮改造 2：页数硬约束信息条——治理区间 [0.9,1.1]×有效目标页数×每页字数（DEFAULT_CHARS_PER_PAGE 校准值）
  const info = p.pageInfo
  const pageCapExceeded = p.pageCap !== null && p.targetPages !== null && p.targetPages > p.pageCap

  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-3">
      {/* UX-v2 视觉收口：项目名/状态/开标/商机已由页级项目卡承担，本行只保留
          「步骤名 + 真实进度 + 本步动作」，不再用大标题渐变卡与页头抢层级 */}
      <header className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">③ 投标文件编制</h1>
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium tabular-nums text-primary">
              已写 {(proj.bid_chapters ?? []).filter((c) => (c.content ?? "").trim().length > 0).length}/{(proj.bid_chapters ?? []).length} 章
            </span>
            <span
              className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block"
              title={
                hasParse
                  ? "未上传底稿时，按招标文件解析出的响应文件组成与评分要求自动编排全部内容；可从方案编制引入底稿"
                  : "尚未完成招标文件解析，建议先回到「AI 解析报告」环节，大纲才能对准评分办法"
              }
            >
              {hasParse
                ? "未上传底稿时按解析出的响应文件组成与评分要求自动编排；可从方案编制引入底稿"
                : "尚未完成招标文件解析，建议先回「AI 解析报告」再编制"}
            </span>
          </div>
          {hasChapters && p.bidSourceMode !== "external" && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={p.generateCommitmentLetter}
                disabled={locked}
                title={locked ? "已归档项目为只读" : "按 ★/▲ 实质性条款逐字生成响应承诺函，作为商务章节并入投标正文"}
                className="border-border bg-card text-card-foreground shadow-sm hover:border-primary hover:text-primary"
              >
                <PenLine className="mr-1.5 h-4 w-4" />
                生成承诺函
              </Button>
              {p.bulkGenerating ? (
                <Button variant="outline" onClick={p.cancelBulkGenerate} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                  <Square className="mr-1.5 h-4 w-4" />
                  停止生成
                </Button>
              ) : (
                <Button onClick={p.startBulkGenerate} disabled={locked} title={locked ? "已归档项目为只读" : undefined} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
                  <Play className="mr-1.5 h-4 w-4" />
                  {p.doneChapterCount > 0 && p.doneChapterCount < p.techChapterTotal ? "继续生成正文" : "逐章生成正文"}
                </Button>
              )}
              {/* 循环 11 块 B：打印 / 存 PDF 回退（浏览器打印对话框另存为 PDF） */}
              <Button
                variant="outline"
                onClick={() => setWordPreviewOpen(true)}
                title="按当前纸张与排版设置以仿 Word 版式预览整本标书"
                className="border-border bg-card text-card-foreground shadow-sm hover:border-primary hover:text-primary"
              >
                <Eye className="mr-1.5 h-4 w-4" />
                Word 预览
              </Button>
              <PrintExportButton title="把当前标书正文按只读版式调起打印，可在打印对话框选择「另存为 PDF」" />
            </div>
          )}
        </div>
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              生成设置
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">审查模式、生成参数、格式、全局事实、素材库</span>
          </summary>
        {/* Q28 切片A：审查模式开关卡——external 态下上传/粘贴外部标书，编制功能置灰 */}
        <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">审查模式</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => p.setBidSourceMode("internal")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${p.bidSourceMode === "internal" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
              >
                内部编制
              </button>
              <button
                type="button"
                onClick={() => p.setBidSourceMode("external")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${p.bidSourceMode === "external" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
              >
                外部标书
              </button>
            </div>
            {p.bidSourceMode === "external" && (
              <span className="text-xs text-muted-foreground">上传或粘贴外部投标文件后，可直接运行废标检查等检查功能，编制/生成功能暂停</span>
            )}
          </div>
          {p.bidSourceMode === "external" && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={p.bidExternalBusy || locked}
                  onClick={() => bidFileInputRef.current?.click()}
                >
                  {p.bidExternalBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1.5 h-3.5 w-3.5" />}
                  {p.bidExternalBusy ? "解析中…" : "上传投标文件（.docx/.pdf）"}
                </Button>
                <input
                  ref={bidFileInputRef}
                  type="file"
                  accept=".docx,.pdf,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    void p.handleBidExternalFile(e.target.files?.[0])
                    e.target.value = ""
                  }}
                />
                {p.bidExternalText && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    <ClipboardPaste className="mr-1 inline h-3 w-3" />
                    已载 {formatCount(p.bidExternalText.length)} 字
                  </span>
                )}
              </div>
              <Textarea
                placeholder="或在此粘贴外部投标文件全文…"
                value={p.bidExternalText}
                onChange={(e) => p.setBidExternalText(e.target.value)}
                disabled={locked}
                rows={6}
                className="text-sm"
              />
            </div>
          )}
        </div>
          {/* 循环 5 A3：归档只读——生成设置 / 格式设置 / 全局事实面板整体锁交互（内部 setter 另有 hook 兜底拦截） */}
          <div className={locked ? "pointer-events-none mt-4 space-y-4 opacity-60" : "mt-4 space-y-4"}>
            <GenerationSettingsBar {...p} />

            {/* 第十七轮 17C：格式与暗标设置面板（纸张/边距/标题正文字体/目录页码/暗标/格式检查项） */}
            <FormatSettingsPanel {...p} />

            <GlobalFactsPanel {...p} />

            {/* R167：公司优质素材库（五类标准件）——逐章/逐节按类别取基线，按招标要求定向调整 */}
            <MaterialLibraryPanel {...p} />
          </div>
        </details>
        {hasChapters && info.totalChars > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground">
              正文实际 ≈{info.actualPages} 页 · 目标 {info.targetPages} 页（硬约束 ±10%）
            </span>
            {pageCapExceeded && (
              <Badge variant="warning">招标文件要求 ≤{p.pageCap} 页，当前目标超出，已按上限收敛</Badge>
            )}
            {info.status === "in" && <Badge variant="success">达标</Badge>}
            {info.status === "under" && (
              <>
                <Badge variant="danger">
                  实际 ≈{info.actualPages} 页，距目标差 {info.gapPages} 页
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={p.pageFillBusy || locked || p.bulkGenerating}
                  title={
                    locked
                      ? "已归档项目为只读"
                      : p.bulkGenerating
                        ? "批量生成进行中，请先停止批量或等待其完成"
                        : undefined
                  }
                  onClick={p.startFillPages}
                  className="h-7 border-primary/40 text-primary hover:bg-primary/10"
                >
                  {p.pageFillBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                  {p.pageFillBusy ? "补齐生成中…" : "一键补齐"}
                </Button>
              </>
            )}
            {info.status === "over" && (
              <span className="text-muted-foreground">已超出治理区间，生成完成后会自动按章精简收敛到上限内</span>
            )}
            {/* T15：字数局部精调（易标字数调整阶段移植）——已成稿即提供手动入口，与生成链自动精调共用同一套锚点机制 */}
            {p.doneChapterCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={p.wordRefineBusy || locked || p.bulkGenerating}
                title={
                  locked
                    ? "已归档项目为只读"
                    : "对预算带外（偏离目标 20% 以上）的小节做局部扩写/缩写：锚点唯一定位、事实口径不改、表格行保护"
                }
                onClick={p.startWordRefineAll}
                className="h-7 border-primary/40 text-primary hover:bg-primary/10"
              >
                {p.wordRefineBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                {p.wordRefineBusy ? "精调中…" : "字数精调"}
              </Button>
            )}
            {/* Q28 切片G：编排配图补齐——正文链路只在小节首块按 JSON 契约顺带出图，纯文本回复/mermaid 弃图/续跑跳过都会静默丢图，
                补齐入口按编排计划逐张补出结构化图（项目13 实测编排 35 张、落库 14 张） */}
            {p.doneChapterCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={p.figureBackfillBusy || locked || p.bulkGenerating || p.figureBackfillPending === 0}
                title={
                  locked
                    ? "已归档项目为只读"
                    : p.figureBackfillProgress
                      ? `正在补齐第 ${p.figureBackfillProgress.current}/${p.figureBackfillProgress.total} 张：${p.figureBackfillProgress.title}`
                      : p.figureBackfillPending === 0
                        ? "编排选中的配图已全部落库"
                        : `按编排计划补齐缺失的 ${p.figureBackfillPending} 张架构/流程/界面示意/mermaid 配图，并把每张图插到它所属小节的末尾`
                }
                onClick={p.startFigureBackfill}
                className="h-7 border-primary/40 text-primary hover:bg-primary/10"
              >
                {p.figureBackfillBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                {p.figureBackfillBusy
                  ? p.figureBackfillProgress
                    ? `补齐配图 ${p.figureBackfillProgress.current}/${p.figureBackfillProgress.total}…`
                    : "补齐配图中…"
                  : `补齐配图${p.figureBackfillPending ? `（${p.figureBackfillPending}）` : ""}`}
              </Button>
            )}
          </div>
        )}
        {p.bulkGenerating && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                正在生成第 {p.genProgress.current} / 共 {p.genProgress.total} 章
              </span>
              <span>{bulkPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${bulkPct}%` }} />
            </div>
          </div>
        )}
        {p.totalAdjustProgress && (
          <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            全文校正中 第 {p.totalAdjustProgress.current} / {p.totalAdjustProgress.total} 章
          </div>
        )}
      </header>

      {p.outlineMissingTitles.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <p className="text-xs text-foreground">
            大纲生成依赖「{p.outlineMissingTitles.join("、")}」解析项，请先回到解析环节勾选并解析
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={p.goParseStep}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            前往解析环节
          </Button>
        </div>
      )}

      {!hasChapters || outlineViewOpen ? (
        /* UX-v2：③ 大纲编制按 prototype/bid/outline.html 复刻三栏——
           左：大纲树（条款覆盖 + 树编辑器）；中：确认/重生成动作；右：评分点覆盖热力表。
           原为两栏（左树 + 右条款覆盖），缺原型右栏的评分点覆盖表，本轮补上。 */
        <div className="mt-5 grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <div>
            {outlineReqActive && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                <Badge variant="warning">本大纲遵循招标规定目录</Badge>
                <span className="text-xs text-muted-foreground">
                  AI 提取目录可能存在幻想，确认前请对照招标原文核对
                </span>
              </div>
            )}
            {/* 循环 5 A3：归档只读——条款覆盖与大纲树编辑锁交互（查看保留） */}
            <div className={locked ? "pointer-events-none opacity-60" : undefined}>
              <OutlineCoverage
                outlineClauseTotal={p.outlineClauseTotal}
                coveredClauseCount={p.coveredClauseCount}
                uncoveredClauses={p.uncoveredClauses}
                addClauseToOutline={p.addClauseToOutline}
                addAllClausesToOutline={p.addAllClausesToOutline}
                outlineChapterDrift={p.outlineChapterDrift}
                syncOutlineChapters={p.syncOutlineChapters}
                removeOutlineNode={p.outlineRemove}
              />
              <OutlineTreeEditor
                nodes={p.outlineDraft}
                onRename={p.outlineRename}
                onRemove={p.outlineRemove}
                onMove={p.outlineMove}
                onAddChild={p.outlineAddChild}
                onAddRoot={p.outlineAddRoot}
                onSetPart={p.outlineSetPart}
              />
            </div>
            {p.outlineDraft.length > 0 && (
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={() => {
                    // R294：已有正文时拦一道二次确认（confirmOutline 全量重建章节清单，会清空既有正文）
                    const done = (proj?.bid_chapters ?? []).filter((c) => (c.content ?? "").trim().length > 0)
                    if (done.length > 0) {
                      setConfirmOutlineGuard({
                        chapters: done.length,
                        words: done.reduce((a, c) => a + (c.content ?? "").length, 0),
                      })
                      return
                    }
                    p.confirmOutline()
                    setOutlineViewOpen(false) // 确认后回到逐章编制视图（编制阶段从大纲视图进来的）
                  }}
                  disabled={locked}
                  title={locked ? "已归档项目为只读" : undefined}
                  className="flex-1 bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
                >
                  确认大纲，开始逐章编制
                </Button>
                <Button
                  variant="outline"
                  disabled={p.outlineLoading || locked}
                  title={locked ? "已归档项目为只读" : undefined}
                  onClick={() => setRegenConfirmOpen(true)}
                  className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                >
                  <RefreshCw className={`mr-1.5 h-4 w-4 ${p.outlineLoading ? "animate-spin" : ""}`} />
                  重新生成
                </Button>
                {hasChapters && (
                  <Button
                    variant="outline"
                    onClick={() => setOutlineViewOpen(false)}
                    className="shrink-0 border-border text-muted-foreground hover:text-foreground"
                  >
                    返回逐章编制
                  </Button>
                )}
              </div>
            )}
          </div>
          <aside className="flex flex-col gap-4">
            {/* UX-v2（prototype/bid/outline.html 右栏首位）：评分点覆盖热力表——真数据来自
                buildScoreCheckup（已覆盖/总分 + 逐条 ✓ 或「缺」，未覆盖按分值降序排最前）。
                点已覆盖项可跳章；「看缺的评分点」展开大纲体检明细。 */}
            <ScoreCoverageRail
              checkup={p.scoreCheckup}
              chapterIdByTitle={chapterIdByTitle}
              onSelectChapter={p.selectChapter}
              onJumpToMissing={() => setOutlineViewOpen(true)}
            />
            <div className="rounded-lg border border-border bg-card p-5 shadow-md">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                全新生成技术标大纲
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                AI 以评分办法为纲生成大纲，重要评分项都会落到具体章节，可再手动增删调整。
              </p>
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">目录级数（可不选）</p>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {LEVEL_OPTIONS.map((opt) => {
                    const active = p.outlineLevel === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => p.setOutlineLevel(opt.value)}
                        className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:text-card-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{LEVEL_HINT[p.outlineLevel]}</p>
              </div>
              {/* R206 切片 1（R-002）：内容范围三模式已上移至常驻「生成设置」条（GenerationSettingsBar），此处不再重复 */}
              <div className="mt-3 flex items-center gap-2">
                <SkillPickerFor scope="bid-outline" source={p.bidOutlineSkills} />
                <Button
                  onClick={p.generateOutline}
                  disabled={p.outlineLoading || locked}
                  title={locked ? "已归档项目为只读" : undefined}
                  variant="outline"
                  className="flex-1 border-primary/40 text-primary hover:bg-primary/10"
                >
                  {p.outlineLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  {p.outlineLoading ? "大纲生成中…" : "AI 生成大纲"}
                </Button>
              </div>
              {p.outlineLoading && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  长标书可能需要几分钟；若超过 5 分钟仍无响应，说明请求被网络波动打断，直接重试即可。
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-5 shadow-md">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FolderInput className="h-4 w-4 text-primary" />
                从方案编制引入底稿
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                选择你已编制的方案（规划 / 可研 / 初设 / 定制 / 标准），大纲与已成稿章节会深拷贝进本投标项目作为底稿。
              </p>
              <Button
                onClick={() => void p.openImportDialog()}
                disabled={locked}
                title={locked ? "已归档项目为只读" : undefined}
                variant="outline"
                className="mt-3 w-full border-border text-card-foreground shadow-sm hover:bg-secondary"
              >
                <FolderInput className="mr-1.5 h-4 w-4" />
                选择方案底稿
              </Button>
            </div>
          </aside>
        </div>
      ) : (
        <>
          {/* UX-R3 S3：第 3 步双 Tab——章节编制 / 偏离与响应表（角标=响应表待人工确认数，0 时隐藏） */}
          <div className="mt-4 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setComposeTab("edit")}
              aria-pressed={composeTab === "edit"}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                composeTab === "edit" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              📝 章节编制
            </button>
            <button
              type="button"
              onClick={() => setComposeTab("tables")}
              aria-pressed={composeTab === "tables"}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                composeTab === "tables" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              📋 偏离与响应表
              {techParamNeedsReview > 0 && (
                <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-warning">
                  {techParamNeedsReview}
                </span>
              )}
            </button>
          </div>
          {composeTab === "edit" ? (
          <>
          <div className="mt-4">
            {/* 循环 5 A3：归档只读——条款覆盖补入锁交互（查看保留） */}
            <div className={locked ? "pointer-events-none opacity-60" : undefined}>
              <OutlineCoverage
                outlineClauseTotal={p.outlineClauseTotal}
                coveredClauseCount={p.coveredClauseCount}
                uncoveredClauses={p.uncoveredClauses}
                addClauseToOutline={p.addClauseToOutline}
                addAllClausesToOutline={p.addAllClausesToOutline}
                outlineChapterDrift={p.outlineChapterDrift}
                syncOutlineChapters={p.syncOutlineChapters}
                removeOutlineNode={p.outlineRemove}
              />
            </div>
          </div>
          {/* 第十六轮 B2 改造 2.1：智能编排——大纲确认后对技术章叶子预编排正文版面（表格/配图），结果供正文生成消费 */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <LayoutGrid className="h-4 w-4 text-primary" />
                正文智能编排
                {p.orchestrationSummary && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">已编排</span>
                )}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {p.orchestrationSummary
                  ? `已编排 ${p.orchestrationSummary.leafCount} 个叶子：${p.orchestrationSummary.tableCount} 节建议表格、选定 ${p.orchestrationSummary.figureCount} 张配图（${
                      p.maxFigures >= FIGURES_UNLIMITED ? "上限=不限，宜图即配" : `全文上限 ${p.maxFigures} 张`
                    }，均匀分布全文），之后生成的正文自动执行编排`
                  : "动笔前为每节预先编排版面：哪节宜用表格、哪节配一张图（架构 / 流程 / 界面示意 / 甘特图）；配图在全文上限内择优、均匀散布各章，避免前密后疏"}
              </p>
              {!p.figuresEnabled && (
                <p className="mt-1 text-xs text-muted-foreground">章节配图开关已关闭，请先在「生成设置」中开启后再编排</p>
              )}
              {p.orchestrationBusy && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {p.orchestrationProgress
                    ? `正在编排第 ${p.orchestrationProgress.current}/${p.orchestrationProgress.total} 批叶子…`
                    : "正在编排…"}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              disabled={!p.figuresEnabled || p.orchestrationBusy || locked}
              onClick={p.startOrchestration}
              title={
                locked
                  ? "已归档项目为只读"
                  : !p.figuresEnabled
                    ? "请先在生成设置中开启章节配图开关"
                    : "为技术章叶子预编排正文表格与配图，生成正文时自动执行"
              }
              className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
            >
              {p.orchestrationBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
              {p.orchestrationBusy ? "编排中…" : p.orchestrationSummary ? "重新编排" : "智能编排"}
            </Button>
          </div>
          {/* 生成链路 D1：上次批量中断恢复横幅——队列残留且存在未完成任务且当前不在批量中 */}
          {hasChapters &&
            !p.bulkGenerating &&
            bulkResumePending && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-card-foreground animate-in fade-in duration-300">
                <span className="min-w-0 flex-1 text-xs">
                  检测到上次批量生成未完成（已生成 {p.doneChapterCount}/{p.techChapterTotal} 章）。点右侧按钮从断点继续——已完成的章不会重复生成，成稿小节按断点续跑只补缺失部分。
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    bulkQueueClear(proj.id)
                    p.startBulkGenerate()
                  }}
                  className="shrink-0 border-warning/50 text-foreground hover:bg-warning/20"
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  继续上次批量生成
                </Button>
              </div>
            )}
          {hasChapters && p.doneChapterCount === 0 && !p.bulkGenerating && !locked ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm text-card-foreground animate-in fade-in duration-300">
              <span className="min-w-0 flex-1">
                大纲已确认，正文还是空的——点右上「逐章生成正文」或「一键补齐」开始生成；也可以点左侧目录选中某一章单独生成。生成进度与状态会实时同步到目录。
              </span>
            </div>
          ) : null}
          {/* 切片A4：生成总览面板——一览各章完成/失败/偏短状态与字数进度 */}
          {hasChapters && (p.doneChapterCount > 0 || failedCount > 0 || pendingSectionCount > 0) && (
            <div className="mt-4 rounded-lg border border-border bg-card shadow-md">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                onClick={() => setOverviewOpen((v) => !v)}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                  生成总览
                  <span className="text-xs font-normal text-muted-foreground">
                    （完成 {p.doneChapterCount}/{p.techChapterTotal}
                    {failedCount > 0 && <span className="text-destructive">，失败 {failedCount}</span>}
                    {proj.bid_chapters.filter((c) => !c.part?.startsWith("biz") && c.underlength).length > 0 && (
                      <span className="text-warning">，偏短 {proj.bid_chapters.filter((c) => !c.part?.startsWith("biz") && c.underlength).length}</span>
                    )}
                    {pendingSectionCount > 0 && (
                      <span className="text-primary">，待补小节 {pendingSectionCount}</span>
                    )}
                    ）
                  </span>
                </span>
                {overviewOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
              {overviewOpen && (
                <div className="max-h-64 overflow-y-auto border-t border-border px-4 py-2">
                  {genFail && (
                    <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-2 text-xs">
                      <p className="font-medium text-destructive">失败归因（本地判定·零费用）：共 {genFail.failedCount} 章失败</p>
                      <ul className="mt-1 space-y-1">
                        {genFail.causes.map((g) => (
                          <li key={`${g.category}-${g.detail}`} className="text-muted-foreground">
                            <span className="font-medium text-foreground">【{g.label}】</span>
                            {g.count} 章 · {g.detail}
                            <span className="ml-1">（{g.chapters.map((c) => c.title).join("、")}{g.truncated ? ` 等共 ${g.count} 章` : ""}）</span>
                          </li>
                        ))}
                      </ul>
                      {genFail.allSameCause && genFail.causes[0] && (
                        <p className="mt-1 text-muted-foreground">全部失败章同属「{genFail.causes[0].label}」，建议先排查该通道再整本重试。</p>
                      )}
                    </div>
                  )}
                  {proj.bid_chapters
                    .map((ch, idx) => ({ ch, idx }))
                    .filter(({ ch }) => !ch.part?.startsWith("biz"))
                    .map(({ ch, idx }) => {
                      const chars = (ch.content ?? "").length
                      const budget = p.chapterBudgets[idx] ?? 0
                      const pendingSec = isIncompleteSectionChapter(ch)
                      const statusLabel = ch.gen_status === "done" ? (pendingSec ? "待补" : "完成") : ch.gen_status === "failed" ? "失败" : ch.gen_status === "generating" ? "进行中" : "未开始"
                      const statusColor =
                        ch.gen_status === "done"
                          ? pendingSec
                            ? "text-primary"
                            : ch.underlength
                              ? "text-warning"
                              : "text-emerald-600"
                          : ch.gen_status === "failed"
                            ? "text-destructive"
                            : ch.gen_status === "generating"
                              ? "text-primary"
                              : "text-muted-foreground"
                      return (
                        <div key={ch.node_id} className="flex items-center gap-2 border-b border-border/50 py-1.5 last:border-b-0 text-xs">
                          <span className={`w-12 shrink-0 font-medium ${statusColor}`}>
                            {ch.gen_status === "generating" ? <Loader2 className="h-3 w-3 animate-spin" /> : statusLabel}
                          </span>
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-foreground hover:text-primary hover:underline"
                            onClick={() => p.selectChapter(ch.node_id)}
                            title={
                              ch.gen_status === "failed" && ch.genError
                                ? `${ch.title}｜失败原因：${ch.genError}`
                                : ch.proseLintWarning
                                  ? `${ch.title}｜${ch.proseLintWarning}`
                                  : ch.sanityWarning
                                    ? `${ch.title}｜${ch.sanityWarning}`
                                    : ch.figureAnnotationWarning
                                      ? `${ch.title}｜${ch.figureAnnotationWarning}`
                                      : ch.title
                            }
                          >
                            {ch.title}
                          </button>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {chars > 0 ? `${chars}` : "-"}/{budget > 0 ? budget : "-"} 字
                            {ch.underlength && <span className="ml-1 text-warning">偏短</span>}
                            {ch.sanityWarning && (
                              <button
                                type="button"
                                className="ml-1 cursor-pointer text-destructive underline-offset-2 hover:underline"
                                title={`${ch.sanityWarning} — 点击跳到该位置（切编辑态并选中，闪烁 2.2 秒）`}
                                onClick={() => {
                                  // R55：与"版式?"徽标同一条跳转通道（R-302 抽出的 bidFocusJump）。
                                  // 丢字是"少了一个字"，正解是人工补字，所以只给跳转、不给整章重写入口。
                                  // 预览态 textarea 未挂载 → 必须在点击事件里切编辑态（不在 effect 内 setState）
                                  setViewMode("edit")
                                  const hit = ch.sanityFirstHit
                                  if (hit && typeof hit.offset === "number") {
                                    p.focusPositionInChapter(ch.node_id, hit.offset, hit.excerpt)
                                  } else {
                                    // 兜底：无 firstHit 数据（R55 之前的存量章）时只切到该章编辑态
                                    p.selectChapter(ch.node_id)
                                  }
                                }}
                              >
                                丢字?
                              </button>
                            )}
                            {ch.proseLintWarning && (
                              <button
                                type="button"
                                // REQ-021：按严重度分色。结构性（标题跳号/关键章缺表）会被评审扣分 → 红色；
                                // 观感（套话/内联指引/长段落/长句）只是啰嗦 → 琥珀色 warning。
                                // 未跑过 lint 的历史章 severity 为 undefined，按红色兜底（沿用旧观感，不降级提醒）。
                                className={`ml-1 cursor-pointer underline-offset-2 hover:underline ${
                                  ch.proseLintSeverity === "style" ? "text-warning" : "text-destructive"
                                }`}
                                title={`${ch.proseLintWarning} — 点击跳到该位置（切编辑态并选中，闪烁 2.2 秒）`}
                                onClick={() => {
                                  // R-302：跳字符位置必须处于可编辑视图（textarea 才存在），
                                  // 事件处理器里切模式（不在 effect 内 setState）
                                  setViewMode("edit")
                                  const hit = ch.proseLintFirstHit
                                  if (hit && typeof hit.offset === "number") {
                                    p.focusPositionInChapter(ch.node_id, hit.offset, hit.excerpt)
                                  } else {
                                    // 兜底：无 firstHit 数据（历史章未跑过 lint）时只切到该章编辑态
                                    p.selectChapter(ch.node_id)
                                  }
                                }}
                              >
                                版式?
                              </button>
                            )}
                            {ch.figureAnnotationWarning && (
                              // REQ-027：截图标注检查（F-04）。
                              // 一律琥珀色——「缺招标要求/投标响应标注」是建议项而非缺陷：
                              // 实测 45 份真实标书 804 张截图里，仅 1 张写了该标注。
                              // 若用红色，用户会把"公司规范建议"误读成"要废标"，红字可信度随即崩塌。
                              <button
                                type="button"
                                className="ml-1 cursor-pointer text-warning underline-offset-2 hover:underline"
                                title={`${ch.figureAnnotationWarning} — 点击切到该章编辑态逐个核对`}
                                onClick={() => {
                                  setViewMode("edit")
                                  p.selectChapter(ch.node_id)
                                }}
                              >
                                截图?
                              </button>
                            )}
                            {ch.itemDensityWarning && (
                              // REQ-048：功能章条目密度检查 —— 功能章 0 条条目为真缺陷，红色
                              <button
                                type="button"
                                className="ml-1 cursor-pointer text-destructive underline-offset-2 hover:underline"
                                title={`${ch.itemDensityWarning} — 点击切到该章编辑态`}
                                onClick={() => {
                                  setViewMode("edit")
                                  p.selectChapter(ch.node_id)
                                }}
                              >
                                条目?
                              </button>
                            )}
                            {ch.captionNumberingWarning && (
                              // 2026-10-26：图表题注断号/重号（公司规范：删除或调整图表后须更新域，
                              // 断号或重号即违规）。一律琥珀色——评审会当成文档不严谨，但不是废标项，
                              // 与「条目?」那类真缺陷（红色）分开，别把格式瑕疵说成废标。
                              <button
                                type="button"
                                className="ml-1 cursor-pointer text-warning underline-offset-2 hover:underline"
                                title={`${ch.captionNumberingWarning} — 点击切到该章编辑态核对题注编号`}
                                onClick={() => {
                                  setViewMode("edit")
                                  p.selectChapter(ch.node_id)
                                }}
                              >
                                题注?
                              </button>
                            )}
                          </span>
                          {ch.gen_status === "failed" && !locked && !p.bulkGenerating && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => p.generateChapter(ch.node_id)}
                              disabled={!!p.chapterBusy}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" />
                              重试
                            </Button>
                          )}
                          {ch.proseLintWarning && !locked && !p.bulkGenerating && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => p.refineChapter(ch.node_id, "rewrite")}
                                disabled={!!p.chapterBusy}
                                title="按版式与文风硬条款重写本章（去 AI 套话 / 禁内联指引 / 修正标题层级 / 关键章补表）"
                              >
                                <Wand2 className="mr-1 h-3 w-3" />
                                重写
                              </Button>
                              {/* UX-R3 S11：「🧹 去 AI 味」主动精修——只改句式（升华/排比/元话语/态度词/政策堆砌），
                                  技术参数与事实一字不动；与「重写」并列，由用户选重还是选轻 */}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                                onClick={() => p.refineChapter(ch.node_id, "deai")}
                                disabled={!!p.chapterBusy}
                                title="句式级去 AI 味精修：删除升华/排比/元话语/态度词/政策堆砌，保留全部技术参数与事实，只换表述（不重写内容）"
                              >
                                <Sparkles className="mr-1 h-3 w-3" />
                                🧹 去 AI 味
                              </Button>
                            </>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )}
          {/* R204 切片 0：右栏折叠开关条——xl 断点可见，展开态显示"收起"、折叠态显示"展开评分点面板" */}
          <div className="mt-3 hidden justify-end xl:flex">
            <button
              type="button"
              onClick={toggleAside}
              aria-expanded={!asideCollapsed}
              aria-controls="score-mapping-aside"
              title={asideCollapsed ? "展开右侧评分点面板" : "折叠右侧评分点面板，扩宽正文"}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {asideCollapsed ? (
                <>
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>展开评分点面板</span>
                </>
              ) : (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span>收起评分点面板</span>
                </>
              )}
            </button>
          </div>
          <div
            className={`mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_3fr] ${
              asideCollapsed ? "xl:grid-cols-[var(--ow)_minmax(0,1fr)]" : "xl:grid-cols-[var(--ow)_minmax(0,1fr)_300px]"
            }`}
            style={{ "--ow": `${outlineW}px` } as CSSProperties}
          >
            <div className="relative lg:sticky lg:top-20">
              <div
                role="separator"
                aria-orientation="vertical"
                title="按住拖动调整大纲宽度，双击恢复默认"
                onPointerDown={outlineDrag}
                onDoubleClick={outlineReset}
                className="group absolute top-0 -right-2 z-10 hidden h-full w-3 cursor-col-resize items-center justify-center xl:flex"
              >
                <span className="h-full w-0.5 rounded-full bg-border transition-colors group-hover:bg-primary/60" />
              </div>
              <BidChapterNavTree
                chapters={proj.bid_chapters}
                chapterBudgets={p.chapterBudgets}
                activeChapterId={p.activeChapterId}
                supplementState={p.supplementState}
                sectionState={p.sectionGenState}
                doneChapterCount={p.doneChapterCount}
                techChapterTotal={p.techChapterTotal}
                emptyBizCount={p.emptyBizChapters.length}
                onFillBizSkeletons={p.fillBizSkeletons}
                onSelectChapter={p.selectChapter}
                onFocusSection={p.focusSectionInChapter}
                onRegenerateOutline={() => {
                  // 编制阶段的重生成：先切到大纲视图（确认弹窗后面能看到大纲），确认后按当前生成设置重跑
                  setOutlineViewOpen(true)
                  setRegenConfirmOpen(true)
                }}
                generateChapter={p.generateChapter}
                continueChapter={p.continueChapter}
                refineChapter={p.refineChapter}
                addBizAssemblyItems={p.addBizAssemblyItems}
              />
            </div>
            <div>
              {p.activeChapter?.part !== "biz" && (
                <>
                  <ChapterBudgetBar
                    activeChapter={p.activeChapter}
                    charCount={activeCharCount}
                    budget={activeBudget}
                    supplementState={p.supplementState}
                  />
                  {p.activeChapter?.underlength && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                      <span className="badge-warning">偏短</span>
                      <span className="text-xs text-muted-foreground">
                        本章成稿字数低于预算六成，可对当前章「扩写」或「继续生成」补足，达标后徽标自动消失
                      </span>
                    </div>
                  )}
                </>
              )}
              {/* 切片A3：预览/编辑切换栏 */}
              {p.activeChapter && (p.editingContent ?? "").trim().length > 0 && p.activeChapter?.part !== "biz" && (
                <div className="mt-3 mb-1 flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={viewMode === "preview" ? "default" : "ghost"}
                    className="h-7 gap-1 text-xs"
                    onClick={() => setViewMode("preview")}
                  >
                    <Eye className="h-3 w-3" />
                    预览
                  </Button>
                  <Button
                    size="sm"
                    variant={viewMode === "edit" ? "default" : "ghost"}
                    className="h-7 gap-1 text-xs"
                    onClick={() => setViewMode("edit")}
                    disabled={locked}
                  >
                    <PenLine className="h-3 w-3" />
                    编辑
                  </Button>
                </div>
              )}
              {/* Word 样式连续预览：与整本「Word 预览」同一渲染管线（A4 版式 / 字体字号 / 首行缩进 / 小节编号），导航点小节可定位 */}
              {viewMode === "preview" && p.activeChapter && (p.editingContent ?? "").trim().length > 0 && p.activeChapter?.part !== "biz" ? (
                <div ref={previewScrollRef} className="mt-1 max-h-[72vh] overflow-auto rounded-lg">
                  <BidWordPreview
                    docTitle={p.activeProject?.project_name || "投标文件"}
                    format={p.effectiveFormatSettings}
                    chapterOffset={Math.max(0, activeChapterIdx)}
                    chapters={[
                      {
                        title: p.activeChapter.title ?? "",
                        content: p.editingContent ?? "",
                        sections: p.activeChapter.sections ?? [],
                      },
                    ]}
                  />
                </div>
              ) : (
              <div className={`rounded-lg transition-colors ${focusFlash ? "bg-primary/15" : ""}`}>
                <ChapterEditor
                  activeChapter={p.activeChapter}
                  activeChapterId={p.activeChapterId}
                  editingContent={p.editingContent}
                  setEditingContent={p.setEditingContent}
                  chapterBusy={p.chapterBusy}
                  generateChapter={p.generateChapter}
                  regenerateChapter={p.regenerateChapter}
                  continueChapter={p.continueChapter}
                  refineChapter={p.refineChapter}
                  bulkGenerating={p.bulkGenerating}
                  autoSaveState={p.autoSaveState}
                  chapterIndex={activeChapterIdx}
                  figures={p.activeChapter?.figures ?? []}
                  textareaRef={textareaRef}
                  readOnly={locked}
                  figureToolbar={
                    <FigureInsertTools
                      disabled={locked}
                      busy={p.figureUploadBusy}
                      templates={p.figureTemplates}
                      onUpload={(f) => void p.uploadChapterFigure(f)}
                      onInsert={(t) => void p.insertFigureTemplate(t)}
                      onRemove={p.removeFigureTemplateById}
                    />
                  }
                  genPickerSlot={<SkillPickerFor scope="bid-chapter" source={p.bidChapterSkills} align="right" />}
                />
              </div>
              )}
            </div>
            {/* R204 切片 0 可折叠 · R212 切片0.5B 右栏双 Tab：评分映射 / 素材弹药（引用即复制，零 AI 零新 collection） */}
            {!asideCollapsed && (
            <div id="score-mapping-aside" className="hidden space-y-4 xl:sticky xl:top-20 xl:block">
              {/* UX-v2（prototype/bid/draft.html 右栏 1:1）：三块真数据体检卡常驻——
                  ① 废标风险（void_check 逐条判定）② 一致性检查（跨章数字比对）③ 写作体检（本章文风扫描）。
                  原来的「评分映射 / 素材弹药」双 Tab 仍在，但收进下方折叠块，不再与体检卡抢右栏主位。 */}
              <VoidRiskRail items={proj.void_check?.items ?? []} onGoVoidCheck={() => p.requestStep(5)} />
              <ConsistencyRail chapters={proj.bid_chapters} onSelectChapter={p.selectChapter} />
              <ProseCheckRail chapter={p.activeChapter} onGoChapter={() => {}} />

              <details className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  评分映射 / 素材弹药
                </summary>
                <div className="mt-2">
                  <div className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                <button
                  type="button"
                  onClick={() => setAsideTab("score")}
                  aria-pressed={asideTab === "score"}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    asideTab === "score" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  评分映射
                </button>
                <button
                  type="button"
                  onClick={() => setAsideTab("material")}
                  aria-pressed={asideTab === "material"}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    asideTab === "material" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  素材弹药
                </button>
                  </div>
              {asideTab === "material" ? (
                <BidMaterialAmmoPanel
                  siblings={proj.bid_chapters
                    .filter((c) => c.part !== "biz" && (c.content ?? "").trim().length > 0 && c.node_id !== p.activeChapterId)
                    .map((c) => ({ id: c.node_id, title: c.title, content: c.content }))}
                  chapterQuery={[p.activeChapter?.title, ...(p.activeChapter?.sections ?? [])].filter(Boolean).join(" ")}
                  activeChapterId={p.activeChapterId}
                  canInsert={!!p.activeChapterId && !locked && p.activeChapter?.part !== "biz"}
                  onInsert={insertMaterial}
                />
              ) : (
                <ScoreMappingPanel
                  report={proj.parse_report ?? null}
                  chapters={proj.bid_chapters}
                  outline={proj.bid_outline ?? []}
                  activeChapterId={p.activeChapterId}
                  outlineClauseTotal={p.outlineClauseTotal}
                  coveredClauseCount={p.coveredClauseCount}
                  uncoveredClauses={p.uncoveredClauses}
                  voidItems={proj.void_check?.items ?? []}
                  onJumpResponse={p.jumpToResponseNode}
                  onSelectChapter={p.selectChapter}
                  onAddClause={p.addClauseToOutline}
                  onGoVoidCheck={() => p.requestStep(5)}
                />
              )}
                </div>
              </details>
            </div>
            )}
          </div>

          {/* 窄于 xl 时：三块体检卡 + 评分点面板降级到编辑器下方（保持功能可见） */}
          <div className="mt-4 space-y-4 xl:hidden">
            <VoidRiskRail items={proj.void_check?.items ?? []} onGoVoidCheck={() => p.requestStep(5)} />
            <ConsistencyRail chapters={proj.bid_chapters} onSelectChapter={p.selectChapter} />
            <ProseCheckRail chapter={p.activeChapter} onGoChapter={() => {}} />
            <ScoreMappingPanel
              report={proj.parse_report ?? null}
              chapters={proj.bid_chapters}
              outline={proj.bid_outline ?? []}
              activeChapterId={p.activeChapterId}
              outlineClauseTotal={p.outlineClauseTotal}
              coveredClauseCount={p.coveredClauseCount}
              uncoveredClauses={p.uncoveredClauses}
              voidItems={proj.void_check?.items ?? []}
              onJumpResponse={p.jumpToResponseNode}
              onSelectChapter={p.selectChapter}
              onAddClause={p.addClauseToOutline}
              onGoVoidCheck={() => p.requestStep(5)}
            />
          </div>
          </>
          ) : (
          <>
          {/* UX-R3 S3：偏离表 + 技术参数响应表整体搬入独立 Tab；原「技术偏离表就在下方」蓝色横幅已删
              （发现性由 Tab 角标承担）。jumpToResponseNode 用包装版——定位前自动切回「章节编制」Tab */}
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
            jumpToResponseNode={jumpResponseCompose}
            exportDeviationWord={p.exportDeviationWord}
            exportBusy={p.exportBusy}
            deviationSkills={p.deviationSkills}
            techParamCoverage={p.techParamCoverage}
            addUncoveredTechParamsToOutline={p.addUncoveredTechParamsToOutline}
          />
          {/* R55：技术参数响应表——与偏离表同 Tab；数据只需 activeProject 的
              tender_text / parse_report，面板内部自算，不动 useBidWorkspace 返回面；key 绑项目 id 防「章节描述」串项目 */}
          <TechParamResponsePanel
            key={proj.id}
            tenderText={proj.tender_text ?? ""}
            report={proj.parse_report ?? null}
            onExport={p.exportTechParamWord}
            exportBusy={p.exportBusy === "deviation"}
            restoredTables={p.activeProject?.tender_tables ?? null}
          />
          {/* UX-R3 S12：主观分逐条确认——与偏离/响应表同区（同属「对外响应口径」） */}
          <SubjectiveScorePanel
            project={proj}
            onConfirm={p.setSubjectiveConfirmation}
            onJumpToChapter={jumpResponseCompose}
            archived={locked}
          />
          </>
          )}
        </>
      )}

      <footer className="mt-10 border-t border-border pt-5 text-center text-xs text-muted-foreground">
        正文按章节顺序串行生成以保持全文口径一致，编辑内容自动保存；改写 / 扩写 / 精简随时可用
      </footer>

      <Dialog open={p.importDialogOpen} onOpenChange={p.setImportDialogOpen}>
        <DialogContent className="max-w-lg rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">从方案编制引入底稿</DialogTitle>
            <DialogDescription>选择方案后，其大纲与已成稿章节将深拷贝进本投标项目</DialogDescription>
          </DialogHeader>
          {p.importLoading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs">方案列表加载中…</p>
            </div>
          ) : p.importCandidates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
              <p className="text-xs text-muted-foreground">还没有可用的方案底稿</p>
              <Link
                to="/solution-studio"
                onClick={() => p.setImportDialogOpen(false)}
                className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                去「方案编制」完成一份方案
              </Link>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {p.importCandidates.map((sol) => (
                <li key={sol.id}>
                  <button
                    type="button"
                    onClick={() => p.importFromSolution(sol)}
                    className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Download className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{sol.solution_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {typeLabel(sol.solution_type)} · {sol.hospital || "未填医院"} · {sol.chapters?.filter((c) => c.content?.trim()).length ?? 0} 章成稿
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">重新生成大纲？</DialogTitle>
            <DialogDescription>
              将沿用当前生成入口的参数重跑大纲生成，现有大纲与手动调整会被覆盖。
              重新生成后会自动切到「大纲」视图供你核对，确认大纲后才会按新结构重建章节清单
              （已生成正文的章节届时会再弹一次确认，不会静默清空）。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRegenConfirmOpen(false)} className="border-border text-muted-foreground shadow-sm hover:text-foreground">
              取消
            </Button>
            <Button
              onClick={() => {
                setRegenConfirmOpen(false)
                p.generateOutline()
              }}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              确认覆盖
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* R58（B28）：关键解析项缺失但项目已有大纲——不再硬拦，改为二次确认。
          默认动作是取消（取消按钮为默认焦点/主按钮，Esc 与点遮罩同样走取消），
          只有用户明确点「继续并覆盖」才会重跑生成，避免一键覆盖既有大纲与手动调整。 */}
      <Dialog
        open={p.outlineCriticalConfirmOpen}
        onOpenChange={(o) => {
          if (!o) p.cancelGenerateOutlineCritical()
        }}
      >
        <DialogContent className="max-w-md rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">解析报告缺少关键项，仍要重新生成大纲？</DialogTitle>
            <DialogDescription>{p.outlineCriticalConfirmText}</DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            继续重新生成将<b>覆盖现有大纲及手动调整</b>，且需重新付费调用 AI；建议先取消，回到「AI 解析报告」补齐缺失项后再生成。
          </p>
          <div className="flex justify-end gap-2">
            <Button
              autoFocus
              onClick={p.cancelGenerateOutlineCritical}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              取消（保留现有大纲）
            </Button>
            <Button
              variant="outline"
              onClick={p.confirmGenerateOutlineCritical}
              className="border-destructive/40 text-destructive shadow-sm hover:bg-destructive/5"
            >
              继续并覆盖
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* R294 确认大纲覆盖既有正文的二次确认：如实报出将清空的章数与字数，避免误点清零 106 万字级资产 */}
      <Dialog open={!!confirmOutlineGuard} onOpenChange={(o) => !o && setConfirmOutlineGuard(null)}>
        <DialogContent className="max-w-sm rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">确认大纲会清空已生成正文</DialogTitle>
            <DialogDescription>
              「确认大纲」会按当前大纲重建章节清单，已成稿的 {confirmOutlineGuard?.chapters ?? 0} 章正文（
              约 {formatCount(confirmOutlineGuard?.words ?? 0)} 字）将被清空且需重新付费生成。
              若只是调整了大纲想补几章，请关闭本弹窗，改用覆盖面板里的「一键补入 / 同步章节清单」——它们只增不删、保留既有正文。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOutlineGuard(null)}
              className="border-border text-muted-foreground shadow-sm hover:text-foreground"
            >
              取消（改用补入）
            </Button>
            <Button
              onClick={() => {
                setConfirmOutlineGuard(null)
                p.confirmOutline()
                setOutlineViewOpen(false)
              }}
              className="bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              清空并重建
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* @r211 R-004 标书 Word 式分页预览弹窗（on-screen，打印仍走上方 PrintExportButton） */}
      <Dialog open={wordPreviewOpen} onOpenChange={setWordPreviewOpen}>
        <DialogContent className="flex h-[92vh] w-[94vw] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 sm:max-w-none">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
            <DialogTitle className="text-foreground">标书 Word 预览</DialogTitle>
            <DialogDescription>
              按当前纸张与排版设置仿 Word 版式连续预览（A4 版心 / 页边距 / 页眉页脚 / 页码 / 首行缩进 / 图表题注）。如需成稿，请用「打印 / 存 PDF」按钮。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <BidWordPreview
              docTitle={p.activeProject?.project_name || "投标文件"}
              format={p.effectiveFormatSettings}
              chapters={(p.activeProject?.bid_chapters ?? []).map((c) => ({
                title: c.title ?? "",
                content: c.content ?? "",
                sections: c.sections,
              }))}
            />
          </div>
        </DialogContent>
      </Dialog>
      {/* 循环 11 块 B：打印 / 存 PDF 只读正文块（屏幕隐藏，打印独占显示） */}
      <PrintChapterFlow
        docTitle={p.activeProject?.project_name || "投标文件"}
        chapters={(p.activeProject?.bid_chapters ?? []).map((c) => ({
          title: c.title ?? "",
          content: c.content ?? "",
          sections: c.sections,
        }))}
      />
      {/* 用户反馈轮：关闭商务标开关时，存量大纲商务章移除确认 */}
      <ConfirmDialog
        open={p.bizRemoveCount != null}
        onOpenChange={(open) => {
          if (!open) p.cancelRemoveBizChapters()
        }}
        title={`一并移除目录中的 ${p.bizRemoveCount ?? 0} 个商务标章节？`}
        description="投标函、资质证照、商务偏离表等骨架章将从当前目录删除（不影响已生成技术章正文）；选择保留则章节留在目录但不会生成正文。"
        confirmText="移除商务章"
        tone="danger"
        onConfirm={p.confirmRemoveBizChapters}
      />
    </section>
  )
}
