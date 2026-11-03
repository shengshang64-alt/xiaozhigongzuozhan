import { useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Download, Eye, FileText, Images, Loader2, Palette, Pencil, Play, Sparkles, Upload , ShieldCheck } from "lucide-react"
import { MaterialPickerDialog } from "./MaterialPickerDialog"
import { deckTypeLabel, TRANSITION_LABEL, type DeckRecord, type DeckTransition, type RefineKind, type Slide } from "@/pages/PptQuote/pptQuoteTypes"
import type { ImageSearchProvider } from "@/pages/PptQuote/imageSearch"
import { SlideListNav } from "./SlideListNav"
import { SlideEditor } from "./SlideEditor"
import { SlidePreviewGrid } from "./SlidePreviewGrid"
import { DeckPresent } from "./DeckPresent"
import { DeckLintPanel } from "./DeckLintPanel"
import { DeckSourcePanel } from "./DeckSourcePanel"
import { DeckTemplateMappingPanel } from "./DeckTemplateMappingPanel"
import { DeckRenderCheckPanel } from "./DeckRenderCheckPanel"
import { DeckVisualPlanPanel } from "./DeckVisualPlanPanel"
import type { DeckVisualPlan } from "@/pages/PptQuote/deckVisualPlan"
import type { RenderReport } from "@/pages/PptQuote/deckRenderCheck"
import { BookOpen, LayoutTemplate, Image as ImageIcon } from "lucide-react"
import type { TemplateMappingZ } from "@/pages/PptQuote/deckSchema"
import type { TemplateOutline } from "@/pages/PptQuote/templateLayouts"
import { groupIssuesByPage, lintDeck } from "@/pages/PptQuote/deckLint"
import { DECK_THEME_PRESETS } from "@/pages/PptQuote/deckTheme"
import { TemplateFidelityPanel } from "./TemplateFidelityPanel"
import type { TemplateFacts } from "@/pages/PptQuote/deckFidelityProbe"

type ImagePool = { source: string; loading: boolean; urls: string[]; error: string }

type DeckEditorWorkspaceProps = {
  deck: DeckRecord
  currentSlide: Slide | null
  currentSlideIndex: number
  setCurrentSlideIndex: (index: number) => void
  editorTab: "edit" | "preview" | "check"
  setEditorTab: (tab: "edit" | "preview" | "check") => void
  slideAiKind: RefineKind | null
  onBack: () => void
  onRename: (value: string) => void
  updateSlide: (patch: Partial<Slide>) => void
  addSlide: () => void
  deleteSlideAt: (index: number) => void
  moveSlide: (index: number, dir: -1 | 1) => void
  refineSlide: (kind: RefineKind) => void
  /** B4：自动保存失败横幅（非阻断）+ 手动立即保存 */
  persistFailed: boolean
  onSaveNow: () => void
  onExportPptx: () => void
  /** R169：公司模板主题——当前模板名（null=内置版式）、上传 .pptx/.potx、清除 */
  deckTemplateName?: string | null
  onUploadDeckTemplate: (file: File) => void
  /** 2026-10-30 补齐：全册视觉计划 */
  visualPlan?: DeckVisualPlan | null
  /** 2026-10-30 补齐：渲染质检（真实把 pptx 渲染成图检查） */
  renderReport?: { report: RenderReport; thumbs: { page: number; dataUrl: string; inkRatio: number }[] } | null
  renderChecking?: boolean
  renderCapability?: { ok: boolean; hint: string } | null
  onCheckRenderQuality?: () => void
  /** 2026-10-30 补齐：检查页签用的模板版式与映射 */
  templateOutline?: TemplateOutline | null
  layoutMapping?: TemplateMappingZ
  onMappingChange?: (m: TemplateMappingZ) => void
  /** 2026-10-30 同稿换风格：当前配色预设 key */
  deckThemePreset?: string
  /** 切换配色预设（只改导出配色，不重新生成内容） */
  onSelectThemePreset?: (key: string) => void
  /** 2026-10-30 AI 润色单段文字（field="bullet:N" | "notes" | "title"） */
  onPolishText?: (field: string, kind: import("@/pages/PptQuote/pptQuoteTypes").PolishKind) => void
  /** 正在润色的字段 key，用于禁用按钮 */
  polishingKey?: string | null
  onClearDeckTemplate: () => void
  /** R190（r169 切片三）：模板保真体检事实，非空即在编辑期展示体检卡片 */
  deckTemplateProbe?: TemplateFacts | null
  onExportSpeech: () => void
  /** 逐页编辑「改写 / 扩写 / 精简」旁的带入技能选择器（页面注入） */
  refinePickerSlot?: ReactNode
  /** 页面切换动画（deck 级，导出时注入 OOXML） */
  deckTransition: DeckTransition
  setDeckTransition: (value: DeckTransition) => void
  /** 真实配图：图池 + 逐页/一键插入 */
  imagePool: ImagePool
  imageBusy: boolean
  onLoadImagePool: (source: string) => void
  attachImageFromUrl: (index: number, url: string) => void
  attachImageByPastedUrl: (index: number, url: string) => void
  uploadSlideImage: (index: number, file: File) => void
  clearSlideImage: (index: number) => void
  applyPoolImagesToHinted: () => void
  /** 逐页联网搜图 */
  searchAndAttachImage: (index: number, query?: string, providerOverride?: ImageSearchProvider) => Promise<boolean>
  /** R-008 素材库：选图弹窗插入 + 缓存重拉 */
  attachImageFromLibrary: (index: number, materialId: string) => Promise<boolean>
  reloadLocalMaterials?: () => Promise<void>
  autoFigureProvider: ImageSearchProvider
  setAutoFigureProvider: (v: ImageSearchProvider) => void
  slideFigureBusy: { index: number; kind: "search" | "" }
  /** R249：占位/空白页「一键补全」——空白页数、进行态、进度文案与触发 */
  blankSlideCount: number
  fillingBlank: boolean
  fillProgress: string
  onFillBlankSlides: () => void
}

