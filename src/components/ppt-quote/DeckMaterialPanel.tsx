// ---------------------------------------------------------------------------
// PPT 素材上传面板（2026-10-30 补齐 3-b）
//
// 四步向导的第二步：上传参考素材（DOCX/PDF/PPTX/XLSX/TXT）。
// 上传后：
//   · 自动解析 → 分块 → 建检索索引（deckMaterialStore）
//   · 展示「命中的段落数」与解析警告（扫描件会提示需 OCR）
//   · 检测素材间数据冲突并提示用户确认（不自动裁决）
//
// 设计取舍：
//   · 素材只存会话级（sessionStorage 存文本，内存存索引），不落库——
//     PPT 素材是一次性上下文，不像知识库需要长期治理
//   · 支持「内容素材 / 视觉素材」两类分开上传（需求明确不得混用）
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, FileText, Loader2, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  addMaterialFiles,
  clearMaterials,
  getMaterialState,
  removeMaterial,
  type MaterialItem,
  type MaterialState,
} from "@/pages/PptQuote/deckMaterialStore"
import type { ConflictHit } from "@/pages/PptQuote/deckMaterials"

const ACCEPT = ".docx,.pdf,.pptx,.xlsx,.xls,.csv,.txt,.md"

export function DeckMaterialPanel({ onChanged }: { onChanged?: (state: MaterialState) => void }) {
  const [state, setState] = useState<MaterialState>(() => getMaterialState())
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<"content" | "visual">("content")
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    const next = getMaterialState()
    setState(next)
    onChanged?.(next)
  }, [onChanged])

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setBusy(true)
      try {
        const { added, errors } = await addMaterialFiles(Array.from(files), kind)
        if (added.length) {
          const chars = added.reduce((n, a) => n + a.charCount, 0)
          toast.success(`已加入 ${added.length} 份${kind === "content" ? "内容" : "视觉"}素材（${chars.toLocaleString()} 字）`)
        }
        for (const e of errors) toast.error(e)
        refresh()
      } catch (e) {
        toast.error(`上传失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ""
      }
    },
    [kind, refresh],
  )

  const contentItems = state.items.filter((i) => i.kind === "content")
  const visualItems = state.items.filter((i) => i.kind === "visual")

  return (
    <div className="space-y-4">
      {/* 上传区 */}
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            {(["content", "visual"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "content" ? "内容素材" : "视觉素材"}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            选择文件
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => void handleFiles(e.target.files)}
            aria-label="上传参考素材"
          />
          {state.items.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                clearMaterials()
                refresh()
                toast.info("已清空素材库")
              }}
              className="ml-auto gap-1.5 text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {kind === "content"
            ? "内容素材用于事实、产品名称、项目参数、数据、建设范围与实施计划。支持 DOCX / PDF / PPTX / XLSX / TXT。"
            : "视觉素材用于版式与风格参考（配色、构图），不参与内容检索。支持 PPTX / PDF / 图片型文档。"}
        </p>
      </div>

      {/* 已上传列表 */}
      {contentItems.length > 0 && <MaterialList title="内容素材" items={contentItems} onRemove={(id) => { removeMaterial(id); refresh() }} />}
      {visualItems.length > 0 && <MaterialList title="视觉素材" items={visualItems} onRemove={(id) => { removeMaterial(id); refresh() }} />}

      {/* 冲突提示（§4.2：素材数据冲突不得自行选择，必须提示用户确认） */}
      {state.conflicts.length > 0 && <ConflictNotice conflicts={state.conflicts} />}

      {/* 摘要 */}
      {state.items.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {state.summary}；生成时每页会自动召回最相关的片段，并记录引用来源
        </p>
      )}
      {state.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          不上传也可以生成（AI 会用通用行业知识），但上传后内容更贴合真实项目，且每页可追溯到素材原文。
        </p>
      )}
    </div>
  )
}

function MaterialList({ title, items, onRemove }: { title: string; items: MaterialItem[]; onRemove: (id: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        {title}（{items.length}）
      </p>
      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 px-3 py-2 text-sm">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-foreground" title={it.name}>
                {it.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {it.charCount.toLocaleString()} 字 · {it.chunkCount} 个片段
                {it.warnings.length ? ` · ${it.warnings[0]}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(it.id)}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={`移除 ${it.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConflictNotice({ conflicts }: { conflicts: ConflictHit[] }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        发现 {conflicts.length} 处素材数据冲突，请人工确认口径
      </p>
      <ul className="mt-2 space-y-1.5">
        {conflicts.slice(0, 5).map((c) => (
          <li key={c.metric} className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{c.metric}</span>
            ：{c.values.join(" / ")}
            <span className="ml-1 opacity-70">（来自 {Array.from(new Set(c.refs.map((r) => r.materialName))).slice(0, 2).join("、")}）</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        系统不会自行选择采用哪个数值，请在生成后人工核对相关页面。
      </p>
    </div>
  )
}
