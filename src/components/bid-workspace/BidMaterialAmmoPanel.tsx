import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { BookOpen, CornerDownLeft, HardDrive, Layers, Library, Loader2, MessageSquareQuote, Search, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decodeRhToken } from "@/lib/rhLogin"
import { type KbDocRow } from "@/lib/kbCore"
import { getCachedVisibleDocs } from "@/lib/kbAssemble"
import { listKbQaPairs, type KbQaPairRow } from "@/lib/kbQa"
import {
  buildBidRecos,
  pickAmmoPairs,
  pickKbHits,
  pickSiblingChapters,
  type BidMaterialTab,
  type BidSiblingChapter,
} from "@/pages/BidWorkspace/bidMaterialAmmo"
import { searchHistoryBids, toInsertText, type HistoryHit } from "@/pages/BidWorkspace/bidHistorySearch"
import { ErrorState } from "@/components/common/DataStates"

// ---------------------------------------------------------------------------
// R212 切片0.5B：标书编制右栏「素材弹药」——知识库 / 弹药库 / 本标书其它章节 三源检索
// + 按当前章主题智能推荐，引用即复制到正文光标处。会话内检索、零 AI、零新 collection；
// 检索组合逻辑集中在 bidMaterialAmmo.ts（脱敏/可见性复用知识库既有真源，不重复实现）。
// ---------------------------------------------------------------------------

type Props = {
  siblings: BidSiblingChapter[]
  chapterQuery: string
  activeChapterId: string | null
  canInsert: boolean
  onInsert: (text: string, label: string) => void
}

const TABS: { key: BidMaterialTab; label: string }[] = [
  { key: "kb", label: "知识库" },
  { key: "ammo", label: "弹药库" },
  { key: "sibling", label: "本章素材" },
  // 本机硬盘里的历史标书（AnyTXT 离线索引）——写方案时参考同类项目怎么写的
  { key: "history", label: "历史标书" },
]

/** 把 AnyTXT 片段的 *<<*高亮*>>* 标记去掉，供卡片预览（插入正文时由 toInsertText 再处理一遍） */
function cleanPreview(raw: string): string {
  return String(raw ?? "")
    .replace(/\*<<\*/g, "")
    .replace(/\*>>\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220)
}

function InsertButton({ disabled, onInsert }: { disabled: boolean; onInsert: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      title={disabled ? "先在左侧选中技术章" : "插入到正文光标处"}
      // preventDefault 保住正文 textarea 焦点与光标位置，插入才能落在光标处
      onMouseDown={(e) => e.preventDefault()}
      onClick={onInsert}
      className="shrink-0 border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
    >
      <CornerDownLeft className="mr-1 h-3.5 w-3.5" />
      插入正文
    </Button>
  )
}

function MaterialCard({
  title,
  badge,
  snippet,
  disabled,
  onInsert,
}: {
  title: string
  badge?: string
  snippet: string
  disabled: boolean
  onInsert: () => void
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground" title={title}>{title}</p>
          {badge && (
            <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>
          )}
        </div>
        <InsertButton disabled={disabled} onInsert={onInsert} />
      </div>
      <p className="mt-2 line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{snippet}</p>
    </article>
  )
}

function ClearBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} className="mt-1 gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary">
      <X className="h-3.5 w-3.5" />
      清空搜索
    </Button>
  )
}

function EmptyHint({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {action}
    </div>
  )
}

