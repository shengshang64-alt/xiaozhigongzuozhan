import { useState, type ReactNode } from "react"
import { ArrowLeft, Download, Eye, FileText, Pencil } from "lucide-react"
import { deckTypeLabel, type DeckRecord, type RefineKind, type Slide } from "@/pages/PptQuote/pptQuoteTypes"
import { SlideListNav } from "./SlideListNav"
import { SlideEditor } from "./SlideEditor"
import { SlidePreviewGrid } from "./SlidePreviewGrid"

type DeckEditorWorkspaceProps = {
  deck: DeckRecord
  currentSlide: Slide | null
  currentSlideIndex: number
  setCurrentSlideIndex: (index: number) => void
  editorTab: "edit" | "preview"
  setEditorTab: (tab: "edit" | "preview") => void
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
  onExportSpeech: () => void
  /** 逐页编辑「改写 / 扩写 / 精简」旁的带入技能选择器（页面注入） */
  refinePickerSlot?: ReactNode
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
  refinePickerSlot,
}: DeckEditorWorkspaceProps) {
  // 用户反馈轮：可编辑性提示条（可关闭，sessionStorage 记忆）
  const [editHintDismissed, setEditHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("ppt_edit_hint_dismissed") === "1"
    } catch {
      return false
    }
  })
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
            <button
              type="button"
              onClick={onExportSpeech}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-all hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <FileText className="h-4 w-4" />
              导出讲稿 Word
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

      {editorTab === "edit" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
          <SlideListNav
            slides={deck.slides}
            currentIndex={currentSlideIndex}
            onSelect={setCurrentSlideIndex}
            onAdd={addSlide}
            onDelete={deleteSlideAt}
            onMove={moveSlide}
          />
          <SlideEditor
            slide={currentSlide}
            index={currentSlideIndex}
            total={deck.slides.length}
            slideAiKind={slideAiKind}
            persistFailed={persistFailed}
            onTitleChange={(value) => updateSlide({ title: value })}
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
    </section>
  )
}
