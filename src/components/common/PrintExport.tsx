import { Printer } from "lucide-react"

/**
 * 循环 11 块 B：打印 / 存为 PDF 回退方案（容器无服务端转 PDF 能力，docx 库不产 PDF）。
 * PrintExportButton 触发浏览器打印；PrintChapterFlow 是仅打印可见的只读正文渲染块
 *（屏幕态 hidden，打印态经 index.css 的 visibility 规则独占显示）。
 */
export function PrintExportButton({ title }: { title?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title={title ?? "调起浏览器打印，可在打印对话框选择「另存为 PDF」"}
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Printer className="h-4 w-4" />
      打印 / 存 PDF
    </button>
  )
}

export type PrintChapter = {
  title: string
  content: string
  sections?: string[]
}

/** 仅打印可见的章节正文流（章标题 + 小节/段落纯文本渲染，零 AI 零请求） */
export function PrintChapterFlow({ docTitle, chapters }: { docTitle: string; chapters: PrintChapter[] }) {
  return (
    <div data-print-only className="hidden">
      <h1 className="mb-6 text-center text-2xl font-bold">{docTitle}</h1>
      {chapters.map((ch, i) => (
        <section key={`${ch.title}-${i}`} className="mb-6">
          <h2 className="mb-2 text-lg font-bold">{`第${i + 1}章 ${ch.title}`}</h2>
          {(ch.content || "")
            .split("\n")
            .filter((l) => l.trim())
            .map((line, j) => {
              const t = line.trim()
              const isSub = (ch.sections ?? []).some((s) => t.startsWith(s)) || /^\d+[.、]\s*\S/.test(t) || /^\d+\.\d+/.test(t)
              return isSub ? (
                <h3 key={j} className="mb-1 mt-3 text-base font-semibold">
                  {t}
                </h3>
              ) : (
                <p key={j} className="mb-1 text-sm leading-relaxed">
                  {t}
                </p>
              )
            })}
        </section>
      ))}
    </div>
  )
}
