import { ArrowRightCircle, Copy, Loader2, ScanSearch } from "lucide-react"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import { Button } from "@/components/ui/button"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { DUP_VERDICT_LABEL, type DupPair, type IntraDupPair } from "@/pages/BidWorkspace/bidTypes"

type DupCheckPanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "dupLoading"
  | "runDupCheck"
  | "jumpToChapter"
  | "isArchivedLocked"
  | "intraDupThreshold"
  | "setIntraDupThreshold"
>

const VERDICT_BADGE: Record<string, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-secondary text-secondary-foreground",
  low: "bg-primary/10 text-primary",
}

export function DupPairCard({ pair, onJump }: { pair: DupPair; onJump?: (nodeId: string) => void }) {
  const pct = Math.round(pair.similarity * 100)
  return (
    <article className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {pair.target_chapter}
            <span className="mx-1.5 text-muted-foreground">↔</span>
            「{pair.source_project}」{pair.source_chapter}
          </p>
          {pair.ai_note && <p className="mt-0.5 text-xs text-muted-foreground">AI 复判：{pair.ai_note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pct >= 60 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            相似度 {pct}%
          </span>
          {pair.ai_verdict && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${VERDICT_BADGE[pair.ai_verdict] ?? "bg-muted text-muted-foreground"}`}>
              {DUP_VERDICT_LABEL[pair.ai_verdict as keyof typeof DUP_VERDICT_LABEL]}
            </span>
          )}
          {onJump && pair.target_node_id && (
            <Button size="sm" variant="outline" onClick={() => onJump(pair.target_node_id)} className="border-primary/40 text-primary hover:bg-primary/10">
              <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />
              去改写
            </Button>
          )}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">本标书段落</p>
          <p className="mt-1.5 text-xs leading-relaxed text-card-foreground">{pair.target_text}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">历史标书段落</p>
          <p className="mt-1.5 text-xs leading-relaxed text-card-foreground">{pair.source_text}</p>
        </div>
      </div>
    </article>
  )
}

/** 第七轮改造 4：本标书章间重复段落卡（零 AI 本地互查结果，双向跳章改写） */
export function IntraDupCard({ pair, onJump }: { pair: IntraDupPair; onJump?: (nodeId: string) => void }) {
  const pct = Math.round(pair.similarity * 100)
  return (
    <article className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-card-foreground">
            {pair.a_chapter}
            <span className="mx-1.5 text-muted-foreground">↔</span>
            {pair.b_chapter}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">同一标书内两章出现高度相似段落，评标专家对比阅读时易被认定为凑篇幅</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pct >= 60 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            相似度 {pct}%
          </span>
          {onJump && pair.a_node_id && (
            <Button size="sm" variant="outline" onClick={() => onJump(pair.a_node_id)} className="border-primary/40 text-primary hover:bg-primary/10">
              <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />
              改写「{pair.a_chapter}」侧
            </Button>
          )}
          {onJump && pair.b_node_id && (
            <Button size="sm" variant="outline" onClick={() => onJump(pair.b_node_id)} className="border-border text-muted-foreground shadow-sm hover:text-foreground">
              <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />
              改写「{pair.b_chapter}」侧
            </Button>
          )}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">{pair.a_chapter} 段落</p>
          <p className="mt-1.5 text-xs leading-relaxed text-card-foreground">{pair.a_text}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">{pair.b_chapter} 段落</p>
          <p className="mt-1.5 text-xs leading-relaxed text-card-foreground">{pair.b_text}</p>
        </div>
      </div>
    </article>
  )
}

export function DupCheckPanel({
  activeProject,
  dupLoading,
  runDupCheck,
  jumpToChapter,
  isArchivedLocked,
  intraDupThreshold,
  setIntraDupThreshold,
}: DupCheckPanelProps) {
  const report = activeProject?.dup_report ?? null
  // 第七轮改造 4：老数据没有 intra_pairs 字段时按空数组容错，不影响既有跨项目分组
  const intraPairs = report?.intra_pairs ?? []
  const chaptersReady = (activeProject?.bid_chapters ?? []).some((c) => (c.content ?? "").trim())
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground">标书查重</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              与你历史投标项目的标书正文对比：先在本地做段落级相似度粗筛（不产生费用），只把可疑段落交 AI 复判，输出相似段落对照。大段雷同有被认定串通投标的废标风险，高风险段落建议逐条改写。
            </p>
          </div>
          <Button
            onClick={runDupCheck}
            disabled={dupLoading || !chaptersReady || isArchivedLocked}
            title={isArchivedLocked ? "已归档项目为只读，解除归档后可重新查重" : undefined}
            className="shrink-0 bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
          >
            {dupLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-1.5 h-4 w-4" />}
            {dupLoading ? "查重进行中…" : report ? "重新查重" : "运行查重"}
          </Button>
        </div>
        {!chaptersReady && (
          <p className="mt-3 rounded-md border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
            投标文件还没有正文，请先完成「投标文件编制」环节
          </p>
        )}
      </header>

      {dupLoading ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-card py-16 text-center shadow-md">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">正在对比历史标书段落…</p>
          <p className="text-xs text-muted-foreground">本地粗筛完成后，可疑段落将交 AI 复判，约需 1 分钟</p>
        </div>
      ) : !report ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-md">
          <Copy className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">尚未执行查重</p>
          <p className="mt-1 text-xs text-muted-foreground">点右上角「运行查重」，与你的历史投标项目对比相似段落</p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">对比历史项目 {report.scanned_projects} 个</span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${report.suspect_count ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
              跨项目可疑段落 {report.suspect_count} 处
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${intraPairs.length ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
              章间重复 {intraPairs.length} 处
            </span>
            <span className="ml-auto text-xs text-muted-foreground">检查时间：{formatDateTimeDisplay(report.checked_at)}</span>
          </div>

          <div className="mt-6">
            <h2 className="text-sm font-semibold text-foreground">跨项目重复（与你的历史投标项目对比，可疑段落经 AI 复判）</h2>
            {report.scanned_projects === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                还没有可对比的历史投标项目，完成更多项目后跨项目查重会自动启用
              </p>
            ) : report.pairs.length === 0 ? (
              <p className="mt-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-6 text-center text-sm font-medium text-primary">
                未发现明显相似段落，可放心进入下一环节
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-4">
                {report.pairs.map((pair, i) => (
                  <DupPairCard key={i} pair={pair} onJump={jumpToChapter} />
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">本标书章间互查（本地算法零费用，跨章相似段落直接列出）</h2>
              {/* 循环 7 A4：相似度阈值滑杆（随项目持久化，调整后需重新查重生效） */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">相似度阈值</span>
                <input
                  type="range"
                  min={0.2}
                  max={0.6}
                  step={0.05}
                  value={intraDupThreshold}
                  disabled={isArchivedLocked}
                  onChange={(e) => setIntraDupThreshold(Number(e.target.value))}
                  className="h-1.5 w-36 cursor-pointer accent-primary disabled:cursor-not-allowed"
                />
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {Math.round(intraDupThreshold * 100)}%
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">阈值调低更严格（更多段落被列为可疑），调整后点右上角「重新查重」生效</p>
            {intraPairs.length === 0 ? (
              <p className="mt-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-6 text-center text-sm font-medium text-primary">
                未发现明显章间重复段落
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-4">
                {intraPairs.map((pair, i) => (
                  <IntraDupCard key={i} pair={pair} onJump={jumpToChapter} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
