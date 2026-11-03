import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { triggerBlobDownload } from "@/lib/download"
import {
  DEFAULT_FORMAT_SETTINGS,
  type FormatAlign,
  type FormatFont,
  type FormatSettings,
  type FormatFontSize,
} from "@/pages/BidWorkspace/bidTypes"
import { extractFormatSpecFromFile, specToFormatSettings, type FormatSpec } from "./formatSpec"
import { refreshDocxFile, type FormatApplyReport } from "./refreshDocx"
import type { FormatScope } from "./formatDiff"

// ---------------------------------------------------------------------------
// 格式刷新工具 · 状态层（第一阶段：识别 → 手动微调 → 存为模板 → 模板库）
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
    err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

export type FormatTemplateRecord = {
  id: string
  name: string
  spec?: FormatSpec
  format_settings?: FormatSettings
  notes?: string[]
  source_file_name?: string
  is_default?: boolean
  created?: string
  updated?: string
}

type ListResponse<T> = { items: T[] }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "").slice(0, 60) || "未命名模板"
}

/** R88/F17：模板名显示层剥内部标记（如「[PDF多模态转译]」前缀）。
 * 仅渲染时剥除，库数据与编辑回填保持原值——与 R57 显示层归一同口径，不动数据。 */
export function stripInternalTemplateMarks(name: string): string {
  const stripped = (name ?? "").replace(/\s*(?:\[|【)[^\]】\n]*(?:\]|】)\s*/g, " ").trim()
  return stripped.length > 0 ? stripped : (name ?? "")
}

