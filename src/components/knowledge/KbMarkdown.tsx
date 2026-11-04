// 知识库共享 Markdown 渲染（阅读视图 + 问答回答共用），全部 token 配色。
import Markdown from "react-markdown"
import type { Components } from "react-markdown"
import { splitMarkdownTables } from "@/lib/markdownTables"
import type { MarkdownTable } from "@/lib/markdownTables"

const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-semibold tracking-tight text-foreground first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-lg font-semibold text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-foreground last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 rounded-r-md border-l-2 border-primary bg-muted/60 px-4 py-2 text-sm text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-md border border-border shadow-sm">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 text-left text-xs font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-muted-foreground">{children}</td>,
  code: ({ children, className }) => {
    const isBlock = (className ?? "").includes("language-")
    if (isBlock) {
      return <code className="block whitespace-pre-wrap break-words font-mono text-xs text-foreground">{children}</code>
    }
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-muted/70 p-3 shadow-inner">{children}</pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  hr: () => <hr className="my-4 border-border" />,
}

// 表格兜底渲染：本仓 react-markdown 没有 remark-gfm，GFM 表格会被当普通段落输出成 `|---|` 文本。
// splitMarkdownTables 先把表格块切出来，这里用原生 <table>（与 MD_COMPONENTS.table 同一套 token 配色）渲染。
function MarkdownTableBlock({ table }: { table: MarkdownTable }) {
  return (
    <div className="mb-3 overflow-x-auto rounded-md border border-border shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60">
          <tr className="border-b border-border">
            {table.header.map((cell, i) => (
              <th
                key={`h_${i}`}
                style={{ textAlign: table.align[i] ?? "left" }}
                className="border-r border-border px-3 py-2 text-xs font-semibold text-foreground last:border-r-0"
              >
                {cell || "\u00a0"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={`r_${ri}`} className="border-b border-border last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={`c_${ci}`}
                  style={{ textAlign: table.align[ci] ?? "left" }}
                  className="border-r border-border px-3 py-2 align-top text-muted-foreground last:border-r-0"
                >
                  {cell || "\u00a0"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function KbMarkdown({ content }: { content: string }) {
  const blocks = splitMarkdownTables(content)
  // 无表格时保持原渲染路径（DOM 结构与改动前完全一致，不影响既有测试与样式）
  if (!blocks.some((block) => block.kind === "table")) {
    return <Markdown components={MD_COMPONENTS}>{content}</Markdown>
  }
  return (
    <div>
      {blocks.map((block, i) =>
        block.kind === "table" ? (
          <MarkdownTableBlock key={`table_${i}`} table={block.table} />
        ) : (
          <Markdown key={`md_${i}`} components={MD_COMPONENTS}>
            {block.text}
          </Markdown>
        ),
      )}
    </div>
  )
}
