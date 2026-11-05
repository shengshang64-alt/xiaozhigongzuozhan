// ---------------------------------------------------------------------------
// PPT 公司模板步骤（2026-10-30 补齐 3-c）
//
// 四步向导的第三步：上传公司模板 + 调整「页面类型 → 模板版式」映射。
//
// 解决的问题（用户第 7 条）：
//   「不允许只提取模板颜色和字体，就宣称"已按公司模板生成"。」
//
//   这里展示真实的 slideLayout 清单（名称 + 占位符特征），让用户能：
//     · 看到模板里到底有哪些版式
//     · 调整每类页面用哪个版式（可保存为公司默认）
//     · 明确知道哪些页面类型没匹配到版式（不静默降级）
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  mappingSummary,
  parseTemplateOutline,
  recommendMapping,
  resolveMapping,
  type TemplateOutline,
} from "@/pages/PptQuote/templateLayouts"
import { SLIDE_KINDS, KIND_LABEL, type SlideKindZ, type TemplateMappingZ } from "@/pages/PptQuote/deckSchema"

export function DeckTemplateStep({
  templateName,
  outline,
  mapping,
  onUpload,
  onClear,
  onMappingChange,
  builtinTemplates = [],
  builtinTemplateKey = null,
  onSelectBuiltin = async () => {},
}: {
  templateName: string | null
  outline: TemplateOutline | null
  mapping: TemplateMappingZ
  onUpload: (file: File) => Promise<void> | void
  onClear: () => void
  onMappingChange: (m: TemplateMappingZ) => void
  /** 2026-11-05 内置公司模板清单（随应用发布，走 fetch 不走 localStorage，不受 3MB 上限） */
  builtinTemplates?: { key: string; label: string; desc: string; layouts: string[] }[]
  builtinTemplateKey?: string | null
  onSelectBuiltin?: (key: string) => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [builtinBusy, setBuiltinBusy] = useState<string | null>(null)
  const [localOutline, setLocalOutline] = useState<TemplateOutline | null>(outline)
  const [localMapping, setLocalMapping] = useState<TemplateMappingZ>(mapping)
  const inputRef = useRef<HTMLInputElement>(null)

  // 外部 outline/mapping 变化时同步（上传后父组件会更新）
  const effectiveOutline = outline ?? localOutline
  const effectiveMapping = Object.keys(mapping).length ? mapping : localMapping

  const resolution = useMemo(
    () => (effectiveOutline ? resolveMapping(effectiveOutline, effectiveMapping) : null),
    [effectiveOutline, effectiveMapping],
  )

  async function handleFile(file: File) {
    setBusy(true)
    setParsing(true)
    try {
      // 本地先解析一次，让界面立刻展示版式清单（父组件也会解析一次用于导出）
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = parseTemplateOutline(bytes)
      setLocalOutline(parsed)
      if (parsed.failure) {
        toast.warning(`版式解析未成功：${parsed.failure}`)
      } else {
        const auto = recommendMapping(parsed)
        setLocalMapping(auto)
        onMappingChange(auto)
        toast.success(`已解析 ${parsed.layouts.length} 个版式，自动匹配 ${Object.keys(auto).length} 类页面`)
      }
      await onUpload(file)
    } catch (e) {
      toast.error(`模板上传失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function setKindLayout(kind: SlideKindZ, layoutId: string) {
    const next: TemplateMappingZ = { ...effectiveMapping }
    if (layoutId) next[kind] = layoutId
    else delete next[kind]
    setLocalMapping(next)
    onMappingChange(next)
  }

  async function selectBuiltin(key: string) {
    setBuiltinBusy(key)
    try {
      await onSelectBuiltin(key)
    } finally {
      setBuiltinBusy(null)
    }
  }

  if (!templateName && !effectiveOutline) {
    return (
      <div className="space-y-3">
        {/* 2026-11-05：内置公司模板放在最前——用户不必自己去找 .pptx 文件，
            且它 4.93MB 超过 localStorage 上限，只有这条 fetch 通道才能保住母版级保真。 */}
        {builtinTemplates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">公司内置模板（推荐）</p>
            {builtinTemplates.map((t) => (
              <div
                key={t.key}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                  builtinTemplateKey === t.key ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{t.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.desc}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">版式：{t.layouts.join(" / ")}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={builtinBusy !== null}
                  onClick={() => void selectBuiltin(t.key)}
                  className="gap-1.5"
                >
                  {builtinBusy === t.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  用这个模板
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              内置模板随应用发布，导出走母版/版式级保真（封面/目录/章节/内页/封底各自套真实母版）。
            </p>
          </div>
        )}
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
          <p className="text-sm font-medium text-foreground">或上传其他公司模板，导出时按真实版式生成</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            支持 .pptx / .potx。上传后会解析模板里的母版与版式（封面页 / 目录页 / 章节页 / 内容页…），
            导出时按页面类型自动套用对应版式，而不是只用内置布局。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="mt-3 gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            选择模板文件
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pptx,.potx"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
            aria-label="上传公司模板"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          也可以跳过：不传模板时用内置商务版式（配色可后续在导出工具栏切换）。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 当前模板 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <span className="text-xs font-medium text-foreground">当前模板：{templateName ?? "（本地解析）"}</span>
        {parsing && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()} className="h-7 gap-1 text-xs">
            <Upload className="h-3 w-3" />
            更换
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setLocalOutline(null)
              setLocalMapping({})
              onMappingChange({})
              onClear()
            }}
            className="h-7 gap-1 text-xs text-muted-foreground"
          >
            <X className="h-3 w-3" />
            移除
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pptx,.potx"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
          aria-label="更换公司模板"
        />
      </div>

      {/* 版式清单 */}
      {effectiveOutline && !effectiveOutline.failure && (
        <>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              模板版式（{effectiveOutline.layouts.length} 个，母版 {effectiveOutline.masterCount} 个）
            </p>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border/60">
              <ul className="divide-y divide-border/40">
                {effectiveOutline.layouts.map((l) => (
                  <li key={l.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">{l.layoutId}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground" title={l.name}>
                      {l.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {l.hasTitle ? "标题" : ""}
                      {l.hasBody ? " +正文" : ""}
                      {!l.hasTitle && !l.hasBody ? "空白" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 映射调整 */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">页面类型 → 版式映射</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {SLIDE_KINDS.map((k) => {
                const cur = effectiveMapping[k] ?? ""
                const layout = resolution?.resolved[k]
                return (
                  <label key={k} className="flex items-center gap-2 rounded border border-border/60 px-2 py-1">
                    <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{KIND_LABEL[k]}</span>
                    <select
                      value={cur}
                      onChange={(e) => setKindLayout(k, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground"
                      aria-label={`${KIND_LABEL[k]} 使用的版式`}
                    >
                      <option value="">（未映射）</option>
                      {effectiveOutline.layouts.map((l) => (
                        <option key={l.path} value={l.layoutId}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    {layout ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-success" aria-label="已匹配" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 shrink-0 text-warning" aria-label="未匹配" />
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          {/* 结论提示 */}
          {resolution && resolution.missing.length > 0 ? (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {resolution.missing.length} 类页面未匹配到版式（{resolution.missing.map((k) => KIND_LABEL[k]).join("、")}），
              导出时会用通用的标题+正文版式。
            </p>
          ) : (
            <p className="flex items-center gap-1.5 rounded-md bg-success/5 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              全部页面类型已匹配到模板版式。{mappingSummary(effectiveOutline, effectiveMapping).slice(0, 80)}
            </p>
          )}

          {/* 正文区提示：模板版式无正文占位符时说明 */}
          {resolution && resolution.bodyFromRenderer.length > 0 && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              提示：{resolution.bodyFromRenderer.length} 类页面所用的模板版式只有标题占位符，
              正文会按版式安全区自动排布（不覆盖模板 Logo 与装饰元素）。
            </p>
          )}
        </>
      )}

      {effectiveOutline?.failure && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          模板版式解析未成功：{effectiveOutline.failure}。导出时只套用配色与字体，用内置布局。
        </p>
      )}
    </div>
  )
}