export function DeckEditorWorkspace({
  deck,
  currentSlide,
  currentSlideIndex,
  setCurrentSlideIndex,
  editorTab,
  setEditorTab,
  slideAiKind,
  onBack,
  onRename,
  updateSlide,
  addSlide,
  deleteSlideAt,
  moveSlide,
  refineSlide,
  persistFailed,
  onSaveNow,
  onExportPptx,
  onExportSpeech,
  deckTemplateName,
  templateOutline,
  layoutMapping,
  onMappingChange,
  visualPlan = null,
  renderReport = null,
  renderChecking = false,
  renderCapability = null,
  onCheckRenderQuality = () => {},
  onUploadDeckTemplate,
  deckThemePreset = "navy",
  onSelectThemePreset,
  onPolishText,
  polishingKey = null,
  onClearDeckTemplate,
  deckTemplateProbe,
  refinePickerSlot,
  deckTransition,
  setDeckTransition,
  imagePool,
  imageBusy,
  onLoadImagePool,
  attachImageFromUrl,
  attachImageByPastedUrl,
  uploadSlideImage,
  clearSlideImage,
  applyPoolImagesToHinted,
  searchAndAttachImage,
  attachImageFromLibrary,
  reloadLocalMaterials,
  autoFigureProvider,
  setAutoFigureProvider,
  slideFigureBusy,
  blankSlideCount,
  fillingBlank,
  fillProgress,
  onFillBlankSlides,
}: DeckEditorWorkspaceProps) {
  // R166：导出前自检接入编辑期（同一套 deckLint 规则，memo 随 slides 重算，非阻断）
  const lintIssues = useMemo(() => lintDeck(deck.slides), [deck.slides])
  // warn 级命中页集合（页面列表圆点用；info 不打点，避免正常编辑满屏红点）
  // 2026-10-30：阻断导出的严重问题数（与导出门禁同一口径：level === "error"）
  const blockingCount = useMemo(() => lintIssues.filter((i) => i.level === "error").length, [lintIssues])

  const lintWarnPages = useMemo(() => {
    const set = new Set<number>()
    for (const [page, level] of groupIssuesByPage(lintIssues)) if (level === "warn" && page > 0) set.add(page - 1)
    return set
  }, [lintIssues])
  // 用户反馈轮：可编辑性提示条（可关闭，sessionStorage 记忆）
  const [editHintDismissed, setEditHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("ppt_edit_hint_dismissed") === "1"
    } catch {
      return false
    }
  })
  // 应用内放映预览（按 deckTransition 播放页面切换动画）
  const [presenting, setPresenting] = useState(false)
  // R-008：素材库选图弹窗（插入当前页）+ 工具栏跳转素材库页
  const [pickerOpen, setPickerOpen] = useState(false)
  const navigate = useNavigate()
  return (
    <section className="py-6 pb-16">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-5 py-4 shadow-md animate-in fade-in duration-500">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            列表
          </button>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={deck.deck_name}
              onChange={(e) => onRename(e.target.value)}
              className="h-9 w-full max-w-md rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold text-foreground hover:border-border focus-visible:border-border focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <span className="badge-success shrink-0">
            {deckTypeLabel(deck.deck_type)}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {deck.audience || "未设对象"} · {deck.duration_min} 分钟 · {deck.slides.length} 页
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              切换动画
              <select
                value={deckTransition}
                onChange={(e) => setDeckTransition(e.target.value as DeckTransition)}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm text-card-foreground shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {(Object.keys(TRANSITION_LABEL) as DeckTransition[]).map((k) => (
                  <option key={k} value={k}>
                    {TRANSITION_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setPresenting(true)}
              disabled={!deck.slides.length}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-all hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Play className="h-4 w-4" />
              放映预览
            </button>
            <button
              type="button"
              onClick={onExportSpeech}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-all hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <FileText className="h-4 w-4" />
              导出讲稿 Word
            </button>
            <label
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-all hover:border-primary hover:text-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-primary"
              title="上传公司 .pptx/.potx 模板：提取主题色与字体，导出 PPT 时自动套用；整册纯文字页时按模板母版/版式保真导出（不上传则用内置商务版式）"
            >
              <Upload className="h-4 w-4" />
              {deckTemplateName ? "更换模板" : "上传公司模板"}
              <input
                type="file"
                accept=".pptx,.potx,application/vnd.openxmlformats-officedocument.presentationml.template,application/vnd.ms-powerpoint.template.macrofree.12"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUploadDeckTemplate(f)
                  e.target.value = ""
                }}
              />
            </label>
            {deckTemplateName ? (
              <button
                type="button"
                onClick={onClearDeckTemplate}
                title={`当前已套用模板「${deckTemplateName}」主题；点击改用内置商务版式`}
                className="max-w-[180px] truncate rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                模板：{deckTemplateName}
              </button>
            ) : null}
            {/* 2026-10-30 同稿换风格：内置配色预设（未上传公司模板时生效，只换风格不换内容） */}
            {!deckTemplateName && (
              <label
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-card-foreground shadow-sm transition-colors hover:border-primary"
                title="同一份内容换个配色再投：给院领导用深藏青，技术评审用科技蓝。只改配色与字体，不动内容"
              >
                <Palette className="h-3.5 w-3.5" />
                <select
                  value={deckThemePreset}
                  onChange={(e) => onSelectThemePreset?.(e.target.value)}
                  aria-label="配色方案"
                  className="bg-transparent text-xs outline-none"
                >
                  {DECK_THEME_PRESETS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => navigate("/materials")}
              title="管理架构图 / 系统截图 / 现场照 / 图库素材；PPT 配图优先命中素材库"
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Images className="h-4 w-4" />
              素材库
            </button>
            <button
              type="button"
              onClick={onExportPptx}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Download className="h-4 w-4" />
              导出 PPT 文件
            </button>
          </div>
        </div>
        <div className="mt-3 flex w-fit items-center gap-1 rounded-full bg-muted p-0.5">
          {(
            [
              { key: "edit" as const, label: "逐页编辑", icon: Pencil },
              { key: "preview" as const, label: "页面预览", icon: Eye },
              // 2026-10-30 补齐：素材来源 / 模板映射 / 页面检查 三面板合一
              { key: "check" as const, label: "检查与来源", icon: ShieldCheck },
            ]
          ).map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setEditorTab(tab.key)}
                className={
                  editorTab === tab.key
                    ? "flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1 text-sm font-medium text-primary shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    : "flex items-center gap-1.5 rounded-full px-3.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </header>

      {!editHintDismissed ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-card-foreground animate-in fade-in duration-300">
          <span>每页的标题、要点、讲稿在这里都能直接点击修改，改动自动保存；导出的 PPT 文件也是可编辑文本框（保护视图点「启用编辑」）。</span>
          <button
            type="button"
            onClick={() => {
              setEditHintDismissed(true)
              try {
                sessionStorage.setItem("ppt_edit_hint_dismissed", "1")
              } catch {
                /* 隐私模式静默降级 */
              }
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            知道了
          </button>
        </div>
      ) : null}

      {persistFailed ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-sm animate-in fade-in duration-300">
          <span>自动保存失败，改动暂存在本页，请检查网络后重试</span>
          <button
            type="button"
            onClick={onSaveNow}
            className="inline-flex items-center rounded-md border border-destructive/50 bg-card px-2.5 py-1 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            立即保存
          </button>
        </div>
      ) : null}

      {deckTemplateName && deckTemplateProbe ? (
        <TemplateFidelityPanel templateName={deckTemplateName} facts={deckTemplateProbe} slides={deck.slides} />
      ) : null}

      {blankSlideCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-card-foreground shadow-sm animate-in fade-in duration-300">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            有 {blankSlideCount} 页仅有标题、正文为空（多为逐页生成时该批未成功），可一键补全或在编辑器逐页「补全此页」。
          </span>
          <button
            type="button"
            onClick={onFillBlankSlides}
            disabled={fillingBlank}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/50 bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {fillingBlank ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {fillingBlank ? fillProgress || "补全中…" : "一键补全空白页"}
          </button>
        </div>
      ) : null}

      <DeckLintPanel
        issues={lintIssues}
        currentIndex={currentSlideIndex}
        onJumpToPage={(index) => {
          setCurrentSlideIndex(index)
          setEditorTab("edit")
        }}
      />

      {editorTab === "check" ? (
        // 2026-10-30 补齐：素材来源 / 模板映射 / 页面检查 三面板
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <BookOpen className="h-4 w-4 text-primary" />
              素材来源
            </h3>
            <DeckSourcePanel deck={deck} currentSlideIndex={currentSlideIndex} onJumpToPage={setCurrentSlideIndex} />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <LayoutTemplate className="h-4 w-4 text-primary" />
              模板映射
            </h3>
            <DeckTemplateMappingPanel
              templateName={deckTemplateName ?? null}
              outline={templateOutline ?? null}
              mapping={layoutMapping ?? {}}
              onMappingChange={onMappingChange ?? (() => {})}
              slideKinds={(deck.slides ?? []).map((s) => kindOfSlideForPanel(s))}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm lg:col-span-2">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              配图计划
              <span className="text-[10px] font-normal text-muted-foreground">（每页配什么图、为什么）</span>
            </h3>
            <DeckVisualPlanPanel
              plan={visualPlan}
              onJumpToPage={(index) => {
                setCurrentSlideIndex(index)
                setEditorTab("edit")
              }}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm lg:col-span-2">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ImageIcon className="h-4 w-4 text-primary" />
              渲染质检
              <span className="text-[10px] font-normal text-muted-foreground">
                （把 PPTX 渲染成图，看真实效果）
              </span>
            </h3>
            <DeckRenderCheckPanel
              report={renderReport?.report ?? null}
              thumbs={renderReport?.thumbs ?? []}
              checking={renderChecking}
              capability={renderCapability}
              onCheck={onCheckRenderQuality}
              onJumpToPage={(index) => {
                setCurrentSlideIndex(index)
                setEditorTab("edit")
              }}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm lg:col-span-2">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              页面检查
              {blockingCount > 0 && (
                <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
                  {blockingCount} 项严重问题会阻断导出
                </span>
              )}
            </h3>
            <DeckLintPanel
              issues={lintIssues}
              currentIndex={currentSlideIndex}
              onJumpToPage={(index) => {
                setCurrentSlideIndex(index)
                setEditorTab("edit")
              }}
            />
          </section>
        </div>
      ) : editorTab === "edit" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
          <SlideListNav
            slides={deck.slides}
            currentIndex={currentSlideIndex}
            onSelect={setCurrentSlideIndex}
            onAdd={addSlide}
            onDelete={deleteSlideAt}
            onMove={moveSlide}
            warnPages={lintWarnPages}
          />
          <SlideEditor
            slide={currentSlide}
            index={currentSlideIndex}
            total={deck.slides.length}
            slideAiKind={slideAiKind}
            persistFailed={persistFailed}
            onTitleChange={(value) => updateSlide({ title: value })}
            onPolishBullet={onPolishText ? (i, kind) => onPolishText(`bullet:${i}`, kind) : undefined}
            polishingKey={polishingKey}
            onLayoutChange={(layout) => updateSlide({ layout })}
            onBulletsChange={(value) =>
              updateSlide({
                bullets: value
                  .split("\n")
                  .map((b) => b.trim())
                  .filter(Boolean),
              })
            }
            onNotesChange={(value) => updateSlide({ notes: value })}
            onRefine={refineSlide}
            refinePickerSlot={refinePickerSlot}
            imagePool={imagePool}
            imageBusy={imageBusy}
            onLoadImagePool={onLoadImagePool}
            onAttachImageFromUrl={(url) => attachImageFromUrl(currentSlideIndex, url)}
            onAttachImageByPastedUrl={(url) => attachImageByPastedUrl(currentSlideIndex, url)}
            onUploadImage={(file) => uploadSlideImage(currentSlideIndex, file)}
            onClearImage={() => clearSlideImage(currentSlideIndex)}
            onApplyPoolImagesToHinted={applyPoolImagesToHinted}
            onSearchImage={(query) => searchAndAttachImage(currentSlideIndex, query)}
            autoFigureProvider={autoFigureProvider}
            setAutoFigureProvider={setAutoFigureProvider}
            figureBusyKind={slideFigureBusy.index === currentSlideIndex ? slideFigureBusy.kind : ""}
            onPickFromLibrary={() => {
              void reloadLocalMaterials?.()
              setPickerOpen(true)
            }}
          />
        </div>
      ) : (
        <div className="mt-5">
          <SlidePreviewGrid
            slides={deck.slides}
            deckName={deck.deck_name}
            onEdit={(index) => {
              setCurrentSlideIndex(index)
              setEditorTab("edit")
            }}
          />
        </div>
      )}

      {presenting && deck.slides.length ? (
        <DeckPresent
          slides={deck.slides}
          deckName={deck.deck_name}
          transition={deckTransition}
          startIndex={Math.min(currentSlideIndex, deck.slides.length - 1)}
          onClose={() => setPresenting(false)}
        />
      ) : null}

      <MaterialPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(materialId) => attachImageFromLibrary(currentSlideIndex, materialId)}
      />
    </section>
  )
}


/** 从 Slide 反推 kind（检查面板统计"本册用到的页面类型"用） */
function kindOfSlideForPanel(s: { kind?: string; chart?: unknown; kpi?: unknown[]; figures?: { type: string }[]; image?: string; layout?: string }): never {
  if (s.kind) return s.kind as never
  if (s.chart) return "chart" as never
  if (s.kpi?.length) return "kpi" as never
  if (s.figures?.some((f) => f.type === "table")) return "table" as never
  if (s.figures?.some((f) => f.type === "flow")) return "flow" as never
  if (s.figures?.some((f) => f.type === "architecture")) return "architecture" as never
  if (s.image) return "image" as never
  if (s.layout === "section") return "section" as never
  return "bullets" as never
}
