import { useState } from "react"
import { Eye, History, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  SNAPSHOT_STAGE_BADGE,
  SNAPSHOT_STAGE_LABEL,
  type SnapshotStage,
  type StageSnapshotRow,
} from "@/pages/BidWorkspace/bidTypes"

type StageHistoryPanelProps = Pick<
  UseBidWorkspace,
  "stageHistory" | "stageHistoryLoading" | "loadStageHistory" | "restoreSnapshot" | "snapshotBusyId"
>

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

/** 按 stage 生成 payload 摘要（本地计算，不展示原文全文） */
function payloadSummary(stage: SnapshotStage, payload: Record<string, unknown> | null): string {
  if (!payload) return "无附加内容"
  const parts: string[] = []
  const report = payload.parse_report as { scoring_items?: unknown[]; qualifications?: unknown[]; void_clauses?: unknown[] } | undefined
  if (report) {
    parts.push(`评分项 ${report.scoring_items?.length ?? 0} 条`)
    parts.push(`资质要求 ${report.qualifications?.length ?? 0} 条`)
    parts.push(`废标条款 ${report.void_clauses?.length ?? 0} 条`)
  }
  const outline = payload.outline as { title?: string }[] | undefined
  if (outline) parts.push(`大纲节点 ${outline.length} 个`)
  const chapters = payload.bid_chapters as { title?: string; content?: string }[] | undefined
  if (chapters) {
    const done = chapters.filter((c) => (c.content ?? "").trim().length > 0).length
    parts.push(`章节 ${done}/${chapters.length} 章成稿`)
  }
  const content = payload.content
  if (typeof content === "string") parts.push(`正文 ${content.length} 字`)
  const dup = payload.dup_report as { items?: unknown[] } | undefined
  if (dup) parts.push(`查重结果 ${dup.items?.length ?? 0} 条`)
  const voidCheck = payload.void_check as { items?: unknown[] } | undefined
  if (voidCheck) parts.push(`废标自查 ${voidCheck.items?.length ?? 0} 条`)
  const review = payload.ai_review as Record<string, unknown> | undefined
  if (review) parts.push("三路评标结果")
  const submission = payload.submission_check as { items?: unknown[] } | undefined
  if (submission) parts.push(`交卷体检 ${submission.items?.length ?? 0} 项`)
  if (parts.length === 0) parts.push(stage === "chapter" ? "章节正文快照" : "环节产物快照")
  return parts.join(" · ")
}

export function StageHistoryPanel(p: StageHistoryPanelProps) {
  // 「查看」预览弹窗
  const [preview, setPreview] = useState<StageSnapshotRow | null>(null)
  // parse/outline/reset 恢复前的「清空下游」询问弹窗
  const [downstreamAsk, setDownstreamAsk] = useState<StageSnapshotRow | null>(null)
  const [clearDownstream, setClearDownstream] = useState(true)
  // chapter/check/eval 恢复的二次确认
  const [restoreConfirm, setRestoreConfirm] = useState<StageSnapshotRow | null>(null)

  const askDownstream = (snap: StageSnapshotRow) => snap.stage === "parse" || snap.stage === "outline" || snap.stage === "reset"

  const requestRestore = (snap: StageSnapshotRow) => {
    if (askDownstream(snap)) {
      setClearDownstream(true)
      setDownstreamAsk(snap)
    } else {
      setRestoreConfirm(snap)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-md">
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="h-4 w-4 text-primary" />
          工作记录
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={p.stageHistoryLoading}
          onClick={() => void p.loadStageHistory()}
          className="text-muted-foreground hover:text-foreground"
        >
          <Loader2 className={`mr-1.5 h-3.5 w-3.5 ${p.stageHistoryLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </header>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        每个环节成功完成时自动留档，误操作后可恢复到任意历史版本；重置项目前的全量备份也保存在这里
      </p>

      {p.stageHistoryLoading && p.stageHistory.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          工作记录加载中…
        </div>
      ) : p.stageHistory.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">本项目还没有工作记录</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {p.stageHistory.map((snap) => {
            const busy = p.snapshotBusyId === snap.id
            return (
              <li
                key={snap.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
              >
                <Badge variant={SNAPSHOT_STAGE_BADGE[snap.stage as SnapshotStage] ?? "neutral"} className="shrink-0">
                  {SNAPSHOT_STAGE_LABEL[snap.stage as SnapshotStage] ?? snap.stage}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={snap.label}>
                  {snap.label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relTime(snap.created)}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPreview(snap)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    查看
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => requestRestore(snap)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    恢复此版本
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/* 快照内容预览 */}
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {preview ? (SNAPSHOT_STAGE_LABEL[preview.stage as SnapshotStage] ?? "快照") : "快照"}
            </DialogTitle>
            <DialogDescription>{preview?.label ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
            {preview ? payloadSummary(preview.stage as SnapshotStage, preview.payload ?? null) : ""}
          </div>
          <p className="text-xs text-muted-foreground">
            {preview ? `留档于 ${preview.created ? new Date(preview.created).toLocaleString("zh-CN") : "—"}` : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} className="border-border text-muted-foreground hover:text-foreground">
              关闭
            </Button>
            <Button
              variant="outline"
              className="border-primary/40 text-primary hover:bg-primary/10"
              onClick={() => {
                const snap = preview
                setPreview(null)
                if (snap) requestRestore(snap)
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              恢复此版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* parse/outline/reset：询问是否同时清空下游产物 */}
      <Dialog open={!!downstreamAsk} onOpenChange={(v) => !v && setDownstreamAsk(null)}>
        <DialogContent className="max-w-sm rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">恢复到该版本？</DialogTitle>
            <DialogDescription>
              将恢复「{downstreamAsk?.label ?? ""}」。该环节之后的产物（大纲 / 章节正文 / 检查与评标报告等）如何处理？
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={clearDownstream}
              onChange={(e) => setClearDownstream(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            同时清空其后的下游产物（推荐，避免新旧内容混杂）
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownstreamAsk(null)} className="border-border text-muted-foreground hover:text-foreground">
              取消
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                const snap = downstreamAsk
                setDownstreamAsk(null)
                if (snap) void p.restoreSnapshot(snap, clearDownstream)
              }}
            >
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* chapter/check/eval：直接二次确认 */}
      <ConfirmDialog
        open={!!restoreConfirm}
        onOpenChange={(v) => !v && setRestoreConfirm(null)}
        title="恢复到该版本？"
        description={`将用「${restoreConfirm?.label ?? ""}」的留档内容覆盖当前结果，恢复后会自动再存一条工作记录。`}
        confirmText="确认恢复"
        cancelText="取消"
        onConfirm={() => {
          const snap = restoreConfirm
          setRestoreConfirm(null)
          if (snap) void p.restoreSnapshot(snap, false)
        }}
      />
    </section>
  )
}
