// ---------------------------------------------------------------------------
// PPT 渲染质检面板（2026-10-30 补齐 5）
//
// 需求：「导出后将 PPTX 渲染为页面图片，检查实际效果；只检查 JSON 字数不算完成验收。」
//
// 这个面板把「真实渲染出来的样子」摆给用户看：
//   · 每页缩略图（这就是导出后客户看到的效果）
//   · 有墨率（判断是否偏空）
//   · 严重问题清单（空页等，会阻断导出）
//
// 设计取舍：不做"一键修复"——渲染问题的修法因页而异（补内容/拆页/换版式），
// 强行自动修只会更糟。这里只负责**如实呈现 + 定位到页**。
// ---------------------------------------------------------------------------

import { AlertTriangle, CheckCircle2, Image as ImageIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RenderReport } from "@/pages/PptQuote/deckRenderCheck"

export type RenderThumb = { page: number; dataUrl: string; inkRatio: number }

export function DeckRenderCheckPanel({
  report,
  thumbs,
  checking,
  capability,
  onCheck,
  onJumpToPage,
}: {
  report: RenderReport | null
  thumbs: RenderThumb[]
  checking: boolean
  capability: { ok: boolean; hint: string } | null
  onCheck: () => void
  onJumpToPage: (index: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCheck} disabled={checking} className="gap-1.5">
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {checking ? "渲染检查中…" : report ? "重新渲染检查" : "渲染检查实际效果"}
        </Button>
        {capability && !capability.ok && (
          <span className="text-[11px] text-warning">{capability.hint}</span>
        )}
        {report && (
          <span
            className={
              report.pass
                ? "flex items-center gap-1 text-[11px] text-success"
                : "flex items-center gap-1 text-[11px] text-destructive"
            }
          >
            {report.pass ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {report.pageCount} 页 · 严重 {report.errorCount} · 注意 {report.warnCount}
          </span>
        )}
      </div>

      {!report && !checking && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          把导出的 PPTX 用 LibreOffice 渲染成页面图片，检查实际排版效果（空白页、大片留白、内容溢出）。
          <br />
          结构检查（JSON 层）无法发现版面问题，只有渲染才能看见——这是导出前的最后一道关。
        </p>
      )}

      {/* 问题清单 */}
      {report && report.issues.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {report.issues.map((it, idx) => (
            <li key={`${it.page}-${it.code}-${idx}`} className="flex items-start gap-2 px-2.5 py-1.5">
              <span
                className={
                  it.severity === "error"
                    ? "mt-0.5 shrink-0 rounded bg-destructive px-1 py-0.5 text-[9px] font-medium text-destructive-foreground"
                    : "mt-0.5 shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground"
                }
              >
                {it.severity === "error" ? "严重" : "注意"}
              </span>
              <button
                type="button"
                onClick={() => onJumpToPage(it.page - 1)}
                className="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-primary"
                title="跳转到该页"
              >
                P{it.page}
              </button>
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground">{it.message}</span>
            </li>
          ))}
        </ul>
      )}

      {report && report.issues.length === 0 && (
        <p className="flex items-center gap-1.5 rounded-md bg-success/5 px-3 py-2 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          已渲染检查 {report.pageCount} 页，未发现版面问题
        </p>
      )}

      {/* 缩略图：真实渲染效果 */}
      {thumbs.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">导出效果预览（渲染图）</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {thumbs.map((t) => {
              const blank = report?.issues.some((i) => i.page === t.page && i.code === "blank_page_render")
              return (
                <button
                  key={t.page}
                  type="button"
                  onClick={() => onJumpToPage(t.page - 1)}
                  className={
                    blank
                      ? "group relative overflow-hidden rounded border-2 border-destructive"
                      : "group relative overflow-hidden rounded border border-border hover:border-primary"
                  }
                  title={`第 ${t.page} 页 · 有墨 ${(t.inkRatio * 100).toFixed(2)}%`}
                >
                  <img src={t.dataUrl} alt={`第 ${t.page} 页渲染效果`} className="w-full" loading="lazy" />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white">{t.page}</span>
                  {blank && (
                    <span className="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-[9px] text-destructive-foreground">
                      空白页
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