export function BidMaterialAmmoPanel(p: Props) {
  const [tab, setTab] = useState<BidMaterialTab>("kb")
  const [queryInput, setQueryInput] = useState("")
  const [query, setQuery] = useState("")
  const [docs, setDocs] = useState<KbDocRow[]>([])
  const [pairs, setPairs] = useState<KbQaPairRow[]>([])
  const [loading, setLoading] = useState(false)
  // 会话内当前用户 id 恒定，useMemo 稳定求值（渲染期不读 ref）
  const uid = useMemo(() => decodeRhToken()?.sub ?? null, [])
  const loadedRef = useRef(false)

  // 300ms 防抖：输入停稳后再触发检索
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  // 面板挂载即拉取知识库/弹药库两源（会话内，仅一次；失败可重试）——知识库源走 kbAssemble 共享缓存
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    let alive = true
    setLoading(true)
    // R304(r303-kb-cache-bypass-sites)：标书侧 openProject 已 prewarmKbCache，面板打开时缓存通常已热，
    // 不再把全库语料重复下载一遍。身份在 effect 内现取（与本面板其它调用同源），避免把这个「仅一次」
    // 的 effect 拖上 uid 依赖。下游 pickKbHits 仍按可见性过滤，语义不变。
    Promise.all([getCachedVisibleDocs(decodeRhToken()?.sub ?? null), listKbQaPairs()])
      .then(([d, q]) => {
        if (!alive) return
        setDocs(d)
        setPairs(q)
      })
      .catch(() => {
        loadedRef.current = false
        if (alive) toast.error("素材来源加载失败，请稍后重试")
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const kbHits = useMemo(() => pickKbHits(docs, uid, query), [docs, uid, query])
  const ammoItems = useMemo(() => pickAmmoPairs(pairs, uid, query), [pairs, uid, query])
  const sibItems = useMemo(() => pickSiblingChapters(p.siblings, p.activeChapterId, query), [p.siblings, p.activeChapterId, query])
  const recos = useMemo(
    () =>
      query
        ? []
        : buildBidRecos({ docs, pairs, siblings: p.siblings, userId: uid, chapterQuery: p.chapterQuery, activeChapterId: p.activeChapterId }),
    [docs, pairs, p.siblings, uid, p.chapterQuery, p.activeChapterId, query],
  )

  // ---- 历史标书（本机 AnyTXT 索引）----
  // 与上面三源不同：这三源是会话内内存过滤，历史标书要打磁盘索引，故走显式点击触发，
  // 不做按键实时搜（避免每次输入都打一次本地 RPC + 取片段）。
  const [historyHits, setHistoryHits] = useState<HistoryHit[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historySearched, setHistorySearched] = useState(false)
  /** 历史标书检索失败原因（与「真没命中」区分，2026-11-04） */
  const [historyError, setHistoryError] = useState("")
  const runHistorySearch = useCallback(async () => {
    const kw = query.trim()
    if (!kw) {
      toast.info("请先在上方输入检索关键词")
      return
    }
    setHistoryBusy(true)
    setHistorySearched(true)
    setHistoryError("")
    try {
      const r = await searchHistoryBids({ keyword: kw, limit: 8 })
      if (r.ok) {
        setHistoryHits(r.hits)
        setHistoryTotal(r.total)
        if (!r.hits.length) toast.info("本机没有找到包含该关键词的历史标书")
      } else {
        // 2026-11-04（R69 同类缺陷）：失败只弹 toast 就清空列表，面板随即显示
        // 「没有命中的历史标书」——用户会以为硬盘里真没这份标书，实际是 AnyTXT 挂了。
        setHistoryHits([])
        setHistoryTotal(0)
        setHistoryError(r.message || "检索失败")
        toast.error(r.message)
      }
    } finally {
      setHistoryBusy(false)
    }
  }, [query])

  return (
    <aside className="flex max-h-[calc(100vh-9rem)] flex-col rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-11 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Library className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">素材弹药</p>
      </div>

      <div className="shrink-0 space-y-2 px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="搜索团队素材…"
            className="h-8 pl-8 text-xs focus-visible:shadow-[var(--focus-ring)]"
          />
        </div>
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? "bg-primary/10 font-medium text-primary" : "bg-secondary text-muted-foreground hover:text-primary"
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {/* 未搜索时展示按当前章主题的跨来源智能推荐（切章自动重排）。
            历史标书 Tab 不参与：它走磁盘检索、要靠用户显式点「检索本机」触发，
            否则会盖住该 Tab 自己的引导与检索结果。 */}
        {tab !== "history" && !query && recos.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-2 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              依据「{p.chapterQuery || "当前章节"}」智能推荐 {recos.length} 条
            </p>
            {recos.map((item) => (
              <MaterialCard
                key={item.key}
                title={item.title}
                badge={item.badge}
                snippet={item.snippet}
                disabled={!p.canInsert}
                onInsert={() => p.onInsert(item.text, item.label)}
              />
            ))}
            <p className="text-[11px] leading-relaxed text-muted-foreground">本地相似度推荐供参考，输入关键词可精确检索</p>
          </div>
        )}

        {/* loading 只挡「知识库/弹药库/本章素材」三源（它们要等 getCachedVisibleDocs + listKbQaPairs）；
            历史标书走 AnyTXT 磁盘检索，与这两次拉取无关，不能被它挡住。 */}
        {loading && tab !== "history" ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            素材来源加载中…
          </div>
        ) : tab === "kb" ? (
          !query ? (
            <EmptyHint
              icon={<BookOpen className="h-7 w-7" />}
              title="输入关键词检索团队素材"
              desc="按块命中知识库文档，脱敏与禁入策略自动生效"
            />
          ) : kbHits.length === 0 ? (
            <EmptyHint
              icon={<BookOpen className="h-7 w-7" />}
              title="没有命中的知识块"
              desc="换个关键词，或到弹药库 / 本章素材找找"
              action={<ClearBtn onClick={() => setQueryInput("")} />}
            />
          ) : (
            kbHits.map((h) => (
              <MaterialCard key={h.key} title={h.title} badge={h.badge} snippet={h.snippet} disabled={!p.canInsert} onInsert={() => p.onInsert(h.snippet, h.label)} />
            ))
          )
        ) : tab === "ammo" ? (
          ammoItems.length === 0 ? (
            <EmptyHint
              icon={<MessageSquareQuote className="h-7 w-7" />}
              title={query ? "没有匹配的标准问答" : "弹药库还是空的"}
              desc={query ? "换个关键词试试" : "到知识中心沉淀已审批的标准问答后，这里可直接引用"}
              action={query ? <ClearBtn onClick={() => setQueryInput("")} /> : undefined}
            />
          ) : (
            ammoItems.map((a) => (
              <MaterialCard key={a.key} title={a.title} badge={a.badge} snippet={a.snippet} disabled={!p.canInsert} onInsert={() => p.onInsert(a.snippet, a.label)} />
            ))
          )
        ) : tab === "history" ? (
          /* 历史标书：本机硬盘（AnyTXT 离线索引）。显式点「检索本机」触发，不做按键实时搜 */
          !historySearched ? (
            <div className="space-y-2">
              <EmptyHint
                icon={<HardDrive className="h-7 w-7" />}
                title="检索本机历史标书"
                desc="在 D 盘标书库里找同类项目是怎么写的，命中片段可一键插入本章"
                action={
                  <Button size="sm" variant="outline" onClick={() => void runHistorySearch()} disabled={historyBusy || !query}>
                    {historyBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
                    {query ? "检索本机" : "先输入关键词"}
                  </Button>
                }
              />
              <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                注意：历史标书未经脱敏，可能含其它医院名称/报价/内部批注。仅作内部参考，插入后必须改写。
              </p>
            </div>
          ) : historyBusy ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              正在检索本机历史标书…
            </div>
          ) : historyError ? (
            <ErrorState
              tone="compact"
              title="历史标书检索没有成功"
              reason={historyError}
              hint="确认 AnyTXT 正在运行、且标书目录已加入索引范围后再点重试"
              onRetry={() => void runHistorySearch()}
            />
          ) : historyHits.length === 0 ? (
            <EmptyHint
              icon={<HardDrive className="h-7 w-7" />}
              title="没有命中的历史标书"
              desc="检索本身是成功的（不是故障）；换个关键词，或确认标书目录已在 AnyTXT 索引范围内"
              action={
                <Button size="sm" variant="outline" onClick={() => void runHistorySearch()}>
                  <Search className="mr-1 h-3.5 w-3.5" />
                  重试
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  命中 {historyTotal} 个文件，显示 {historyHits.length} 条片段
                </p>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void runHistorySearch()}>
                  刷新
                </Button>
              </div>
              {historyHits.map((h) => {
                const ins = toInsertText(h)
                return (
                  <MaterialCard
                    key={h.fid}
                    title={h.title}
                    badge={h.dir}
                    snippet={cleanPreview(h.snippet)}
                    disabled={!p.canInsert}
                    onInsert={() => p.onInsert(ins.text, ins.label)}
                  />
                )
              })}
            </div>
          )
        ) : sibItems.length === 0 ? (
          <EmptyHint
            icon={<Layers className="h-7 w-7" />}
            title={query ? "没有匹配的本标书章节" : "本标书还没有其它成稿章节"}
            desc={query ? "换个关键词试试" : "其它技术章生成正文后，可在此跨章引用复用"}
            action={query ? <ClearBtn onClick={() => setQueryInput("")} /> : undefined}
          />
        ) : (
          sibItems.map((s) => (
            <MaterialCard key={s.key} title={s.title} badge={s.badge} snippet={s.snippet} disabled={!p.canInsert} onInsert={() => p.onInsert(s.text, s.label)} />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        引用即复制到光标处，插入后记得改写融合，源素材不受影响
      </div>
    </aside>
  )
}
