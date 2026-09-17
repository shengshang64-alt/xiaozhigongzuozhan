import { useEffect, useRef } from "react"
import Markdown from "react-markdown"
import type { Components } from "react-markdown"
import { toast } from "sonner"
import { Bot, Copy, Loader2, RotateCcw, Search, Sparkles, X } from "lucide-react"
import type { ChatMsg } from "@/lib/assistantCore"

const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold text-foreground first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-sm font-bold text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary pl-3 text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">{children}</pre>
  ),
  code: ({ className, children }) => {
    const isBlock = (className ?? "").includes("language-")
    if (isBlock) return <code className={`${className ?? ""} font-mono text-xs`}>{children}</code>
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-secondary/50 px-2 py-1.5 text-left font-semibold text-secondary-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-3 border-border" />,
}

const QUICK_SAMPLES = [
  "我手上哪些商机最久没跟进？",
  "帮我总结最近的中标情报",
  "给我列一下进行中的项目和进度",
]

type ChatStreamProps = {
  messages: ChatMsg[]
  sendState: "idle" | "sending" | "fetching"
  fetchBadge: string
  compact?: boolean
  onQuickAsk?: (text: string) => void
  /** A2-9：失败消息的「重试」回调，缺省时不渲染重试按钮 */
  onRetry?: () => void
  /** B1：失败消息的单条「×」消除回调，缺省时不渲染消除按钮 */
  onDismiss?: (msgId: string) => void
}

export function ChatStream({ messages, sendState, fetchBadge, compact, onQuickAsk, onRetry, onDismiss }: ChatStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, sendState, fetchBadge])

  const busy = sendState !== "idle"

  return (
    <div ref={scrollRef} className={`flex-1 overflow-y-auto ${compact ? "p-3" : "p-4 lg:p-5"}`}>
      {messages.length === 0 && !busy ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
            <Bot className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">你好，我是小智</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              医疗售前专属助手：能查你的站内数据、记住你的工作习惯，
              <br className={compact ? "hidden" : undefined} />
              还能联动当前页面帮你干活。
            </p>
          </div>
          {onQuickAsk ? (
            <div className="mt-1 flex w-full max-w-md flex-col gap-2">
              {QUICK_SAMPLES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onQuickAsk(q)}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground shadow-sm transition-all hover:scale-[1.02] hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                  {q}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-md">
                  {m.content}
                </div>
              </div>
            ) : (
              <article key={m.id} className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="group min-w-0 max-w-[85%]">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">小智</span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(m.content).then(
                          () => toast.success("已复制到剪贴板"),
                          () => toast.error("复制失败，请手动选择文本复制"),
                        )
                      }}
                      aria-label="复制这条回复"
                      className="rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {m.failed ? (
                    <div className="rounded-xl rounded-tl-sm border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-sm leading-relaxed text-destructive shadow-sm">
                      {m.content}
                    </div>
                  ) : (
                    <div className="rounded-xl rounded-tl-sm bg-secondary px-3.5 py-2.5 text-sm text-secondary-foreground shadow-sm">
                      <Markdown components={MD_COMPONENTS}>{m.content}</Markdown>
                    </div>
                  )}
                  {m.failed && (onRetry || onDismiss) ? (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {onRetry ? (
                        <button
                          type="button"
                          onClick={onRetry}
                          className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <RotateCcw className="h-3 w-3" />
                          重试
                        </button>
                      ) : null}
                      {onDismiss ? (
                        <button
                          type="button"
                          onClick={() => onDismiss(m.id)}
                          aria-label="消除这条失败提示"
                          className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <X className="h-3 w-3" />
                          消除
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ),
          )}

          {busy ? (
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
                <Bot className="h-4 w-4" />
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="rounded-xl rounded-tl-sm bg-secondary px-3.5 py-2.5 shadow-sm">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                  </span>
                </span>
                {sendState === "fetching" && fetchBadge ? (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    <Search className="h-3 w-3 animate-pulse" />
                    {fetchBadge}
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center gap-1.5 px-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    小智正在思考…
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
