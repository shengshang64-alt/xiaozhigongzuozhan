// ---------------------------------------------------------------------------
// PPT 编辑器 · 模板映射面板（2026-10-30 补齐 4）
//
// 解决的问题：用户上传了公司模板、向导里也能调整映射，但进入编辑器后就看不到
// 当前用的是哪套版式、哪些页面类型没匹配上 —— 导出前无法确认"到底有没有用上模板"。
//
// 本面板在编辑器里常驻展示：
//   · 当前模板名与解析出的版式清单
//   · 11 类页面的映射状态（已匹配 / 未匹配）
//   · 可直接调整映射（改完立即影响下次导出）
//   · 明确提示哪些页没用上模板版式（不静默降级）
// ---------------------------------------------------------------------------

import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, LayoutTemplate, XCircle } from "lucide-react"
import { KIND_LABEL, SLIDE_KINDS, type SlideKindZ, type TemplateMappingZ } from "@/pages/PptQuote/deckSchema"
import { mappingSummary, resolveMapping, type TemplateOutline } from "@/pages/PptQuote/templateLayouts"

export function DeckTemplateMappingPanel({
  templateName,
  outline,
  mapping,
  onMappingChange,
  slideKinds,
}: {
  templateName: string | null
  outline: TemplateOutline | null
  mapping: TemplateMappingZ
  onMappingChange: (m: TemplateMappingZ) => void
  /** 当前 deck 每页实际用到的 kind（用于提示"这些页会用哪个版式"） */
  slideKinds?: SlideKindZ[]
}) {
  const resolution = useMemo(() => (outline ? resolveMapping(outline, mapping) : null), [outline, mapping])

  /** 本册实际用到的 kind 及其是否已匹配版式（只报用到的，不刷全 11 类） */
  const usedKinds = useMemo(() => {
    if (!slideKinds?.length) return []
    const set = new Set(slideKinds)
    return SLIDE_KINDS.filter((k) => set.has(k))
  }, [slideKinds])

  if (!templateName) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <LayoutTemplate className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          当前未使用公司模板，导出走内置商务版式。若要按公司母版/版式导出，
          请在「新建」第 3 步或工具栏「上传模板」选择 .pptx/.potx 文件。
        </p>
      </div>
    )
  }

  if (!outline || outline.failure) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-foreground">
          模板：<span className="font-medium">{templateName}</span>
        </p>
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {outline?.failure ?? "模板版式尚未解析"}
          。导出时只套用配色与字体，使用内置布局——这不等于「按公司模板生成」。
        </p>
      </div>
    )
  }

  const missing = resolution?.missing ?? []
  const usedMissing = usedKinds.filter((k) => missing.includes(k))

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-foreground">
          模板：<span className="font-medium">{templateName}</span>
        </p>
        <span className="badge-neutral text-[10px]">
          {outline.layouts.length} 个版式 · {outline.masterCount} 个母版
        </span>
      </div>

      {/* 本册实际用到的 kind 的匹配状态（最有信息量的部分） */}
      {usedKinds.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">本册用到的页面类型</p>
          <ul className="space-y-0.5">
            {usedKinds.map((k) => {
              const layout = resolution?.resolved[k]
              const count = slideKinds?.filter((x) => x === k).length ?? 0
              return (
                <li key={k} className="flex items-center gap-1.5 text-[11px]">
                  {layout ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-warning" />
                  )}
                  <span className="text-foreground">{KIND_LABEL[k]}</span>
                  <span className="text-muted-foreground">×{count}</span>
                  <span className="ml-auto truncate text-muted-foreground" title={layout?.name}>
                    {layout ? `→ ${layout.name}` : "未匹配版式"}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {usedMissing.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          本册有 {usedMissing.length} 类页面未匹配到模板版式，导出时会用通用版式，外观可能与其它页不一致。
        </p>
      )}

      {/* 映射调整 */}
      <details className="group">
        <summary className="cursor-pointer text-[11px] font-medium text-primary hover:underline">
          调整页面类型 → 版式映射
        </summary>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {SLIDE_KINDS.map((k) => {
            const cur = mapping[k] ?? ""
            return (
              <label key={k} className="flex items-center gap-1.5">
                <span className="w-12 shrink-0 text-[10px] text-muted-foreground">{KIND_LABEL[k]}</span>
                <select
                  value={cur}
                  onChange={(e) => {
                    const next: TemplateMappingZ = { ...mapping }
                    if (e.target.value) next[k] = e.target.value
                    else delete next[k]
                    onMappingChange(next)
                  }}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground"
                  aria-label={`${KIND_LABEL[k]} 版式`}
                >
                  <option value="">（未映射）</option>
                  {outline.layouts.map((l) => (
                    <option key={l.path} value={l.layoutId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {mappingSummary(outline, mapping).slice(0, 120)}
        </p>
      </details>
    </div>
  )
}
