// ---------------------------------------------------------------------------
// 本机资料检索面板（2026-10-29）
//
// 场景：写标书/方案时要找「当年那份 XX 医院的投标文件」「某个评分办法原文」，
// 这些资料躺在硬盘里但从未入库，系统现有搜索完全看不到。
//
// 依赖 AnyTXT（本机离线全文搜索引擎）。没装/没开时整块面板显示引导，不影响其他功能。
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, BookPlus, Check, FileSearch, Loader2, Search, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  probeAnytxt,
  searchAnytxt,
  shortPath,
  type AnytxtFile,
} from "@/lib/anytxtClient"
import { ingestManyToKb, ingestToKb } from "@/lib/anytxtIngest"
import { toast } from "sonner"
import { EmptyState, ErrorState } from "@/components/common/DataStates"

type State = "probing" | "offline" | "ready"
/** 单个文件的入库状态 */
type IngestState = "busy" | "done"
/** 批量纳入的最大条数（一次 RPC+写库，太多会慢且易超时） */
const BATCH_SIZE = 10

export function LocalDocSearchPanel({
  onPick,
  initialQuery,
}: {
  onPick?: (file: AnytxtFile) => void
  /** 从 URL 带入的初始关键词（⌘K 点「本机文件」结果时用），非空则自动执行一次搜索 */
  initialQuery?: string
}) {
  const [state, setState] = useState<State>("probing")
  const [offlineMsg, setOfflineMsg] = useState("")
  const [kw, setKw] = useState(() => String(initialQuery ?? "").trim())
  const [searching, setSearching] = useState(false)
  const [files, setFiles] = useState<AnytxtFile[]>([])
  const [count, setCount] = useState(0)
  const [searched, setSearched] = useState(false)
  /** 检索失败原因（与「真没搜到」区分开，2026-11-04） */
  const [searchError, setSearchError] = useState("")
  const [ingestState, setIngestState] = useState<Record<string, IngestState>>({})
  const [batchBusy, setBatchBusy] = useState(false)

  /** 单条纳入知识库 */
  const doIngest = useCallback(async (f: AnytxtFile) => {
    setIngestState((prev) => ({ ...prev, [f.id]: "busy" }))
    try {
      const r = await ingestToKb(f)
      if (r.ok) {
        setIngestState((prev) => ({ ...prev, [f.id]: "done" }))
        toast.success(`已纳入知识库：${f.name}（${r.chars.toLocaleString()} 字）`)
      } else {
        setIngestState((prev) => {
          const next = { ...prev }
          delete next[f.id]
          return next
        })
        toast.error(r.message)
      }
    } catch (e) {
      setIngestState((prev) => {
        const next = { ...prev }
        delete next[f.id]
        return next
      })
      toast.error(e instanceof Error ? e.message : "纳入失败")
    }
  }, [])

  /** 批量纳入本次命中的前 N 个 */
  const doBatchIngest = useCallback(async () => {
    const targets = files.slice(0, BATCH_SIZE)
    if (!targets.length) return
    setBatchBusy(true)
    const ids = targets.reduce<Record<string, IngestState>>((acc, f) => {
      acc[f.id] = "busy"
      return acc
    }, {})
    setIngestState((prev) => ({ ...prev, ...ids }))
    try {
      const r = await ingestManyToKb(targets)
      setIngestState((prev) => {
        const next = { ...prev }
        for (const f of targets) {
          if (next[f.id] === "busy") delete next[f.id]
        }
        for (const f of targets) {
          // 成功的标 done（用名字反查 id）
          if (!r.failed.some((x) => x.name === f.name)) next[f.id] = "done"
        }
        return next
      })
      if (r.ok > 0) toast.success(`已纳入 ${r.ok} 篇文档到知识库`)
      if (r.failed.length) toast.error(`${r.failed.length} 篇失败：${r.failed[0].message}`)
    } finally {
      setBatchBusy(false)
    }
  }, [files])

  useEffect(() => {
    let alive = true
    void probeAnytxt().then((h) => {
      if (!alive) return
      if (h.online) {
        setState("ready")
      } else {
        setState("offline")
        setOfflineMsg(h.message ?? "AnyTXT 未运行")
      }
    })
    return () => {
      alive = false
    }
  }, [])


  const doSearch = useCallback(async (explicit?: string) => {
    const pattern = String(explicit ?? kw).trim()
    if (!pattern) return
    setSearching(true)
    setSearched(true)
    setSearchError("")
    try {
      const r = await searchAnytxt({ pattern, limit: 100 })
      if (r.ok) {
        setFiles(r.files)
        setCount(r.count)
        if (!r.files.length) toast.info("本机没有找到匹配内容的文件")
      } else {
        // 2026-11-04（R69 同类缺陷）：失败只弹了个 toast，列表清空后界面显示
        // 「本机没有找到匹配内容的文件」——用户会以为硬盘里真没这份资料，
        // 而实际是 AnyTXT 挂了/超时。现在把失败原因留在面板上，与「真没搜到」分开。
        setFiles([])
        setCount(0)
        setSearchError(r.message || "检索失败")
        toast.error(r.message)
      }
    } finally {
      setSearching(false)
    }
  }, [kw])

  // 从 URL 带入关键词时自动搜一次（⌘K 点「本机文件」结果的落点）。
  // 等 probe 完成（state 变为 ready）再触发，避免服务未探测就发请求。
  // 用 setTimeout(0) 把 setState 移出 effect 同步体，避免 react-hooks/set-state-in-effect。
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (autoRanRef.current) return
    if (state !== "ready") return
    const q = String(initialQuery ?? "").trim()
    if (!q) return
    autoRanRef.current = true
    const t = window.setTimeout(() => {
      void doSearch(q)
    }, 0)
    return () => window.clearTimeout(t)
  }, [state, initialQuery, doSearch])

  if (state === "probing") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在探测本机搜索服务…
      </div>
    )
  }

  if (state === "offline") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">本机资料检索未启用</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              这块能力靠 <span className="font-medium text-foreground">AnyTXT</span> 提供：
              它能离线索引你硬盘里的 Word / Excel / PDF / 扫描件，按内容秒速命中。
              没装它时系统其他功能不受影响。
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {offlineMsg}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href="https://anytxt.net.cn/download.html"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Settings2 className="h-3.5 w-3.5" />
                去下载 AnyTXT
              </a>
              <span className="text-[11px] text-muted-foreground">
                装完在「设置 → API」里启用本地服务（默认 9920 端口）后，回来刷新本页
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">本机资料检索</span>
        <span className="text-[11px] text-muted-foreground">搜索硬盘里的历史标书 / 方案 / 扫描件</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-sm"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSearch()
            }}
            placeholder="输入关键词，如「电子病历评级」「XX医院 投标文件」"
            aria-label="本机资料搜索关键词"
          />
        </div>
        <Button onClick={() => void doSearch()} disabled={searching || !kw.trim()} className="h-9">
          {searching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
          搜索
        </Button>
      </div>

      {searched && !searching && searchError && (
        <ErrorState
          className="mt-2"
          tone="compact"
          title="本机检索没有成功"
          reason={searchError}
          hint="确认 AnyTXT 正在运行（设置 → API/MCP 打开、绑定 127.0.0.1:9920）后再点搜索"
          onRetry={() => void doSearch()}
        />
      )}

      {searched && !searching && !searchError && (
        files.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            命中 {count} 个文件，显示前 {files.length} 个
          </p>
        ) : (
          <EmptyState
            className="mt-2"
            tone="compact"
            title="本机没有找到匹配内容的文件"
            hint="检索本身是成功的（不是故障）；可换个更短的关键词，或确认那份资料已在 AnyTXT 索引目录里"
          />
        )
      )}

      {files.length > 0 && (
        <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
          {files.map((f) => {
            const state = ingestState[f.id]
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground" title={f.name}>
                    {f.name || "（未命名文件）"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={f.path}>
                    {shortPath(f.path)}
                  </p>
                </div>
                {onPick && (
                  <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => onPick(f)}>
                    选用
                  </Button>
                )}
                {/* 纳入知识库：把硬盘里的历史文件转成系统可检索、可问答的资产 */}
                <Button
                  size="sm"
                  variant={state === "done" ? "ghost" : "outline"}
                  className="h-7 shrink-0"
                  disabled={state === "busy" || state === "done"}
                  onClick={() => void doIngest(f)}
                  title={state === "done" ? "已纳入知识库" : "提取正文并存入知识库（之后可被正文检索与问答命中）"}
                >
                  {state === "busy" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : state === "done" ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <BookPlus className="h-3.5 w-3.5" />
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 批量纳入：把本次搜索命中的前 N 个一次性入库（常见用法：某类历史标书批量转资产） */}
      {files.length > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            纳入知识库后可用「正文全文检索」和「问知识库」命中
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0"
            disabled={batchBusy}
            onClick={() => void doBatchIngest()}
          >
            {batchBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookPlus className="mr-1 h-3.5 w-3.5" />}
            批量纳入前 {Math.min(BATCH_SIZE, files.length)} 个
          </Button>
        </div>
      )}
    </div>
  )
}

