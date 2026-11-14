// 知识库 · 知识原子「引用到项目」弹窗。
//
// ## 为什么它重要
//
// 这是**整条「被引用 N 次」链路的生产者**。
//
// 现状（2026-11-11 实测）：kb_atoms.usage_count 全库为 0，因为
// `reportAtomUsageAfterGen`（既有，src/lib/kbAtomAssemble.ts）**没有任何生产调用点**
// ——原型的「被引用 12 次」「按引用数排」「高频引用 Top5」全都没有数据源。
//
// 本弹窗把「用户真的把这条原子用进标书了」这个动作落成两件事：
//   ① reportAtomUsage → kb_atoms.usage_count + 1（服务端 /api/kb/search/feedback）
//      → 知识原子屏的「引用次数」列、「高频引用 Top5」、文档库的「被引用 N 次」
//         与「按引用数排」三处**立刻**开始长数据；
//   ② 复制一条带来源的引用文本 → 粘到标书对应章节即可，用户不必自己拼来源。
//
// 诚实说明：本弹窗**不往标书正文里写内容**（正文写入属于标书工作台的章节模型，
// 不在本屏职责内，也不该由知识库直接改标书）。它做的是「记一次真实使用 + 给可粘贴的引用」。

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, Link2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/DataStates"
import { KbCard, KbCardBody, KbCardHead, KbTag } from "@/components/knowledge/KbPrimitives"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { reportAtomUsage } from "@/pages/Knowledge/kbAtomSearch"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

export type CiteableAtom = {
  id: string
  title: string
  body?: string
  docName?: string
  sourceAnchor?: string
  sourceDocId?: string
}

export function KbAtomCiteDialog({
  open,
  onClose,
  atom,
  userId,
  onCited,
}: {
  open: boolean
  onClose: () => void
  atom: CiteableAtom | null
  userId: string | null
  /** 引用成功后的回调（用来刷新统计与列表） */
  onCited?: () => void
}) {
  const [projects, setProjects] = useState<BidProjectRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState("")
  const [picked, setPicked] = useState<string>("")
  const [citing, setCiting] = useState(false)

  const load = useCallback(async () => {
    if (!userId) {
      setProjects([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${getPocketBaseUrl()}/api/bid_projects?rh_user_id=${encodeURIComponent(userId)}&perPage=200&sort=-updated`,
        { headers: vibexAuthHeaders() },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = (await res.json()) as { items?: BidProjectRecord[] }
      const rows = (j.items ?? []).filter((p) => !p.deleted_at)
      setProjects(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!open) return
    // setTimeout(0)：让 setState 发生在微任务之后（react-hooks/set-state-in-effect 规则）
    const t = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open, load])

  /** 关闭并清空本次选择（重置放在事件处理里，不用 effect） */
  const close = useCallback(() => {
    setKeyword("")
    setPicked("")
    onClose()
  }, [onClose])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        (p.project_name ?? "").toLowerCase().includes(q) ||
        (p.tender_no ?? "").toLowerCase().includes(q),
    )
  }, [projects, keyword])

  const citationLine = useMemo(() => {
    if (!atom) return ""
    const src = atom.docName ? ` · 来源：${atom.docName}` : ""
    const anchor = atom.sourceAnchor ? ` · ${atom.sourceAnchor}` : ""
    return `${atom.title}${src}${anchor}`
  }, [atom])

  const doCite = useCallback(async () => {
    if (!atom || !userId) return
    setCiting(true)
    try {
      // ① 记一次真实使用（usage_count + 1）——这是「被引用 N 次」的数据来源
      await reportAtomUsage(userId, [atom.id])
      // ② 给一条可粘贴的引用
      const target = projects.find((p) => p.id === picked)
      const text = target ? `【${target.project_name}】${citationLine}` : citationLine
      await navigator.clipboard
        ?.writeText(text)
        .then(() => toast.success("已复制引用，并计入这条原子的引用次数"))
        .catch(() => toast.success("已计入引用次数；复制失败，请手动选中引用文本"))
      onCited?.()
      close()
    } finally {
      setCiting(false)
    }
  }, [atom, userId, picked, projects, citationLine, onCited, close])

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : close())}>
      <DialogContent className="w-[min(560px,94vw)]" aria-label="引用知识原子到项目">
        <DialogHeader>
          <DialogTitle>引用到项目</DialogTitle>
          <DialogDescription>
            选一个标书项目，这条原子会被计入「被引用 N 次」，同时复制一条带来源的引用文本。
          </DialogDescription>
        </DialogHeader>

        {atom ? (
          <KbCard>
            <KbCardHead title="要引用的原子" />
            <KbCardBody tight>
              <p className="text-xs font-semibold text-foreground">{atom.title}</p>
              {atom.body ? (
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{atom.body}</p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {atom.docName ? <KbTag>{atom.docName}</KbTag> : null}
                {atom.sourceAnchor ? <KbTag>{atom.sourceAnchor}</KbTag> : null}
              </div>
            </KbCardBody>
          </KbCard>
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜标书项目"
            aria-label="搜标书项目"
            className="h-8 text-[13px]"
          />
          {loading ? (
            <LoadingState tone="compact" text="正在加载标书项目…" />
          ) : error ? (
            <ErrorState tone="compact" title="项目列表加载失败" reason={error} onRetry={load} />
          ) : filtered.length === 0 ? (
            <EmptyState
              tone="compact"
              title="没有匹配的标书项目"
              hint="可以先不选项目——直接复制引用文本，引用次数一样会计入。"
            />
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
              {filtered.slice(0, 50).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(p.id)}
                    className={`flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-muted/50 ${
                      picked === p.id ? "bg-primary/5" : ""
                    }`}
                  >
                    {picked === p.id ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 grow truncate text-foreground">{p.project_name || p.id}</span>
                    {p.tender_no ? (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{p.tender_no}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="text-[11px] text-muted-foreground">
            {picked ? "将复制带项目名的引用文本" : "未选项目：只复制引用文本"}
          </span>
          <Button variant="outline" size="sm" onClick={close}>
            取消
          </Button>
          <Button size="sm" className="gap-1.5" disabled={!atom || citing} onClick={() => void doCite()}>
            {citing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            引用并计数
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
