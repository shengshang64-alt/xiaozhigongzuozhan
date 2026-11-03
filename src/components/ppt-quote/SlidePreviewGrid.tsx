import { useMemo } from "react"
import { Eye, Image as ImageIcon, Network, Pencil } from "lucide-react"
import { SLIDE_ROLE_LABEL, type Slide, type SlideRole } from "@/pages/PptQuote/pptQuoteTypes"
import { buildFigureSvg, tokenPalette } from "@/components/bid-workspace/BidFigure"

type SlidePreviewGridProps = {
  slides: Slide[]
  deckName: string
  onEdit: (index: number) => void
}

/** 图示缩略：把首个结构化图示渲染为内联 SVG 预览 */
function FigureThumb({ slide }: { slide: Slide }) {
  const markup = useMemo(
    () => (slide.figures?.[0] ? buildFigureSvg(slide.figures[0], tokenPalette()) : ""),
    [slide.figures],
  )
  if (!markup) return null
  return <span className="block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: markup }} />
}

const LAYOUT_LABEL: Record<string, string> = {
  auto: "自动",
  bullets: "纯文字",
  section: "章节页",
  "image-right": "文左图右",
  "image-left": "图左文右",
  banner: "横幅图",
  chart: "数据图表",
  kpi: "数字亮点",
}

/** 叙事角色徽章配色（与导出色语义一致：痛点赭石/主张蓝/价值绿/计划紫） */
const ROLE_TONE: Record<SlideRole, string> = {
  context: "border-slate-400/40 bg-slate-500/10 text-slate-600",
  problem: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  question: "border-amber-600/40 bg-amber-600/10 text-amber-700",
  answer: "border-primary/40 bg-primary/10 text-primary",
  evidence: "border-teal-500/40 bg-teal-500/10 text-teal-700",
  approach: "border-primary/40 bg-primary/10 text-primary",
  plan: "border-violet-500/40 bg-violet-500/10 text-violet-700",
  value: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  close: "border-slate-400/40 bg-slate-500/10 text-slate-600",
}

function visualBadge(slide: Slide): { text: string; tone: string } | null {
  if (slide.chart) return { text: `图表 · ${slide.chart.type}`, tone: "border-sky-500/40 bg-sky-500/10 text-sky-600" }
  if (slide.kpi?.length) return { text: `数字亮点 · ${slide.kpi.length}`, tone: "border-violet-500/40 bg-violet-500/10 text-violet-600" }
  if (slide.image) return { text: "已配图", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" }
  if (slide.figures?.length) return { text: `AI 图示 · ${slide.figures[0].type === "architecture" ? "架构图" : slide.figures[0].type === "flow" ? "流程图" : "界面示意"}`, tone: "border-teal-500/40 bg-teal-500/10 text-teal-600" }
  const layout = slide.layout && slide.layout !== "auto" && slide.layout !== "bullets" ? slide.layout : ""
  if (layout) return { text: LAYOUT_LABEL[layout] ?? layout, tone: "border-amber-500/40 bg-amber-500/10 text-amber-600" }
  return null
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
        {slides.map((slide, index) => {
          const badge = visualBadge(slide)
          return (
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
                {/* 2026-10-30 叙事角色徽章：让全册的 SCQA 推进一目了然 */}
                {slide.role ? (
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${ROLE_TONE[slide.role] ?? "border-border bg-muted text-muted-foreground"}`}
                  >
                    {SLIDE_ROLE_LABEL[slide.role]}
                  </span>
                ) : null}
                {badge ? (
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.tone}`}>{badge.text}</span>
                ) : null}
                <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-background px-2 py-0.5 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Pencil className="h-3 w-3" />
                  点击编辑
                </span>
              </span>
            </span>
            {slide.image ? (
              <span className="block px-4 pt-3">
                <span className="relative flex h-20 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                  <img src={slide.image} alt={slide.imageAlt || "配图"} loading="lazy" className="h-full w-full object-cover" />
                  <ImageIcon className="absolute bottom-1 right-1 h-3 w-3 rounded bg-background/70 p-0.5 text-primary" />
                </span>
              </span>
            ) : slide.figures?.length ? (
              <span className="block px-4 pt-3">
                <span className="relative flex h-24 items-center justify-center overflow-hidden rounded-md border border-border bg-background p-1">
                  <FigureThumb slide={slide} />
                  <Network className="absolute bottom-1 right-1 h-3 w-3 rounded bg-background/70 p-0.5 text-teal-600" />
                </span>
              </span>
            ) : null}
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
          )
        })}
      </div>
    </section>
  )
}
