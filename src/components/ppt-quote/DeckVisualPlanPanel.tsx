// ---------------------------------------------------------------------------
// PPT 视觉计划面板（2026-10-30 补齐 6）
//
// 需求（§六.1）：「用户确认大纲和视觉计划后，才能逐页生成或搜索图片，
//   避免无效调用。」
//
// 这个面板把「AI 打算给每页配什么图、为什么这么判断」摊开给用户看：
//   · 全册视觉基调（决定整体风格统一）
//   · 每页 visualType + 决策理由（可审计，用户能看出判断对错）
//   · 按类型统计（一眼看出有没有"全是照片"或"全是插画"）
//
// 价值：配图是最容易被 AI 判断错的一环（架构页配大楼照、数字页配风景照）。
// 让判断**可见可改**，比追求"全自动"更实用。
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Image as ImageIcon, Sparkles } from "lucide-react"
import {
  VISUAL_TYPES,
  VISUAL_TYPE_LABEL,
  VISUAL_TONE_LABEL,
  groupByVisualType,
  type DeckVisualPlan,
  type VisualType,
} from "@/pages/PptQuote/deckVisualPlan"

const TYPE_TONE: Record<VisualType, string> = {
  none: "bg-muted text-muted-foreground",
  companyAsset: "bg-success/15 text-success",
  vectorDiagram: "bg-primary/15 text-primary",
  chart: "bg-primary/15 text-primary",
  aiIllustration: "bg-warning/15 text-warning",
  stockPhoto: "bg-foreground/10 text-foreground",
  productScreenshot: "bg-success/15 text-success",
}

export function DeckVisualPlanPanel({
  plan,
  onJumpToPage,
}: {
  plan: DeckVisualPlan | null
  onJumpToPage: (index: number) => void
}) {
  const [expanded, setExpanded] = useState<VisualType | null>(null)
  const grouped = useMemo(() => (plan ? groupByVisualType(plan) : null), [plan])

  if (!plan || !plan.slides.length) {
    return (
      <p className="text-xs text-muted-foreground">生成完成后这里会显示全册配图计划（每页配什么类型的图、为什么）。</p>
    )
  }

  const needAssets = VISUAL_TYPES.filter((vt) => vt === "stockPhoto" || vt === "aiIllustration").reduce(
    (n, vt) => n + plan.stats[vt],
    0,
  )

  return (
    <div className="space-y-2.5">
      {/* 基调与摘要 */}
      <div className="rounded-md bg-muted/50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {VISUAL_TONE_LABEL[plan.tone]}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{plan.summary}</p>
      </div>

      {/* 按类型统计（可展开看具体页） */}
      <div className="space-y-1">
        {VISUAL_TYPES.filter((vt) => plan.stats[vt] > 0).map((vt) => {
          const open = expanded === vt
          const items = grouped?.[vt] ?? []
          return (
            <div key={vt} className="rounded border border-border/60">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : vt)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              >
                {open ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_TONE[vt]}`}>
                  {VISUAL_TYPE_LABEL[vt]}
                </span>
                <span className="text-[11px] text-muted-foreground">{plan.stats[vt]} 页</span>
                {vt === "none" && (
                  <span className="ml-auto text-[10px] text-muted-foreground">内容本身有视觉，不配图</span>
                )}
              </button>
              {open && (
                <ul className="divide-y divide-border/40 border-t border-border/40">
                  {items.map((it) => (
                    <li key={it.page} className="flex items-start gap-2 px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => onJumpToPage(it.page - 1)}
                        className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-primary"
                        title="跳转到该页"
                      >
                        P{it.page}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-foreground">{it.purpose}</p>
                        <p className="text-[10px] leading-relaxed text-muted-foreground">{it.reason}</p>
                        {it.query && (
                          <p className="mt-0.5 text-[10px] text-primary">
                            检索词：{it.query}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* 提示：需要真实素材的页 */}
      {needAssets > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-[10px] leading-relaxed text-warning">
          <ImageIcon className="mt-0.5 h-3 w-3 shrink-0" />
          {needAssets} 页需要真实图片（实拍/AI 插画）。生成时会自动配图；
          其中涉及产品界面、Logo、资质的页**不会用 AI 生成**，需你上传原始素材。
        </p>
      )}

      {/* 缺素材提示 */}
      {plan.missingSources.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          第 {plan.missingSources.join("、")} 页缺可用素材，建议补充后重新配图。
        </p>
      )}
    </div>
  )
}
