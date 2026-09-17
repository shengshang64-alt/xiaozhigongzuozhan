// 引用溯源（轮次 D-4）：按 [资料N] 标记切分回答文本，标记渲染为上标 chip，
// hover/focus 出摘录卡（标题 + 可见范围 + 片段前 200 字），点击跳原文。
import { BookMarked, ExternalLink } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { KbMarkdown } from "@/components/knowledge/KbMarkdown"
import type { QaCitation } from "@/pages/Knowledge/useKnowledge"

/** 回答里是否带 [资料N] 内联引用标记（无标记走旧版底部 chips 兼容渲染） */
export function hasCitationMarkers(content: string): boolean {
  return /\[资料\d+\]/.test(content ?? "")
}

type CitedAnswerProps = {
  content: string
  citations: QaCitation[]
  onOpenCitation: (citation: QaCitation) => void
}

function CitationChip({
  index,
  citation,
  onOpenCitation,
}: {
  index: number
  citation: QaCitation
  onOpenCitation: (c: QaCitation) => void
}) {
  return (
    <HoverCard openDelay={120} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => onOpenCitation(citation)}
          aria-label={`资料${index}：${citation.title}，点击查看原文`}
          className="mx-0.5 inline-block rounded bg-primary/10 px-1 align-super text-[10px] font-semibold leading-4 text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {index}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72 space-y-2">
        <p className="flex items-start gap-1.5 text-sm font-semibold text-foreground">
          <BookMarked className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 break-all">《{citation.title}》</span>
          <span
            className={`shrink-0 rounded-full px-1.5 text-xs font-normal ${
              citation.visibility === "personal"
                ? "bg-muted text-muted-foreground"
                : "bg-primary/10 text-primary"
            }`}
          >
            {citation.visibility === "personal" ? "个人" : "团队"}
          </span>
        </p>
        <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
          {(citation.snippet ?? "").slice(0, 200)}
        </p>
        <button
          type="button"
          onClick={() => onOpenCitation(citation)}
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ExternalLink className="h-3 w-3" />
          查看原文 →
        </button>
      </HoverCardContent>
    </HoverCard>
  )
}

export function CitedAnswer({ content, citations, onOpenCitation }: CitedAnswerProps) {
  const src = content ?? ""
  const segments: { kind: "text" | "chip"; text?: string; markerIndex?: number }[] = []
  let last = 0
  for (const m of src.matchAll(/\[资料(\d+)\]/g)) {
    const num = Number(m[1])
    if (m.index === undefined || num < 1 || num > citations.length) continue // 序号越界：原样输出文本不渲染 chip
    const before = src.slice(last, m.index)
    if (before) segments.push({ kind: "text", text: before })
    segments.push({ kind: "chip", markerIndex: num })
    last = m.index + m[0].length
  }
  if (last < src.length) segments.push({ kind: "text", text: src.slice(last) })

  return (
    <div>
      {segments.map((seg, i) =>
        seg.kind === "chip" && seg.markerIndex ? (
          <CitationChip
            key={`chip_${i}`}
            index={seg.markerIndex}
            citation={citations[seg.markerIndex - 1]}
            onOpenCitation={onOpenCitation}
          />
        ) : (
          <KbMarkdown key={`txt_${i}`} content={seg.text ?? ""} />
        ),
      )}
    </div>
  )
}
