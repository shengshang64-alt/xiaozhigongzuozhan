import { useEffect, useMemo, useState } from "react"
import { Archive, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createKbDoc, extractKbIndex } from "@/lib/kbCore"
import { getCachedVisibleDocs } from "@/lib/kbAssemble"
import { KB_CATEGORIES } from "@/lib/kbPolicy"
import { decodeRhToken } from "@/lib/rhLogin"
import { deriveSection, deriveTrack } from "@/lib/kbTaxonomy"
import type { SolutionRecord } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// 历史方案拆块入素材库向导（轮次 E-2）：纯文本拆块，零 LLM 零费用。
// 逐章 createKbDoc 写入知识库，已存在同名同目录文档跳过；入库后
// 知识库检索 / 素材面板自动覆盖（kbCore 链路生效，无需额外接线）。
// ---------------------------------------------------------------------------

type SolutionToKbWizardProps = {
  solution: SolutionRecord | null
  userId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 入库完成后回调（刷新素材来源） */
  onImported: () => void
}

type ChapterRow = { node_id: string; title: string; charCount: number }

export function SolutionToKbWizard({ solution, userId, open, onOpenChange, onImported }: SolutionToKbWizardProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [folderPath, setFolderPath] = useState("")
  const [docCategory, setDocCategory] = useState<string>("项目案例")
  const [visibility, setVisibility] = useState<"personal" | "team">("personal")
  const [importing, setImporting] = useState(false)

  const chapterRows = useMemo<ChapterRow[]>(
    () =>
      (solution?.chapters ?? []).map((ch) => ({
        node_id: ch.node_id,
        title: ch.title,
        charCount: (ch.content ?? "").trim().length,
      })),
    [solution],
  )

  // 打开时初始化：默认全选有正文的章，目录默认「方案素材/<方案名>」
  useEffect(() => {
    if (!open || !solution) return
    setStep(1)
    setImporting(false)
    setSelectedIds(chapterRows.filter((c) => c.charCount > 0).map((c) => c.node_id))
    setFolderPath(`方案素材/${solution.solution_name}`)
    setDocCategory("项目案例")
    setVisibility("personal")
  }, [open, solution, chapterRows])

  const toggleChapter = (nodeId: string) => {
    setSelectedIds((prev) => (prev.includes(nodeId) ? prev.filter((x) => x !== nodeId) : [...prev, nodeId]))
  }

  const runImport = async () => {
    if (!solution || !userId) {
      toast.error("当前无法入库，请稍后重试")
      return
    }
    const targets = chapterRows.filter((c) => selectedIds.includes(c.node_id) && c.charCount > 0)
    if (!targets.length) {
      toast.error("请至少勾选一个有正文的章节")
      return
    }
    const folder = folderPath.trim() || `方案素材/${solution.solution_name}`
    setImporting(true)
    try {
      // R304(r303-kb-cache-bypass-sites)：去重读取走共享缓存——从方案页打开本向导时 R303 已预热缓存，
      // 不再额外全库下载一遍。去重口径同时收敛为「团队库 + 本人个人文档」：旧的全库口径会因他人同名
      // 个人文档把我方章节判成「已存在」而静默跳过导入，而本向导写的正是本人可见的文档。
      const existingDocs = await getCachedVisibleDocs(userId)
      const existingKeys = new Set(existingDocs.map((d) => `${d.folder_path}||${d.title}`))
      const uploaderName = decodeRhToken()?.nickName ?? ""
      let created = 0
      let skipped = 0
      for (const row of targets) {
        const chapter = solution.chapters.find((c) => c.node_id === row.node_id)
        const content = (chapter?.content ?? "").trim()
        if (!content) {
          skipped += 1
          continue
        }
        const title = `${solution.solution_name}·${row.title}`
        if (existingKeys.has(`${folder}||${title}`)) {
          skipped += 1
          continue
        }
        const { summary, keywords } = extractKbIndex(title, content)
        // 2026-10-07 用户口径：入库即按「章节用途/赛道」自动打标（设计方案/实施方案/售后方案…），
        // 生成检索（kbAssemble sections 软加权）可直接按用途取用
        const hay = `${title}
${content.slice(0, 2000)}`
        await createKbDoc({
          rh_user_id: userId,
          title,
          folder_path: folder,
          content,
          doc_format: "text",
          visibility,
          summary,
          keywords,
          source_file_name: "",
          uploader_name: uploaderName,
          doc_category: docCategory,
          kb_section: deriveSection(hay),
          kb_track: deriveTrack(hay),
          kb_bucket: "方案素材",
        })
        existingKeys.add(`${folder}||${title}`)
        created += 1
      }
      toast.success(`已入库 ${created} 篇（跳过 ${skipped} 篇重复）`)
      onOpenChange(false)
      onImported()
    } catch {
      toast.error("入库失败，请稍后重试")
    } finally {
      setImporting(false)
    }
  }

  const selectedCount = chapterRows.filter((c) => selectedIds.includes(c.node_id) && c.charCount > 0).length

  return (
    <Dialog open={open} onOpenChange={(next) => !importing && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Archive className="h-5 w-5 text-primary" />
            历史方案入素材库
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {solution ? `把《${solution.solution_name}》的成稿章节拆块写入知识库，纯文本复制零费用，入库后可在素材面板检索引用` : ""}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="mt-2 space-y-4">
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-2">
              {chapterRows.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">该方案没有章节</p>}
              {chapterRows.map((row) => {
                const hasContent = row.charCount > 0
                const on = selectedIds.includes(row.node_id)
                return (
                  <button
                    key={row.node_id}
                    type="button"
                    disabled={!hasContent}
                    onClick={() => toggleChapter(row.node_id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      !hasContent
                        ? "cursor-not-allowed border-transparent text-muted-foreground opacity-60"
                        : on
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-card text-card-foreground hover:border-primary/30"
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{hasContent ? `${row.charCount} 字` : "无正文"}</span>
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-foreground">目标目录</label>
                <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="方案素材/方案名" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">文档分类</label>
                <Select value={docCategory} onValueChange={setDocCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KB_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">可见范围</label>
                <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
                  {(["personal", "team"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVisibility(v)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        visibility === v ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v === "personal" ? "仅自己" : "团队可见"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">
                取消
              </Button>
              <Button onClick={() => setStep(2)} disabled={selectedCount === 0} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
                下一步：确认入库
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm leading-relaxed text-card-foreground">
              将入库 <span className="font-semibold text-primary">{selectedCount}</span> 篇章节素材：
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>目录：{folderPath.trim() || `方案素材/${solution?.solution_name ?? ""}`}</li>
                <li>分类：{docCategory} · 可见范围：{visibility === "personal" ? "仅自己" : "团队可见"}</li>
                <li>已存在的同名同目录文档自动跳过，不会产生重复</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={importing} className="text-muted-foreground hover:text-foreground">
                上一步
              </Button>
              <Button onClick={() => void runImport()} disabled={importing} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
                {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Archive className="mr-1 h-4 w-4" />}
                {importing ? "入库中…" : `确认入库 ${selectedCount} 篇`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
