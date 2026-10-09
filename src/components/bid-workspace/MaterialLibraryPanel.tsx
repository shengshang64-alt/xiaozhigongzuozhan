import { useMemo, useRef, useState } from "react"
import { ChevronDown, Library, Loader2, RotateCcw, Save, Tags, Upload, Wand2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  COMPANY_DEFAULTS,
  MATERIAL_KINDS,
  isCompanyDefaultBody,
  parseMaterialLibrary,
  type MaterialKind,
  type MaterialLibrary,
} from "@/pages/BidWorkspace/materialLibrary"

type MaterialLibraryPanelProps = Pick<
  UseBidWorkspace,
  "refMaterialsDraft" | "activeProject" | "isArchivedLocked" | "refFileBusy" | "saveMaterialLibrary" | "applyLibraryDefaults" | "importLibraryFile" | "classifyLibraryDraft"
>

/**
 * R167 标书优质素材库面板：五类公司标准件（设计方案/项目背景分析/实施方案/培训方案/测试方案）
 * 的分类编辑台。内容编码进项目 ref_materials_text（零 schema），逐章/逐节生成时按标题命中类别
 * 自动带对应标准件作为「结构基线」，再由模型按招标要求与全局事实定向调整（口径见 prompts/bidChapter）。
 * 纯本地编辑 + 既有防抖落盘，不新增任何 AI 调用。
 */
export function MaterialLibraryPanel(p: MaterialLibraryPanelProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<MaterialLibrary>(() => parseMaterialLibrary(p.refMaterialsDraft))
  const [active, setActive] = useState<MaterialKind | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 切项目时在渲染期重置编辑态（React 官方「随 props 变化重置 state」范式，避免 effect 内 setState 级联渲染）
  const [syncedId, setSyncedId] = useState(p.activeProject?.id)
  if (p.activeProject?.id !== syncedId) {
    setSyncedId(p.activeProject?.id)
    setDraft(parseMaterialLibrary(p.refMaterialsDraft))
  }

  const counts = useMemo(() => {
    const c: Record<MaterialKind, number> = { design: 0, background: 0, implementation: 0, training: 0, testing: 0 }
    for (const m of MATERIAL_KINDS) c[m.kind] = (draft[m.kind] ?? "").trim().length
    return c
  }, [draft])
  const filled = MATERIAL_KINDS.filter((m) => counts[m.kind] > 0)
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(parseMaterialLibrary(p.refMaterialsDraft)),
    [draft, p.refMaterialsDraft],
  )

  const setKind = (kind: MaterialKind, value: string) => setDraft((prev) => ({ ...prev, [kind]: value }))

  const save = () => {
    if (p.saveMaterialLibrary(draft)) setDraft(parseMaterialLibrary(p.refMaterialsDraft))
  }

  const applyDefaults = () => {
    const empties = MATERIAL_KINDS.filter((m) => counts[m.kind] === 0).map((m) => m.kind)
    if (!empties.length) {
      toast.info("五类标准件均已有内容，无需套用默认")
      return
    }
    if (p.applyLibraryDefaults(empties)) setDraft(parseMaterialLibrary(p.refMaterialsDraft))
  }

  const importFile = (file: File | null | undefined) => {
    void p.importLibraryFile(file).then(() => setDraft(parseMaterialLibrary(p.refMaterialsDraft)))
  }

  const classify = () => {
    if (p.classifyLibraryDraft()) setDraft(parseMaterialLibrary(p.refMaterialsDraft))
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Library className="h-4 w-4 text-primary" />
          公司优质素材库（标准件）
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{filled.length}/5 类有内容</span>
          {dirty && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">未保存</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            沉淀公司较优标书的五类标准件写作范式：设计方案、项目背景分析、实施方案、培训方案、测试方案。
            编制正文时，程序按章 / 节标题命中类别自动带上对应标准件作为<span className="font-medium text-primary">结构基线</span>，
            再按本项目的招标条款、评分办法与全局事实<span className="font-medium text-primary">定向调整</span>（禁止照抄、禁止沿用占位）。
            内容随项目保存，全部为本地编辑，不产生任何费用。
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={applyDefaults} className="border-border text-card-foreground shadow-sm hover:bg-secondary">
              <Wand2 className="mr-1 h-3.5 w-3.5" />
              套用公司默认标准件
            </Button>
            <Button size="sm" variant="outline" onClick={classify} className="border-border text-card-foreground shadow-sm hover:bg-secondary">
              <Tags className="mr-1 h-3.5 w-3.5" />
              自由资料一键归类
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={p.refFileBusy}
              className="border-border text-card-foreground shadow-sm hover:bg-secondary"
            >
              {p.refFileBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
              导入素材文件（自动归类）
            </Button>
            <input ref={fileInputRef} type="file" accept=".docx,.pdf,.txt,.md" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = "" }} />
          </div>

          <div className="mt-4 space-y-2">
            {MATERIAL_KINDS.map((m) => {
              const body = draft[m.kind] ?? ""
              const n = counts[m.kind]
              const isDefault = n > 0 && isCompanyDefaultBody(m.kind, body)
              const isActive = active === m.kind
              return (
                <div key={m.kind} className="rounded-md border border-border bg-background">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setActive(isActive ? null : m.kind)}
                      aria-expanded={isActive}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    >
                      <span className="shrink-0 text-xs font-semibold text-foreground">{m.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.hint}</span>
                      <span
                        className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          n === 0 ? "bg-muted text-muted-foreground" : isDefault ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
                        }`}
                      >
                        {n === 0 ? "未建" : isDefault ? "公司默认" : `自定义 ${n} 字`}
                      </span>
                    </button>
                    {n > 0 && (
                      <Button size="sm" variant="ghost" aria-label={`清空「${m.label}」标准件`} onClick={() => setKind(m.kind, "")} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {isActive && (
                    <div className="border-t border-border px-3 py-3">
                      <Textarea
                        value={body}
                        onChange={(e) => setKind(m.kind, e.target.value)}
                        readOnly={p.isArchivedLocked}
                        placeholder={`粘贴或编辑「${m.label}」的公司标准件（可先点上方「套用公司默认标准件」得到结构骨架，再按本院口径替换占位）…`}
                        className="min-h-[16rem] resize-y border-border bg-background font-sans text-xs leading-relaxed text-foreground focus-visible:shadow-[var(--focus-ring)]"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">〔按本项目填写：…〕为占位，正文生成前须替换或删除，否则模型不会沿用。</p>
                        <Button size="sm" variant="ghost" onClick={() => setKind(m.kind, COMPANY_DEFAULTS[m.kind])} className="text-muted-foreground hover:text-foreground">
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          重置为公司默认
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={!dirty || p.isArchivedLocked} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
              <Save className="mr-1.5 h-4 w-4" />
              保存素材库
            </Button>
            {p.isArchivedLocked && <span className="text-xs text-muted-foreground">已归档项目为只读</span>}
          </div>
        </div>
      )}
    </div>
  )
}
