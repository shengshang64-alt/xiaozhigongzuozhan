// ---------------------------------------------------------------------------
// PPT 编辑器 · 素材来源面板（2026-10-30 补齐 4）
//
// 解决的问题：生成时已经把素材片段挂到了每页 sourceRefs，但编辑器里看不到，
// 用户无法核验「这页内容凭什么这么说」。
//
// 本面板让每页的引用可见：
//   · 该页引用了哪些素材的哪些片段
//   · 点开可看片段原文
//   · 无引用的页明确标注（提示可能是 AI 通用知识，需人工核对）
// ---------------------------------------------------------------------------

import { useState } from "react"
import { AlertTriangle, BookOpen, ChevronDown, ChevronRight, FileText } from "lucide-react"
import type { DeckRecord } from "@/pages/PptQuote/pptQuoteTypes"

export function DeckSourcePanel({
  deck,
  currentSlideIndex,
  onJumpToPage,
}: {
  deck: DeckRecord
  currentSlideIndex: number
  onJumpToPage: (index: number) => void
}) {
  const slides = deck.slides ?? []
  const [expanded, setExpanded] = useState<number | null>(currentSlideIndex)

  const withRefs = slides.filter((s) => s.sourceRefs?.length).length
  const totalRefs = slides.reduce((n, s) => n + (s.sourceRefs?.length ?? 0), 0)

  if (totalRefs === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          整册没有任何素材引用。这说明生成时没有使用参考素材，内容来自 AI 通用行业知识
          ——<span className="font-medium text-foreground">涉及数据、客户名称、政策条款的段落请人工核对</span>。
          建议下次新建时在第 2 步上传可研报告 / 历史方案 / 标书。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {withRefs}/{slides.length} 页有素材引用，共 {totalRefs} 处。
        点页码可跳转到该页，展开可看引用片段原文。
      </p>
      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {slides.map((s, i) => {
          const refs = s.sourceRefs ?? []
          const open = expanded === i
          return (
            <li key={s.id ?? i} className={i === currentSlideIndex ? "bg-primary/5" : ""}>
              <div className="flex items-start gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : i)}
                  disabled={!refs.length}
                  className="mt-0.5 shrink-0 text-muted-foreground disabled:opacity-30"
                  aria-label={open ? "收起" : "展开引用"}
                >
                  {refs.length ? open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" /> : <span className="inline-block h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => onJumpToPage(i)}
                  className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground hover:text-primary"
                  title="跳转到该页"
                >
                  {i + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground" title={s.title}>
                    {s.title || `第 ${i + 1} 页`}
                  </p>
                  {refs.length ? (
                    <p className="flex items-center gap-1 text-[10px] text-primary">
                      <BookOpen className="h-2.5 w-2.5" />
                      {refs.length} 处引用
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/70">无引用（通用知识）</p>
                  )}
                </div>
              </div>
              {open && refs.length ? (
                <ul className="space-y-1.5 px-2 pb-2 pl-11">
                  {refs.map((r) => (
                    <li key={r.chunkId} className="rounded bg-muted/50 p-2">
                      <p className="flex items-center gap-1 text-[10px] font-medium text-foreground">
                        <FileText className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{r.materialName || r.chunkId}</span>
                      </p>
                      <p className="mt-0.5 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{r.excerpt}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
