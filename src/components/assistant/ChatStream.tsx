import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import Markdown from "react-markdown"
import type { Components } from "react-markdown"
import { toast } from "sonner"
import { copyTextToClipboard } from "@/lib/clipboard"
import { Bot, CalendarCheck2, Copy, ExternalLink, FileDown, Loader2, RotateCcw, Search, Sparkles, Users, X } from "lucide-react"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import type { ChatMsg } from "@/lib/assistantCore"
import { triggerBlobDownload } from "@/lib/download"
import { DOCX_DEFAULT_STYLES } from "@/lib/exportFont"
import { localDateStamp } from "@/lib/dateStamp"

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
        <div className="flex flex-col gap-3 lg:gap-4">
          {messages.map((m, idx) => {
            // R62/⑤：采用动作——回看上一条用户消息的技能戳（技能名仅会话内存）
            const prevUser = idx > 0 ? messages[idx - 1] : undefined
            const skillName = m.role === "assistant" && !m.failed ? prevUser?.role === "user" ? prevUser.skillName : undefined : undefined
            return m.role === "user" ? (
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
                        void copyTextToClipboard(m.content, {
                          successMessage: "已复制到剪贴板",
                          errorMessage: "复制失败，请手动选择文本复制",
                        })
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
                  {skillName ? (
                    <SkillAdoptRow skillName={skillName} content={m.content} />
                  ) : null}
                </div>
              </article>
            )
          })}

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

// ---------------------------------------------------------------------------
// R62/⑤：技能产出「采用」动作——按技能类型给落点（写回经既有接口，零 schema 变更）
// ---------------------------------------------------------------------------

const ADOPTABLE = new Set(["写客户跟进邮件", "生成周报总结", "竞品深度分析", "招标文件要点梳理", "客户拜访准备清单", "方案大纲构思"])

type CustomerOption = { id: string; hospital_name: string }

