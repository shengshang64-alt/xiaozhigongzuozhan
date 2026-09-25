import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import {
  DEFAULT_FORMAT_SETTINGS,
  type FormatAlign,
  type FormatFont,
  type FormatSettings,
  type FormatFontSize,
} from "@/pages/BidWorkspace/bidTypes"
import { extractFormatSpecFromFile, specToFormatSettings, type FormatSpec } from "./formatSpec"
import { refreshDocxFile } from "./refreshDocx"
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

export function useFormatTool() {
  const [templates, setTemplates] = useState<FormatTemplateRecord[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  // R58：第 1 步上传的「待刷新原文档」引用（仅内存，不落库）——导出刷新后文档用
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [exporting, setExporting] = useState(false)

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

  // ---- 上传识别 ----
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

  // ---- R58：按当前模板配置改写原文档并下载（文字 0 改动）----
  const exportRefreshed = useCallback(async (scopes: FormatScope[]) => {
    if (!sourceFile) {
      toast.error("请先在第 1 步上传要刷新的 .docx 文档")
      return
    }
    setExporting(true)
    try {
      const { blob, notes } = await refreshDocxFile(sourceFile, settings, scopes)
      const downloadName = sourceFile.name.replace(/\.docx$/i, "") + "-格式刷新.docx"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = downloadName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
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
    exportRefreshed,
    exporting,
    sourceFile,
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
