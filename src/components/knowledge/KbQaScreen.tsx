// 知识库 · ⑤ 问知识库屏（UX-v2：/knowledge?tab=qa，对齐 prototype/kb/qa.html）。
//
// ## 这一屏解决什么
//
// 原型写得很准：「用大白话提问，答案必须带得回来源」。老问题是**问不到内容时只有一句
// 「知识库中没找到」**，用户分不清是「没检索到」还是「库里真没资料」，于是得出
// 「这个知识库不好用」的结论；答案也没有出处，不敢往标书里抄。
//
// 改造后：答案带 [1][2] 编号 + 来源卡片；右侧摊开检索过程；未命中与真无资料用两条不同文案。
//
// ## 既有能力全部保留
//
// 检索（BM25 + IDF 缓存）、弹药库直答（high/medium 两级）、费用确认、待补答队列、
// 引用跳转定位、近似定位滚动、PII 掩码——都在 `useKnowledge` 里，本屏只做版式。
//
// 未命中文案不是本屏造的：`buildKbMissCopy`（既有）已经把「范围里没文档 / 范围选窄了 /
// 有文档但没匹配上」分成三种，各自给不同的下一步。本屏只是把它按「未命中」样式呈现。

import { useEffect, useMemo, useRef } from "react"
import { AlertTriangle, BookOpen, MessageCircleQuestion, Paperclip, RefreshCw, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shell/PageHeader"
import { EmptyState, LoadingState } from "@/components/common/DataStates"
import { KbAlert, KbCard, KbCardBody, KbCardFoot, KbCardHead, KbSeg } from "@/components/knowledge/KbPrimitives"
import { qaScopeLabel } from "@/pages/Knowledge/kbMissCopy"
import type { KbTab } from "@/components/knowledge/kbTabs"
import type { useKnowledge } from "@/pages/Knowledge/useKnowledge"

type Scope = "all" | "team" | "personal"

export function KbQaScreen({
  p,
  onTab,
}: {
  p: ReturnType<typeof useKnowledge>
  onTab: (tab: KbTab) => void
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const msgs = p.qaMessages
  const rounds = useMemo(() => msgs.filter((m) => m.role === "user").length, [msgs])
  const lastAssistant = useMemo(() => [...msgs].reverse().find((m) => m.role === "assistant"), [msgs])
  const citations = lastAssistant?.citations ?? []
  const isMiss = lastAssistant?.id.startsWith("qa_none") ?? false

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [msgs.length])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="问知识库"
        titleExtra={rounds > 0 ? <Badge variant="success">{rounds} 轮问答</Badge> : null}
        desc={
          <>
            这一屏只做一件事：<b>用大白话提问，答案必须带得回来源</b>。
            每个结论后面都有来源编号，点编号跳到那篇文档；右侧把检索过程摊开给你看——召回了什么、采用了什么。
          </>
        }
        meta={
          <>
            <span>
              检索范围 <b className="font-mono font-semibold text-foreground">{qaScopeLabel(p.qaScope)}</b>
            </span>
            <span>
              本次采用 <b className="font-mono font-semibold text-foreground">{citations.length}</b> 个来源
            </span>
            <span>
              待补答队列 <b className="font-mono font-semibold text-foreground">{p.pendingQaPairs.length}</b> 条
            </span>
          </>
        }
        actions={
          <Button variant="outline" onClick={() => p.clearQa()} disabled={msgs.length === 0}>
            <RefreshCw className="h-4 w-4" />
            新建会话
          </Button>
        }
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 左：会话 */}
        <KbCard>
          <KbCardHead
            title="会话"
            icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
            sub="答案只引用库里真实存在的片段，不编造"
            actions={
              citations.length > 0 ? <Badge variant="success">已溯源 {citations.length} 处</Badge> : null
            }
          />
          <KbCardBody>
            {msgs.length === 0 ? (
              <EmptyState
                title="还没开始提问"
                hint="用大白话问就行。答案只基于检索到的库内片段；检索不到时会直说，不会拿模型知识补。"
                action={
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {["四甲要改多少数据元？", "等保三级有几条控制点？", "电子病历五级要求什么？"].map((q) => (
                      <Button key={q} size="sm" variant="outline" onClick={() => void p.sendQaQuestion(q)}>
                        {q}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              <div className="flex flex-col gap-4">
                {msgs.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex items-start gap-2">
                      <Badge variant="neutral">我</Badge>
                      <div className="min-w-0 grow">
                        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                          <p className="text-xs leading-relaxed text-foreground">{m.content}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex items-start gap-2">
                      <Badge variant="secondary">智</Badge>
                      <div className="min-w-0 grow">
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                          {m.id.startsWith("qa_none") ? (
                            <KbAlert tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
                              <b>这个问题我答不了，但不能编。</b>
                              <p className="mt-1 whitespace-pre-line">{m.content}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => p.setQaInput("")}>
                                  换个词再问
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => onTab("upload")}>
                                  上传相关文档
                                </Button>
                                <div className="grow" />
                                <span className="text-[11px] text-muted-foreground">已记入待补答队列</span>
                              </div>
                            </KbAlert>
                          ) : (
                            <>
                              <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">{m.content}</p>
                              {m.qaLevel ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="success">
                                    {m.qaLevel === "high" ? "弹药库直答（零费用）" : "采用团队标准答案口径"}
                                  </Badge>
                                  {m.qaFollowQuestion ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => void p.askAiAnyway(m.qaFollowQuestion ?? "")}
                                    >
                                      仍要问 AI
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>

                        {/* 来源卡片：[1][2] 编号 + 可点的出处 */}
                        {m.citations && m.citations.length > 0 ? (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {m.citations.map((c, i) => (
                              <div key={`${c.docId}-${i}`} className="flex flex-wrap items-center gap-2">
                                <Badge variant={i === 0 ? "secondary" : "warning"}>[{i + 1}]</Badge>
                                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                                  {c.title}
                                  {c.visibility === "personal" ? " · 我的笔记" : " · 团队知识库"}
                                </span>
                                <div className="grow" />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => p.openCitation(c)}
                                >
                                  打开原文
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {m.role === "assistant" && !m.id.startsWith("qa_none") ? (
                          <div className="mt-2 flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground"
                              onClick={() => void p.reportAnswerWrong(m.id)}
                              title="这条答得不对？记入待补答队列，团队补充答案后下次直接命中"
                            >
                              答得不对
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ),
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </KbCardBody>

          {/* 输入区 */}
          <KbCardFoot className="flex-col items-stretch gap-2">
            {p.qaIndexing ? (
              <LoadingState tone="compact" text="正在准备全文语料，首次会慢一点…" />
            ) : null}
            <div className="flex items-center gap-2">
              <Input
                value={p.qaInput}
                onChange={(e) => p.setQaInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) void p.sendQaQuestion()
                }}
                placeholder="接着问 —— 如「四甲测评的评审专家一般问什么」"
                aria-label="向知识库提问"
                className="h-8 text-[13px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 shrink-0 p-0"
                title="附加文档"
                onClick={() => onTab("upload")}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                className="h-8 shrink-0 gap-1.5"
                disabled={p.qaSending || p.qaIndexing || !p.qaInput.trim()}
                onClick={() => void p.sendQaQuestion()}
              >
                <Send className="h-3.5 w-3.5" />
                发送
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">检索范围</span>
              <KbSeg
                value={(p.qaScope as Scope) || "all"}
                onChange={(v) => p.setQaScope(v)}
                options={[
                  { value: "all", label: "全部" },
                  { value: "team", label: "团队知识库" },
                  { value: "personal", label: "我的笔记" },
                ]}
              />
              <div className="grow" />
              <span className="text-[11px] text-muted-foreground">
                答案只基于检索到的库内片段；检索不到时会直说，不会拿模型知识补。
              </span>
            </div>
          </KbCardFoot>
        </KbCard>

        {/* 右：检索过程 + 说明 */}
        <div className="col flex flex-col gap-4">
          <KbCard>
            <KbCardHead
              title="检索过程"
              actions={
                <Badge variant="neutral">采用 {citations.length}</Badge>
              }
            />
            <KbCardBody tight>
              <p className="text-[11px] text-muted-foreground">① 召回并重排后采用的来源</p>
              {citations.length === 0 ? (
                <EmptyState
                  tone="compact"
                  title={isMiss ? "本轮召回 0 个片段" : "还没有提问"}
                  hint={isMiss ? "库里确实没有匹配到相关片段。" : "提问后这里会列出采用了哪些来源。"}
                />
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {citations.map((c, i) => (
                    <li key={`${c.docId}-${i}`} className="flex items-center gap-2">
                      <Badge variant={i === 0 ? "success" : "neutral"}>采用</Badge>
                      <span className="min-w-0 grow truncate text-xs text-foreground">{c.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </KbCardBody>
          </KbCard>

          <KbCard>
            <KbCardHead title="未命中 vs 真无资料" />
            <KbCardBody tight>
              <div className="flex flex-col gap-2">
                <KbAlert tone="info" icon={<AlertTriangle className="h-4 w-4" />}>
                  <b>未命中</b> = 没检索到相关片段。可能是问法与原文用词不同，或资料还没入库。
                  <b>下一步：换词、放宽范围、或启用本机全文检索。</b>
                </KbAlert>
                <KbAlert tone="info" icon={<AlertTriangle className="h-4 w-4" />}>
                  <b>真无资料</b> = 检索到了相关片段，但内容不覆盖这个问题。
                  <b>下一步：补充对应文档，或记入待补答队列。</b>
                </KbAlert>
                <div className="h-px bg-border" />
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  前者是「找不到」，后者是「找到了但没写」
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  两种都绝不编造，都会记入待补答队列
                </p>
              </div>
            </KbCardBody>
          </KbCard>

          <KbCard>
            <KbCardHead title="会话可检索" />
            <KbCardBody tight>
              <p className="text-xs text-muted-foreground">
                这次会话会存进历史，下次搜「四甲 数据元」能翻到。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onTab("search")}>
                  <BookOpen className="h-3.5 w-3.5" />
                  在检索中查会话
                </Button>
                <Button size="sm" variant="ghost" onClick={() => p.clearQa()} disabled={msgs.length === 0}>
                  清空会话
                </Button>
              </div>
            </KbCardBody>
          </KbCard>
        </div>
      </div>
    </div>
  )
}