function SkillAdoptRow({ skillName, content }: { skillName: string; content: string }) {
  const navigate = useNavigate()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [customers, setCustomers] = useState<CustomerOption[] | null>(null)
  /** 客户列表加载失败（与「真没客户」区分，2026-11-04） */
  const [customerLoadFailed, setCustomerLoadFailed] = useState(false)
  const [customerId, setCustomerId] = useState("")
  const [saving, setSaving] = useState(false)

  if (!ADOPTABLE.has(skillName)) return null

  const loadCustomers = () => {
    if (customers) return
    setCustomerLoadFailed(false)
    fetch(`${getPocketBaseUrl()}/api/customers?perPage=200&page=1`, { headers: vibexAuthHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: CustomerOption[] }) => setCustomers(d.items ?? []))
      .catch(() => {
        // 2026-11-04（R69 同类缺陷）：原来失败后 setCustomers([])，界面随即显示
        // 「还没有客户，先到客户管理新建」——把网络/鉴权失败说成了业务空态。
        // 现在置失败标记，界面区分「真没客户」与「没加载出来」。
        toast.error("客户列表加载失败")
        setCustomerLoadFailed(true)
        setCustomers([])
      })
  }

  const saveFollowRecord = () => {
    if (!customerId) {
      toast.error("请先选客户")
      return
    }
    setSaving(true)
    fetch(`${getPocketBaseUrl()}/api/follow_records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
      body: JSON.stringify({ customer_id: customerId, record_type: "邮件跟进", content }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        toast.success("已存入该客户的跟进记录，可到客户管理查看")
        setPickerOpen(false)
      })
      .catch(() => toast.error("保存失败，请稍后重试"))
      .finally(() => setSaving(false))
  }

  const downloadWeeklyDocx = () => {
    // 2026-10-20 修复（R124 守卫实测命中）：本组件此前在文件顶部静态引入 docx 的
    // Document/Packer/Paragraph/TextRun，于是「浮动助手」这条静态链把 docx（数百 kB）
    // 拖进了入口 chunk —— 全站每一页首访都要多下它，而「导出周报」只在点了按钮时才需要。
    // 改为点击时按需 await import()，重库不进首载图。
    // 注意：本注释刻意不写出该 import 语句的完整字面量，因为 onDemandHeavyLibs 守卫的
    // staticSpecs() 用正则扫源码、不剔除注释——写了就会被误判成「静态可达」。
    void (async () => {
      const { Document, Packer, Paragraph, TextRun } = await import("docx")
      const paras = content
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => new Paragraph({ children: [new TextRun(l)] }))
      const doc = new Document({ styles: DOCX_DEFAULT_STYLES, sections: [{ children: [new Paragraph({ children: [new TextRun({ text: "售前周报", bold: true, size: 32 })] }), ...paras] }] })
      const blob = await Packer.toBlob(doc)
      triggerBlobDownload(blob, `售前周报-${localDateStamp()}.docx`)
      toast.success("周报 Word 已下载")
    })()
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {skillName === "写客户跟进邮件" ? (
        <>
          <button
            type="button"
            onClick={() => {
              setPickerOpen((v) => !v)
              loadCustomers()
            }}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Users className="h-3 w-3" />
            存为客户跟进记录
          </button>
          {pickerOpen ? (
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
              {customers === null ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  客户加载中…
                </span>
              ) : customers.length === 0 ? (
                <span className="text-xs text-muted-foreground">{customerLoadFailed ? "客户列表没加载出来（不是没有客户），请重试" : "还没有客户，先到客户管理新建"}</span>
              ) : (
                <>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="max-w-[220px] rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="">选客户…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.hospital_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={saveFollowRecord}
                    disabled={saving || !customerId}
                    className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? "存档中…" : "存档"}
                  </button>
                </>
              )}
            </span>
          ) : null}
        </>
      ) : null}
      {skillName === "生成周报总结" ? (
        <button
          type="button"
          onClick={downloadWeeklyDocx}
          className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <FileDown className="h-3 w-3" />
          下载 Word
        </button>
      ) : null}
      {skillName === "竞品深度分析" ? (
        <CompetitorAdopt content={content} />
      ) : null}
      {skillName === "招标文件要点梳理" ? (
        <BidMaterialAdopt content={content} />
      ) : null}
      {skillName === "客户拜访准备清单" ? (
        <VisitChecklistAdopt content={content} />
      ) : null}
      {skillName === "方案大纲构思" ? (
        <button
          type="button"
          onClick={() => {
            void copyTextToClipboard(content, {
              successMessage: "大纲已复制，去方案编辑器粘贴即用",
              errorMessage: "复制失败，请手动选择文本复制",
            })
            navigate("/solution-studio")
          }}
          className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ExternalLink className="h-3 w-3" />
          复制并去方案编辑
        </button>
      ) : null}
      {(skillName === "写客户跟进邮件" || skillName === "客户拜访准备清单") && !pickerOpen ? (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarCheck2 className="h-3 w-3" />
          存档后到客户管理时间线查看
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// D4：竞品深度分析——选竞品 → 追加写入 threat_notes
// ---------------------------------------------------------------------------

type CompOption = { id: string; competitor_name: string }

function CompetitorAdopt({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const [comps, setComps] = useState<CompOption[] | null>(null)
  /** 竞品列表加载失败（与「真没竞品」区分，2026-11-04） */
  const [compLoadFailed, setCompLoadFailed] = useState(false)
  const [compId, setCompId] = useState("")
  const [saving, setSaving] = useState(false)

  const loadComps = () => {
    if (comps) return
    fetch(`${getPocketBaseUrl()}/api/competitors?perPage=200&page=1`, { headers: vibexAuthHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: CompOption[] }) => setComps(d.items ?? []))
      .catch(() => {
        // 失败≠没竞品（2026-11-04 同 R69 修法）
        toast.error("竞品列表加载失败")
        setCompLoadFailed(true)
        setComps([])
      })
  }

  const doAdopt = () => {
    if (!compId) { toast.error("请先选择竞品"); return }
    setSaving(true)
    // 先获取当前 threat_notes，再追加
    fetch(`${getPocketBaseUrl()}/api/competitors/${encodeURIComponent(compId)}`, { headers: vibexAuthHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((row: { threat_notes?: string }) => {
        const prev = (row.threat_notes ?? "").trim()
        const stamp = localDateStamp()
        const next = prev ? `${prev}\n\n---\n【AI 深度分析 ${stamp}】\n${content}` : `【AI 深度分析 ${stamp}】\n${content}`
        return fetch(`${getPocketBaseUrl()}/api/competitors/${encodeURIComponent(compId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
          body: JSON.stringify({ threat_notes: next }),
        })
      })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        toast.success("分析已写入竞品档案")
        setOpen(false)
      })
      .catch(() => toast.error("写入失败，请稍后重试"))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); loadComps() }}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Users className="h-3 w-3" />
        写入竞品档案
      </button>
      {open ? (
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
          {comps === null ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />加载中…
            </span>
          ) : comps.length === 0 ? (
            <span className="text-xs text-muted-foreground">{compLoadFailed ? "竞品列表没加载出来（不是没有竞品），请重试" : "暂无竞品，先到竞品管理新建"}</span>
          ) : (
            <>
              <select value={compId} onChange={(e) => setCompId(e.target.value)}
                className="max-w-[180px] rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <option value="">选竞品…</option>
                {comps.map((c) => <option key={c.id} value={c.id}>{c.competitor_name}</option>)}
              </select>
              <button type="button" onClick={doAdopt} disabled={saving || !compId}
                className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
                {saving ? "写入中…" : "确认写入"}
              </button>
            </>
          )}
        </span>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// D4：招标文件要点梳理——选标书项目 → 追加写入 ref_materials_text
// ---------------------------------------------------------------------------

type BidOption = { id: string; project_name: string }

function BidMaterialAdopt({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const [bids, setBids] = useState<BidOption[] | null>(null)
  /** 标书项目加载失败（与「真没项目」区分，2026-11-04） */
  const [bidLoadFailed, setBidLoadFailed] = useState(false)
  const [bidId, setBidId] = useState("")
  const [saving, setSaving] = useState(false)

  const loadBids = () => {
    if (bids) return
    fetch(`${getPocketBaseUrl()}/api/bid_projects?perPage=200&page=1`, { headers: vibexAuthHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: BidOption[] }) => setBids(d.items ?? []))
      .catch(() => {
        toast.error("标书项目列表加载失败")
        setBidLoadFailed(true)
        setBids([])
      })
  }

  const doAdopt = () => {
    if (!bidId) { toast.error("请先选择标书项目"); return }
    setSaving(true)
    fetch(`${getPocketBaseUrl()}/api/bid_projects/${encodeURIComponent(bidId)}`, { headers: vibexAuthHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((row: { ref_materials_text?: string }) => {
        const prev = (row.ref_materials_text ?? "").trim()
        const stamp = localDateStamp()
        const next = prev ? `${prev}\n\n---\n【招标要点梳理 ${stamp}】\n${content}` : `【招标要点梳理 ${stamp}】\n${content}`
        return fetch(`${getPocketBaseUrl()}/api/bid_projects/${encodeURIComponent(bidId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
          body: JSON.stringify({ ref_materials_text: next }),
        })
      })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        toast.success("要点已存入标书素材")
        setOpen(false)
      })
      .catch(() => toast.error("写入失败，请稍后重试"))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); loadBids() }}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <FileDown className="h-3 w-3" />
        存入标书素材
      </button>
      {open ? (
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
          {bids === null ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />加载中…
            </span>
          ) : bids.length === 0 ? (
            <span className="text-xs text-muted-foreground">{bidLoadFailed ? "标书项目没加载出来（不是没有项目），请重试" : "暂无标书项目，先到工作台新建"}</span>
          ) : (
            <>
              <select value={bidId} onChange={(e) => setBidId(e.target.value)}
                className="max-w-[180px] rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <option value="">选项目…</option>
                {bids.map((b) => <option key={b.id} value={b.id}>{b.project_name}</option>)}
              </select>
              <button type="button" onClick={doAdopt} disabled={saving || !bidId}
                className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
                {saving ? "写入中…" : "确认写入"}
              </button>
            </>
          )}
        </span>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// D4：客户拜访准备清单——选客户 → 存为跟进记录
// ---------------------------------------------------------------------------

function VisitChecklistAdopt({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const [customers, setCustomers] = useState<CustomerOption[] | null>(null)
  /** 客户列表加载失败（与「真没客户」区分，2026-11-04） */
  const [customerLoadFailed, setCustomerLoadFailed] = useState(false)
  const [customerId, setCustomerId] = useState("")
  const [saving, setSaving] = useState(false)

  const loadCustomers = () => {
    if (customers) return
    fetch(`${getPocketBaseUrl()}/api/customers?perPage=200&page=1`, { headers: vibexAuthHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: CustomerOption[] }) => setCustomers(d.items ?? []))
      .catch(() => {
        toast.error("客户列表加载失败")
        setCustomerLoadFailed(true)
        setCustomers([])
      })
  }

  const doAdopt = () => {
    if (!customerId) { toast.error("请先选择客户"); return }
    setSaving(true)
    fetch(`${getPocketBaseUrl()}/api/follow_records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
      body: JSON.stringify({ customer_id: customerId, record_type: "拜访准备", content }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        toast.success("拜访清单已存入跟进记录")
        setOpen(false)
      })
      .catch(() => toast.error("保存失败，请稍后重试"))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); loadCustomers() }}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Users className="h-3 w-3" />
        存为客户跟进
      </button>
      {open ? (
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
          {customers === null ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />加载中…
            </span>
          ) : customers.length === 0 ? (
            <span className="text-xs text-muted-foreground">{customerLoadFailed ? "客户列表没加载出来（不是没有客户），请重试" : "还没有客户"}</span>
          ) : (
            <>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                className="max-w-[180px] rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <option value="">选客户…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.hospital_name}</option>)}
              </select>
              <button type="button" onClick={doAdopt} disabled={saving || !customerId}
                className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
                {saving ? "存档中…" : "存档"}
              </button>
            </>
          )}
        </span>
      ) : null}
    </>
  )
}

