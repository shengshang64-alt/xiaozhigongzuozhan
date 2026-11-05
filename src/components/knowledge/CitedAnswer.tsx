// 引用溯源（轮次 D-4）：按 [资料N] 标记切分回答文本，标记渲染为上标 chip，
// hover/focus 出摘录卡（标题 + 可见范围 + 片段前 200 字），点击跳原文。
//
// 阶段 1 · 包 3（知识问答 · 问答 Markdown 表可渲染）修复：
//   原实现直接在**整篇原文**上按 `[资料N]` 切段，再对每段分别做 Markdown 渲染。
//   Markdown 表格一旦在单元格里带引用标记（`| HIS | 300 万 [资料1] |`），这句就被切成
//   「…300 万 」「chip」「 |」三段，表格的三个部分各自成了一个不完整片段：
//   实测结果——表被切断，第二行数据整行漏到表格外，界面上留下原始 `|\n| EMR | 200 万` 文本，
//   `<tr>` 从应有 3 行掉到 2 行。知识问答最常见的输出恰恰是「表格 + 逐格引用」，用户看到的就是坏表。
//
//   现口径：**先按块级表格切分原文**（复用 renderedTables 的同一解析器），
//    · 表格块：整块交给 KbMarkdown 渲染（保持 `<table>` 结构完整），块内 `[资料N]`
//      在渲染层折成上标数字并以 `title` 保留来源（表格单元格是纯文本，不能塞交互组件，
//      塞了会把 `<td>` 撑坏；折成上标数字 + 悬停可读的 title 是这里唯一不破坏表格的形态）；
//    · 非表格块：维持原行为（逐段切引用 + 挂 CitationChip 交互 chip）。
import { BookMarked, ExternalLink } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { KbMarkdown } from "@/components/knowledge/KbMarkdown"
import { redactPii } from "@/lib/piiRedact"
import { splitMarkdownTables } from "@/lib/markdownTables"
import { foldCitationMarkersInTable, tableSourceLineOf } from "@/components/knowledge/citationMarkers"
import type { QaCitation } from "@/pages/Knowledge/useKnowledge"

// 引用标记相关的纯函数都在 ./citationMarkers；
// 本文件只导出组件（react-refresh/only-export-components 约束），不做任何函数重导出。
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
          {/* P1（2026-10-24）：悬浮摘录卡同 QaDrawer 引用列表，历史原始片段展示前强制 PII 掩码 */}
          {redactPii(citation.snippet ?? "").slice(0, 200)}
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

/** 非表格文本块：按 [资料N] 切段，标记渲染成交互 chip（原有行为，原样保留） */
function CitationText({
  text,
  citations,
  onOpenCitation,
}: {
  text: string
  citations: QaCitation[]
  onOpenCitation: (citation: QaCitation) => void
}) {
  const src = text ?? ""
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
    <>
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
    </>
  )
}

export function CitedAnswer({ content, citations, onOpenCitation }: CitedAnswerProps) {
  const src = content ?? ""
  // 先切块级表格：表格必须整块渲染，否则单元格里的 [资料N] 会把表格切断（见文件头注释）
  const blocks = splitMarkdownTables(src)
  return (
    <div>
      {blocks.map((block, i) => {
        if (block.kind === "table") {
          // 还原成标准 GFM 文本交给 KbMarkdown —— 保证 <table> 结构完整、行数正确
          const gfm = [
            `| ${block.table.header.join(" | ")} |`,
            `| ${block.table.align.map((a) => (a === "center" ? ":--:" : a === "right" ? "--:" : ":--")).join(" | ")} |`,
            ...block.table.rows.map((r) => `| ${r.join(" | ")} |`),
          ].join("\n")
          const source = tableSourceLineOf(gfm, citations)
          return (
            <div key={`table_${i}`}>
              <KbMarkdown content={foldCitationMarkersInTable(gfm, citations)} />
              {source ? (
                <p className="mb-3 -mt-1 text-xs text-muted-foreground">{source}</p>
              ) : null}
            </div>
          )
        }
        return (
          <CitationText
            key={`md_${i}`}
            text={block.text}
            citations={citations}
            onOpenCitation={onOpenCitation}
          />
        )
      })}
    </div>
  )
}
