// ---------------------------------------------------------------------------
// PPT 大纲确认面板（2026-10-30 补齐 3-d，四步向导第 4 步）
//
// 需求：「用户确认/编辑大纲后，才能逐页生成或搜索图片，避免无效调用。」
//
// 这个面板让用户在**花钱逐页生成之前**看到并修改：
//   · 每页标题（必须是结论句）
//   · 页面类型 kind（决定用哪个渲染器与模板版式）
//   · 页面顺序（上下移动 / 删除）
//   · 每页引用了哪些素材（可查看原文片段）
//
// 关键取舍：**不在这里做内容编辑**——那属于生成后的「逐页精修」阶段。
// 大纲阶段只解决"结构对不对"，这正是最高杠杆的干预点（结构错则整册返工）。
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, FileText, Loader2, Sparkles, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KIND_LABEL, SLIDE_KINDS, type SlideKindZ } from "@/pages/PptQuote/deckSchema"
import { ROLE_LABEL_CN } from "@/pages/PptQuote/deckSchema"
import type { SlidePlan } from "@/pages/PptQuote/pptQuoteTypes"

export function DeckOutlineStep({
  outline,
  onChange,
  onGenerate,
  onBack,
  generating,
  progress,
}: {
  outline: SlidePlan[]
  onChange: (next: SlidePlan[]) => void
  onGenerate: () => void
  onBack: () => void
  generating: boolean
  progress: string
}) {
  const [expanded, setExpanded] = useState<number | null>(null)

  const stats = useMemo(() => {
    const kinds = new Map<string, number>()
    for (const p of outline) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1)
    const withRefs = outline.filter((p) => p.sourceRefs?.length).length
    // 名词短语标题（缺结论感）——给个轻提示，不阻断
    const nounish = outline.filter((p) => /(背景|概述|简介|介绍|方案|架构|总结|说明|现状|需求)$/.test(p.title)).length
    return { kinds: Array.from(kinds.entries()), withRefs, nounish }
  }, [outline])

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= outline.length) return
    const next = outline.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  function remove(i: number) {
    if (outline.length <= 1) return
    onChange(outline.filter((_, k) => k !== i))
  }

  function setTitle(i: number, title: string) {
    const next = outline.slice()
    next[i] = { ...next[i], title }
    onChange(next)
  }

  function setKind(i: number, kind: SlideKindZ) {
    const next = outline.slice()
    next[i] = { ...next[i], kind }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {/* 概览 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">共 {outline.length} 页</span>
        {stats.kinds.map(([k, n]) => (
          <span key={k}>
            {KIND_LABEL[k as SlideKindZ] ?? k} {n}
          </span>
        ))}
        {stats.withRefs > 0 && (
          <span className="flex items-center gap-1 text-primary">
            <BookOpen className="h-3 w-3" />
            {stats.withRefs} 页有素材引用
          </span>
        )}
      </div>

      {stats.nounish > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          有 {stats.nounish} 页标题偏名词标签（如「方案介绍」）。建议改成结论句，听众 3 秒就能读懂观点。
        </p>
      )}

      {/* 页面列表 */}
      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {outline.map((p, i) => (
          <li key={p.id || i} className="px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="mt-1 w-6 shrink-0 text-center text-[11px] font-mono text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  value={p.title}
                  onChange={(e) => setTitle(i, e.target.value)}
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-foreground hover:border-border focus:border-primary focus:bg-background focus-visible:outline-none"
                  aria-label={`第 ${i + 1} 页标题`}
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={p.kind}
                    onChange={(e) => setKind(i, e.target.value as SlideKindZ)}
                    className="rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground"
                    aria-label={`第 ${i + 1} 页类型`}
                  >
                    {SLIDE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  {p.role && <span className="badge-neutral text-[10px]">{ROLE_LABEL_CN[p.role]}</span>}
                  {p.sourceRefs?.length ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className="flex items-center gap-1 rounded px-1 text-[10px] text-primary hover:bg-primary/10"
                    >
                      <BookOpen className="h-3 w-3" />
                      引用 {p.sourceRefs.length} 处
                    </button>
                  ) : null}
                  {p.intent && <span className="truncate text-[10px] text-muted-foreground">{p.intent}</span>}
                </div>
                {/* 素材引用展开 */}
                {expanded === i && p.sourceRefs?.length ? (
                  <ul className="mt-1 space-y-1 rounded bg-muted/50 p-2">
                    {p.sourceRefs.map((r) => (
                      <li key={r.chunkId} className="text-[10px] leading-relaxed text-muted-foreground">
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <FileText className="h-2.5 w-2.5" />
                          {r.materialName || r.chunkId}
                        </span>
                        <span className="line-clamp-2">{r.excerpt}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {/* 操作 */}
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  aria-label="上移"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === outline.length - 1}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  aria-label="下移"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={outline.length <= 1}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                  aria-label="删除该页"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* 操作区 */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={generating}>
          返回修改
        </Button>
        <Button type="button" size="sm" onClick={onGenerate} disabled={generating || !outline.length} className="gap-1.5">
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? "生成中…" : `确认大纲，生成 ${outline.length} 页内容`}
        </Button>
        {generating && progress && <span className="text-[11px] text-muted-foreground">{progress}</span>}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        确认后才会调用 AI 逐页填充内容（按实际 token 扣费）。页面类型决定用哪个渲染器与模板版式，
        内容不适合图表时建议改回「要点页」，避免为了配图而编造数据。
      </p>
    </div>
  )
}
