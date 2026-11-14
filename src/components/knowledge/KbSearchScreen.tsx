// 知识库 · ② 全文检索屏（UX-v2：/knowledge?tab=search，对齐 prototype/kb/search.html）。
//
// ## 这一屏解决什么
//
// 一个框搜到底，结果按「标题命中 / 正文命中」分组；搜不到时**必须区分两种「没有」**：
//
//   · 未命中 = 没检索到相关片段 → 可能问法与原文用词不同，或资料还在本机硬盘里；
//   · 真无资料 = 检索到了但内容不覆盖 → 建议补充文档。
//
// 原型把这句话写在了屏上：「**未命中 ≠ 库里没有**」。本屏照做，并给两条出路
// （换个词 / 去问知识库）。
//
// ## 真实数据来源
//
// - 标题命中：前端元数据过滤（title/summary/keywords/folder），即时、不打接口。
// - 正文命中：服务端 SQLite FTS5（POST /api/kb_docs/search），片段里用 [[词]] 标命中位。
// - 知识原子：服务端已通过审核的原子（POST /api/kb/search）。
//
// ## 为什么不用 AnyTXT
//
// AnyTXT 搜的是**本机硬盘**，不是云端知识库。原型的「本机资料检索」是独立入口，
// 放在「问知识库」的未命中提示里（去问知识库屏）与文档库屏的提示条上，
// 不混进云端检索结果——混在一起会让用户以为「库里没有 = 我没有」。

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, FileText, List, Search as SearchIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shell/PageHeader"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/DataStates"
import { KbAlert, KbCard, KbCardBody, KbCardFoot, KbCardHead, KbChip, KbSeg, KbTag } from "@/components/knowledge/KbPrimitives"
import { countSnippetHits, timeBucketCounts, titleHitsOf } from "@/components/knowledge/kbSearchGroup"
import { docFormatLabel, relativeTimeOf } from "@/components/knowledge/kbDocMeta"
import { searchKbContent, splitSnippet } from "@/lib/kbContentSearch"
import { KbLocalSearchDialog } from "@/components/knowledge/KbLocalSearchDialog"
import { searchAtoms, type AtomHit } from "@/pages/Knowledge/kbAtomSearch"
import type { KbTab } from "@/components/knowledge/kbTabs"
import type { useKnowledge } from "@/pages/Knowledge/useKnowledge"

type Scope = "all" | "title" | "body" | "atom"

const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "title", label: "标题" },
  { value: "body", label: "正文" },
  { value: "atom", label: "知识原子" },
]

type BodyHit = {
  id: string
  title: string
  folder_path: string
  snippet: string
  updated: string
}

