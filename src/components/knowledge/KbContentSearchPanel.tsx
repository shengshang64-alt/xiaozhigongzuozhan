// ---------------------------------------------------------------------------
// 知识库正文检索面板（2026-10-29）
//
// 补的缺口：知识库列表搜索只扫标题/摘要/关键词/目录，搜不到正文。
// 用户想找「哪篇方案里写过电子病历五级的整改路径」，以前搜不到，现在可以。
//
// 后端：SQLite FTS5 索引（7000 篇 / 1.14 亿字符），片段带 [[高亮]] 标记。
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from "react"
import { FileText, Loader2, Search, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  searchKbContent,
  splitSnippet,
  type KbSearchItem,
} from "@/lib/kbContentSearch"
import { redactPii } from "@/lib/piiRedact"
import { EmptyState, ErrorState } from "@/components/common/DataStates"

/** 把服务端/网络的失败串翻成人话 + 下一步做什么（不吞原因，也不把故障说成「没有」） */
function failureHint(message: string): string {
  const m = (message ?? "").toLowerCase()
  if (/timeout|aborted|abort/.test(m)) return "检索超时了（正文索引很大，首次检索会慢一些）。请稍等再点一次「搜正文」。"
  if (/401|403|unauthorized|forbidden|登录|鉴权/.test(m)) return "登录状态失效了，刷新页面重新登录后再搜。"
  if (/no such|fts|index|索引|not enabled|未建/.test(m)) return "正文索引还没建好。可让管理员在知识库设置里重建索引，或先用左侧的列表搜索按标题/关键词查找。"
  if (/fetch|network|econn|enotfound|failed to fetch/.test(m)) return "连不上本地服务。请确认本机 PocketBase（7000 端口）在运行，然后重试。"
  return "检索没成功，原因见上方。可先重试一次；仍失败请把这句话反馈给管理员。"
}

/** 片段渲染：[[关键词]] → 黄色高亮。渲染前统一过 redactPii（与 QaDrawer / CitedAnswer 同口径）。 */
function SnippetText({ snippet }: { snippet: string }) {
  const parts = splitSnippet(snippet)
  if (!parts.length) return <span className="text-muted-foreground">（无片段）</span>
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-foreground">
            {/* 2026-11-04 口径统一：知识库其余展示面（QaDrawer / CitedAnswer / qaCopyText）
                渲染前都过 redactPii，只有本面板裸渲染原文片段。两边都过，掩码保留头尾，
                用户要看全号仍可点开该文档（文档详情有「查看原文」）。 */}
            {redactPii(p.text)}
          </mark>
        ) : (
          <span key={i}>{redactPii(p.text)}</span>
        ),
      )}
    </>
  )
}

export function KbContentSearchPanel({
  libTab,
  onOpenDoc,
}: {
  libTab: "team" | "personal"
  /** 点击结果时打开对应文档（外部决定：切到该文档） */
  onOpenDoc?: (id: string) => void
}) {
  const [kw, setKw] = useState("")
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<KbSearchItem[]>([])
  const [total, setTotal] = useState(0)
  const [searched, setSearched] = useState(false)
  // 2026-11-04（审计 P1）：检索**失败**（401 / 索引没建 / 服务没起 / 超时）此前被静默吞成
  // 「没有找到正文包含该关键词的文档」——用户会以为库里真没有，实际是功能坏了。
  // 现在把失败原因与下一步单独存起来，与「搜到了 0 条」严格区分。
  const [failMessage, setFailMessage] = useState("")
  const seqRef = useRef(0)

  const run = useCallback(async () => {
    const q = kw.trim()
    if (!q) return
    const seq = ++seqRef.current
    setBusy(true)
    setSearched(true)
    setFailMessage("")
    try {
      const r = await searchKbContent({ q, limit: 30, libTab })
      if (seq !== seqRef.current) return // 丢弃过期响应
      if (r.ok) {
        setItems(r.items)
        setTotal(r.total)
      } else {
        setItems([])
        setTotal(0)
        setFailMessage(r.message || "检索失败")
      }
    } finally {
      if (seq === seqRef.current) setBusy(false)
    }
  }, [kw, libTab])

  // 切换库时清空结果：用 key 重置组件而非 effect（effect 里 setState 会触发
  // react-hooks/set-state-in-effect，且会造成一帧旧数据闪现）
  // 由调用方传 key={libTab} 保证换库即重新挂载；此处不再需要 effect。

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">正文全文检索</span>
        <span className="text-[11px] text-muted-foreground">
          搜 7000+ 篇文档的正文内容（不只是标题）
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-sm"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run()
            }}
            placeholder="输入正文关键词，如「电子病历五级整改」「互联互通四甲 数据元」"
            aria-label="正文字号检索关键词"
          />
        </div>
        <Button onClick={() => void run()} disabled={busy || !kw.trim()} className="h-9">
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
          搜正文
        </Button>
      </div>

      {searched && !busy && failMessage && (
        <ErrorState
          className="mt-2"
          tone="compact"
          title="正文检索没有成功"
          reason={failMessage}
          hint={failureHint(failMessage)}
          onRetry={() => void run()}
        />
      )}

      {searched && !busy && !failMessage && (
        items.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            命中 {total} 篇，显示前 {items.length} 篇
          </p>
        ) : (
          <EmptyState
            className="mt-2"
            tone="compact"
            title="没有找到正文包含该关键词的文档"
            hint="检索本身是成功的（不是故障）；可换个更短的关键词，或先用左侧列表按标题查找"
          />
        )
      )}

      {items.length > 0 && (
        <ul className="mt-2 max-h-96 space-y-1.5 overflow-y-auto">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onOpenDoc?.(it.id)}
                className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{it.title || "（无标题）"}</span>
                    {it.folder_path && (
                      <span className="block truncate text-[11px] text-muted-foreground">{it.folder_path}</span>
                    )}
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      <SnippetText snippet={it.snippet} />
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