export function useFormatTool() {
  const [templates, setTemplates] = useState<FormatTemplateRecord[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  // R58：第 1 步上传的「待刷新原文档」引用（仅内存，不落库）——导出刷新后文档用
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [exporting, setExporting] = useState(false)
  // R-009：一键应用 → 校验报告 → 导出 三段式（应用与导出解耦）
  const [applyResult, setApplyResult] = useState<{
    blob: Blob
    report: FormatApplyReport
    notes: string[]
  } | null>(null)
  const [applying, setApplying] = useState(false)

  // 当前编辑中的模板
  const [name, setName] = useState("")
  const [isDefault, setIsDefault] = useState(false)
  const [settings, setSettings] = useState<FormatSettings>(() => clone(DEFAULT_FORMAT_SETTINGS))
  const [spec, setSpec] = useState<FormatSpec | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await apiFetch<ListResponse<FormatTemplateRecord>>("/api/format_templates")
      setTemplates(res.items ?? [])
    } catch {
      toast.error("模板库加载失败")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  // ---- 上传要刷新的文档（附三用户需求解耦：只设源文件 + 识别原格式供改前对比，
  // 不再覆盖当前模板配置——v1 上传即覆盖模板，导致「按我的模板刷新」不成立）----
  const handleUploadSource = useCallback(async (file: File) => {
    setUploading(true)
    try {
      setSourceFile(file)
      try {
        setSpec(await extractFormatSpecFromFile(file))
      } catch {
        setSpec(null) // 识别失败不阻塞上传：diff 预览空、导出仍按当前模板执行
      }
      toast.success(`已上传「${file.name}」，请在第 2 步选择套用的模板后导出`)
    } finally {
      setUploading(false)
    }
  }, [])

  // ---- 上传格式方案识别（建模板专用：识别结果覆盖当前编辑配置）----
  const handleRecognize = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const extracted = await extractFormatSpecFromFile(file)
      const mapped = specToFormatSettings(extracted)
      setSpec(extracted)
      setSourceFile(file)
      setSettings(mapped.settings)
      setNotes(mapped.notes)
      setEditingId(null)
      if (!name.trim()) setName(stripExt(file.name))
      toast.success("已识别格式，请在下方核对/微调后保存为模板")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "识别失败，请确认上传的是 .docx 文件")
    } finally {
      setUploading(false)
    }

  }, [name])

  // ---- R-009：一键应用格式（应用 + 产出后复检，不直接下载）----
  const applyFormat = useCallback(
    async (scopes: FormatScope[], opts?: { removeUnusedStyles?: boolean; overrideDirectFormat?: boolean }) => {
      if (!sourceFile) {
        toast.error("请先在第 1 步上传要刷新的 .docx 文档")
        return
      }
      setApplying(true)
      try {
        const r = await refreshDocxFile(sourceFile, settings, scopes, opts)
        setApplyResult({ blob: r.blob, report: r.report, notes: r.notes })
        const fails = [r.report.slots.bodyFont, r.report.slots.heading, r.report.slots.lineSpacing, r.report.slots.pageMargin].filter(
          (x) => x.status === "fail",
        )
        if (fails.length) {
          toast.warning(`格式应用完成，${fails.length} 项未生效——导出前请查看报告`, {
            description: fails.map((f) => f.reason).slice(0, 2).join("；"),
          })
        } else if (r.report.textBefore !== r.report.textAfter) {
          toast.warning(`格式已生效 ${r.report.okCount}/${r.report.totalCount}，但正文文字数发生变化（${r.report.textBefore} → ${r.report.textAfter}），请在报告中核对`)
        } else {
          toast.success(`格式应用完成：已生效 ${r.report.okCount}/${r.report.totalCount}，正文字符 0 改动`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "应用失败，请确认文档是未加密的 .docx")
      } finally {
        setApplying(false)
      }
    },
    [sourceFile, settings],
  )

  // ---- 导出已应用的结果（须先一键应用；下载 applyResult.blob，不再重复改写）----
  const exportApplied = useCallback(() => {
    if (!applyResult) {
      toast.error("请先点「一键应用格式」生成校验报告，再导出")
      return
    }
    if (!sourceFile) {
      toast.error("请先在第 1 步上传要刷新的 .docx 文档")
      return
    }
    const downloadName = sourceFile.name.replace(/\.docx$/i, "") + "-格式刷新.docx"
    triggerBlobDownload(applyResult.blob, downloadName)
    toast.success(`已导出「${downloadName}」，正文文字 0 改动`)
    if (applyResult.notes.length) {
      toast.info(applyResult.notes[0], {
        description: applyResult.notes.length > 1 ? `另有 ${applyResult.notes.length - 1} 条提示` : undefined,
      })
    }
  }, [applyResult, sourceFile])

  // ---- R58：按当前模板配置改写原文档并下载（文字 0 改动）----
  const exportRefreshed = useCallback(async (scopes: FormatScope[], opts?: { removeUnusedStyles?: boolean; overrideDirectFormat?: boolean }) => {
    if (!sourceFile) {
      toast.error("请先在第 1 步上传要刷新的 .docx 文档")
      return
    }
    setExporting(true)
    try {
      const { blob, notes } = await refreshDocxFile(sourceFile, settings, scopes, opts)
      const downloadName = sourceFile.name.replace(/\.docx$/i, "") + "-格式刷新.docx"
      triggerBlobDownload(blob, downloadName)
      toast.success(`已导出「${downloadName}」，正文文字 0 改动`)
      if (notes.length) toast.info(notes[0], { description: notes.length > 1 ? `另有 ${notes.length - 1} 条提示` : undefined })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败，请确认文档是未加密的 .docx")
    } finally {
      setExporting(false)
    }
  }, [sourceFile, settings])

  // ---- 从零手动定义 ----
  const startBlank = useCallback(() => {
    setSpec(null)
    setSourceFile(null)
    setNotes([])
    setSettings(clone(DEFAULT_FORMAT_SETTINGS))
    setName("")
    setIsDefault(false)
    setEditingId(null)
  }, [])

  const editTemplate = useCallback((rec: FormatTemplateRecord) => {
    setEditingId(rec.id)
    setName(rec.name)
    setIsDefault(!!rec.is_default)
    setSpec(rec.spec ?? null)
    setNotes(rec.notes ?? [])
    setSettings(rec.format_settings ? clone(rec.format_settings) : clone(DEFAULT_FORMAT_SETTINGS))
  }, [])

  // ---- 编辑器 patch（全部走不可变更新）----
  const patchSettings = useCallback((patch: Partial<FormatSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])
  const patchMargin = useCallback((key: "top" | "bottom" | "left" | "right", val: number) => {
    setSettings((s) => ({ ...s, margins: { ...s.margins, [key]: val } }))
  }, [])
  const patchHeading = useCallback((level: number, patch: Partial<{ font: FormatFont; size: FormatFontSize; align: FormatAlign }>) => {
    setSettings((s) => {
      const heading = s.heading.map((h, i) => (i === level ? { ...h, ...patch } : h))
      return { ...s, heading }
    })
  }, [])
  const patchBody = useCallback((patch: Partial<FormatSettings["body"]>) => {
    setSettings((s) => ({ ...s, body: { ...s.body, ...patch } }))
  }, [])

  // ---- 保存 / 删除 / 设默认 ----
  const saveTemplate = useCallback(async () => {
    if (!name.trim()) {
      toast.error("请先给模板起个名字")
      return
    }
    setBusy(true)
    try {
      const payload = {
        name: name.trim(),
        spec: spec ?? {},
        format_settings: settings,
        notes,
        source_file_name: spec?.sourceFileName ?? "",
        is_default: isDefault,
      }
      if (editingId) {
        await apiFetch(`/api/format_templates/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) })
        toast.success("模板已更新")
      } else {
        await apiFetch("/api/format_templates", { method: "POST", body: JSON.stringify(payload) })
        toast.success("模板已保存到模板库")
      }
      await loadTemplates()
    } catch {
      toast.error("保存失败，请稍后重试")
    } finally {
      setBusy(false)
    }
  }, [name, spec, settings, notes, isDefault, editingId, loadTemplates])

  const deleteTemplate = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/format_templates/${id}`, { method: "DELETE" })
        if (editingId === id) startBlank()
        await loadTemplates()
        toast.success("模板已删除")
      } catch {
        toast.error("删除失败")
      }
    },
    [editingId, loadTemplates, startBlank],
  )

  const setDefault = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/format_templates/${id}`, { method: "PATCH", body: JSON.stringify({ is_default: true }) })
        await loadTemplates()
        if (editingId === id) setIsDefault(true)
        toast.success("已设为默认套用模板")
      } catch {
        toast.error("设置失败")
      }
    },
    [editingId, loadTemplates],
  )

  return {
    // 列表
    templates,
    listLoading,
    loadTemplates,
    // 编辑态
    busy,
    uploading,
    name,
    setName,
    isDefault,
    setIsDefault,
    settings,
    spec,
    notes,
    editingId,
    // 动作
    handleRecognize,
    handleUploadSource,
    sourceFile,
    exporting,
    exportRefreshed,
    exportApplied,
    applying,
    applyResult,
    applyFormat,
    startBlank,
    editTemplate,
    patchSettings,
    patchMargin,
    patchHeading,
    patchBody,
    saveTemplate,
    deleteTemplate,
    setDefault,
  }
}

export type UseFormatTool = ReturnType<typeof useFormatTool>
