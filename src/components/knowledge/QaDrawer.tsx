// 问知识库抽屉（轮次 D 改造）：三页签胶囊——问答 / 弹药库 / 待补答。
// 问答页签：对话流 + 弹药库命中标记 + [资料N] 内联引用溯源；弹药库与待补答由子面板承接。
import { useEffect, useRef, useState } from "react"
import { BookMarked, HelpCircle, Loader2, MessageCircleQuestion, Send, ShieldCheck, Sparkles, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { ModelSelect } from "@/components/model-config/ModelSelect"
import { KbMarkdown } from "@/components/knowledge/KbMarkdown"
import { CitedAnswer, hasCitationMarkers } from "@/components/knowledge/CitedAnswer"
import { QaAmmoPanel } from "@/components/knowledge/QaAmmoPanel"
import { QaGapPanel } from "@/components/knowledge/QaGapPanel"
import type { QaChatMsg, QaCitation, QaScope } from "@/pages/Knowledge/useKnowledge"
import type { UseScopeSkills } from "@/hooks/useScopeSkills"
import type { ModelRef } from "@/lib/modelGateway"
import type { KbQaPairRow } from "@/lib/kbQa"

type QaDrawerProps = {
  qaOpen: boolean
  closeQa: () => void
  qaScope: QaScope
  setQaScope: (s: QaScope) => void
  qaInput: string
  setQaInput: (v: string) => void
  qaMessages: QaChatMsg[]
  qaSending: boolean
  sendQaQuestion: (text?: string) => void
  clearQa: () => void
  openCitation: (citation: QaCitation) => void
  models: ModelRef[]
  activeModelKey: string
  onModelChange: (key: string) => void
  costText: string
  // 轮次 F：kb-qa 技能选择器源
  qaSkills: UseScopeSkills
  // 轮次 D-3：弹药库
  approvedQaPairs: KbQaPairRow[]
  pendingQaPairs: KbQaPairRow[]
  qaPairsLoading: boolean
  createQaPair: (question: string, answer: string, category: string, visibility: string) => Promise<boolean>
  updateQaPair: (
    row: KbQaPairRow,
    patch: Partial<Pick<KbQaPairRow, "question" | "answer" | "category" | "visibility">>,
  ) => Promise<boolean>
  deleteQaPair: (row: KbQaPairRow) => Promise<void>
  approveQaPending: (row: KbQaPairRow, answer: string, category: string) => Promise<boolean>
  askAiAnyway: (question: string) => void
  // 轮次 4 B1：回答卡「答得不对」负反馈入待补答队列
  reportAnswerWrong: (messageId: string) => Promise<boolean>
}

const SCOPE_OPTIONS: { key: QaScope; label: string }[] = [
  { key: "all", label: "团队 + 个人" },
  { key: "team", label: "仅团队" },
  { key: "personal", label: "仅个人" },
]

type DrawerTab = "chat" | "ammo" | "gap"

const TAB_OPTIONS: { key: DrawerTab; label: string }[] = [
  { key: "chat", label: "问答" },
  { key: "ammo", label: "弹药库" },
  { key: "gap", label: "待补答" },
]

export function QaDrawer({
  qaOpen,
  closeQa,
  qaScope,
  setQaScope,
  qaInput,
  setQaInput,
  qaMessages,
  qaSending,
  sendQaQuestion,
  clearQa,
  openCitation,
  models,
  activeModelKey,
  onModelChange,
  costText,
  qaSkills,
  approvedQaPairs,
  pendingQaPairs,
  qaPairsLoading,
  createQaPair,
  updateQaPair,
  deleteQaPair,
  approveQaPending,
  askAiAnyway,
  reportAnswerWrong,
}: QaDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("chat")
  // 轮次 4 B1：本轮会话里已点过「答得不对」的消息 id（按钮变「已反馈」禁用）
  const [reportedMsgIds, setReportedMsgIds] = useState<string[]>([])
  const [reportingMsgId, setReportingMsgId] = useState<string | null>(null)
  useEffect(() => {
    if (qaOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [qaOpen, qaMessages, qaSending])

  const handleReportWrong = (msgId: string) => {
    if (reportingMsgId || reportedMsgIds.includes(msgId)) return
    setReportingMsgId(msgId)
    void reportAnswerWrong(msgId)
      .then((ok) => {
        if (ok) setReportedMsgIds((prev) => (prev.includes(msgId) ? prev : [...prev, msgId]))
      })
      .finally(() => setReportingMsgId(null))
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm transition-opacity ${
          qaOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeQa}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ${
          qaOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="问知识库"
      >
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-sm">
            {drawerTab === "chat" ? (
              <MessageCircleQuestion className="h-4 w-4" />
            ) : drawerTab === "ammo" ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <HelpCircle className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {drawerTab === "chat" ? "问知识库" : drawerTab === "ammo" ? "标准问答弹药库" : "待补答队列"}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {drawerTab === "chat" ? costText : "已审批问答高置信命中时直接出答案，不产生 AI 费用"}
            </p>
          </div>
          {drawerTab === "chat" ? (
            <>
              <ModelSelect models={models} valueKey={activeModelKey} onChange={onModelChange} />
              <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)} disabled={qaMessages.length === 0} aria-label="清空对话" className="h-8 text-muted-foreground">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={closeQa} aria-label="关闭" className="h-8 text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          {drawerTab === "chat" && <SkillPickerFor scope="kb-qa" source={qaSkills} />}
          <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
            {TAB_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDrawerTab(opt.key)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  drawerTab === opt.key
                    ? "bg-card font-medium text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
                {opt.key === "gap" && pendingQaPairs.length > 0 ? (
                  <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                    {pendingQaPairs.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {drawerTab === "chat" ? (
            <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-0.5">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setQaScope(opt.key)}
                  className={`rounded-full px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    qaScope === opt.key
                      ? "bg-card font-medium text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {drawerTab === "chat" ? (
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {qaMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">基于你的知识库回答</p>
                  <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
                    提问后先在文档里做块级检索，命中弹药库标准答案时直接出答案；回答附 [资料N] 内联引用，点击跳原文
                  </p>
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                    {["互联互通评级有哪些要求？", "售前方案的方法论是什么？", "有哪些产品资料可以参考？"].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => sendQaQuestion(q)}
                        className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-all hover:scale-105 hover:border-primary hover:text-primary"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                qaMessages.map((m) => {
                  const inlineCited =
                    m.role === "assistant" && !!m.citations && m.citations.length > 0 && hasCitationMarkers(m.content)
                  return (
                    <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex flex-col gap-2"}>
                      <div
                        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm shadow-md ${
                          m.role === "user"
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-bl-md border border-border bg-background text-foreground"
                        }`}
                      >
                        {m.role === "user" ? (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        ) : (
                          <>
                            {m.qaLevel === "high" ? (
                              <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                <ShieldCheck className="h-3 w-3" />
                                弹药库命中 · 本次不产生 AI 费用
                              </p>
                            ) : null}
                            {m.qaLevel === "medium" ? (
                              <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                <BookMarked className="h-3 w-3 text-primary" />
                                已采用弹药库标准答案口径
                              </p>
                            ) : null}
                            {inlineCited && m.citations ? (
                              <CitedAnswer content={m.content} citations={m.citations} onOpenCitation={openCitation} />
                            ) : (
                              <KbMarkdown content={m.content} />
                            )}
                            {/* 轮次 4 B1：直答卡 / LLM 引用回答卡底部「答得不对」负反馈通道 */}
                            {m.qaLevel === "high" || (m.citations && m.citations.length > 0) ? (
                              <div className="mt-2 border-t border-border pt-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleReportWrong(m.id)}
                                  disabled={reportingMsgId === m.id || reportedMsgIds.includes(m.id)}
                                  className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-70"
                                >
                                  {reportedMsgIds.includes(m.id)
                                    ? "已反馈"
                                    : reportingMsgId === m.id
                                      ? "反馈中…"
                                      : "答得不对"}
                                </button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                      {m.role === "assistant" && m.qaLevel === "high" && m.qaFollowQuestion ? (
                        <button
                          type="button"
                          onClick={() => askAiAnyway(m.qaFollowQuestion ?? "")}
                          disabled={qaSending}
                          className="w-fit rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                        >
                          仍要问 AI
                        </button>
                      ) : null}
                      {m.citations && m.citations.length > 0 && !inlineCited ? (
                        <div className="space-y-1.5">
                          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <BookMarked className="h-3.5 w-3.5 text-primary" />
                            引用来源（点击查看原文）
                          </p>
                          {m.citations.map((c) => (
                            <button
                              key={`${c.docId}_${c.chunkStart ?? 0}`}
                              type="button"
                              onClick={() => openCitation(c)}
                              className="block w-full rounded-lg border border-border bg-muted/40 p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{c.title}</span>
                                <span
                                  className={`shrink-0 rounded-full px-1.5 text-xs ${
                                    c.visibility === "personal"
                                      ? "bg-muted text-muted-foreground"
                                      : "bg-primary/10 text-primary"
                                  }`}
                                >
                                  {c.visibility === "personal" ? "个人" : "团队"}
                                </span>
                              </span>
                              <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{c.snippet}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
              {qaSending ? (
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-background px-3.5 py-2.5 text-sm text-muted-foreground shadow-md">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  正在检索并生成回答…
                </div>
              ) : null}
            </div>

            <footer className="shrink-0 border-t border-border px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      sendQaQuestion()
                    }
                  }}
                  rows={2}
                  placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
                  aria-label="向知识库提问"
                  className="max-h-32 min-h-16 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-shadow placeholder:text-muted-foreground hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button
                  onClick={() => sendQaQuestion()}
                  disabled={qaSending || !qaInput.trim()}
                  aria-label="发送"
                  className="h-10 gap-1.5 bg-primary px-4 text-primary-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md"
                >
                  <Send className="h-4 w-4" />
                  提问
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">每轮回答前会先做费用确认；追问沿用当前对话上下文</p>
            </footer>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {drawerTab === "ammo" ? (
              <QaAmmoPanel
                approvedPairs={approvedQaPairs}
                loading={qaPairsLoading}
                createQaPair={createQaPair}
                updateQaPair={updateQaPair}
                deleteQaPair={deleteQaPair}
              />
            ) : (
              <QaGapPanel
                pendingPairs={pendingQaPairs}
                loading={qaPairsLoading}
                approveQaPending={approveQaPending}
                deleteQaPair={deleteQaPair}
              />
            )}
          </div>
        )}
      </aside>
      <ConfirmDialog
        open={confirmingClear}
        onOpenChange={setConfirmingClear}
        title="清空对话"
        description="确定清空当前问答记录吗？清空后不可恢复。"
        confirmText="清空"
        tone="danger"
        onConfirm={() => {
          setConfirmingClear(false)
          clearQa()
        }}
      />
    </>
  )
}