export function KbSearchScreen({
  p,
  onTab,
}: {
  p: ReturnType<typeof useKnowledge>
  onTab: (tab: KbTab) => void
}) {
  const [query, setQuery] = useState(p.searchQuery)
  const [scope, setScope] = useState<Scope>("all")
  const [bodyHits, setBodyHits] = useState<BodyHit[]>([])
  const [bodyTotal, setBodyTotal] = useState(0)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [atomHits, setAtomHits] = useState<AtomHit[]>([])
  const [atomTotal, setAtomTotal] = useState(0)
  const [atomLoading, setAtomLoading] = useState(false)
  const [atomError, setAtomError] = useState<string | null>(null)
  const [localSearchOpen, setLocalSearchOpen] = useState(false)

  const q = query.trim()

  const titleHits = useMemo(() => {
    if (!q) return []
    if (scope === "body" || scope === "atom") return []
    return titleHitsOf(p.docs, q)
  }, [p.docs, q, scope])

  const runBodySearch = useCallback(async () => {
    if (!q || scope === "title" || scope === "atom") {
      setBodyHits([])
      setBodyTotal(0)
      setBodyError(null)
      setElapsedMs(null)
      return
    }
    setBodyLoading(true)
    setBodyError(null)
    const t0 = Date.now()
    try {
      const r = await searchKbContent({ q, limit: 30, libTab: p.libTab })
      if (!r.ok) {
        setBodyError(r.message)
        setBodyHits([])
        setBodyTotal(0)
      } else {
        setBodyHits(r.items as BodyHit[])
        setBodyTotal(r.total)
      }
      setElapsedMs(Date.now() - t0)
    } catch (e) {
      setBodyError(e instanceof Error ? e.message : String(e))
      setBodyHits([])
      setBodyTotal(0)
    } finally {
      setBodyLoading(false)
    }
  }, [q, scope, p.libTab])

  const runAtomSearch = useCallback(async () => {
    if (!q || scope !== "atom") {
      setAtomHits([])
      setAtomTotal(0)
      setAtomError(null)
      return
    }
    setAtomLoading(true)
    setAtomError(null)
    try {
      const r = await searchAtoms(p.userId ?? "", { query: q, topN: 20 })
      setAtomHits(r.hits)
      setAtomTotal(r.total)
    } catch (e) {
      setAtomError(e instanceof Error ? e.message : String(e))
      setAtomHits([])
      setAtomTotal(0)
    } finally {
      setAtomLoading(false)
    }
  }, [q, scope, p.userId])

  // 检索是「点了才跑」的动作，不随输入框逐键触发（7000 篇的 FTS 不是逐键能扛的）
  const [submitted, setSubmitted] = useState("")
  const doSearch = useCallback(() => {
    setSubmitted(q)
    p.setSearchQuery(q)
  }, [q, p])

  useEffect(() => {
    if (!submitted) return
    // setTimeout(0)：让 setState 发生在微任务之后（react-hooks/set-state-in-effect 规则）
    const t = window.setTimeout(() => {
      void runBodySearch()
      void runAtomSearch()
    }, 0)
    return () => window.clearTimeout(t)
  }, [submitted, runBodySearch, runAtomSearch])

  const timeCounts = useMemo(
    () => timeBucketCounts([...titleHits, ...bodyHits].map((d) => ({ updated: d.updated }))),
    [titleHits, bodyHits],
  )
  const totalHits = titleHits.length + bodyTotal + (scope === "atom" ? atomTotal : 0)
  const nothing = submitted !== "" && totalHits === 0 && !bodyLoading && !atomLoading && !bodyError && !atomError

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="全文检索"
        titleExtra={submitted ? <Badge variant="secondary">{totalHits} 条命中</Badge> : null}
        desc={
          <>
            这一屏只做一件事：<b>一个框搜到底，结果按「标题命中 / 正文命中」分组</b>。
            标题命中通常就是你要的那篇；正文命中给你语境片段，点开能跳到原文位置。
          </>
        }
        meta={
          <>
            <span>
              检索词 <b className="font-mono font-semibold text-foreground">{submitted || "—"}</b>
            </span>
            <span>
              范围 <b className="font-mono font-semibold text-foreground">{p.libTab === "team" ? "团队知识库" : "我的笔记"}</b>
            </span>
            <span>
              耗时 <b className="font-mono font-semibold text-foreground">{elapsedMs === null ? "—" : `${(elapsedMs / 1000).toFixed(2)} 秒`}</b>
            </span>
          </>
        }
      />

      <KbCard>
        <KbCardBody>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[320px] grow">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSearch()
                }}
                placeholder="搜标题与正文"
                aria-label="全文检索关键词"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            <Button className="gap-1.5" onClick={doSearch}>
              <SearchIcon className="h-4 w-4" />
              检索
            </Button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">搜索范围</span>
            <KbSeg value={scope} onChange={setScope} options={SCOPES} />
            <span className="mx-1 h-5 w-px bg-border" />
            <span className="text-[11px] text-muted-foreground">
              {submitted
                ? `共 ${totalHits} 条结果 · 标题命中 ${titleHits.length} 条 · 正文命中 ${bodyTotal} 条${scope === "atom" ? ` · 原子命中 ${atomTotal} 条` : ""}`
                : "输入关键词后点「检索」"}
            </span>
          </div>
        </KbCardBody>
      </KbCard>

      <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* 左：筛选 + 检索提示 */}
        <div className="col sticky top-16 flex flex-col gap-4">
          <KbCard>
            <KbCardHead
              title="筛选"
              actions={
                <Button
                  size="sm"
                  variant="link"
                  className="h-7 px-1 text-xs"
                  onClick={() => {
                    setQuery("")
                    setSubmitted("")
                    setBodyHits([])
                    setBodyTotal(0)
                    p.setSearchQuery("")
                  }}
                >
                  清空
                </Button>
              }
            />
            <KbCardBody tight>
              <div className="flex flex-col gap-2">
                <span className="text-[11px] text-muted-foreground">时间</span>
                <div className="flex flex-wrap gap-1.5">
                  <KbChip count={timeCounts.d7}>近 7 天</KbChip>
                  <KbChip count={timeCounts.d90}>近 90 天</KbChip>
                  <KbChip count={timeCounts.older}>更早</KbChip>
                </div>
              </div>
            </KbCardBody>
          </KbCard>

          <KbCard>
            <KbCardHead title="检索提示" />
            <KbCardBody tight>
              <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                <li>· 一个框同时查标题与正文，不用切换。</li>
                <li>· 命中词在片段里高亮，点开直接跳到原文那一行。</li>
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">想按语义提问？</span>
                <Button size="sm" variant="link" className="h-7 px-1 text-xs" onClick={() => onTab("qa")}>
                  去问知识库 →
                </Button>
              </div>
            </KbCardBody>
          </KbCard>
        </div>

        {/* 右：结果 */}
        <div className="col flex min-w-0 flex-col gap-4">
          {/* 标题命中 */}
          {scope !== "body" && scope !== "atom" ? (
            <KbCard>
              <KbCardHead
                title="标题命中"
                icon={<FileText className="h-3.5 w-3.5" />}
                sub="标题里直接含检索词，通常就是要找的那篇"
                actions={<Badge variant="secondary">{titleHits.length} 条</Badge>}
              />
              <KbCardBody flush>
                {titleHits.length === 0 ? (
                  submitted ? (
                    <EmptyState
                      tone="compact"
                      title="标题里没有这个关键词"
                      hint="也许它在正文里——看看下面「正文命中」的结果。"
                    />
                  ) : (
                    <EmptyState tone="compact" title="输入关键词开始检索" hint="一个框同时查标题与正文。" />
                  )
                ) : (
                  <ul>
                    {titleHits.slice(0, 8).map((h) => (
                      <li key={h.id} className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                        <Badge variant="secondary">{docFormatLabel(h.format)}</Badge>
                        <div className="min-w-0 grow">
                          <p className="truncate text-[13px] font-semibold text-foreground">{h.title}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {h.folderPath ? `${h.folderPath}` : "未归类目录"}
                            {h.updated ? ` · ${relativeTimeOf(h.updated)}` : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => {
                            p.selectDoc(p.docs.find((d) => d.id === h.id) ?? null)
                            onTab("browse")
                          }}
                        >
                          打开
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </KbCardBody>
              {titleHits.length > 8 ? (
                <KbCardFoot>
                  <span>标题命中 {titleHits.length} 条 · 已显示 8 条</span>
                </KbCardFoot>
              ) : null}
            </KbCard>
          ) : null}

          {/* 正文命中 */}
          {scope !== "title" && scope !== "atom" ? (
            <KbCard>
              <KbCardHead
                title="正文命中"
                icon={<List className="h-3.5 w-3.5" />}
                sub="标题不含检索词，但正文段落里出现了"
                actions={<Badge variant="warning">{bodyTotal} 条</Badge>}
              />
              <KbCardBody flush>
                {bodyLoading ? (
                  <LoadingState tone="compact" text="正在检索正文…" hint="全文索引在服务端（SQLite FTS5）" />
                ) : bodyError ? (
                  <div className="p-3">
                    <ErrorState
                      tone="compact"
                      title="正文检索失败"
                      reason={bodyError}
                      hint="标题命中仍然可用——换个范围或稍后重试。"
                      onRetry={doSearch}
                    />
                  </div>
                ) : bodyHits.length === 0 ? (
                  submitted ? (
                    <EmptyState
                      tone="compact"
                      title="正文里没有这个关键词"
                      hint="库里可能用了别的说法——试试更短的词，或直接去「问知识库」用大白话问。"
                    />
                  ) : (
                    <EmptyState tone="compact" title="输入关键词开始检索" />
                  )
                ) : (
                  <ul>
                    {bodyHits.slice(0, 6).map((h) => (
                      <li key={h.id} className="border-b border-border/60 px-4 py-2.5 last:border-b-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-foreground">{h.title}</span>
                          <div className="grow" />
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            命中 {countSnippetHits(h.snippet)} 处
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {splitSnippet(h.snippet).map((seg, i) =>
                            seg.hit ? (
                              <mark key={i} className="rounded bg-warning/20 px-0.5 text-foreground">
                                {seg.text}
                              </mark>
                            ) : (
                              <span key={i}>{seg.text}</span>
                            ),
                          )}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {h.folder_path || "未归类目录"}
                          {h.updated ? ` · ${relativeTimeOf(h.updated)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </KbCardBody>
              {bodyHits.length > 0 ? (
                <KbCardFoot>
                  <span>正文命中 {bodyTotal} 条 · 已显示 {Math.min(6, bodyHits.length)} 条</span>
                  <div className="grow" />
                  <span className="text-[11px]">命中词用琥珀底标出</span>
                </KbCardFoot>
              ) : null}
            </KbCard>
          ) : null}

          {/* 知识原子命中 */}
          {scope === "atom" ? (
            <KbCard>
              <KbCardHead
                title="知识原子命中"
                icon={<List className="h-3.5 w-3.5" />}
                sub="已通过审核的可复用事实单元"
                actions={<Badge variant="secondary">{atomTotal} 条</Badge>}
              />
              <KbCardBody flush>
                {atomLoading ? (
                  <LoadingState tone="compact" text="正在检索知识原子…" />
                ) : atomError ? (
                  <div className="p-3">
                    <ErrorState tone="compact" title="原子检索失败" reason={atomError} onRetry={doSearch} />
                  </div>
                ) : atomHits.length === 0 ? (
                  <EmptyState
                    tone="compact"
                    title="没有命中的知识原子"
                    hint="原子只收录已通过审核的结论；换个词或去「原子审核」看候选队列。"
                  />
                ) : (
                  <ul>
                    {atomHits.map((a) => (
                      <li key={a.atomId} className="border-b border-border/60 px-4 py-2.5 last:border-b-0">
                        <p className="text-[13px] font-semibold text-foreground">{a.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.sourceQuote || a.body}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <KbTag>{a.atomType}</KbTag>
                          {a.docName ? <KbTag>{a.docName}</KbTag> : null}
                          {a.sourceAnchor ? <span className="text-[11px] text-muted-foreground">{a.sourceAnchor}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </KbCardBody>
            </KbCard>
          ) : null}

          {/* 未命中：明说「未命中 ≠ 库里没有」，并给两条出路 */}
          {nothing ? (
            <KbCard>
              <KbCardHead title="未命中" sub="搜一个库里确实没有的词，看系统怎么如实说明" />
              <KbCardBody>
                <EmptyState
                  title={`没有找到「${submitted}」相关文档`}
                  hint={`在团队知识库 ${p.teamCount.toLocaleString("zh-CN")} 篇 + 我的笔记 ${p.personalCount.toLocaleString("zh-CN")} 条范围内，标题与正文都没有命中。`}
                  action={
                    <>
                      <Button size="sm" variant="outline" onClick={() => setQuery("DRG 分组器")}>
                        换个词试试
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onTab("qa")}>
                        去问知识库
                      </Button>
                    </>
                  }
                />
                <KbAlert
                  tone="warning"
                  className="mt-3"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  actions={
                    <Button size="sm" variant="outline" onClick={() => setLocalSearchOpen(true)}>
                      查看配置
                    </Button>
                  }
                >
                  <b>未命中 ≠ 库里没有</b>：可能只在本地文件里（本机全文检索未启用）。
                </KbAlert>
              </KbCardBody>
            </KbCard>
          ) : null}
        </div>
      </div>

      <KbLocalSearchDialog open={localSearchOpen} onClose={() => setLocalSearchOpen(false)} />
    </div>
  )
}
