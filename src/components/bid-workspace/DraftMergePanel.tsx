import { useMemo, useRef, useState } from "react"
import { ChevronDown, FileStack, Loader2, Sparkles, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import type { useBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { importDraftChapters } from "@/pages/BidWorkspace/bidDraftImport"
import { FormatSyncDialog } from "./FormatSyncDialog"
import { normalizeBidScope } from "@/pages/BidWorkspace/bidTypes"
import type { DraftChapter, DraftMergePlan, MergeAction } from "@/pages/BidWorkspace/bidDraftMerge"
import {
  applyMergePlan,
  draftKeptChapters,
  planForChapters,
  previewExtras,
  releaseDraftChapter,
  stripDraftRefBlock,
} from "@/pages/BidWorkspace/bidDraftPlan"
import type { DraftApplySummary } from "@/pages/BidWorkspace/bidDraftPlan"

/**
 * R245 底稿增量合并面板（用户 P0 需求 R-001 的接线片）：
 * 商务同事已写好的标书底稿（.docx/.pdf/.txt/.md）上传后，与本项目大纲逐章匹配，
 * 产出「原文保留 / 参考重写 / 缺失自动生成 / 补偏离表 / 底稿多出章追加」五态计划，一键落到章节清单。
 * 原文保留的章直接写入底稿正文并标记「底稿保留」（逐章生成天然跳过，绝不误删商务同事成果）；
 * 参考重写的章把底稿要点带进既有「写作资料」通道，逐章生成时按标题自动命中（零提示词改动）。
 */
type DraftMergePanelProps = Pick<
  ReturnType<typeof useBidWorkspace>,
  "activeProject" | "updateProject" | "isArchivedLocked" | "bidSourceMode" | "refMaterialsDraft" | "setRefMaterialsDraft"
>

const ACTION_META: Record<MergeAction, { label: string; hint: string; variant: "success" | "warning" | "neutral" | "danger" }> = {
  "keep-draft": { label: "底稿原文保留", hint: "不再生成，随全套导出", variant: "success" },
  "draft-as-reference": { label: "以底稿为参考", hint: "底稿要点带入，正文交 AI 重写", variant: "warning" },
  "generate-missing": { label: "缺失·自动生成", hint: "底稿没有，按大纲生成", variant: "neutral" },
  "append-deviation": { label: "补偏离表", hint: "在偏离表环节一键生成", variant: "neutral" },
  "draft-extra": { label: "底稿多出·追加保留", hint: "大纲未认领，原样追加为商务章", variant: "success" },
}

export function DraftMergePanel(p: DraftMergePanelProps) {
  const proj = p.activeProject
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState("")
  const [drafts, setDrafts] = useState<DraftChapter[] | null>(null)
  const [plan, setPlan] = useState<DraftMergePlan | null>(null)
  const [appendExtras, setAppendExtras] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applied, setApplied] = useState<DraftApplySummary | null>(null)
  const [formatFile, setFormatFile] = useState<File | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const keptChapters = useMemo(() => draftKeptChapters(proj?.bid_chapters ?? []), [proj])

  if (!proj || p.bidSourceMode === "external") return null

  // R246 空大纲引导：大纲未确认（bid_chapters 为空）时合并面板整体不渲染，用户会误以为功能缺失；
  // 改为给一张「先确认大纲再合并底稿」引导卡，指回上方 解析→生成→确认 动线（无副作用、零新状态）。
  if (proj.bid_chapters.length === 0) {
    return (
      <section className="mb-3 rounded-2xl border border-dashed border-border bg-card/50 px-4 py-3">
        <div className="flex items-start gap-2 text-xs">
          <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">底稿增量合并需先生成并确认大纲</p>
            <p className="mt-1 text-muted-foreground">
              当前项目还没有章节。请在上方完成「解读招标文件 → 生成大纲 → 确认章节」，再回到这里上传商务同事已写好的底稿，即可逐章匹配、原文保留并补齐缺失。
            </p>
          </div>
        </div>
      </section>
    )
  }

  const autoApplyFormat = async (file: File) => {
    try {
      const { extractDocxFormat, extractedToFields } = await import("@/pages/BidWorkspace/bidDocxFormatExtract")
      const ext = await extractDocxFormat(file)
      const fields = extractedToFields(ext)
      if (!fields.length) return
      const patch: Record<string, unknown> = {}
      for (const f of fields) f.apply(patch as never)
      const merged = { ...(proj.format_settings ?? {}), ...patch } as never
      p.updateProject({ format_settings: merged } as never)
      toast.success(`已自动同步底稿格式 ${fields.length} 项`)
    } catch { /* 静默 */ }
  }

  const applyFormatPatch = (patch: Record<string, unknown>) => {
    const merged = { ...(proj.format_settings ?? {}), ...patch } as never
    p.updateProject({ format_settings: merged } as never)
    setFormatOpen(false)
    toast.success(`已同步底稿格式 ${Object.keys(patch).length} 项`)
  }

  const load = async (file: File | null | undefined) => {
    if (!file) return
    if (p.isArchivedLocked) {
      toast.error("已归档项目为只读，解除归档后再合并底稿")
      return
    }
    setBusy(true)
    setApplied(null)
    try {
      const { chapters } = await importDraftChapters(file)
      const next = planForChapters(proj.bid_chapters, chapters)
      setFileName(file.name)
      setDrafts(chapters)
      setPlan(next)
      setOpen(true)
      if ((file.name ?? "").toLowerCase().endsWith(".docx")) {
        if (localStorage.getItem("xiaozhi.bid.formatSync.auto.v1") === "1") {
          void autoApplyFormat(file)
        } else {
          setFormatFile(file)
          setFormatOpen(true)
        }
      }
      const hit = next.stats.keep + next.stats.reference
      toast.success(
        `底稿已切成 ${chapters.length} 章，与大纲对上 ${hit} 章（保留 ${next.stats.keep} · 参考 ${next.stats.reference}），待生成 ${next.stats.generate} 章`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "底稿解析失败，请改存为带标题样式的 .docx 后重试")
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!plan || !drafts) return
    if (p.isArchivedLocked) return
    const out = applyMergePlan({
      chapters: proj!.bid_chapters,
      outline: proj!.bid_outline ?? [],
      plan,
      drafts,
      appendExtras,
    })
    p.updateProject({ bid_chapters: out.chapters, bid_outline: out.outline })
    if (out.refAppendix) {
      const base = stripDraftRefBlock(p.refMaterialsDraft)
      p.setRefMaterialsDraft(base ? `${base}\n\n${out.refAppendix}` : out.refAppendix)
    }
    setApplied(out.summary)
    setConfirmOpen(false)
    const s = out.summary
    toast.success(
      `合并计划已应用：${s.kept + s.appended} 章使用底稿原文（大纲位 ${s.kept} + 追加 ${s.appended}）` +
        (s.referenced ? `，${s.referenced} 章带底稿要点交 AI 重写` : "") +
        (s.folded ? `，${s.folded} 个小节已并入所属章` : "") +
        (s.pruned ? `，清理上轮遗留的底稿多出章 ${s.pruned} 个` : "") +
        (s.protectedFilled ? `；${s.protectedFilled} 章已有正文未被覆盖，已转参考材料` : ""),
    )
  }

  const release = (nodeId: string, title: string) => {
    if (p.isArchivedLocked) return
    const out = releaseDraftChapter(proj!.bid_chapters, nodeId, {
      outline: proj!.bid_outline,
      scope: normalizeBidScope(proj!.gen_options),
    })
    p.updateProject(out.partFlipped ? { bid_chapters: out.chapters, bid_outline: out.outline } : { bid_chapters: out.chapters })
    toast.info(
      `「${title}」已交回 AI 重写：底稿原文仍留在正文里，下次「逐章生成正文」会重写本章` +
        (out.partFlipped ? "（该章原为商务骨架章，已切为技术章才会参与生成，可在章节目录改回）" : ""),
    )
  }

  const reset = () => {
    setDrafts(null)
    setPlan(null)
    setApplied(null)
    setFileName("")
  }

  const stats = plan?.stats
  const totalChapters = proj.bid_chapters.length
  // 「底稿多出」以折叠后口径展示：Word 的二级标题小节并入所属章，不冒充独立章
  const extraPreview = plan && drafts ? previewExtras(drafts, plan) : null
  const appendPreviewTitles = extraPreview
    ? extraPreview.append.map((i) => drafts?.[i]?.title || "未命名章")
    : []
  const appendCount = extraPreview?.append.length ?? stats?.extra ?? 0
  const foldCount = extraPreview?.folded.length ?? 0

  /** R245 实机自测：保留章的「交 AI 重写」入口不能依赖本次是否解析过底稿——
   *  刷新重进项目后章节仍是锁定的，入口消失就等于锁死解不开，故抽成共享节点两处复用。 */
  const keptList = keptChapters.length > 0 && (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
      <p className="text-xs font-medium text-foreground">使用底稿原文的章（{keptChapters.length}）</p>
      <ul className="mt-1.5 space-y-1">
        {keptChapters.slice(0, 12).map((c) => (
          <li key={c.node_id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-foreground" title={c.draftFrom ? `底稿：${c.draftFrom}` : c.title}>
              {c.title}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{c.content.length} 字</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => release(c.node_id, c.title)}>
              交 AI 重写
            </Button>
          </li>
        ))}
        {keptChapters.length > 12 && (
          <li className="text-xs text-muted-foreground">…另有 {keptChapters.length - 12} 章</li>
        )}
      </ul>
    </div>
  )

  return (
    <section className="mb-3 rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <FileStack className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-semibold text-foreground">底稿增量合并</span>
          <span className="truncate text-xs text-muted-foreground">
            上传商务同事已写好的标书，逐章匹配大纲：商务与架构原文保留不动，技术带底稿要点重写，缺的自动补齐
          </span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.pdf,.txt,.md"
          className="hidden"
          onChange={(e) => {
            void load(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        <Button size="sm" variant="outline" disabled={busy || p.isArchivedLocked} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
          {busy ? "解析中…" : plan ? "重新上传底稿" : "上传底稿"}
        </Button>
        {plan && (
          <Button size="sm" variant="ghost" onClick={reset} title="清除本次底稿解析结果">
            <X className="mr-1.5 h-3.5 w-3.5" />
            清除
          </Button>
        )}
      </header>

      {!open || !plan || !stats ? (
        keptChapters.length > 0 && !plan ? (
          <div className="space-y-2.5 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              已有 {keptChapters.length} 章使用底稿原文（不参与逐章生成）；上传新底稿可重新匹配。
            </p>
            {keptList}
          </div>
        ) : null
      ) : (
        <div className="space-y-3 border-t border-border px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-foreground">
              底稿「{fileName}」共 {stats.total} 个匹配位（大纲 {totalChapters} 章）
            </span>
            <Badge variant="success">原文保留 {stats.keep}</Badge>
            <Badge variant="warning">带参考重写 {stats.reference}</Badge>
            <Badge variant="neutral">缺失自动生成 {stats.generate}</Badge>
            {stats.deviation > 0 && <Badge variant="neutral">补偏离表 {stats.deviation}</Badge>}
            {stats.extra > 0 && (
              <Badge variant="success">
                底稿多出 {appendCount} 章
                {foldCount > 0 ? ` · ${foldCount} 节并入所属章` : ""}
              </Badge>
            )}
          </div>

          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border/70 bg-muted/20 p-2">
            {plan.items.map((it) => {
              const meta = ACTION_META[it.action]
              return (
                <li key={it.outlineId} className="flex flex-wrap items-center gap-2 rounded-md bg-card px-2.5 py-1.5 text-xs shadow-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={it.outlineTitle}>
                    {it.outlineTitle}
                  </span>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="shrink-0 text-muted-foreground">
                    {it.matchedDraftIndex != null
                      ? `底稿「${it.matchedDraftTitle}」${it.stage === "exact" ? "标题一致" : `相似度 ${Math.round(it.confidence * 100)}%`}`
                      : "底稿无对应章"}
                  </span>
                </li>
              )
            })}
          </ul>

          {stats.extra > 0 && drafts && appendPreviewTitles.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={appendExtras}
                onChange={(e) => setAppendExtras(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[#0e9f8a]"
              />
              <span>
                追加底稿中大纲未认领的 {appendPreviewTitles.length} 章（
                {appendPreviewTitles.slice(0, 3).join("、")}
                {appendPreviewTitles.length > 3 ? " 等" : ""}），原样保留为商务章节
                {foldCount > 0 ? `；另有 ${foldCount} 个小节按标题层级并入所属章，不单独成章` : ""}
              </span>
            </label>
          )}

          {applied ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs text-foreground">
              <p className="font-medium">
                已应用：{applied.kept + applied.appended} 章使用底稿原文（大纲位 {applied.kept} · 追加 {applied.appended}
                {applied.folded > 0 ? ` · ${applied.folded} 节并入所属章` : ""}）
                {applied.referenced > 0 ? ` · ${applied.referenced} 章带底稿要点交 AI 重写` : ""}
              </p>
              {applied.protectedFilled > 0 && (
                <p className="mt-1 text-muted-foreground">
                  {applied.protectedFilled} 章已有正文，未被底稿覆盖，改作该章参考材料（可在写作资料里查看）
                </p>
              )}
              {applied.pruned > 0 && (
                <p className="mt-1 text-muted-foreground">
                  已清理上一轮底稿遗留、本轮不再存在的 {applied.pruned} 个「底稿多出章」
                </p>
              )}
              <p className="mt-1 text-muted-foreground">
                下一步照常「逐章生成正文」：保留章自动跳过，缺失章按大纲补齐。
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={p.isArchivedLocked}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                应用合并计划
              </Button>
              <span className="text-xs text-muted-foreground">
                仅整理章节归属与正文来源，不调用 AI、不产生费用；随时可逐章重新生成覆盖
              </span>
            </div>
          )}

          {keptList}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="应用底稿合并计划"
        description={
          stats
            ? `将把 ${stats.keep} 章大纲正文换成底稿原文并标记保留（不再参与逐章生成）${
                stats.reference ? `，${stats.reference} 章把底稿要点带入后仍由 AI 重写` : ""
              }${appendExtras && appendCount > 0 ? `，并追加 ${appendCount} 个底稿多出的章` : ""}${
                appendExtras && foldCount > 0 ? `（${foldCount} 个小节并入所属章）` : ""
              }。已有正文的章不会被覆盖。`
            : ""
        }
        confirmText="应用"
        onConfirm={apply}
      />
      <FormatSyncDialog
        open={formatOpen}
        file={formatFile}
        current={(proj.format_settings ?? null) as never}
        onClose={() => setFormatOpen(false)}
        onApply={(patch) => applyFormatPatch(patch as never)}
      />
    </section>
  )
}
