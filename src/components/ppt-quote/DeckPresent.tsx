import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react"
import type { DeckTransition, Slide } from "@/pages/PptQuote/pptQuoteTypes"
import { BidFigure } from "@/components/bid-workspace/BidFigure"

// ---------------------------------------------------------------------------
// DeckPresent — 应用内放映预览
// 全屏一页一页播放整份 deck，并按 deck 级「切换动画」(deckTransition) 用 CSS 关键帧
// 播放淡出/推入/擦除/分割效果，让导出前就能在应用里看到页面切换动画的实际观感。
// 逻辑：切页时给当前页容器换 key 触发重挂载，从而重放进入动画。
// ---------------------------------------------------------------------------

const KEYFRAMES = `
@keyframes deck-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes deck-push { from { transform: translateX(6%) ; opacity: .3 } to { transform: translateX(0); opacity: 1 } }
@keyframes deck-wipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes deck-split { from { transform: scaleY(.6); opacity: .2 } to { transform: scaleY(1); opacity: 1 } }
`

const EASE = "cubic-bezier(.22,.61,.36,1)"

function enterStyle(transition: DeckTransition): React.CSSProperties {
  const dur = "0.5s"
  switch (transition) {
    case "fade":
      return { animation: `deck-fade ${dur} ${EASE} both` }
    case "push":
      return { animation: `deck-push ${dur} ${EASE} both` }
    case "wipe":
      return { animation: `deck-wipe ${dur} ${EASE} both` }
    case "split":
      return { animation: `deck-split ${dur} ${EASE} both`, transformOrigin: "top" }
    default:
      return {}
  }
}

/** 单页版式渲染（近似导出效果：标题 + 要点 + 图示/配图 / KPI / 图表占位） */
function SlideView({ slide, deckName, index, total }: { slide: Slide; deckName: string; index: number; total: number }) {
  const isSection = slide.layout === "section"
  const figure = slide.figures?.[0]
  const hasSideVisual = Boolean(slide.image || figure)
  const sideRight = slide.layout !== "image-left"
  const kpi = slide.kpi ?? []
  const chart = slide.chart && (slide.chart.categories?.length ?? 0) > 0 ? slide.chart : null

  if (isSection) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-primary px-10 text-center text-primary-foreground">
        <h2 className="text-4xl font-bold leading-tight">{slide.title || "—"}</h2>
        {slide.bullets.length ? <p className="mt-4 text-xl opacity-90">{slide.bullets.join("　·　")}</p> : null}
      </div>
    )
  }

  const bulletsNode = (
    <ul className="space-y-3 text-2xl leading-relaxed text-foreground">
      {(slide.bullets.length ? slide.bullets : [slide.title || "—"]).map((b, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  )

  const sideNode = (
    <div className="flex items-center justify-center">
      {figure ? (
        <div className="w-full max-w-md [&>figure]:text-base">
          <BidFigure spec={figure} />
        </div>
      ) : slide.image ? (
        <img src={slide.image} alt={slide.imageAlt || "配图"} className="max-h-full w-full rounded-lg object-cover shadow-md" />
      ) : (
        <ImageOff className="h-10 w-10 text-muted-foreground/40" />
      )}
    </div>
  )

  return (
    <div className="flex h-full w-full flex-col bg-background px-12 py-9">
      <h2 className="mb-6 text-4xl font-bold text-foreground">{slide.title || "—"}</h2>
      {kpi.length ? (
        <div className="mb-6 flex flex-1 items-center gap-6">
          {kpi.slice(0, 4).map((k, i) => (
            <div key={i} className="flex-1 rounded-xl border border-border bg-muted/40 p-6 text-center">
              <p className="text-5xl font-bold text-primary">{k.value}</p>
              <p className="mt-2 text-lg text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      ) : chart ? (
        <div className="mb-6 flex flex-1 flex-col justify-center gap-3 rounded-xl border border-border bg-muted/30 p-6">
          <p className="text-lg font-semibold text-foreground">{chart.title || "数据图表"}</p>
          <div className="flex items-end gap-4" style={{ height: 200 }}>
            {chart.categories.slice(0, 8).map((c, i) => {
              const val = chart.series?.[0]?.data?.[i] ?? 0
              const max = Math.max(1, ...(chart.series ?? []).flatMap((s) => s.data))
              return (
                <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-sm text-muted-foreground">{val}</span>
                  <div className="w-full rounded-t bg-primary/70" style={{ height: `${(val / max) * 160}px` }} />
                  <span className="max-w-full truncate text-xs text-muted-foreground">{c}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : hasSideVisual ? (
        <div className={`flex flex-1 items-center gap-10 ${sideRight ? "" : "flex-row-reverse"}`}>
          <div className="flex-1">{bulletsNode}</div>
          <div className="w-2/5 flex-shrink-0 self-stretch">{sideNode}</div>
        </div>
      ) : (
        <div className="flex flex-1 items-center">{bulletsNode}</div>
      )}
      <footer className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm text-muted-foreground">
        <span className="truncate">{deckName}</span>
        <span>
          {index + 1} / {total}
        </span>
      </footer>
    </div>
  )
}

export function DeckPresent({
  slides,
  deckName,
  transition,
  startIndex = 0,
  onClose,
}: {
  slides: Slide[]
  deckName: string
  transition: DeckTransition
  startIndex?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, slides.length - 1)))
  const go = useCallback(
    (delta: number) => setIndex((prev) => Math.min(Math.max(0, prev + delta), slides.length - 1)),
    [slides.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") go(1)
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, onClose])

  const current = slides[index]
  if (!current) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm">
      <style>{KEYFRAMES}</style>
      <div className="flex shrink-0 items-center justify-between px-5 py-3 text-white/90">
        <span className="text-sm font-medium">
          放映预览 · {deckName}
          {transition !== "none" ? <span className="ml-2 text-xs text-white/60">（切换动画播放中）</span> : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="h-4 w-4" />
          退出放映
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
        <div className="relative flex aspect-video w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-2xl">
          {/* key={index} 触发重挂载，重放进入动画 */}
          <div key={index} className="h-full w-full" style={enterStyle(transition)}>
            <SlideView slide={current} deckName={deckName} index={index} total={slides.length} />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-4 pb-5 text-white">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="上一页"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm tabular-nums text-white/80">
          {index + 1} / {slides.length}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index >= slides.length - 1}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="下一页"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
