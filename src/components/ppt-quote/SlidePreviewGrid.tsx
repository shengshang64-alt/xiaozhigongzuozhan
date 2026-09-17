import { Eye, Pencil } from "lucide-react"
import type { Slide } from "@/pages/PptQuote/pptQuoteTypes"

type SlidePreviewGridProps = {
  slides: Slide[]
  deckName: string
  onEdit: (index: number) => void
}

export function SlidePreviewGrid({ slides, deckName, onEdit }: SlidePreviewGridProps) {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Eye className="h-4 w-4 text-primary" />
          页面预览
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
            共 {slides.length} 页
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">预览仅供参考，点击任意页卡片进入编辑，改标题、要点、讲稿</p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => onEdit(index)}
            className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left shadow-md transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="block border-b border-border bg-muted/50 px-4 py-2.5">
              <span className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="truncate text-sm font-semibold text-foreground">{slide.title || "（未命名页）"}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-background px-2 py-0.5 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Pencil className="h-3 w-3" />
                  点击编辑
                </span>
              </span>
            </span>
            <span className="block flex-1 space-y-1.5 px-4 py-3">
              {(slide.bullets.length ? slide.bullets : ["—"]).slice(0, 5).map((bullet, bi) => (
                <span key={bi} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="line-clamp-2">{bullet}</span>
                </span>
              ))}
              {slide.bullets.length > 5 && (
                <span className="block text-xs text-muted-foreground/70">…等 {slide.bullets.length} 条要点</span>
              )}
            </span>
            {slide.notes && (
              <span className="block border-t border-dashed border-border px-4 py-2">
                <span className="line-clamp-1 text-xs text-muted-foreground">讲稿：{slide.notes}</span>
              </span>
            )}
            <span className="block bg-muted/30 px-4 py-1.5 text-right text-xs text-muted-foreground">
              {deckName} · {index + 1} / {slides.length}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
